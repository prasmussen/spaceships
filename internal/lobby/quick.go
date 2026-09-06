package lobby

// Quick rooms retain their membership across rounds. A short mesh transition
// carries a confirmed snapshot from a surviving peer to the new roster.
func (s *Server) startQuick(r *room, snapshot []byte, slots []int) {
	seed := random32()
	if snapshot != nil && r.match != nil {
		seed = r.match.Seed
	}
	r.match = &Match{Quick: true, Snapshot: snapshot, Slots: slots, Players: len(r.members), ID: randomID(16), Epoch: random32(), Seed: seed, Identity: s.cfg.Identity, InputDelay: 2, RecoveryPeer: 0, Region: r.region}
	r.previous = nil
	r.transition = ""
	r.authority = nil
	r.reported = make([]bool, len(r.members))
	r.ready = make([]bool, len(r.members))
	r.winner = nil
	s.roomState(r)
	for _, c := range r.members {
		s.sendMatch(c, r)
	}
}

func (s *Server) transitionRoom(r *room) {
	r.transition = randomID(8)
	r.transitionAt = s.cfg.Now()
	r.authority = nil
	for _, previous := range r.previous {
		for _, member := range r.members {
			if previous == member && member.connected {
				r.authority = member
				break
			}
		}
		if r.authority != nil {
			break
		}
	}
	if r.authority == nil {
		s.startQuick(r, nil, nil)
		return
	}
	s.roomState(r)
	s.requestTransition(r)
}

func (s *Server) requestTransition(r *room) {
	s.broadcast(r, map[string]any{"type": "transition", "matchId": r.match.ID})
	s.send(r.authority, map[string]any{"type": "snapshotRequest", "matchId": r.match.ID, "transition": r.transition})
}

func (s *Server) quickLeave(r *room, c *client) {
	if r.previous == nil {
		r.previous = append([]*client(nil), r.members...)
	}
	for i, member := range r.members {
		if member == c {
			r.members = append(r.members[:i], r.members[i+1:]...)
			break
		}
	}
	r.ready = make([]bool, len(r.members))
	if len(r.members) == 0 {
		delete(s.rooms, r.code)
		return
	}
	s.transitionRoom(r)
}
