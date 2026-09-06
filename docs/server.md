# Guest/lobby/signaling service

Build the frontend, then run the Go service:

```sh
npm run build
go run ./cmd/server
```

The default listener is `127.0.0.1:8080`, serving the production `dist/` assets and APIs. It verifies the WASM SHA-256 against the manifest before listening. `npm run dev` also proxies `/api` and `/ws` to that service. Online duel uses the service for matchmaking and signaling; solo practice works without it.

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
| `METRICS_TOKEN` | optional bearer token for `GET /api/metrics`; endpoint is unavailable without one |

For deployment, use one process behind an HTTPS/WSS reverse proxy, set exact HTTPS `PUBLIC_ORIGINS`, and configure TURN. HTTPS origins receive Secure cookies. The proxy must preserve WebSocket upgrades and Origin. It should enforce external request/connection limits and send HSTS. The service uses direct socket IPs for its session issuance limiter; do not rely on untrusted forwarded IP headers. A shared in-memory deployment does not support horizontal scaling or persistent guest identities.

## HTTP and WebSocket contract

- `POST /api/session` requires a trusted Origin and returns an expiring HttpOnly, SameSite=Strict guest cookie. Sessions last six hours; repeated calls reuse an unexpired session. New sessions are rate-limited and total session storage is bounded.
- `GET /api/config` requires that cookie and returns build identities, regions, ICE servers, input delay 2, and the unverified-results label. TURN REST usernames expire after ten minutes and use base64 HMAC-SHA1 credentials; the shared secret is never returned.
- `GET /ws` requires the session cookie and trusted Origin. Each connection has a 32 KiB message limit, bounded outgoing queue, write deadlines, ping/pong liveness, and message rate limits.
- `GET /healthz` reports basic process availability. Authenticated `GET /api/metrics` returns aggregate, client-reported connection/relay/RTT/stall/rollback/desync counters; these are operational observations, not trusted competitive outcomes.

The server sends `welcome` with the current identity. A new guest sends `hello` with exact identity and selected region. Only compatible clients can create/join rooms or queue. The supported messages are:

| Client message | Effect |
| --- | --- |
| `create {players}` | Create a 2–4-player invite room, receive `room` with code and slot |
| `join {code}` | Join an available room in the selected region |
| `queue {players}` / `cancelQueue` | Group compatible clients with the same 2–4-player count and region, or cancel |
| `ready {ready}` | Set ready state; every occupied slot ready starts a match |
| `signal {matchId, recipient, signal}` | Forward bounded signaling only to the specified other slot in this active match; sender is stamped by the server |
| `finish {matchId, winner}` | Collect every participant’s matching winner report before ending the match; results remain unverified |
| `rematch` | Ready for a fresh match ID/epoch/seed; all clients must opt in |
| `leave` | Leave room/queue; all active opponents receive disconnected termination |
| `metrics {matchId, metrics}` | Submit bounded operational counters for an active match |

A `match` message fixes player count and slots, random match ID/epoch/seed, exact content identity, input delay 2, region and designated recovery peer 0. WebSocket reconnect with the same cookie preserves room and slot for ten seconds; the server resends room and match configuration. The client must resume/renegotiate its peer transport. The browser retries temporary HTTP failures during reconnect and bounds HTTP/WebSocket setup by the remaining grace window. After that grace window, cleanup frees the room membership and informs all opponents. Sessions, rates and idle clients are also cleaned periodically.

WebSocket framing/concurrency follows the [Gorilla WebSocket API](https://pkg.go.dev/github.com/gorilla/websocket). TURN credentials follow [coturn's REST authentication configuration](https://github.com/coturn/coturn/blob/master/README.turnserver). Local forced-relay and HTTPS/WSS browser checks are implemented; public acceptance remains outstanding. See [deployment](deployment.md) and [TURN](turn.md).
