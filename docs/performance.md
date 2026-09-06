# Performance baseline

Measured 2026-09-05T22:53:15.116Z on Apple M3 Max, macOS arm64, Node v26.7.0. Reproduce with `node scripts/benchmark.mjs` after building. The script writes summary statistics and artifact identity to `artifacts/performance.json`.

| Work | Samples | p99 | Maximum observed | Plan target |
| --- | --- | --- | --- | --- |
| Normal cave simulation tick | 20000 | 0.0018 ms | 0.0483 ms | < 1 ms |
| 12-tick restore/replay | 500 | 0.1627 ms | 0.3214 ms | < 8 ms |
| Network input, tick, events and frame | 20000 | 0.0224 ms | 1.5398 ms | < 1 ms |
| Network packet, 12-tick rollback, events and frame | 500 | 0.1943 ms | 0.2228 ms | < 8 ms |

Tick samples exclude 2,000 warm-up ticks and use varying held flight/fire controls. Rollback samples restore before a differing late input and execute exactly 12 ticks, including snapshots and hashes. Network samples additionally exercise `NetworkSession`, event collection, packet validation (rollback sample), and confirmed frame assembly. Transport callbacks discard their output: these measurements exclude socket latency, GPU rendering and browser scheduling.

The script enforces p99 targets; individual samples can exceed them during runtime pauses. This is a high-performance laptop baseline, not a guarantee for lower-end hardware or every adversarial pool configuration.

WASM SHA-256: `0b9dd1d10639fe1b071428fd7f437dcce1a413715e36121a0973eaa4f10786d5`.
