package lobby

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Identity struct {
	Protocol int    `json:"protocol"`
	ABI      int    `json:"abi"`
	WASM     string `json:"wasm"`
	Map      string `json:"map"`
	Config   string `json:"config"`
}
type Config struct {
	TrustedProxyCIDRs []string
	Identity          Identity
	Origins           []string
	Regions           []string
	STUNURLs          []string
	TURNURLs          []string
	TURNSecret        string
	StaticDir         string
	MetricsToken      string
	Now               func() time.Time
}
type Match struct {
	Quick        bool     `json:"quick,omitempty"`
	Snapshot     []byte   `json:"snapshot,omitempty"`
	Slots        []int    `json:"slots,omitempty"`
	Players      int      `json:"players"`
	ID           string   `json:"id"`
	Epoch        uint32   `json:"epoch"`
	Seed         uint32   `json:"seed"`
	Identity     Identity `json:"identity"`
	InputDelay   int      `json:"inputDelay"`
	RecoveryPeer int      `json:"recoveryPeer"`
	Region       string   `json:"region"`
}
type session struct{ expires time.Time }
type rate struct {
	since time.Time
	count int
}
type client struct {
	players   int
	token     string
	conn      *websocket.Conn
	send      chan any
	done      chan struct{}
	room      string
	region    string
	hello     bool
	connected bool
	last      time.Time
	window    time.Time
	messages  int
}
type room struct {
	quick        bool
	previous     []*client
	transition   string
	authority    *client
	transitionAt time.Time
	code         string
	members      []*client
	ready        []bool
	reported     []bool
	winner       *int
	match        *Match
	region       string
}
type message struct {
	Transition string          `json:"transition"`
	Snapshot   []byte          `json:"snapshot"`
	Players    int             `json:"players"`
	Recipient  *int            `json:"recipient"`
	Type       string          `json:"type"`
	Identity   Identity        `json:"identity"`
	Region     string          `json:"region"`
	Code       string          `json:"code"`
	Ready      bool            `json:"ready"`
	MatchID    string          `json:"matchId"`
	Signal     json.RawMessage `json:"signal"`
	Winner     *int            `json:"winner"`
	Metrics    *Metrics        `json:"metrics"`
}
type Metrics struct {
	Connections uint64 `json:"connections"`
	Relayed     uint64 `json:"relayed"`
	RTT         uint64 `json:"rttMs"`
	Stalls      uint64 `json:"stalls"`
	Rollbacks   uint64 `json:"rollbacks"`
	MaxDepth    uint64 `json:"maxDepth"`
	Desyncs     uint64 `json:"desyncs"`
	Reports     uint64 `json:"reports"`
}
type Server struct {
	mu       sync.Mutex
	cfg      Config
	sessions map[string]session
	clients  map[string]*client
	rooms    map[string]*room
	queue    []*client
	rates    map[string]rate
	metrics  Metrics
}

