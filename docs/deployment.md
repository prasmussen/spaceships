# HTTPS/WSS deployment

For a native FreeBSD jail without Docker, use [the FreeBSD deployment guide](freebsd.md).

`Dockerfile` builds the handwritten WASM and frontend with pinned Node, then compiles the Go service with pinned Go. Image digests fix both build environments. The final image contains the static site and a Go binary, runs as a non-root user, and needs no writable filesystem. Startup verifies the served WASM digest.

`deploy/compose.yml` places Caddy in front of the app. Only Caddy publishes ports. Caddy manages public certificates and proxies WebSocket upgrades; see its [automatic HTTPS](https://caddyserver.com/docs/automatic-https) and [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) documentation.

## Prepare a host

Use a Linux Docker host with a hostname pointing to its public address. Allow inbound TCP 80 and TCP/UDP 443. Configure TURN separately using [the relay guide](turn.md). Copy `deploy/game.env.example` to a private file, replace the hostname/origin, set the relay credentials, and generate a separate random metrics token. `PUBLIC_ORIGIN` must match the exact browser origin, including a nonstandard port when applicable.

```sh
docker compose --env-file /path/to/game.env -f deploy/compose.yml config --quiet
docker compose --env-file /path/to/game.env -f deploy/compose.yml up --build -d
docker compose --env-file /path/to/game.env -f deploy/compose.yml logs --tail=100
```

Leave `TLS_CONFIG` unset for public certificate issuance. Caddy's `/data` volume retains certificates and private keys across restarts. Do not delete production volumes during ordinary updates. The fixed private subnet is `172.30.90.0/24`; if it conflicts with host networking, update the subnet, both service addresses, and `TRUSTED_PROXY_CIDRS` together.

The Go service accepts `X-Real-IP` only from the configured Caddy address, `172.30.90.2/32`. Caddy overwrites that header using its immediate client's address. This preserves per-client guest rate limits. For other proxy arrangements, explicitly configure their CIDRs and overwrite `X-Real-IP`; do not expose the app port to untrusted callers behind a broadly trusted proxy network. Forwarded headers from untrusted connections are ignored.

## Local deployment verification

```sh
node tests/browser.mjs --https
```

The existing browser entry point builds the complete image, starts an isolated Compose project on loopback ports 18080/18443, and uses Caddy's internal CA. Only these test browser contexts ignore certificate trust errors; no CA is installed on the host. It verifies a secure context, Secure/HttpOnly guest cookies, WSS queue matching, WebRTC controls, wrong-origin rejection and leave. It compares the container's WASM identity with the workspace build. Finally it stops the project and deletes only its own test volumes. Evidence is written to `artifacts/https-browser.json` and `artifacts/https-server.log`.

## Operations and acceptance

Rooms, sessions, queue entries and metrics are in memory. Restarting the Go process interrupts active matches; schedule updates between play sessions. This is a single-instance deployment: do not place independently stateful app replicas behind a load balancer. Preserve each released build manifest and WASM alongside its replays for later validation.

Monitor `/healthz`, process/container restarts, Caddy errors, TURN allocation failures and the bearer-authenticated `/api/metrics` endpoint. Metrics are bounded client observations. Game results remain unverified. Rotate the metrics token separately from the TURN shared secret; relay-secret rotation affects credentials already issued to players.

Before public acceptance, verify from separate networks: public certificate trust, direct and forced-relay complete matches, recovery and disconnect behavior, first-to-five/rematch/leave, and long-match credential renewal. The local test does not prove public DNS, ACME issuance, firewall/NAT behavior or internet performance. No public host has been configured by these files alone.
