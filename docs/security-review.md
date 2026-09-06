# Public-internet security review — 2026-09-06

**Original assessment (before the fixes below): not ready for unrestricted public access.** The principal risks are inexpensive denial of service, matchmaking disruption, and anonymous relay consumption. Fix the admission and session-exhaustion findings before public launch; address matchmaking abuse and relay admission before offering open Quick play with TURN.

Scope: repository server, lobby protocol, relevant browser trust boundaries, Docker/Caddy/coturn configuration, and FreeBSD service/install samples. This was a source review with bounded local tests, not a penetration test of a deployed host. The original review made no application changes. The subsequent implementation is described below; the historical findings retain their original evidence and line references.

## Remediation implemented

All four findings now have server enforcement and regression coverage in `internal/lobby/security_test.go` and `internal/lobby/server_test.go`:

- Atomic admission reservations cap retained and physical sockets globally, per guest and per source. Handshake/message budgets aggregate across instances; hello has a ten-second deadline. Existing-instance reconnects preserve their slot.
- Unused sessions expire after two minutes, source issuance/outstanding budgets prevent two-address accumulation, and IPv6 addresses share a /64 budget. Active players are preserved; HTTP polling cannot prolong unused sessions.
- `/api/config` contains no TURN credentials. `/api/ice` checks the page, current multiplayer match, Origin and reconnect grace, caches credentials and limits requests. The browser uses the new flow. Solo guests receive no relay access.
- Guest-wide rejoin cooldowns survive reconnects, source/guest admission budgets constrain churn, and room admission budgets limit repeated roster changes. Pending transitions exclude newcomers and retain their original deadline. The UI retries a requested rejoin after the short cooldown and allows cancellation.

Additional changes: unexpected HTTP bodies are rejected; HTTP read/write timeouts are set; HTTP response data is copied before releasing the mutex and writing to clients; CSP and HSTS protect the production page; Docker resource budgets contain the app; coturn's CLI is explicitly disabled; authenticated metrics expose server-owned admission counters and current capacity. FreeBSD includes a soft Go memory budget and documents the need for jail limits.

See [the server contract](server.md) for exact limits and [deployment](deployment.md) for resource settings. These changes mitigate the demonstrated attacks; they do not establish bot identity or protect against arbitrary distributed denial of service. The public-host verification gates below still apply.

## Verification of the implementation

- `go test -race ./...`: passed, including the admission, session, TURN, churn, migration rollback, metrics trust, and mutex-release regressions. The lobby suite was rerun after the final exact eight-minute TURN renewal boundary fix and passed.
- `go vet ./...`: passed.
- `npm run build`: passed.
- `npm test`: all 204 simulation/protocol tests passed.
- `node tests/browser.mjs --server-only --turn --https`: passed. This covers real forced-relay play with up to four players, round resets, lobby reconnect, cooldown/rejoin, coordinator departure, abrupt disconnection, relay restart, HTTPS/WSS, secure cookies, Origin rejection, CSP enforcement and HSTS.
- The HTTPS fixture inspected the running app container and confirmed 512 MiB memory, two CPUs and 128 PIDs. A sample after the two-player check was 7.211 MiB; this is not a maximum-concurrency load test. Evidence is in `artifacts/https-browser.json`.
- `git diff --check`: passed.

The new `--server-only` mode selects the relevant integration checks through the existing browser entry point. The original all-purpose browser mode still has stale practice-menu expectations; it was not certified as passing. Outdated selectors in the server integration checks were updated to the existing menu controls, and the rejoin test now waits for fresh frames instead of accepting frames from before departure.

## Findings

### 1. High: one guest can create unbounded WebSocket clients

Location: `internal/lobby/server.go:280–336`.

`/ws?instance=<32 hex characters>` keys clients by cookie plus caller-selected instance ID. There is no connection/admission cap per session, IP, or server, and no upgrade rate limit. The session creation limits do not constrain these sockets. Each accepted instance allocates buffers, a 64-entry outgoing channel, goroutines, and a client-map entry. The 100-message/second limit is also per connection, so the same bypass multiplies message-processing capacity. Connections do not need to send a compatible hello to be retained; ping/pong-capable clients can keep them alive until later cleanup.

Evidence: a local WebSocket probe obtained one guest cookie and admitted 128 concurrent instances from one IP without sending hello. This was deliberately bounded; no resource-exhaustion load test was performed. The absence of an upper bound is established by the admission code.

Impact: an anonymous caller can exhaust file descriptors/memory or contend on the global lobby mutex. Neither the supplied Compose file nor Caddy configuration adds connection quotas; Compose also lacks CPU, memory, and PID budgets.

Remediation: reserve capacity atomically before upgrade, with global, per-session and per-source limits; bound retained disconnected instances and queue membership too. Preserve legitimate same-instance reconnects without allowing churn to bypass admission limits. Rate-limit handshakes, require hello within a short deadline, and add measured process/container resource budgets. Aggregate IPv6 source limits appropriately rather than treating every address in a client prefix as unrelated.

### 2. High: cheaply issued sessions can deny entry to every new visitor

Location: `internal/lobby/server.go:230–252`, `Cleanup`.