func New(cfg Config) (*Server, error) {
	for _, cidr := range cfg.TrustedProxyCIDRs {
		if _, err := netip.ParsePrefix(cidr); err != nil {
			return nil, errors.New("invalid trusted proxy CIDR")
		}
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if len(cfg.Origins) == 0 || len(cfg.Regions) == 0 || cfg.Identity.Protocol < 1 || cfg.Identity.ABI < 1 {
		return nil, errors.New("origins, regions and build identity are required")
	}
	for _, hash := range []string{cfg.Identity.WASM, cfg.Identity.Map, cfg.Identity.Config} {
		if b, e := hex.DecodeString(hash); e != nil || len(b) != 32 {
			return nil, errors.New("invalid build digest")
		}
	}
	if len(cfg.TURNURLs) > 0 && len(cfg.TURNSecret) < 24 {
		return nil, errors.New("TURN requires a shared secret of at least 24 characters")
	}
	return &Server{cfg: cfg, sessions: map[string]session{}, clients: map[string]*client{}, rooms: map[string]*room{}, rates: map[string]rate{}}, nil
}
func randomID(bytes int) string {
	b := make([]byte, bytes)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}
func random32() uint32 {
	var b [4]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return binary.LittleEndian.Uint32(b[:])
}
func (s *Server) origin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	for _, allowed := range s.cfg.Origins {
		if o == allowed {
			return true
		}
	}
	return false
}
func jsonResponse(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(value)
}
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/session", s.issueSession)
	mux.HandleFunc("GET /api/config", s.configuration)
	mux.HandleFunc("GET /ws", s.websocket)
	mux.HandleFunc("GET /api/metrics", func(w http.ResponseWriter, r *http.Request) {
		if s.cfg.MetricsToken == "" || !hmac.Equal([]byte(r.Header.Get("Authorization")), []byte("Bearer "+s.cfg.MetricsToken)) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		jsonResponse(w, s.Metrics())
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { jsonResponse(w, map[string]string{"status": "ok"}) })
	if s.cfg.StaticDir != "" {
		mux.Handle("GET /", http.FileServer(http.Dir(s.cfg.StaticDir)))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "same-origin")
		mux.ServeHTTP(w, r)
	})
}
func (s *Server) token(r *http.Request) string {
	c, err := r.Cookie("spaceships_guest")
	if err != nil {
		return ""
	}
	v, ok := s.sessions[c.Value]
	if !ok || !v.expires.After(s.cfg.Now()) {
		return ""
	}
	return c.Value
}

