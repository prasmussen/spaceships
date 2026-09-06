package lobby

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type fixture struct {
	hub    *Server
	server *httptest.Server
	clock  atomic.Int64
}

func TestProxyAddressTrust(t *testing.T) {
	s := &Server{cfg: Config{TrustedProxyCIDRs: []string{"172.30.90.2/32"}}}
	for _, tc := range []struct{ remote, header, want string }{
		{"172.30.90.2:1234", "198.51.100.10", "198.51.100.10"},
		{"172.30.90.3:1234", "198.51.100.10", "172.30.90.3"},
		{"172.30.90.2:1234", "198.51.100.10, 203.0.113.1", "172.30.90.2"},
		{"172.30.90.2:1234", "", "172.30.90.2"},
	} {
		r := httptest.NewRequest("POST", "/api/session", nil)
		r.RemoteAddr = tc.remote
		r.Header.Set("X-Real-IP", tc.header)
		if got := s.clientAddress(r); got != tc.want {
			t.Fatalf("%+v: got %s", tc, got)
		}
	}
}

func setup(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{}
	f.clock.Store(time.Now().Unix())
	h, err := New(Config{Identity: Identity{1, 1, strings.Repeat("a", 64), strings.Repeat("b", 64), strings.Repeat("c", 64)}, Origins: []string{"pending"}, Regions: []string{"eu", "us"}, TURNURLs: []string{"turn:relay.example:3478"}, TURNSecret: strings.Repeat("s", 32), Now: func() time.Time { return time.Unix(f.clock.Load(), 0) }})
	if err != nil {
		t.Fatal(err)
	}
	f.hub = h
	f.server = httptest.NewServer(h.Handler())
	h.cfg.Origins = []string{f.server.URL}
	t.Cleanup(func() {
		h.mu.Lock()
		for _, c := range h.clients {
			_ = c.conn.Close()
		}
		h.mu.Unlock()
		f.server.Close()
	})
	return f
}
func (f *fixture) guest(t *testing.T) *http.Cookie {
	t.Helper()
	req, _ := http.NewRequest("POST", f.server.URL+"/api/session", nil)
	req.Header.Set("Origin", f.server.URL)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatalf("session: %d", res.StatusCode)
	}
	return res.Cookies()[0]
}
func (f *fixture) connect(t *testing.T, cookie *http.Cookie, region string) *websocket.Conn {
	t.Helper()
	header := http.Header{"Origin": []string{f.server.URL}, "Cookie": []string{cookie.String()}}
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.server.URL, "http")+"/ws", header)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = c.Close() })
	next(t, c, "welcome")
	if region != "" {
		send(t, c, map[string]any{"type": "hello", "region": region, "identity": f.hub.cfg.Identity})
		next(t, c, "hello")
	}
	return c
}
func send(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	if err := c.WriteJSON(v); err != nil {
		t.Fatal(err)
	}
}
func next(t *testing.T, c *websocket.Conn, kind string) map[string]any {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(3 * time.Second))
	for i := 0; i < 30; i++ {
		var m map[string]any
		if err := c.ReadJSON(&m); err != nil {
			t.Fatalf("waiting for %s: %v", kind, err)
		}
		if m["type"] == kind {
			return m
		}
	}
	t.Fatalf("too many messages waiting for %s", kind)
	return nil
}
func TestSessionOriginExpiryAndTURN(t *testing.T) {
	f := setup(t)
	req, _ := http.NewRequest("POST", f.server.URL+"/api/session", nil)
	req.Header.Set("Origin", "https://attacker.example")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 403 {
		t.Fatal(res.StatusCode)
	}
	cookie := f.guest(t)
	if !cookie.HttpOnly || cookie.SameSite != http.SameSiteStrictMode || cookie.MaxAge <= 0 {
		t.Fatal("unsafe cookie attributes")
	}
	req, _ = http.NewRequest("GET", f.server.URL+"/api/config", nil)
	req.AddCookie(cookie)
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		ICEServers []struct{ Username, Credential string } `json:"iceServers"`
	}
	if err = json.NewDecoder(res.Body).Decode(&config); err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	ice := config.ICEServers[0]
	mac := hmac.New(sha1.New, []byte(f.hub.cfg.TURNSecret))
	mac.Write([]byte(ice.Username))
	if ice.Credential != base64.StdEncoding.EncodeToString(mac.Sum(nil)) {
		t.Fatal("invalid TURN credentials")
	}
	f.clock.Add(7 * 3600)
	f.hub.Cleanup()
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatal("expired session accepted")
	}
}
func TestWebSocketRequiresSessionAndOrigin(t *testing.T) {
	f := setup(t)
	url := "ws" + strings.TrimPrefix(f.server.URL, "http") + "/ws"
	_, res, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{f.server.URL}})
	if err == nil || res.StatusCode != 401 {
		t.Fatal("unauthenticated socket accepted")
	}
	cookie := f.guest(t)
	_, res, err = websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{"https://evil.example"}, "Cookie": []string{cookie.String()}})
	if err == nil || res.StatusCode != 403 {
		t.Fatal("foreign origin accepted")
	}
}
func TestInviteReadySignalingFinishAndRematch(t *testing.T) {
	f := setup(t)
	a := f.connect(t, f.guest(t), "eu")
	b := f.connect(t, f.guest(t), "eu")
	stranger := f.connect(t, f.guest(t), "eu")
	send(t, a, map[string]any{"type": "create", "players": 2})
	room := next(t, a, "room")
	code := room["code"].(string)
	send(t, b, map[string]any{"type": "join", "code": code})
	next(t, b, "room")
	send(t, a, map[string]any{"type": "ready", "ready": true})
	send(t, b, map[string]any{"type": "ready", "ready": true})
	ma := next(t, a, "match")
	mb := next(t, b, "match")
	match := ma["match"].(map[string]any)
	id := match["id"].(string)
	if ma["slot"] != float64(0) || mb["slot"] != float64(1) || mb["match"].(map[string]any)["id"] != id {
		t.Fatal("unstable slots or match")
	}
	send(t, stranger, map[string]any{"type": "signal", "recipient": 1, "matchId": id, "signal": map[string]string{"type": "offer"}})
	next(t, stranger, "error")
	send(t, a, map[string]any{"type": "signal", "recipient": 1, "matchId": id, "signal": map[string]string{"type": "offer", "sdp": "test"}})
	signal := next(t, b, "signal")
	if signal["sender"] != float64(0) || signal["matchId"] != id {
		t.Fatal("signal not room scoped")
	}
	send(t, a, map[string]any{"type": "finish", "matchId": id, "winner": 0})
	send(t, b, map[string]any{"type": "finish", "matchId": id, "winner": 0})
	ended := next(t, b, "ended")
	if ended["trust"] != "unverified" {
		t.Fatal("trusted casual result")
	}
	send(t, a, map[string]any{"type": "rematch"})
	send(t, b, map[string]any{"type": "rematch"})
	again := next(t, a, "match")["match"].(map[string]any)
	if again["id"] == id || again["epoch"] == match["epoch"] {
		t.Fatal("reused match epoch")
	}
	next(t, b, "match")
	send(t, a, map[string]any{"type": "leave"})
	ended = next(t, b, "ended")
	if ended["reason"] != "disconnected" {
		t.Fatal(ended)
	}
}
func TestQueueCompatibilityRegionsAndCancellation(t *testing.T) {
	f := setup(t)
	a := f.connect(t, f.guest(t), "eu")
	b := f.connect(t, f.guest(t), "us")
	c := f.connect(t, f.guest(t), "")
	bad := f.hub.cfg.Identity
	bad.WASM = strings.Repeat("d", 64)
	send(t, c, map[string]any{"type": "hello", "identity": bad, "region": "eu"})
	next(t, c, "error")
	send(t, c, map[string]any{"type": "queue", "players": 2})
	next(t, c, "error")
	send(t, a, map[string]any{"type": "queue", "players": 2})
	next(t, a, "queued")
	send(t, b, map[string]any{"type": "queue", "players": 2})
	next(t, b, "queued")
	send(t, b, map[string]any{"type": "cancelQueue"})
	next(t, b, "queueCancelled")
	send(t, c, map[string]any{"type": "hello", "identity": f.hub.cfg.Identity, "region": "eu"})
	next(t, c, "hello")
	send(t, c, map[string]any{"type": "queue", "players": 2})
	ma := next(t, a, "match")
	mc := next(t, c, "match")
	if ma["match"].(map[string]any)["id"] != mc["match"].(map[string]any)["id"] {
		t.Fatal("queue did not pair")
	}
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	if len(f.hub.queue) != 0 {
		t.Fatal("cancelled queue entry retained")
	}
}
func TestReconnectPreservesSlotAndCleanupRemovesAbandonedRoom(t *testing.T) {
	f := setup(t)
	cookie := f.guest(t)
	a := f.connect(t, cookie, "eu")
	send(t, a, map[string]any{"type": "create", "players": 2})
	code := next(t, a, "room")["code"]
	replacement := f.connect(t, cookie, "")
	r := next(t, replacement, "room")
	if r["code"] != code || r["slot"] != float64(0) {
		t.Fatal("reconnect lost room")
	}
	_ = replacement.Close()
	deadline := time.Now().Add(time.Second)
	for {
		f.hub.mu.Lock()
		connected := f.hub.clients[cookie.Value].connected
		f.hub.mu.Unlock()
		if !connected {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("disconnect not observed")
		}
		time.Sleep(time.Millisecond)
	}
	f.clock.Add(11)
	f.hub.Cleanup()
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	if len(f.hub.rooms) != 0 || len(f.hub.clients) != 0 {
		t.Fatal("abandoned room retained")
	}
}

