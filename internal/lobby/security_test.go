package lobby

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func request(f *fixture, method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("Origin", f.server.URL)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	f.hub.Handler().ServeHTTP(w, r)
	return w
}
func dialInstance(f *fixture, cookie *http.Cookie, id int) (*websocket.Conn, *http.Response, error) {
	return websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(f.server.URL, "http")+fmt.Sprintf("/ws?instance=%032x", id), http.Header{"Origin": {f.server.URL}, "Cookie": {cookie.String()}})
}
func TestSocketAdmissionAndReconnectAtGuestCapacity(t *testing.T) {
	f := setup(t)
	cookie := f.guest(t)
	for i := 0; i < 4; i++ {
		c, _, err := dialInstance(f, cookie, i)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { c.Close() })
		next(t, c, "welcome")
		send(t, c, map[string]any{"type": "hello", "identity": f.hub.cfg.Identity, "region": "eu"})
		next(t, c, "hello")
	}
	c, res, err := dialInstance(f, cookie, 4)
	if err == nil {
		c.Close()
		t.Fatal("fifth page accepted")
	}
	if res.StatusCode != 429 {
		t.Fatal(res.StatusCode)
	}
	replacement, _, err := dialInstance(f, cookie, 0)
	if err != nil {
		t.Fatal("same-instance reconnect rejected", err)
	}
	defer replacement.Close()
	if next(t, replacement, "welcome")["resumed"] != true {
		t.Fatal("reconnect not resumed")
	}
	// An invalid upgrade must release its reservation even on a replacement.
	w := request(f, "GET", "/ws?instance="+fmt.Sprintf("%032x", 1), cookie)
	if w.Code != 400 {
		t.Fatal(w.Code)
	}
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	if len(f.hub.pending) != 0 || len(f.hub.clients) != 4 {
		t.Fatal("upgrade leaked reservation or slot")
	}
}
func TestConcurrentReservationsRespectAllCaps(t *testing.T) {
	for _, kind := range []string{"guest", "source", "global"} {
		t.Run(kind, func(t *testing.T) {
			f := setup(t)
			var wg sync.WaitGroup
			count := 0
			limit := map[string]int{"guest": maxSessionClients, "source": maxSourceClients, "global": maxClients}[kind]
			for i := 0; i < limit+32; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					token, source := fmt.Sprint(i), fmt.Sprint(i)
					if kind == "guest" {
						token = "same"
					}
					if kind != "global" {
						source = "same"
					}
					f.hub.mu.Lock()
					defer f.hub.mu.Unlock()
					if f.hub.reserve(fmt.Sprint(i), &client{token: token, source: source}) {
						count++
					}
				}(i)
			}
			wg.Wait()
			if count != limit {
				t.Fatalf("admitted %d, want %d", count, limit)
			}
		})
	}
}
func TestUpgradeBudgetSurvivesInstanceChurn(t *testing.T) {
	f := setup(t)
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	for i := 0; i < 120; i++ {
		c := &client{token: "guest", source: "same"}
		if !f.hub.reserve("page", c) {
			t.Fatal("budget ended early", i)
		}
		delete(f.hub.pending, "page")
		delete(f.hub.live, c)
	}
	if f.hub.reserve("new-page", &client{token: "new-guest", source: "same"}) {
		t.Fatal("new identity bypassed source budget")
	}
}
func TestUnusedSessionsCannotAccumulateAndIPv6IsGrouped(t *testing.T) {
	f := setup(t)
	issue := func(address string) int {
		r := httptest.NewRequest("POST", "/api/session", nil)
		r.Header.Set("Origin", f.server.URL)
		r.RemoteAddr = address
		w := httptest.NewRecorder()
		f.hub.Handler().ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 20; i++ {
		if issue(fmt.Sprintf("[2001:db8::%x]:1234", i+1)) != 200 {
			t.Fatal("early reject")
		}
	}
	if issue("[2001:db8::ff]:1234") != 429 {
		t.Fatal("IPv6 rotation bypassed rate limit")
	}
	f.clock.Add(61)
	for i := 0; i < 12; i++ {
		if issue("[2001:db8::1]:1234") != 200 {
			t.Fatal("early outstanding cap")
		}
	}
	if issue("[2001:db8::1]:1234") != 429 {
		t.Fatal("outstanding session budget bypassed")
	}
	if issue("[2001:db8:0:1::1]:1234") != 200 {
		t.Fatal("unrelated prefix rejected")
	}
	f.clock.Add(121)
	f.hub.Cleanup()
	f.hub.mu.Lock()
	count := len(f.hub.sessions)
	f.hub.mu.Unlock()
	if count != 0 {
		t.Fatal("unused sessions retained", count)
	}
	if issue("[2001:db8::1]:1234") != 200 {
		t.Fatal("capacity not recovered")
	}
}
func TestHelloDeadlineAndActiveSessionLifetime(t *testing.T) {
	f := setup(t)
	idleCookie := f.guest(t)
	idle := f.connect(t, idleCookie, "")
	activeCookie := f.guest(t)
	f.connect(t, activeCookie, "eu")
	f.clock.Add(11)
	f.hub.Cleanup()
	idle.SetReadDeadline(time.Now().Add(time.Second))
	if _, _, err := idle.ReadMessage(); err == nil {
		t.Fatal("client without hello survived deadline")
	}
	f.clock.Add(121)
	f.hub.Cleanup()
	if request(f, "GET", "/api/config", idleCookie).Code != 401 {
		t.Fatal("unused session still valid")
	}
	if request(f, "GET", "/api/config", activeCookie).Code != 200 {
		t.Fatal("active session expired")
	}
}
func TestQuickPlayCooldownAndTransitionDeadline(t *testing.T) {
	f := setup(t)
	a, _ := quickJoin(t, f, nil)
	cookie := f.guest(t)
	b := f.connect(t, cookie, "eu")
	send(t, b, map[string]any{"type": "quickPlay"})
	next(t, a, "snapshotRequest")
	f.hub.mu.Lock()
	var room *room
	for _, r := range f.hub.rooms {
		room = r
	}
	started := room.transitionAt
	f.hub.mu.Unlock()
	f.clock.Add(2)
	send(t, b, map[string]any{"type": "leave"})
	next(t, b, "left")
	next(t, a, "snapshotRequest")
	send(t, b, map[string]any{"type": "quickPlay"})
	if next(t, b, "error")["retryAfterMs"] == nil {
		t.Fatal("missing cooldown")
	}
	replacement := f.connect(t, cookie, "")
	send(t, replacement, map[string]any{"type": "quickPlay"})
	next(t, replacement, "error")
	// A fresh guest cannot join and extend the pending transition.
	c := f.connect(t, f.guest(t), "eu")
	send(t, c, map[string]any{"type": "quickPlay"})
	solo := next(t, c, "match")["match"].(map[string]any)
	if solo["players"] != float64(1) {
		t.Fatal("joined transitioning room")
	}
	f.hub.mu.Lock()
	unchanged := room.transitionAt.Equal(started)
	f.hub.mu.Unlock()
	if !unchanged {
		t.Fatal("departure extended transition deadline")
	}
	f.clock.Add(9)
	f.hub.Cleanup()
	if next(t, a, "match")["match"].(map[string]any)["players"] != float64(1) {
		t.Fatal("transition did not finish on original deadline")
	}
}
func TestRequestBodiesRejected(t *testing.T) {
	f := setup(t)
	for _, path := range []string{"/api/session", "/api/ice", "/healthz", "/ws"} {
		r := httptest.NewRequest("POST", path, strings.NewReader("x"))
		r.Header.Set("Origin", f.server.URL)
		w := httptest.NewRecorder()
		f.hub.Handler().ServeHTTP(w, r)
		if w.Code != 413 {
			t.Fatal(path, w.Code)
		}
	}
}

func TestRelayAdmissionCachingBudgetsAndGrace(t *testing.T) {
	f := setup(t)
	cookie := f.guest(t)
	if strings.Contains(request(f, "GET", "/api/config", cookie).Body.String(), "credential") {
		t.Fatal("config exposed credentials")
	}
	if request(f, "POST", "/api/ice", cookie).Code != 403 {
		t.Fatal("idle guest got relay")
	}
	a := f.connect(t, cookie, "eu")
	send(t, a, map[string]any{"type": "quickPlay"})
	solo := next(t, a, "match")["match"].(map[string]any)
	soloPath := "/api/ice?matchId=" + solo["id"].(string)
	if strings.Contains(request(f, "POST", soloPath, cookie).Body.String(), "credential") {
		t.Fatal("solo guest got relay")
	}
	_, match := quickJoin(t, f, []*websocket.Conn{a})
	path := "/api/ice?matchId=" + match["id"].(string)
	first := request(f, "POST", path, cookie)
	if first.Code != 200 || !strings.Contains(first.Body.String(), "credential") {
		t.Fatal("admitted guest missing credentials", first.Code)
	}
	if request(f, "POST", soloPath, cookie).Code != 403 {
		t.Fatal("stale match accepted")
	}
	if request(f, "POST", path+"&instance="+strings.Repeat("a", 32), cookie).Code != 403 {
		t.Fatal("idle tab borrowed another tab's match")
	}
	r := httptest.NewRequest("POST", path, nil)
	r.AddCookie(cookie)
	r.Header.Set("Origin", "https://evil.example")
	w := httptest.NewRecorder()
	f.hub.Handler().ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("foreign Origin accepted")
	}
	for i := 0; i < 58; i++ {
		if request(f, "POST", path, cookie).Code != 200 {
			t.Fatal("early request limit")
		}
	}
	if request(f, "POST", path, cookie).Code != 429 {
		t.Fatal("unbounded credential requests")
	}
	f.clock.Add(61)
	if request(f, "POST", path, cookie).Body.String() != first.Body.String() {
		t.Fatal("credentials rotated outside renewal window")
	}
	f.clock.Add(8*60 - 61) // Renew at exactly the eight-minute boundary.
	renewed := request(f, "POST", path, cookie)
	if renewed.Code != 200 || renewed.Body.String() == first.Body.String() {
		t.Fatal("credentials did not renew")
	}
	a.Close()
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
	f.clock.Add(9)
	if request(f, "POST", path, cookie).Code != 200 {
		t.Fatal("reconnect grace not allowed")
	}
	f.clock.Add(2)
	if request(f, "POST", path, cookie).Code != 403 {
		t.Fatal("disconnected guest renewed past grace")
	}
}