// X-Real-IP is accepted only from an explicitly configured proxy, which must overwrite it.
func (s *Server) clientAddress(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	address, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	for _, cidr := range s.cfg.TrustedProxyCIDRs {
		prefix, _ := netip.ParsePrefix(cidr)
		if prefix.Contains(address.Unmap()) {
			if forwarded, err := netip.ParseAddr(r.Header.Get("X-Real-IP")); err == nil {
				return forwarded.Unmap().String()
			}
			break
		}
	}
	return address.Unmap().String()
}
func (s *Server) issueSession(w http.ResponseWriter, r *http.Request) {
	if !s.origin(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	token := s.token(r)
	if token == "" {
		host := s.clientAddress(r)
		now := s.cfg.Now()
		entry := s.rates[host]
		if now.Sub(entry.since) > time.Minute {
			entry = rate{since: now}
		}
		if entry.count >= 20 || len(s.sessions) >= 10000 || len(s.rates) >= 10000 {
			http.Error(w, "session capacity reached", http.StatusTooManyRequests)
			return
		}
		entry.count++
		s.rates[host] = entry
		token = randomID(32)
		s.sessions[token] = session{expires: now.Add(6 * time.Hour)}
	}
	expires := s.sessions[token].expires
	http.SetCookie(w, &http.Cookie{Name: "spaceships_guest", Value: token, Path: "/", HttpOnly: true, Secure: strings.HasPrefix(r.Header.Get("Origin"), "https://"), SameSite: http.SameSiteStrictMode, Expires: expires, MaxAge: int(expires.Sub(s.cfg.Now()).Seconds())})
	jsonResponse(w, map[string]any{"guest": true, "expires": expires})
}
func (s *Server) configuration(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	token := s.token(r)
	if token == "" {
		http.Error(w, "guest session required", http.StatusUnauthorized)
		return
	}
	ice := []map[string]any{}
	if len(s.cfg.STUNURLs) > 0 {
		ice = append(ice, map[string]any{"urls": s.cfg.STUNURLs})
	}
	expires := s.cfg.Now().Add(10 * time.Minute).Unix()
	if len(s.cfg.TURNURLs) > 0 {
		// coturn TURN REST credentials: expiry:guest, base64(HMAC-SHA1(secret, username)).
		username := strconv.FormatInt(expires, 10) + ":" + token[:16]
		mac := hmac.New(sha1.New, []byte(s.cfg.TURNSecret))
		_, _ = mac.Write([]byte(username))
		ice = append(ice, map[string]any{"urls": s.cfg.TURNURLs, "username": username, "credential": base64.StdEncoding.EncodeToString(mac.Sum(nil))})
	}
	jsonResponse(w, map[string]any{"identity": s.cfg.Identity, "regions": s.cfg.Regions, "iceServers": ice, "iceExpires": expires, "inputDelay": 2, "resultTrust": "unverified"})
}
func (s *Server) websocket(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	token := s.token(r)
	s.mu.Unlock()
	if token == "" {
		http.Error(w, "guest session required", http.StatusUnauthorized)
		return
	}
	// A guest cookie is shared by windows; only reconnect the same page instance.
	key := token
	if instance := r.URL.Query().Get("instance"); instance != "" {
		if decoded, err := hex.DecodeString(instance); err != nil || len(decoded) != 16 {
			http.Error(w, "invalid page instance", http.StatusBadRequest)
			return
		}
		key += ":" + strings.ToLower(instance)
	}
	upgrader := websocket.Upgrader{CheckOrigin: s.origin, HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	now := s.cfg.Now()
	c := &client{token: token, conn: conn, send: make(chan any, 64), done: make(chan struct{}), connected: true, last: now, window: now}
	s.mu.Lock()
	if old := s.clients[key]; old != nil {
		c.room = old.room
		c.region = old.region
		c.players = old.players
		c.hello = old.hello
		if old.conn != nil {
			_ = old.conn.Close()
		}
		if room := s.rooms[c.room]; room != nil {
			for i, p := range room.members {
				if p == old {
					room.members[i] = c
				}
			}
		}
		if room := s.rooms[c.room]; room != nil {
			for i, p := range room.previous {
				if p == old {
					room.previous[i] = c
				}
			}
			if room.authority == old {
				room.authority = c
			}
		}
		for i, p := range s.queue {
			if p == old {
				s.queue[i] = c
			}
		}
	}
	s.clients[key] = c
	s.send(c, map[string]any{"type": "welcome", "identity": s.cfg.Identity, "resumed": c.hello, "region": c.region})
	if room := s.rooms[c.room]; room != nil {
		s.roomState(room)
		if room.match != nil {
			s.sendMatch(c, room)
			if room.transition != "" {
				s.requestTransition(room)
			}
		}
	}
	s.mu.Unlock()
	go s.writer(c)
	defer func() {
		close(c.done)
		_ = conn.Close()
		s.mu.Lock()
		defer s.mu.Unlock()
		if s.clients[key] == c {
			c.connected = false
			c.last = s.cfg.Now()
			if room := s.rooms[c.room]; room != nil {
				s.broadcast(room, map[string]any{"type": "peerDisconnected", "resumeSeconds": 10})
			}
		}
	}()
	conn.SetReadLimit(32768)
	_ = conn.SetReadDeadline(time.Now().Add(45 * time.Second))
	conn.SetPongHandler(func(string) error { _ = conn.SetReadDeadline(time.Now().Add(45 * time.Second)); return nil })
	for {
		kind, raw, err := conn.ReadMessage()
		if err != nil {
			return
		}
		if kind != websocket.TextMessage {
			return
		}
		var m message
		if json.Unmarshal(raw, &m) != nil {
			return
		}
		s.mu.Lock()
		if s.clients[key] != c {
			s.mu.Unlock()
			return
		}
		s.handle(c, m)
		s.mu.Unlock()
	}
}
func (s *Server) writer(c *client) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case value := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if c.conn.WriteJSON(value) != nil {
				_ = c.conn.Close()
				return
			}
		case <-ticker.C:
			if c.conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
				_ = c.conn.Close()
				return
			}
		}
	}
}

