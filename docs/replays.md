# Replay validation

The rollback laboratory exports version-2 JSON recordings with build identities, seed, map mode, player count, initial state, confirmed input vectors and checkpoints. Load them in the laboratory to validate and seek. Online matches expose Capture replay and prepare a final recording on leave/end. These contain only mutually acknowledged simulated inputs. Before offering the download, the worker replays those inputs from the match configuration and verifies the final hash and snapshot against the live confirmed state. A recovery that cannot be reproduced from the recorded inputs produces an error directing the player to the desync diagnostic.

The Go validator executes the same `public/simulation.wasm` using pinned wazero v1.9.0:

```sh
go run ./cmd/replaycheck artifacts/browser-replay.json
go run ./cmd/replaycheck -wasm archived/simulation.wasm -build archived/build.json saved-game.json
```

Keep each recording with its build manifest and WASM. The validator checks the binary SHA-256 and all identity fields, initializes the simulation from the recorded match configuration, compares the initial bytes, then executes each full input vector. Every supplied checkpoint must match both the signed 64-bit hash and all 8512 snapshot bytes. Successful output contains ticks, final hash, winner (`-1` when unfinished), and all player scores. Invalid files exit nonzero.

Bounds match the browser format: 216,000 ticks, 3,601 checkpoints, 2–4 button masks per input, matching the recorded player count, and fixed snapshot size. The CLI additionally caps JSON at 110 MiB, execution at 30 seconds and WASM memory at four pages. No host functions or filesystem/network imports are provided to WASM. Context cancellation terminates execution through [wazero's runtime configuration](https://github.com/tetratelabs/wazero/blob/v1.9.0/config.go).

`go test -race ./...` generates 3,600-tick recordings for 2, 3, and 4 players with the JavaScript WASM engine and validates every checkpoint in wazero. It also rejects altered identities, artifacts, initial states, input shapes, checkpoint order, hashes and bytes. This requires Node 22.18+ and the built public artifacts.

Validation establishes that the recorded inputs produce a rule-consistent outcome. It does not establish honest input timing or prevent collusion. Results remain unverified competitive results.