Every request without a valid cookie can allocate a six-hour session. The only source limit is 20 new sessions per minute; the global cap is 10,000. Sessions that never connect or play remain until expiry. When the table fills, all new visitors receive HTTP 429, including unrelated IPs. Existing unexpired cookies continue to work.

Evidence: using the test clock, two source IPs created 20 sessions each per 61-second window for 250 windows, filling all 10,000 entries before any expired. A third, previously unused IP then received 429. This is about 4 hours 14 minutes of simulated issuance; more addresses reduce the time. Source limits use individual IPv6 addresses, further weakening the cost assumption.

Remediation: avoid six-hour storage for unused sessions, impose per-source outstanding-session budgets, and expire inactive guests promptly. Consider authenticated stateless guest cookies with separately bounded active state. Any eviction policy must protect legitimate active players from attacker-driven eviction. Add admission controls and capacity monitoring so the global cap is not the only abuse boundary.

### 3. Medium: any guest can continuously obtain general-purpose TURN credentials

Location: `internal/lobby/server.go:258–278`, `deploy/compose.turn.yml:20–31`.

`/api/config` issues renewable TURN credentials to any guest cookie. No WebSocket, compatible build, matchmaking participation, or active match is required, and credential issuance is not rate-limited. A nonbrowser caller can supply the allowed Origin when obtaining a guest cookie: Origin checks protect browser cross-origin access, not against scripted anonymous clients.

Evidence: a guest with no WebSocket or match obtained credentials every simulated minute for an hour. Existing tests verify that these credentials have the expected HMAC. Relay traffic abuse itself was not exercised.

Impact: callers can use the relay for unrelated traffic to permitted public peers and consume allocation/bandwidth capacity needed by players. This is authenticated anonymous access, not an unauthenticated TURN configuration. The configured per-user/global quotas, bandwidth caps, and private-destination denials are useful containment, but do not establish that the caller is playing. See coturn's [official configuration reference](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

Remediation: separate public configuration from credential issuance; issue initial credentials only after bounded matchmaking admission and renew for active participants with a reconnect grace period. This requires adjusting the browser's current pre-WebSocket config flow. Keep relay quotas, add issuance budgets and abuse monitoring, and set an explicit acceptable bandwidth/cost budget. Match participation alone does not prevent a determined bot, so retain layered admission limits.

### 4. Medium: repeated join/leave messages can keep another player's room transitioning

Location: `internal/lobby/server.go:566–580`, `internal/lobby/quick.go:23–48,51–66`.

A guest can repeatedly use `quickPlay` and `leave`; every admission/departure requests another roster transition and resets its timeout. A room already in transition remains eligible for new joins. There is no join cooldown, transition budget, or admission hold during the transition. The generic 100-message/second limit is much higher than needed to disrupt play.

Evidence: with one victim's solo room and one attacker connection, ten join/leave cycles caused twenty snapshot/transition requests to the victim in approximately 5 milliseconds without triggering the message limit. The probe verifies server behavior; it does not measure the resulting browser interruption duration.

Impact: a guest can repeatedly pause/reconfigure a non-full Quick play room. Unlimited instances from finding 1 expand the attack to more rooms. Room selection is server-controlled, so this does not imply an arbitrary victim-targeting API.

Remediation: budget joins per session/source, add a rejoin cooldown, and defer new admission while a roster transition is pending. Bound/coalesce roster changes and ensure churn cannot continually extend the transition deadline. Always allow a player to leave safely.

## Original review verification and limits

- `go test -race ./...`: passed.
- `go vet ./...`: passed.
- `go run golang.org/x/vuln/cmd/govulncheck@latest ./cmd/server/...`: no vulnerabilities found for the server dependency graph and installed Go toolchain. This uses the [Go vulnerability database](https://go.dev/doc/security/vuln/database); it is not evidence that application logic is safe.
- `npm audit --json`: zero reported vulnerabilities.
- Four temporary local probes passed under the race detector: connection admission, session capacity exhaustion, Quick play churn, and TURN issuance without playing.
- A separate suspected global-lock stall from an incomplete HTTP request body did not reproduce and is not reported as a vulnerability. HTTP responses are nevertheless written under the lobby mutex; copying response data and unlocking before I/O would be useful defensive cleanup.

The original temporary probes and Go overlay were retained in `/tmp/spaceships-security-review/`. Those probes demonstrated the pre-fix behavior and are not acceptance tests for the patched server. Use the checked-in regression suite (`go test -race ./...`) for current verification.

Existing protections include exact Origin checks, random HttpOnly/SameSite guest cookies, trusted-proxy IP handling, bounded WebSocket messages and outgoing queues, writer deadlines, match-scoped signaling authorization, metrics bearer authentication, and a non-root/read-only application container. The server does not expose the offline replay validator as an upload API. Peer-authoritative game results are explicitly unverified; this review does not certify cheat resistance.

Additional hardening: reject unexpected request bodies and set appropriate HTTP body/write timeouts; add a browser-tested CSP and HSTS for the actual HTTPS deployment. These are secondary to the demonstrated abuse paths.

Unverified deployment gates: actual public DNS/TLS/firewall exposure, deployed secrets, host/jail limits, deployed binary/toolchain versions, container-image vulnerability scans, and direct/forced-relay matches across separate networks. Repository samples and application dependency scans do not prove the deployed system satisfies these gates.
