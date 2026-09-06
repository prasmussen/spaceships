#!/bin/sh
# Build a complete release from this checkout; frontend and WASM stay matched.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
arch=${1:-amd64}
case "$arch" in amd64|arm64) ;; *) echo "Usage: $0 [amd64|arm64]" >&2; exit 2 ;; esac
if [ "$#" -gt 1 ]; then echo "Usage: $0 [amd64|arm64]" >&2; exit 2; fi
npm ci
npm run build
stage=$(mktemp -d "${TMPDIR:-/tmp}/spaceships-freebsd.XXXXXXXX")
trap 'rm -rf "$stage"' EXIT
trap 'exit 1' HUP INT TERM
release="spaceships-freebsd-$arch"
payload="$stage/$release"
mkdir -p "$payload/bin" "$payload/www" "$root/artifacts/freebsd"
"$root/scripts/build-freebsd.sh" "$arch" "$payload/bin"
cp -R dist/. "$payload/www/"
cp deploy/freebsd/spaceships "$payload/spaceships"
cp deploy/freebsd/spaceships.conf.sample "$payload/spaceships.conf.sample"
cp deploy/freebsd/Caddyfile.sample "$payload/Caddyfile.sample"
cp deploy/freebsd/install.sh "$payload/install.sh"
cp docs/freebsd.md "$payload/INSTALL.md"
cp docs/deployment.md docs/turn.md "$payload/"
printf '%s\n' "$arch" > "$payload/ARCH"
# Avoid host ACLs, extended attributes and restrictive source permissions.
find "$payload" -type d -exec chmod 755 {} +
find "$payload" -type f -exec chmod 644 {} +
chmod 755 "$payload/bin/spaceships" "$payload/spaceships" "$payload/install.sh"
archive="$root/artifacts/freebsd/$release.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$stage" "$release"
# Node is already required by the frontend; use it for portable SHA-256 output.
node --input-type=module - "$archive" <<'JS'
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
const path=process.argv[2];
writeFileSync(`${path}.sha256`,`${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${basename(path)}\n`);
JS
printf 'Bundle: %s\nChecksum: %s.sha256\n' "$archive" "$archive"
