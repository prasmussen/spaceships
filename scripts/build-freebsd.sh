#!/bin/sh
# Cross-compile the server; no FreeBSD SDK or C toolchain is needed.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
arch=${1:-amd64}
case "$arch" in amd64|arm64) ;; *) echo "Usage: $0 [amd64|arm64] [output-directory]" >&2; exit 2 ;; esac
if [ "$#" -gt 2 ]; then echo "Usage: $0 [amd64|arm64] [output-directory]" >&2; exit 2; fi
output=${2:-"$root/artifacts/freebsd/$arch"}
mkdir -p "$output"
env GOOS=freebsd GOARCH="$arch" GOAMD64=v1 GOARM64=v8.0 CGO_ENABLED=0 \
  go build -trimpath -buildvcs=false -o "$output/spaceships" ./cmd/server
printf 'Built %s\n' "$output/spaceships"
