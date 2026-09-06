# Rollback and confirmation

Each match has 2–4 participants. `Rollback` retains an input map for each slot, complete input vectors for executed ticks, pre-tick snapshots, hashes and separate acknowledgements for every remote peer. Commands are scheduled two ticks ahead; missing remote inputs repeat that player's last known buttons.

`complete` is the highest contiguous tick with inputs from every player. `agreed` is the minimum of that frontier and every remote acknowledgement. Simulation may speculate at most 12 ticks beyond agreement and retains 120 ticks of snapshots for repairs. Late input rolls back to its pre-tick snapshot and re-executes the full vectors. Duplicate identical inputs are harmless; conflicting submissions, foreign ownership and out-of-window repairs are rejected.

The online worker runs one shared simulation per browser. Its full-mesh RTC links carry latest-eight input packets and reliable repairs, bound to the authenticated sender slot. Confirmed HUD scores, winner and replay capture use agreed snapshots and inputs. A missing participant stalls everyone; a ten-second input stall ends the match.

Peers compare agreed checkpoint hashes every 60 ticks. Slot 0 coordinates one bounded recovery across all participants. Every participant restores the same agreed snapshot and replays retained inputs. Slot 0 waits for all recovery acknowledgements before releasing the match. A later mismatch aborts. [Protocol details](protocol.md) describe the recovery messages and revisions.

The interactive laboratory remains a two-peer demonstration. Node tests additionally exercise three and four independent rollback peers and wire sessions under loss, duplication, reordering, outages and state mismatch. Browser checks exercise actual 2–4-player RTC meshes, independent controls, synchronized hashes, pause/resume and Go-validated replay capture.
