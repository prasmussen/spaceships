# Complete-match checks

```sh
node tests/browser.mjs --lobby --full-match
node tests/browser.mjs --turn --full-match
```

These reuse the approved browser entry point. Each runs two independent guest sessions through the queue, a complete first-to-five game, replay download/Go validation, rematch with reset scores, and leave. The second command forces relay candidates and also checks credential renewal and bounded network recovery. Expect roughly two minutes for the full relay suite.

`tests/match-inputs.mjs` generates a cooperative acceptance flight using the shipped WASM. One pilot traverses the lower cave, counter-steers to an attack position, compensates for inherited projectile velocity, and attacks the other pilot's pad. The other pilot remains on its pad. All movement and combat use ordinary button masks from the initial spawn state: no positions, hull, score, pool entries or simulation parameters are edited. The current frozen build wins 5–0 in 3,008 ticks. A Node test checks this path and that the winning state freezes.

The browser harness wraps the production online worker to feed those masks through its normal input-message handler at frame boundaries. Both original workers still schedule gameplay, apply input delay, communicate over the actual DataChannels, perform rollback and emit confirmed presentation frames. The wrapper queues initialization while loading the production module and resolves its fetch URLs against the page origin. This instrumentation is in test files and is absent from the production build.

Successful evidence includes `artifacts/full-direct-match.json`, `artifacts/full-relay-match.json`, and corresponding replay JSON files. The Go validator must report winner 0 and scores `[5,0]`; both browser HUDs must show that same confirmed result. Rematch must begin with zero scores.

This check exposed a finish-report race: the service's unverified report could close the other peer one tick before its own confirmed winner frame. The client now allows up to ten seconds to confirm final inputs locally, without trusting the reported winner. It ends without a confirmed result if that cannot complete.

This is repeatable lifecycle evidence, not a competitive bot or a substitute for human game-feel testing. Loopback and locally hosted TURN do not establish public internet performance, public certificate trust, or behavior between separate access networks.
