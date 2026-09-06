package lobby

import (
	"encoding/base64"
	"github.com/gorilla/websocket"
	"testing"
)

func quickJoin(t *testing.T, f *fixture, existing []*websocket.Conn) (*websocket.Conn, map[string]any) {
	t.Helper()
	c := f.connect(t, f.guest(t), "eu")
	send(t, c, map[string]any{"type": "quickPlay"})
	if len(existing) > 0 {
		request := next(t, existing[0], "snapshotRequest")
		send(t, existing[0], map[string]any{"type": "snapshot", "matchId": request["matchId"], "transition": request["transition"], "snapshot": base64.StdEncoding.EncodeToString(make([]byte, 8512))})
	}
	match := next(t, c, "match")["match"].(map[string]any)
	for _, p := range existing {
		next(t, p, "match")
	}
	return c, match
}

func TestQuickPlayFillsRoomsAndAutomaticallyRestarts(t *testing.T) {
	f := setup(t)
	var players []*websocket.Conn
	var match map[string]any
	for count := 1; count <= 4; count++ {
		var c *websocket.Conn
		c, match = quickJoin(t, f, players)
		players = append(players, c)
		if match["players"] != float64(count) || match["quick"] != true {
			t.Fatalf("bad quick match: %v", match)
		}
		if count > 1 {
			slots := match["slots"].([]any)
			if slots[count-1] != float64(-1) {
				t.Fatal("new pilot must spawn")
			}
		}
	}
	fifth, solo := quickJoin(t, f, nil)
	if solo["players"] != float64(1) || solo["id"] == match["id"] {
		t.Fatal("fifth player did not get own room")
	}
	for _, p := range players {
		send(t, p, map[string]any{"type": "finish", "matchId": match["id"], "winner": 2})
	}
	for _, p := range players {
		fresh := next(t, p, "match")["match"].(map[string]any)
		if fresh["id"] == match["id"] || fresh["players"] != float64(4) || fresh["snapshot"] != nil {
			t.Fatal("round did not reset")
		}
	}
	send(t, fifth, map[string]any{"type": "leave"})
	next(t, fifth, "left")
}

func TestQuickPlayHostDepartureCarriesRemainingRoster(t *testing.T) {
	f := setup(t)
	a, _ := quickJoin(t, f, nil)
	b, _ := quickJoin(t, f, []*websocket.Conn{a})
	send(t, a, map[string]any{"type": "leave"})
	next(t, a, "left")
	request := next(t, b, "snapshotRequest")
	send(t, b, map[string]any{"type": "snapshot", "matchId": request["matchId"], "transition": request["transition"], "snapshot": base64.StdEncoding.EncodeToString(make([]byte, 8512))})
	nextMatch := next(t, b, "match")["match"].(map[string]any)
	if nextMatch["players"] != float64(1) || nextMatch["slots"].([]any)[0] != float64(1) {
		t.Fatal("remaining pilot was not promoted")
	}
}

func TestQuickTransitionIgnoresPrematureFinishAndStaleSnapshot(t *testing.T) {
	f := setup(t)
	a, _ := quickJoin(t, f, nil)
	b := f.connect(t, f.guest(t), "eu")
	send(t, b, map[string]any{"type": "quickPlay"})
	request := next(t, a, "snapshotRequest")
	send(t, b, map[string]any{"type": "finish", "matchId": request["matchId"], "winner": 1})
	send(t, a, map[string]any{"type": "snapshot", "matchId": request["matchId"], "transition": "stale", "snapshot": base64.StdEncoding.EncodeToString(make([]byte, 8512))})
	send(t, a, map[string]any{"type": "snapshot", "matchId": request["matchId"], "transition": request["transition"], "snapshot": base64.StdEncoding.EncodeToString(make([]byte, 8512))})
	next(t, a, "match")
	next(t, b, "match")
}
