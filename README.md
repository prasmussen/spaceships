# Cavern Duel

A work-in-progress implementation of `plan.txt`: online spaceship deathmatch, flight/landing practice, online invite/queue play, and an interactive rollback/replay laboratory. Gameplay is handwritten WAT compiled to WASM. TypeScript workers run the simulation; WebGPU renders the cave.

Requires a recent Node.js (22.18+ for the TypeScript test modules) and a desktop WebGPU browser.

```sh
npm install
npm run build
npm run dev
```

Open the printed localhost URL. Use **W/A/D** or **Up/Left/Right arrows** to fly, and **Space** to fire. Multiplayer requires a separate browser for each player through Online duel. **R** restarts. Open Controls to change your bindings or the restart/rematch key. Bindings persist in this browser; the footer always shows the current keys. Enable Sound effects in Controls for shots, impacts and landing cues. Particle bursts are deduplicated across rollback. Reduce camera motion disables cosmetic particles (gameplay debris stays visible), velocity look-ahead and correction offsets; its initial value follows the system preference. Counter-steer to stop rotation. Land upright and slowly on your own illuminated pad to refuel. Other terrain contact crashes; shots take three hull points to kill. First to five wins; tied winning scores continue until one player leads.

Open How to play for a short guide to momentum, landing, scoring and online setup. Select Flight lab for an enclosed arena with an open center and two landing pads or Landing course to practice refueling. Rollback lab runs two independent peers behind configurable delay/loss/outages, compares them with a reference replay, and lets you seek, save or open a validated replay. Focus loss clears controls; hidden tabs pause standalone play. Graphics device loss triggers automatic resource rebuilding while the simulation continues. If the GPU remains unavailable, Retry graphics attempts recovery without resetting the match.

```sh
npm test                            # simulation, collision, combat, rollback, replay, desync
npm run build                       # validate WAT, type-check, bundle production site
node tests/browser.mjs              # self-contained Chrome/WebGPU and replay test
node tests/browser.mjs --all-engines # also provision Firefox/WebKit and compare hashes
node tests/browser.mjs --peer --lobby # real WebRTC workers, invite UI and Go lobby flows
node tests/browser.mjs --turn        # Docker coturn and forced-relay invite play
node tests/browser.mjs --https       # isolated container HTTPS/WSS deployment
node tests/browser.mjs --lobby --full-match # full direct match and rematch
node tests/browser.mjs --turn --full-match  # full relay match and rematch
node tests/browser.mjs --turn --soak # eleven-minute credential renewal check
node scripts/benchmark.mjs           # simulation tick and 12-tick rollback measurements
go test -race ./...                  # Go HTTP/WebSocket integration and race checks
```

Reuse `tests/browser.mjs` for browser checks. It starts/closes its server and browsers, uses installed Google Chrome, provisions pinned Firefox/WebKit when requested, and writes artifacts locally. On macOS it uses official URLs from the pinned Playwright CLI and native ZIP extraction.

The build pins WABT, concatenates handwritten WAT fragments, inserts checked-in integer trig/map/configuration data, validates the binary, and emits SHA-256 content identities. No JS imports or floating-point operations execute gameplay. See [the ABI and integer rules](docs/simulation.md), [rollback/replay architecture](docs/rollback.md), and [performance baseline](docs/performance.md).

The Go guest/lobby/signaling service is implemented: after building, run `go run ./cmd/server` to serve the app and APIs on port 8080. See [service configuration](docs/server.md) and [peer packet formats](docs/protocol.md).

For online play, open the Go-served app in two browsers, select Online duel, connect, create/join an invite and have both players select Ready. Each player can use either control set. Find opponent joins the selected region’s queue. See [TURN setup and testing](docs/turn.md) for connections across networks; the force-relay option requires a working TURN service.

Validate an exported laboratory replay with `go run ./cmd/replaycheck artifacts/browser-replay.json`. See [replay validation](docs/replays.md).

Use Capture replay in the online panel to save confirmed play; a final recording is also prepared when you leave or the match ends. Open the downloaded JSON in Rollback lab, or validate it with the Go command above.

See [complete-match verification](docs/match-acceptance.md) and [HTTPS/WSS deployment](docs/deployment.md) for the container build and Caddy setup. Public deployment and release acceptance remain in progress. [PROGRESS.md](PROGRESS.md) tracks the full original scope and verification limits.
