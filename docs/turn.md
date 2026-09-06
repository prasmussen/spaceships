# TURN relay

The Go service issues ten-minute HMAC credentials compatible with coturn's REST authentication. The shared `TURN_SECRET` belongs on the service and relay host; browsers receive only expiring usernames and credentials.

## Local browser check

```sh
node tests/browser.mjs --turn
```

This uses the same browser entry point as all other tests. Docker must be running. The script starts a disposable coturn container, configures the Go test service with a random shared secret, forces both browsers to use relay candidates, exercises renewed credentials and ICE restart without replacing the match, checks flight controls, leave, queue cancellation and requeue, and validates the downloaded replay through Go/wazero. It stops the container and saves `artifacts/turn-server.log` and `artifacts/relay-browser.json`.

The fixture selects a local IPv4 address; set `TURN_TEST_IP` to override it. It binds TCP/UDP 34789 and UDP 45000–45031 on that address. Those ports must be free. Its private-address peer permissions support the local test topology; the deployment configuration below restricts private destinations.

For an extended check, run `node tests/browser.mjs --turn --soak`. It holds real relay traffic for eleven minutes, verifies scheduled renewals beyond the original credential expiry, then checks recovery/disconnect and shared hashes. The completed result is saved in `artifacts/turn-soak.json`.

## Linux relay host

Copy `deploy/turn.env.example` to a private file, replace the addresses and hostname, and generate a random shared secret. Set the same secret in the Go service. The public address must map relay UDP ports one-to-one to the private address; on a directly addressed host both values are identical. Point the TURN hostname at that public address.

```sh
docker compose --env-file /path/to/turn.env -f deploy/compose.turn.yml config --quiet
docker compose --env-file /path/to/turn.env -f deploy/compose.turn.yml up -d
```

Allow inbound TCP/UDP 3478 and UDP 45000–45199 through the host firewall and any upstream firewall. Configure the Go service with:

```text
TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp
TURN_SECRET=<same private secret>
```

The deployment pins coturn 4.17.2-r0 by image digest. It uses Linux host networking, allocation/bandwidth quotas, no CLI, rotated logs and private-peer address restrictions. Review quotas against expected concurrency. See the [official container guide](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md) and [configuration options](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf).

This configuration offers TURN over UDP and TCP. Networks requiring TLS-only egress need an additional TURN TLS listener with a valid certificate and a `turns:` URL; that deployment is not configured here. The game and signaling service also still need their HTTPS/WSS deployment. Local relay evidence does not prove public routing, NAT/firewall behavior, or complete internet matches: run acceptance from separate networks against the deployed service.
