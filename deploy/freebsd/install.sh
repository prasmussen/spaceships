#!/bin/sh
# Run as root inside the target jail, from an extracted release bundle.
set -eu
if [ "$(uname -s)" != FreeBSD ]; then echo 'Install inside a FreeBSD jail.' >&2; exit 1; fi
if [ "$(id -u)" != 0 ]; then echo 'Run as root inside the jail.' >&2; exit 1; fi
bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
arch=$(cat "$bundle/ARCH")
case "$(uname -m):$arch" in amd64:amd64|arm64:arm64|aarch64:arm64) ;; *) echo "Bundle architecture $arch does not match this jail." >&2; exit 1 ;; esac
for file in bin/spaceships www/index.html www/build.json www/simulation.wasm spaceships spaceships.conf.sample Caddyfile.sample; do
    if [ ! -f "$bundle/$file" ]; then echo "Incomplete bundle: $file" >&2; exit 1; fi
done
if [ -x /usr/local/etc/rc.d/spaceships ] && service spaceships onestatus >/dev/null 2>&1; then
    echo 'Stop the running service first: service spaceships stop' >&2
    exit 1
fi
if ! pw groupshow spaceships >/dev/null 2>&1; then pw groupadd spaceships; fi
if ! pw usershow spaceships >/dev/null 2>&1; then
    pw useradd spaceships -g spaceships -d /nonexistent -s /usr/sbin/nologin -c 'Spaceships server'
fi
install -d -o root -g wheel -m 755 /usr/local/libexec/spaceships /usr/local/share/spaceships/www /usr/local/etc/rc.d
install -o root -g wheel -m 755 "$bundle/bin/spaceships" /usr/local/libexec/spaceships/spaceships
cp -R "$bundle/www/." /usr/local/share/spaceships/www/
chown -R root:wheel /usr/local/share/spaceships
find /usr/local/share/spaceships -type d -exec chmod 755 {} +
find /usr/local/share/spaceships -type f -exec chmod 644 {} +
install -o root -g wheel -m 555 "$bundle/spaceships" /usr/local/etc/rc.d/spaceships
install -o root -g wheel -m 600 "$bundle/spaceships.conf.sample" /usr/local/etc/spaceships.conf.sample
if [ ! -e /usr/local/etc/spaceships.conf ]; then
    install -o root -g wheel -m 600 "$bundle/spaceships.conf.sample" /usr/local/etc/spaceships.conf
fi
install -o root -g wheel -m 644 "$bundle/Caddyfile.sample" /usr/local/share/spaceships/Caddyfile.sample
printf '%s\n' 'Installed. Existing configuration was preserved.' \
    'Edit /usr/local/etc/spaceships.conf, then:' \
    '  sysrc spaceships_enable=YES' \
    '  service spaceships start'
