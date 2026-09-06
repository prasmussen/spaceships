# 2–4-player completion audit

The requested multiplayer, arena and spawn changes are implemented. Protocol, WASM ABI and replay format are all version 2; old formats are rejected.

| Requirement | Implementation | Verification |
| --- | --- | --- |
| 2–4 players throughout the game | Four simulation slots; count-sized input vectors, rollback acknowledgement sets and replays; full RTC mesh; count-aware lobby queues, invite rooms, readiness, finish reports and rematches; four rendered colors, scores and practice selection | 173 Node tests; Go race tests; actual 2/3/4-browser matches and rematches |
| Arena has four times the area and more open space | 6400 × 4000 instead of 3200 × 2000; 400-unit collision cells; four small pad platforms; arena omits central obstacles and has over 89% open area; cave has sparse obstacles and broad flight corridors | `tests/arena.test.mjs`, collision-grid/full-scan comparisons across the expanded dimensions, normal-input travel fixtures |
| Every player can use every landing pad | Shared pad lookup for landing, sliding, refueling and snapshot validation; neutral pad color | Every one of four players lands on every pad in `tests/multiplayer.test.mjs`; existing landing threshold and refueling tests |
| Random starting pads | Fresh crypto random seed for local games; shared random match seed online; deterministic seed-dependent assignment of distinct starting pads | All starting assignments, all player counts, deterministic reinitialization and twelve complete normal-input flight fixtures |
| Respawn farthest from other players | Maximize squared distance to the nearest living opponent across all active slots; deterministic pad-order ties | Respawn tests for each victim slot against three independently positioned opponents; two-second timing and snapshot restoration tests |
| Combat and results include every player | Every hull pair; earliest opponent projectile/debris target; summed exhaust; lethal-shot credit, trades and unique-leader victory rules | Every pair, higher-slot weapons/exhaust/debris, four-way trade/tie and winner tests; complete online first-to-five matches |
| Online state remains synchronized | Sender-bound signaling and input ownership, latest-eight packets, reliable repair, all-peer agreement and coordinator recovery barrier | Packet-loss/outage/recovery tests; real direct and forced-TURN 3/4-player meshes; pause/resume, consistent hashes and Go-validated replay capture |
| Match lifecycle supports every participant | Queue isolation by player count/region, complete readiness, all-player finish reports, stable rematch slots, and termination when any participant leaves | Go lobby tests including sender spoofing/capacity checks; real 2/3/4-browser winners, replay validation, rematches and leave |

Final checks passed:

- `npm run build`
- `npm test` — 173 passing tests
- `go test -race ./...`
- `node tests/browser.mjs --lobby --peer` transport checks, followed by updated lobby checks in the commands below
- `node tests/browser.mjs --lobby --multiplayer --full-match`
- `node tests/browser.mjs --turn --multiplayer`
- Node/Chromium determinism over 120,000 ticks at 30/60/144 presentation reads per second

Runtime evidence is generated in `artifacts/full-direct-match.json`, `artifacts/online-multiplayer.json`, `artifacts/online-multiplayer-relay.json`, and the corresponding full-match and online replay JSON files. Full-match browser acceptance replaces only the local button sampler with a deterministic flight pilot and accelerates scheduling time threefold; it keeps the real worker, gameplay simulation, WebRTC, rollback and replay validation. It does not inject authoritative snapshots or results.

The race detector caught a mutable ready-slice reference in queued lobby messages during implementation. Room updates now copy that slice before the asynchronous writer serializes it; the final race run passes.