func TestMetricsAuthenticationAndBoundedReports(t *testing.T) {
	f := setup(t)
	f.hub.cfg.MetricsToken = "operator-test-token"
	a := f.connect(t, f.guest(t), "eu")
	b := f.connect(t, f.guest(t), "eu")
	send(t, a, map[string]any{"type": "queue", "players": 2})
	next(t, a, "queued")
	send(t, b, map[string]any{"type": "queue", "players": 2})
	id := next(t, a, "match")["match"].(map[string]any)["id"]
	send(t, a, map[string]any{"type": "metrics", "matchId": id, "metrics": map[string]any{"connections": 2}})
	next(t, a, "error")
	send(t, a, map[string]any{"type": "metrics", "matchId": id, "metrics": map[string]any{"connections": 1, "relayed": 1, "rttMs": 80, "maxDepth": 7}})
	send(t, a, map[string]any{"type": "invalid"})
	next(t, a, "error") // prior report has been processed
	req, _ := http.NewRequest("GET", f.server.URL+"/api/metrics", nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal("metrics exposed without token")
	}
	req.Header.Set("Authorization", "Bearer operator-test-token")
	res, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var metrics Metrics
	if err = json.NewDecoder(res.Body).Decode(&metrics); err != nil {
		t.Fatal(err)
	}
	if metrics.Connections != 1 || metrics.Relayed != 1 || metrics.Reports != 1 || metrics.MaxDepth != 7 {
		t.Fatalf("wrong metrics: %+v", metrics)
	}
}
func TestOversizedWebSocketMessageIsClosed(t *testing.T) {
	f := setup(t)
	c := f.connect(t, f.guest(t), "eu")
	_ = c.WriteMessage(websocket.TextMessage, []byte(`{"type":"signal","signal":"`+strings.Repeat("x", 40000)+`"}`))
	_ = c.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := c.ReadMessage(); err == nil {
		t.Fatal("oversized message accepted")
	}
}

