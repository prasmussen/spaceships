# Guest/lobby/signaling service

Build the frontend, then run the Go service:

```sh
npm run build
go run ./cmd/server
```

The default listener is `127.0.0.1:8080`, serving the production `dist/` assets and APIs. It verifies the WASM SHA-256 against the manifest before listening. `npm run dev` also proxies `/api` and `/ws` to that service. Online multiplayer uses the service for matchmaking and signaling; solo practice works without it.

## Configuration

| Environment | Default / purpose |
| --- | --- |
| `LISTEN_ADDR` | `127.0.0.1:8080` |
| `STATIC_DIR` | `dist` |
| `PUBLIC_ORIGINS` | comma-separated exact trusted origins; defaults to localhost/127.0.0.1 ports 8080 and 5173 |
| `REGIONS` | `eu`; comma-separated matchmaking regions |
| `STUN_URLS` | optional comma-separated STUN URLs |
| `TURN_URLS` | optional comma-separated TURN/TURNS URLs |
| `TURN_SECRET` | shared coturn REST secret, at least 24 characters when TURN URLs are configured |
| `GOMEMLIMIT` | optional Go soft memory budget; deployment samples use `384MiB` |
| `METRICS_TOKEN` | optional bearer token for `GET /api/metrics`; endpoint is unavailable without one |

For deployment, use one process behind an HTTPS/WSS reverse proxy, set exact HTTPS `PUBLIC_ORIGINS`, and configure TURN. HTTPS origins receive Secure cookies. The proxy must preserve WebSocket upgrades and Origin. It should enforce external request/connection limits and send HSTS. The service uses direct socket IPs for its session issuance limiter; do not rely on untrusted forwarded IP headers. A shared in-memory deployment does not support horizontal scaling or persistent guest identities.

## HTTP and WebSocket contract

- `POST /api/session` requires a trusted Origin and returns an expiring HttpOnly, SameSite=Strict guest cookie. Sessions have a six-hour absolute lifetime. Unused/disconnected sessions expire after two minutes without an admitted connection; repeated HTTP calls do not extend that idle lifetime. Active WebSockets keep the session usable. Issuance is limited to 20/minute and 32 outstanding sessions per source, with 10,000 globally.
- `GET /api/config` requires that cookie and returns build identities, regions, STUN servers, input delay 2, and the unverified-results label. It never issues TURN credentials.
- `POST /api/ice?instance=<page ID>&matchId=<current match>` requires the guest cookie, trusted Origin, and the named page in the named active match. A disconnected page has a ten-second reconnect grace period. Multiplayer matches receive ten-minute TURN REST credentials; solo rooms receive STUN only. Credentials are cached per guest and refreshed within two minutes of expiry, at most 60 requests/minute per guest and 240 per source. The browser requests this after receiving a match and during ICE renewal. The shared secret is never returned.
- `GET /ws` requires the session cookie and trusted Origin. Use `?instance=<32 hex characters>` to distinguish up to four windows sharing a cookie. New connections must send compatible hello within ten seconds. Each connection has a 32 KiB message limit, a 64-message outgoing queue, write deadlines and ping/pong liveness. Admission reserves capacity before upgrade; failed upgrades release it. The retained-client caps are 4/guest, 64/source and 512 globally, including disconnected clients and pending new upgrades. Same-instance reconnects can replace their retained slot; separate physical-socket limits of 8/guest, 128/source and 576 globally bound overlap with closing predecessors. Source handshakes are limited to 120/minute. Message limits are 100/second per socket, 200 per guest and 1,000 per source.
- `GET /healthz` reports basic process availability. Authenticated `GET /api/metrics` returns aggregate, client-reported connection/relay/RTT/stall/rollback/desync counters; these are operational observations, not trusted competitive outcomes. Its separate `server` object contains authoritative session/client/socket/pending/room/queue/source counts, admission rejection counters and relay-response counts. Client reports cannot set those fields.

All routes reject request bodies. The HTTP server has header, read and write timeouts; responses include a CSP permitting the local scripts, workers and WASM but forbidding inline scripts, framing and plugins. Sources use the trusted proxy address handling described above and group IPv6 clients by /64. The source-budget table is bounded at 10,000 entries; inactive entries without sessions are pruned after two minutes. Shared NATs are subject to shared source limits.

The server sends `welcome` with the current identity. A new guest sends `hello` with exact identity and selected region. Only compatible clients can enter rooms. The UI uses Quick play; invite rooms and fixed-size queues remain available through the protocol. The supported messages are:

| Client message | Effect |
| --- | --- |
| `quickPlay` | Join a room in the same region with fewer than four pilots, or start flying in a new solo room |
| `snapshot {matchId, transition, snapshot}` | The designated surviving peer supplies a base64 confirmed snapshot for a roster change |
| `create {players}` | Create a 2–4-player invite room, receive `room` with code and slot |
| `join {code}` | Join an available room in the selected region |
| `queue {players}` / `cancelQueue` | Group compatible clients with the same 2–4-player count and region, or cancel |
| `ready {ready}` | Set ready state; every occupied slot ready starts a match |
| `signal {matchId, recipient, signal}` | Forward bounded signaling only to the specified other slot in this active match; sender is stamped by the server |
| `finish {matchId, winner}` | Collect every participant’s matching winner report before ending the match; results remain unverified |
| `rematch` | Ready for a fresh match ID/epoch/seed; all clients must opt in |
| `leave` | Leave room/queue; all active opponents receive disconnected termination |
| `metrics {matchId, metrics}` | Submit bounded operational counters for an active match |

Room/queue admission attempts are limited to 12/minute per guest and 60 per source. Leaving remains unrestricted. Leaving a room starts a three-second guest-wide rejoin cooldown, preserved across reconnects; the UI waits and retries an outstanding Quick play request. Quick rooms accept at most four additional admissions/minute and accept no newcomers while transitioning (another available room or a new solo room is used). Departures may change the snapshot authority, but do not extend the original ten-second transition deadline.

Quick rooms restart automatically with everyone at zero when a confirmed score reaches five. Joining or leaving briefly pauses the peer mesh while a surviving pilot supplies a confirmed snapshot; the new match carries the snapshot and old-to-new slot mapping, preserving ships and scores. Departed pilots’ projectiles are removed, and new pilots spawn with zero points. If the snapshot handoff times out after ten seconds, the room starts a fresh round. Quick rooms stay open until the final pilot leaves.

A `match` message fixes player count and slots, random match ID/epoch/seed, exact content identity, input delay 2, region and designated recovery peer 0. WebSocket reconnect with the same cookie preserves room and slot for ten seconds; the server resends room and match configuration. The client must resume/renegotiate its peer transport. The browser retries temporary HTTP failures during reconnect and bounds HTTP/WebSocket setup by the remaining grace window. After that grace window, cleanup frees the room membership and informs all opponents. Sessions, rates and idle clients are also cleaned periodically.

WebSocket framing/concurrency follows the [Gorilla WebSocket API](https://pkg.go.dev/github.com/gorilla/websocket). TURN credentials follow [coturn's REST authentication configuration](https://github.com/coturn/coturn/blob/master/README.turnserver). Local forced-relay and HTTPS/WSS browser checks are implemented; public acceptance remains outstanding. See [deployment](deployment.md) and [TURN](turn.md).
