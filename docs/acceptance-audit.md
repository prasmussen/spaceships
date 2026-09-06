# Acceptance audit against plan.txt

The goal is not complete. The implementation and local acceptance evidence cover the seven milestones' code deliverables. Public deployment, separate-network acceptance and subjective playability approval remain unproven. This table preserves those gates rather than treating local tests as proof of public release readiness.

| Requirement | Implementation and evidence | Status / limit |
| --- | --- | --- |
| Handwritten WAT, pinned WABT, versioned ABI and identities | `sim/*.wat`, `scripts/build-sim.mjs`, `src/engine.ts`, `public/build.json`; build validates WASM and emits hashes | Implemented; no gameplay host imports |
| Fixed 60 Hz, two substeps, Q16.16, i64 intermediates, rounding/saturation, checked-in trig | `sim/core.wat`, `sim/sine.json`, tuning manifest; simulation and collision tests | Implemented and tested |
| Bounded map/configuration, deterministic collision order and allocation | Frozen cave/tuning build validation, collision/combat tests, fixed two-ship/256-projectile pools | Implemented and tested |
| Momentum, opposing rotation, fuel exhaustion and rotation at zero fuel | Core WAT and simulation tests; browser flight/control checks | Implemented; human enjoyment is not established by tests |
| Strict own-pad landing, refuel, launch, crashes and two-second respawn | Landing WAT/tests, threshold boundary cases, browser landing course | Implemented; broad human approach consistency remains a playability gate |
| Swept ship terrain, swept projectile terrain/moving ships, inherited velocity, held fire, three hits | Collision/combat tests including analytic/grid comparisons and maximum-speed cases | Implemented and tested |
| Same-tick trades, crash precedence, negative scores, tied wins, first-to-five freeze, protection | Combat tests and normal-input complete matches | Implemented and tested |
| Shared cave collision/render geometry, static spatial grid | `sim/cave.json`, build script, collision WAT and renderer | Implemented |
| Fixed memory, canonical snapshots, validation, bulk frame/events ABI | Engine adapter, fixed WASM memory, malformed snapshot tests, event scratch exclusion tests | Implemented and tested |
| Dedicated workers, two-tick input delay, last-input prediction, 120-tick snapshots, rollback | Rollback class, worker modules, loss/jitter/outage tests | Implemented and tested |
| Separate complete/agreed frontiers and 12-tick speculation cap | Rollback/session tests and real browser worker suspension checks | Implemented and tested |
| Fixed scheduling, clear held input on focus loss, suspended-tab stall policy | Main input handlers, fixed worker scheduling, real paused-worker test | Implemented; OS suspension coverage is bounded by the tested worker-pause scenario |
| Unreliable latest-eight gameplay channel plus reliable repair/control, bounded queues/rates | Protocol/session/peer modules and real DataChannel checks | Implemented and tested |
| Content handshake, match/epoch/seed/slots, ping-based tick-zero scheduling | Go match configuration, protocol tests, browser build rejection | Implemented and tested |
| Agreed hashes every 60 ticks, freeze/diagnostic, one player-0 recovery then abort | Desync/session tests; browser normal-play hash comparisons | Implemented; forced desync/recovery is tested through serialized session control, not public internet |
| Bounded ICE recovery, signaling reconnect and expiring TURN credentials | Peer renewal, lobby reconnect, real TURN renewal and disconnect tests | Verified through an eleven-minute real-time TURN soak, two scheduled renewals and the original credential expiry; see `artifacts/turn-soak.json` |
| Confirmed replay input/checkpoints, seek/import/export and identity checks | Replay tests, browser lab, online recordings, Go validation of full matches | Implemented and tested |
| Deterministic event IDs, deduplicated sound/particles, confirmed score/winner, small visual correction smoothing | Events/effects/presentation tests, browser audio/GPU checks, complete-match regression | Implemented and tested; cosmetic state never writes gameplay state |
| Guest cookies, origins, bounded WebSockets, invite/queue/ready/finish/rematch/leave, cleanup | Go integration/race tests and browser lifecycle tests | Implemented and tested locally |
| Regional compatible queue, unverified results, operational metrics | Server/client modules, queue/region tests and full-match UI label | Implemented; metrics are client observations |
| TURN infrastructure and forced-relay play | Pinned coturn Compose configuration, temporary local relay, full 5–0 match/replay/rematch | Locally verified; public relay host not supplied |
| HTTPS/WSS deployment | Pinned Docker build, Caddy, trusted proxy handling, `--https` browser test | Locally verified with a test CA; public DNS/certificate issuance not verified |
| Keyboard configuration, onboarding, accessibility | Saved bindings, How to play guide, native dialogs, optional sound and reduced motion | Implemented; broader assistive-technology/usability review remains useful |
| WebGPU terrain/ships/projectiles/particles/lighting/compositing, damped camera/look-ahead | WGSL pipelines and additive effects, screenshots, GPU validation | Implemented; visual taste is subjective |
| GPU device-loss rebuild and compatibility screen | Forced device destruction, adapter failure and retry browser tests | Implemented and tested |
| Go/wazero validation of identical WASM | JS-generated recording integration test; browser full-match replay validation | Implemented and tested; does not prove honest inputs |
| Cross-engine deterministic replay at different presentation rates | `artifacts/determinism-{chromium,firefox,webkit}.json`, browser script's Chromium/Firefox/WebKit comparison | Verified for the frozen WASM identity; rendering availability differs by browser |
| Tick <1 ms, rollback <8 ms on documented laptop | Updated benchmark includes network/event/frame overhead | p99 budgets pass; maximums and scope documented in `docs/performance.md` |
| Complete direct/relay matches, strangers, rematch and leave | `full-direct-match.json`, `full-relay-match.json`, queue/requeue browser evidence | Local complete paths pass; separate access networks not tested |

Remaining external inputs: the public game/relay hostname and server target, access needed to deploy there, and playability feedback on the frozen flight/landing tuning. No production deployment or human approval is inferred from the local green checks.