func TestSharedGuestWindowsAndReconnect(t *testing.T) {
	f := setup(t)
	cookie := f.guest(t)
	connect := func(instance string) *websocket.Conn {
		t.Helper()
		header := http.Header{"Origin": {f.server.URL}, "Cookie": {cookie.String()}}
		c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.server.URL, "http")+"/ws?instance="+instance, header)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = c.Close() })
		return c
	}
	a := connect(strings.Repeat("a", 32))
	next(t, a, "welcome")
	send(t, a, map[string]any{"type": "hello", "region": "eu", "identity": f.hub.cfg.Identity})
	next(t, a, "hello")
	send(t, a, map[string]any{"type": "queue", "players": 2})
	next(t, a, "queued")
	b := connect(strings.Repeat("b", 32))
	next(t, b, "welcome")
	send(t, b, map[string]any{"type": "hello", "region": "eu", "identity": f.hub.cfg.Identity})
	next(t, b, "hello")
	send(t, b, map[string]any{"type": "queue", "players": 2})
	first := next(t, a, "match")
	second := next(t, b, "match")
	if first["match"].(map[string]any)["id"] != second["match"].(map[string]any)["id"] {
		t.Fatal("windows did not match")
	}
	resumed := connect(strings.Repeat("a", 32))
	if next(t, resumed, "welcome")["resumed"] != true {
		t.Fatal("page did not resume")
	}
	restored := next(t, resumed, "match")
	if restored["match"].(map[string]any)["id"] != first["match"].(map[string]any)["id"] {
		t.Fatal("reconnect lost match")
	}
	send(t, resumed, map[string]any{"type": "leave"})
	next(t, b, "ended")
	f.hub.Cleanup()
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	if len(f.hub.clients) != 2 {
		t.Fatal("cleanup incorrectly expired page instances")
	}
}

