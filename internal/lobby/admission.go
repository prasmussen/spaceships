package lobby

import (
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

// All admission state is protected by Server.mu. Limits include disconnected
// clients retained for reconnect and reservations whose upgrade is in flight.
type AdmissionMetrics struct {
	Sessions         int    `json:"sessions"`
	Clients          int    `json:"clients"`
	Sockets          int    `json:"sockets"`
	Pending          int    `json:"pendingUpgrades"`
	Rooms            int    `json:"rooms"`
	Queued           int    `json:"queued"`
	Sources          int    `json:"sources"`
	RejectedSessions uint64 `json:"rejectedSessions"`
	RejectedSockets  uint64 `json:"rejectedSockets"`
	RejectedJoins    uint64 `json:"rejectedJoins"`
	LimitedICE       uint64 `json:"limitedICE"`
	RelayResponses   uint64 `json:"relayResponses"`
}

const maxClients = 512
const maxSessionClients = 4
const maxSourceClients = 64

func allow(r *rate, now time.Time, window time.Duration, limit int) bool {
	if r.since.IsZero() || now.Sub(r.since) >= window {
		*r = rate{since: now}
	}
	if r.count >= limit {
		return false
	}
	r.count++
	return true
}
func limited(w http.ResponseWriter) {
	w.Header().Set("Retry-After", "5")
	http.Error(w, "Online capacity or request limit reached. Please try again shortly.", http.StatusTooManyRequests)
}
func instanceKey(token, instance string) (string, bool) {
	if instance == "" {
		return token, true
	}
	decoded, err := hex.DecodeString(instance)
	if err != nil || len(decoded) != 16 {
		return "", false
	}
	return token + ":" + strings.ToLower(instance), true
}
func (s *Server) sourceAddress(r *http.Request) string {
	address := s.clientAddress(r)
	if ip, err := netip.ParseAddr(address); err == nil && ip.Is6() {
		return netip.PrefixFrom(ip, 64).Masked().String()
	}
	return address
}
func (s *Server) source(address string) *sourceBudget {
	v := s.sources[address]
	if v == nil {
		if len(s.sources) >= 10000 {
			return nil
		}
		v = &sourceBudget{}
		s.sources[address] = v
	}
	v.last = s.cfg.Now()
	return v
}
func (s *Server) sessionActive(token string) bool {
	for _, c := range s.clients {
		if c.token == token && c.connected {
			return true
		}
	}
	for _, c := range s.pending {
		if c.token == token {
			return true
		}
	}
	return false
}
func (s *Server) reserve(key string, c *client) (admitted bool) {
	defer func() {
		if !admitted {
			s.admission.RejectedSockets++
		}
	}()
	source := s.source(c.source)
	if source == nil || !allow(&source.upgrades, s.cfg.Now(), time.Minute, 120) || s.pending[key] != nil {
		return false
	}
	// Replacements may briefly coexist with their closing predecessor, but actual
	// sockets (including handshakes) have separate hard limits as well.
	liveSession, liveSource := 0, 0
	for other := range s.live {
		if other.token == c.token {
			liveSession++
		}
		if other.source == c.source {
			liveSource++
		}
	}
	if len(s.live) >= maxClients+64 || liveSession >= 8 || liveSource >= 128 {
		return false
	}
	total, sessionCount, sourceCount := 0, 0, 0
	for k, other := range s.clients {
		if k == key {
			continue
		}
		total++
		if other.token == c.token {
			sessionCount++
		}
		// A migrating replacement reserves both sources until the old slot is
		// replaced; a failed upgrade must not overfill its original source.
		replacement := s.pending[k]
		if other.source == c.source || replacement != nil && replacement.source == c.source {
			sourceCount++
		}
	}
	for k, other := range s.pending {
		if s.clients[k] != nil {
			continue
		} // replacement already occupies a retained slot
		total++
		if other.token == c.token {
			sessionCount++
		}
		if other.source == c.source {
			sourceCount++
		}
	}
	if total >= maxClients || sessionCount >= maxSessionClients || sourceCount >= maxSourceClients {
		return false
	}
	s.pending[key] = c
	s.live[c] = true
	return true
}

// Configuration does not grant relay access. Each request names the admitted
// page and match; cookies shared by another idle tab are insufficient.
func (s *Server) credentials(w http.ResponseWriter, r *http.Request) {
	if !s.origin(r) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	s.mu.Lock()
	token := s.token(r)
	if token == "" {
		s.mu.Unlock()
		http.Error(w, "guest session required", http.StatusUnauthorized)
		return
	}
	key, valid := instanceKey(token, r.URL.Query().Get("instance"))
	c := s.clients[key]
	now := s.cfg.Now()
	if !valid || c == nil || !c.hello || !c.connected && now.Sub(c.last) > 10*time.Second {
		s.mu.Unlock()
		http.Error(w, "active match required", http.StatusForbidden)
		return
	}
	room := s.rooms[c.room]
	if room == nil || room.match == nil || room.match.ID != r.URL.Query().Get("matchId") {
		s.mu.Unlock()
		http.Error(w, "active match required", http.StatusForbidden)
		return
	}
	guest := s.sessions[token]
	source := s.source(s.sourceAddress(r))
	if source == nil || !allow(&guest.ice, now, time.Minute, 60) || !allow(&source.ice, now, time.Minute, 240) {
		s.admission.LimitedICE++
		s.mu.Unlock()
		limited(w)
		return
	}
	// Reuse credentials across mesh changes and windows, renewing only near
	// expiry. Rapid calls cannot mint a new timestamped identity on every second.
	if guest.iceExpires <= now.Add(2*time.Minute).Unix() {
		guest.iceExpires = now.Add(10 * time.Minute).Unix()
	}
	expires := guest.iceExpires
	multiplayer := len(room.members) > 1
	if multiplayer && len(s.cfg.TURNURLs) > 0 {
		s.admission.RelayResponses++
	}
	s.mu.Unlock()
	ice := []map[string]any{}
	if len(s.cfg.STUNURLs) > 0 {
		ice = append(ice, map[string]any{"urls": s.cfg.STUNURLs})
	}
	if multiplayer && len(s.cfg.TURNURLs) > 0 {
		username := strconv.FormatInt(expires, 10) + ":" + token[:16]
		mac := hmac.New(sha1.New, []byte(s.cfg.TURNSecret))
		_, _ = mac.Write([]byte(username))
		ice = append(ice, map[string]any{"urls": s.cfg.TURNURLs, "username": username, "credential": base64.StdEncoding.EncodeToString(mac.Sum(nil))})
	}
	jsonResponse(w, map[string]any{"identity": s.cfg.Identity, "iceServers": ice, "iceExpires": expires})
}