func TestPendingMigrationDoesNotFreeOriginalSourceCapacity(t *testing.T) {
	f := setup(t)
	f.hub.mu.Lock()
	defer f.hub.mu.Unlock()
	// These placeholders model retained slots without opening 64 sockets.
	defer func() { f.hub.clients = map[string]*client{} }()
	for i := 0; i < maxSourceClients; i++ {
		f.hub.clients[fmt.Sprint(i)] = &client{token: fmt.Sprint(i), source: "original"}
	}
	moving := &client{token: "0", source: "destination"}
	if !f.hub.reserve("0", moving) {
		t.Fatal("migration rejected")
	}
	if f.hub.reserve("extra", &client{token: "extra", source: "original"}) {
		t.Fatal("pending migration freed original slot before success")
	}
	delete(f.hub.pending, "0")
	delete(f.hub.live, moving)
	if f.hub.reserve("extra", &client{token: "extra", source: "original"}) {
		t.Fatal("failed migration overfilled source")
	}
}
func TestAdmissionMetricsCannotBeForged(t *testing.T) {
	f := setup(t)
	cookie := f.guest(t)
	if request(f, "GET", "/api/metrics", cookie).Code != 404 {
		t.Fatal("operational metrics exposed")
	}
	a := f.connect(t, cookie, "eu")
	send(t, a, map[string]any{"type": "quickPlay"})
	match := next(t, a, "match")["match"].(map[string]any)
	send(t, a, map[string]any{"type": "metrics", "matchId": match["id"], "metrics": map[string]any{"server": map[string]any{"sessions": 9000, "rejectedSockets": 9000}}})
	send(t, a, map[string]any{"type": "unknown"})
	next(t, a, "error")
	snapshot := f.hub.Metrics()
	if snapshot.Server == nil || snapshot.Server.Sessions != 1 || snapshot.Server.Clients != 1 || snapshot.Server.RejectedSockets != 0 {
		t.Fatal("invalid server metrics", snapshot.Server)
	}
}

