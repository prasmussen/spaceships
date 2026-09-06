# FreeBSD jail deployment

The release bundle contains the statically linked Go server, production web assets, an rc.d service, configuration samples and an installer. Go, Node, npm and a C compiler are only needed on the build machine, not in the jail. The server serves both the site and matchmaking/signaling APIs; use an HTTPS reverse proxy for public browser access.

## Build on macOS, Linux or FreeBSD

Use Go 1.23 or newer and Node 26.7+ (the frontend build directly imports TypeScript). The Dockerfile records the toolchain versions used by the container build. Choose the architecture of the **FreeBSD host**, not your build machine. The scripts support `amd64` (default) and `arm64`. Use a supported FreeBSD release compatible with your Go toolchain; see the [Go on FreeBSD compatibility table](https://go.dev/wiki/FreeBSD).

From the repository:

```sh
# Server binary only, without installing frontend dependencies:
./scripts/build-freebsd.sh amd64
# -> artifacts/freebsd/amd64/spaceships

# Complete installable release (npm ci, frontend/WASM build, Go build, archive):
./scripts/bundle-freebsd.sh amd64
# -> artifacts/freebsd/spaceships-freebsd-amd64.tar.gz
# -> artifacts/freebsd/spaceships-freebsd-amd64.tar.gz.sha256

# For an ARM64 host instead:
./scripts/bundle-freebsd.sh arm64
```

The build script also accepts an output directory as its second argument. Relative output paths are relative to the repository root. Cross-compilation sets `GOOS=freebsd`, the chosen `GOARCH`, and `CGO_ENABLED=0`. Each bundle rebuilds the website and WASM together; do not combine a server's web files with a different release's manifest. The server verifies the WASM digest at startup. Keep previous archives for rollback and replay validation. Each run replaces the archive for that architecture.

## Install inside the jail

Create and network your jail using your usual jail manager. No Linux compatibility or special raw-socket privileges are needed by this service. The jail must have a working resolver, network route and readable base system files. Copy the archive and its checksum file into the jail, for example to `/tmp`. If copying through the host, place them under the jail's root directory, then enter the jail with `jexec JAIL_NAME /bin/sh`.

Run the following **as root inside the jail** (substitute `arm64` when applicable):

```sh
cd /tmp
# Compare the digest with the first field of the companion .sha256 file.
sha256 -q spaceships-freebsd-amd64.tar.gz
cat spaceships-freebsd-amd64.tar.gz.sha256

tar -xzf spaceships-freebsd-amd64.tar.gz
cd spaceships-freebsd-amd64
./install.sh
vi /usr/local/etc/spaceships.conf
```

The installer checks the OS and architecture, creates the `spaceships` user/group if absent, and installs:

| Path | Contents |
| --- | --- |
| `/usr/local/libexec/spaceships/spaceships` | Server binary |
| `/usr/local/share/spaceships/www/` | Built site, WASM and manifest |
| `/usr/local/etc/rc.d/spaceships` | Service script |
| `/usr/local/etc/spaceships.conf` | Root-only shell configuration; existing contents are preserved |
| `/usr/local/etc/spaceships.conf.sample` | Current configuration example |
| `/usr/local/share/spaceships/Caddyfile.sample` | Optional reverse proxy example |

The installer does not enable or start the service or configure the proxy. Edit the configuration first. Its contents use **shell syntax**, including quoted values, and are sourced by root at service startup. Keep it owned by `root:wheel` with mode `0600`.

## Listener, origin and proxy

Set `PUBLIC_ORIGINS` to the exact browser origin, for example `https://game.example.com`. Multiple origins are comma-separated. Keep `REGIONS` consistent with the region you offer to players. Set an optional random `METRICS_TOKEN` to enable authenticated metrics; an empty token leaves the endpoint unavailable.

Choose addresses for your jail topology:

- **Proxy in the same VNET jail:** the sample uses `LISTEN_ADDR='127.0.0.1:8080'`, trusts only loopback proxy addresses and proxies to `127.0.0.1:8080`.
- **Proxy on the host or in another jail:** bind to this game's jail address, for example `LISTEN_ADDR='10.0.0.20:8080'`. Set `TRUSTED_PROXY_CIDRS` to the proxy's actual source IP, for example `10.0.0.10/32`. Point the proxy upstream at `10.0.0.20:8080`. For a traditional shared-IP jail, use its assigned IP rather than assuming loopback behaves like a VNET jail.

Allow the app's port only from the proxy. The proxy must preserve WebSocket upgrades and `Origin`, and overwrite `X-Real-IP` with the immediate client's IP. A proxy in another jail must connect to the game jail's address, not its own loopback.

For Caddy in the same jail:

```sh
pkg install caddy
# Merge the supplied site block into your existing configuration, or copy it
# for a new dedicated proxy. Replace game.example.com before starting Caddy.
cp /usr/local/share/spaceships/Caddyfile.sample /usr/local/etc/caddy/Caddyfile
vi /usr/local/etc/caddy/Caddyfile
caddy validate --config /usr/local/etc/caddy/Caddyfile
sysrc caddy_enable=YES
service caddy start
```

Public DNS must point at your proxy. Forward/allow TCP 80 and 443 to the proxy for HTTPS and certificate issuance; UDP 443 is optional for HTTP/3. If you already have a host-level reverse proxy, add the supplied site block there instead. See [deployment.md](deployment.md) in the repository for the HTTPS architecture, and [Caddy's reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) for other configurations.

For reliable WebRTC connectivity across networks, configure `STUN_URLS`, `TURN_URLS` and `TURN_SECRET`. TURN is a separate coturn service with its own listening and relay ports; it is not included in this bundle. Use the same secret in coturn and the app, with at least 24 characters. Repository instructions are in `docs/turn.md`. An HTTP proxy alone cannot relay WebRTC game traffic.

## Enable, verify and operate

```sh
sysrc spaceships_enable=YES
service spaceships start
service spaceships status
# Use the configured jail address instead if you changed LISTEN_ADDR.
fetch -qo - http://127.0.0.1:8080/healthz
fetch -qo - http://127.0.0.1:8080/build.json
```

The service uses FreeBSD's [daemon(8)](https://man.freebsd.org/cgi/man.cgi?query=daemon&sektion=8) supervisor to run the child as `spaceships`, log stdout/stderr to syslog with tag `spaceships`, and restart it after five seconds if it exits. Its PID file tracks the **supervisor**, so `service spaceships stop` terminates the child without restarting it. This follows the standard [rc.d framework](https://docs.freebsd.org/en/articles/rc-scripting/).

Logs normally appear in `/var/log/messages` inside the jail when syslogd is running:

```sh
tail -f /var/log/messages
service spaceships restart
service spaceships stop
```

`status` reports the supervisor. A bad origin, missing assets or an unavailable listen address may cause repeated startup failures while the supervisor remains running: inspect the log and `/healthz`. The health endpoint checks the server only; also open the public HTTPS URL and try Quick play from two browsers on separate networks. Confirm direct/relay connectivity, shield controls, rematch and reconnect.

Optional `/etc/rc.conf` overrides are `spaceships_config`, `spaceships_program` and `spaceships_run_user`. These default to the installed paths and account. Use paths without spaces for rc command arguments. The sample sets `GOMEMLIMIT=384MiB`, a soft Go memory target. Apply host/jail `rctl` resource limits and proxy connection limits appropriate to the jail; a Go soft target is not a hard jail limit. The application has no persistent database or writable application data directory; sessions and rooms live in memory.

## Upgrade or roll back

Build and transfer a complete bundle. Verify its checksum, then extract it in a fresh directory. Stop the service before installing; the installer refuses to replace a running service.

```sh
service spaceships stop
cd /tmp/spaceships-freebsd-amd64
./install.sh
service spaceships start
fetch -qo - http://127.0.0.1:8080/healthz
```

Existing configuration and rc.conf settings are preserved. Review the new `.conf.sample` for additional options. Old hashed frontend assets may remain on disk; current `index.html` selects the new assets. To roll back, stop the service, install a previously retained bundle, then start it again. Restarting interrupts matches and clears in-memory rooms; schedule updates between play sessions and have clients reload after a release.

Cross-compilation and archive checks on a non-FreeBSD build machine do not execute the FreeBSD binary or rc.d service. Complete the startup, stop/restart, HTTP and public-network checks above in the target jail before relying on the deployment.