func TestMultiplayerQueueSignalingFinishRematch(t *testing.T) {
	for _, players := range []int{3, 4} {
		t.Run(strconv.Itoa(players), func(t *testing.T) {
			f := setup(t)
			clients := make([]*websocket.Conn, players)
			for id := range clients {
				clients[id] = f.connect(t, f.guest(t), "eu")
				send(t, clients[id], map[string]any{"type": "queue", "players": players})
				if id < players-1 {
					next(t, clients[id], "queued")
				}
			}
			matches := make([]map[string]any, players)
			for id, c := range clients {
				m := next(t, c, "match")
				if m["slot"] != float64(id) {
					t.Fatal("unstable slot", m)
				}
				matches[id] = m["match"].(map[string]any)
				if matches[id]["players"] != float64(players) {
					t.Fatal("wrong count")
				}
			}
			id := matches[0]["id"].(string)
			send(t, clients[0], map[string]any{"type": "signal", "matchId": id, "recipient": players - 1, "sender": 2, "signal": map[string]any{"candidate": "test"}})
			signal := next(t, clients[players-1], "signal")
			if signal["sender"] != float64(0) {
				t.Fatal("sender spoofed")
			}
			for _, recipient := range []int{-1, 0, players} {
				send(t, clients[0], map[string]any{"type": "signal", "matchId": id, "recipient": recipient, "signal": map[string]string{"candidate": "test"}})
				next(t, clients[0], "error")
			}
			send(t, clients[0], map[string]any{"type": "finish", "matchId": id, "winner": players - 1})
			// A finish report does not dismantle transport before all players confirm.
			f.hub.mu.Lock()
			active := 0
			for _, r := range f.hub.rooms {
				if r.match != nil {
					active++
				}
			}
			f.hub.mu.Unlock()
			if active != 1 {
				t.Fatal("ended before all reports")
			}
			for _, c := range clients[1:] {
				send(t, c, map[string]any{"type": "finish", "matchId": id, "winner": players - 1})
			}
			for _, c := range clients {
				ended := next(t, c, "ended")
				if ended["winner"] != float64(players-1) {
					t.Fatal(ended)
				}
			}
			for _, c := range clients {
				send(t, c, map[string]any{"type": "rematch"})
			}
			for _, c := range clients {
				m := next(t, c, "match")["match"].(map[string]any)
				if m["id"] == id || m["players"] != float64(players) {
					t.Fatal("invalid rematch", m)
				}
			}
			send(t, clients[players-1], map[string]any{"type": "leave"})
			for _, c := range clients[:players-1] {
				if next(t, c, "ended")["reason"] != "disconnected" {
					t.Fatal("missing disconnect")
				}
			}
		})
	}
}

func TestPlayerCountQueueIsolationAndInviteCapacity(t *testing.T) {
	f := setup(t)
	a := f.connect(t, f.guest(t), "eu")
	b := f.connect(t, f.guest(t), "eu")
	for _, count := range []int{0, 1, 5} {
		send(t, a, map[string]any{"type": "queue", "players": count})
		next(t, a, "error")
	}
	send(t, a, map[string]any{"type": "queue", "players": 3})
	next(t, a, "queued")
	send(t, b, map[string]any{"type": "queue", "players": 4})
	next(t, b, "queued")
	f.hub.mu.Lock()
	queued := len(f.hub.queue)
	rooms := len(f.hub.rooms)
	f.hub.mu.Unlock()
	if queued != 2 || rooms != 0 {
		t.Fatal("mixed player counts matched")
	}
	send(t, a, map[string]any{"type": "create", "players": 4})
	code := next(t, a, "room")["code"].(string)
	send(t, b, map[string]any{"type": "join", "code": code})
	next(t, b, "room")
	for range 2 {
		c := f.connect(t, f.guest(t), "eu")
		send(t, c, map[string]any{"type": "join", "code": code})
		state := next(t, c, "room")
		if len(state["present"].([]any)) != 4 {
			t.Fatal("wrong room size")
		}
	}
	extra := f.connect(t, f.guest(t), "eu")
	send(t, extra, map[string]any{"type": "join", "code": code})
	next(t, extra, "error")
}