type pausedResponse struct {
	*httptest.ResponseRecorder
	entered chan struct{}
	release chan struct{}
}

func (w *pausedResponse) Write(p []byte) (int, error) {
	close(w.entered)
	<-w.release
	return w.ResponseRecorder.Write(p)
}
func TestHTTPResponsesDoNotHoldLobbyLock(t *testing.T) {
	for _, path := range []string{"/api/session", "/api/config"} {
		t.Run(path, func(t *testing.T) {
			f := setup(t)
			cookie := f.guest(t)
			method := "GET"
			if path == "/api/session" {
				method = "POST"
			}
			r := httptest.NewRequest(method, path, nil)
			r.Header.Set("Origin", f.server.URL)
			r.AddCookie(cookie)
			w := &pausedResponse{httptest.NewRecorder(), make(chan struct{}), make(chan struct{})}
			finished := make(chan struct{})
			go func() { f.hub.Handler().ServeHTTP(w, r); close(finished) }()
			<-w.entered
			available := make(chan struct{})
			go func() { f.hub.Metrics(); close(available) }()
			stalled := false
			select {
			case <-available:
			case <-time.After(time.Second):
				stalled = true
			}
			close(w.release)
			<-finished
			if stalled {
				t.Fatal("HTTP response held global lobby lock")
			}
		})
	}
}