// All following room/client methods run under s.mu. A slow client cannot block rooms.
func (s *Server) send(c *client, value any) {
	if c == nil {
		return
	}
	select {
	case c.send <- value:
	default:
		_ = c.conn.Close()
	}
}
func (s *Server) fail(c *client, reason string) {
	s.send(c, map[string]any{"type": "error", "message": reason})
}
func (s *Server) broadcast(r *room, value any) {
	for _, c := range r.members {
		if c != nil {
			s.send(c, value)
		}
	}
}
func (s *Server) roomState(r *room) {
	present := make([]bool, len(r.members))
	for i, p := range r.members {
		present[i] = p != nil
	}
	for slot, c := range r.members {
		if c != nil {
			s.send(c, map[string]any{"type": "room", "code": r.code, "slot": slot, "ready": append([]bool(nil), r.ready...), "present": present, "players": len(r.members), "region": r.region, "active": r.match != nil})
		}
	}
}
func (s *Server) sendMatch(c *client, r *room) {
	members := r.members
	if r.transition != "" {
		members = r.previous
	}
	for slot, p := range members {
		if p == c {
			s.send(c, map[string]any{"type": "match", "slot": slot, "match": r.match})
		}
	}
}
func (s *Server) start(r *room) {
	if r.match != nil {
		return
	}
	for i, p := range r.members {
		if p == nil || !p.connected || !r.ready[i] {
			return
		}
	}
	r.reported = make([]bool, len(r.members))
	r.winner = nil
	r.match = &Match{Players: len(r.members), ID: randomID(16), Epoch: random32(), Seed: random32(), Identity: s.cfg.Identity, InputDelay: 2, RecoveryPeer: 0, Region: r.region}
	for _, c := range r.members {
		s.sendMatch(c, r)
	}
	s.roomState(r)
}
func (s *Server) unqueue(c *client) {
	for i := 0; i < len(s.queue); {
		if s.queue[i] == c {
			s.queue = append(s.queue[:i], s.queue[i+1:]...)
		} else {
			i++
		}
	}
}
func (s *Server) leave(c *client) {
	s.unqueue(c)
	r := s.rooms[c.room]
	c.room = ""
	if r == nil {
		return
	}
	if r.quick {
		s.quickLeave(r, c)
		return
	}
	if r.match != nil {
		s.broadcast(r, map[string]any{"type": "ended", "matchId": r.match.ID, "reason": "disconnected", "trust": "unverified"})
		r.match = nil
	}
	for i, p := range r.members {
		if p == c {
			r.members[i] = nil
		}
	}
	r.ready = make([]bool, len(r.members))
	empty := true
	for _, p := range r.members {
		if p != nil {
			empty = false
		}
	}
	if empty {
		delete(s.rooms, r.code)
	} else {
		s.roomState(r)
	}
}
func (s *Server) newRoom(members []*client, players int) *room {
	code := randomID(4)
	for s.rooms[code] != nil {
		code = randomID(4)
	}
	r := &room{code: code, members: make([]*client, players), ready: make([]bool, players), region: members[0].region}
	copy(r.members, members)
	s.rooms[code] = r
	for _, c := range members {
		c.room = code
	}
	return r
}
func (s *Server) handle(c *client, m message) {
	now := s.cfg.Now()
	c.last = now
	if now.Sub(c.window) >= time.Second {
		c.window = now
		c.messages = 0
	}
	c.messages++
	if c.messages > 100 {
		_ = c.conn.Close()
		return
	}
	if m.Type == "hello" {
		if m.Identity != s.cfg.Identity {
			s.fail(c, "incompatible build")
			s.unqueue(c)
			c.hello = false
			return
		}
		valid := false
		for _, region := range s.cfg.Regions {
			if region == m.Region {
				valid = true
			}
		}
		if !valid {
			s.fail(c, "unknown region")
			return
		}
		if c.room != "" || s.queued(c) {
			s.fail(c, "leave before changing region")
			return
		}
		c.hello = true
		c.region = m.Region
		s.send(c, map[string]any{"type": "hello", "region": c.region})
		return
	}
	if !c.hello {
		s.fail(c, "compatible hello required")
		return
	}
	switch m.Type {
	case "quickPlay":
		if c.room != "" {
			s.fail(c, "already in room")
			return
		}
		s.unqueue(c)
		for _, r := range s.rooms {
			if r.quick && r.region == c.region && len(r.members) < 4 {
				if r.previous == nil {
					r.previous = append([]*client(nil), r.members...)
				}
				r.members = append(r.members, c)
				r.ready = make([]bool, len(r.members))
				c.room = r.code
				s.transitionRoom(r)
				return
			}
		}
		if len(s.rooms) >= 5000 {
			s.fail(c, "room capacity reached")
			return
		}
		r := s.newRoom([]*client{c}, 1)
		r.quick = true
		s.startQuick(r, nil, nil)
	case "snapshot":
		r := s.rooms[c.room]
		if r == nil || !r.quick || r.authority != c || r.transition == "" || m.Transition != r.transition || r.match == nil || m.MatchID != r.match.ID {
			return
		}
		if len(m.Snapshot) != 8512 {
			s.fail(c, "invalid room snapshot")
			return
		}
		slots := make([]int, len(r.members))
		for i, member := range r.members {
			slots[i] = -1
			for old, previous := range r.previous {
				if member == previous {
					slots[i] = old
					break
				}
			}
		}
		s.startQuick(r, m.Snapshot, slots)
	case "create":
		if m.Players < 2 || m.Players > 4 {
			s.fail(c, "invalid player count")
			return
		}
		if c.room != "" {
			s.fail(c, "already in room")
			return
		}
		if len(s.rooms) >= 5000 {
			s.fail(c, "room capacity reached")
			return
		}
		s.unqueue(c)
		r := s.newRoom([]*client{c}, m.Players)
		s.roomState(r)
	case "join":
		r := s.rooms[strings.ToLower(m.Code)]
		if c.room != "" || r == nil || r.match != nil || r.region != c.region {
			s.fail(c, "room unavailable")
			return
		}
		slot := -1
		for i, p := range r.members {
			if p == nil {
				slot = i
				break
			}
		}
		if slot < 0 {
			s.fail(c, "room full")
			return
		}
		s.unqueue(c)
		r.members[slot] = c
		c.room = r.code
		r.ready = make([]bool, len(r.members))
		s.roomState(r)
	case "queue":
		if m.Players < 2 || m.Players > 4 {
			s.fail(c, "invalid player count")
			return
		}
		if c.room != "" {
			s.fail(c, "leave room first")
			return
		}
		s.unqueue(c)
		c.players = m.Players
		members := []*client{}
		for _, other := range s.queue {
			if other.connected && other.hello && other.region == c.region && other.players == c.players {
				members = append(members, other)
				if len(members) == m.Players-1 {
					break
				}
			}
		}
		if len(members) == m.Players-1 {
			if len(s.rooms) >= 5000 {
				s.fail(c, "room capacity reached")
				return
			}
			for _, other := range members {
				s.unqueue(other)
			}
			members = append(members, c)
			r := s.newRoom(members, m.Players)
			for i := range r.ready {
				r.ready[i] = true
			}
			s.roomState(r)
			s.start(r)
			return
		}
		s.queue = append(s.queue, c)
		s.send(c, map[string]any{"type": "queued", "region": c.region, "players": m.Players})
	case "cancelQueue":
		s.unqueue(c)
		s.send(c, map[string]any{"type": "queueCancelled"})
	case "leave":
		s.leave(c)
		s.send(c, map[string]any{"type": "left"})
	case "ready", "rematch":
		r := s.rooms[c.room]
		if r == nil || r.match != nil {
			s.fail(c, "room not waiting")
			return
		}
		for i, p := range r.members {
			if p == c {
				r.ready[i] = m.Ready || m.Type == "rematch"
			}
		}
		s.roomState(r)
		s.start(r)
	case "signal":
		r := s.rooms[c.room]
		if r != nil && r.transition != "" {
			return
		}
		if r == nil || r.match == nil || r.match.ID != m.MatchID || len(m.Signal) == 0 || len(m.Signal) > 24000 || m.Recipient == nil || *m.Recipient < 0 || *m.Recipient >= len(r.members) || r.members[*m.Recipient] == nil || r.members[*m.Recipient] == c {
			if r != nil && r.quick {
				return
			}
			s.fail(c, "invalid room signal")
			return
		}
		for slot, p := range r.members {
			if p == c {
				s.send(r.members[*m.Recipient], map[string]any{"type": "signal", "matchId": m.MatchID, "sender": slot, "signal": m.Signal})
			}
		}
	case "finish":
		r := s.rooms[c.room]
		if r != nil && r.transition != "" {
			return
		}
		if r == nil || r.match == nil || r.match.ID != m.MatchID {
			s.fail(c, "unknown match")
			return
		}
		if m.Winner == nil || *m.Winner < 0 || *m.Winner >= len(r.members) {
			s.fail(c, "invalid winner")
			return
		}
		if r.winner != nil && *r.winner != *m.Winner {
			s.fail(c, "conflicting winner report")
			return
		}
		r.winner = m.Winner
		for i, p := range r.members {
			if p == c {
				r.reported[i] = true
			}
		}
		for _, reported := range r.reported {
			if !reported {
				return
			}
		}
		if r.quick {
			s.startQuick(r, nil, nil)
			return
		}
		s.broadcast(r, map[string]any{"type": "ended", "matchId": r.match.ID, "reason": "reported", "winner": m.Winner, "trust": "unverified"})
		r.match = nil
		r.ready = make([]bool, len(r.members))
		s.roomState(r)
	case "metrics":
		r := s.rooms[c.room]
		if r == nil || r.match == nil || r.match.ID != m.MatchID || m.Metrics == nil {
			s.fail(c, "invalid metrics")
			return
		}
		v := m.Metrics
		if v.Connections > 1 || v.Relayed > 1 || v.RTT > 10000 || v.Stalls > 3600 || v.Rollbacks > 3600 || v.MaxDepth > 120 || v.Desyncs > 2 {
			s.fail(c, "metrics out of bounds")
			return
		}
		s.metrics.Connections += v.Connections
		s.metrics.Relayed += v.Relayed
		s.metrics.RTT += v.RTT
		s.metrics.Stalls += v.Stalls
		s.metrics.Rollbacks += v.Rollbacks
		if v.MaxDepth > s.metrics.MaxDepth {
			s.metrics.MaxDepth = v.MaxDepth
		}
		s.metrics.Desyncs += v.Desyncs
		s.metrics.Reports++
	default:
		s.fail(c, "unknown message")
	}
}
func (s *Server) queued(c *client) bool {
	for _, p := range s.queue {
		if p == c {
			return true
		}
	}
	return false
}
func (s *Server) Cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now()
	for token, c := range s.clients {
		expired := !s.sessions[c.token].expires.After(now)
		if expired || !c.connected && now.Sub(c.last) > 10*time.Second || c.connected && now.Sub(c.last) > 30*time.Minute {
			s.leave(c)
			delete(s.clients, token)
			_ = c.conn.Close()
		}
	}
	for _, r := range s.rooms {
		if r.quick && r.transition != "" && now.Sub(r.transitionAt) > 10*time.Second {
			s.startQuick(r, nil, nil)
		}
	}
	for token, v := range s.sessions {
		if !v.expires.After(now) {
			delete(s.sessions, token)
		}
	}
	for ip, v := range s.rates {
		if now.Sub(v.since) > 2*time.Minute {
			delete(s.rates, ip)
		}
	}
}
func (s *Server) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.mu.Lock()
			for _, c := range s.clients {
				_ = c.conn.Close()
			}
			s.mu.Unlock()
			return
		case <-ticker.C:
			s.Cleanup()
		}
	}
}
func (s *Server) Metrics() Metrics { s.mu.Lock(); defer s.mu.Unlock(); return s.metrics }
