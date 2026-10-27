#!/usr/bin/env bash
# Idempotent VPS install, run as root by deploy/push-to-vps.sh with the release
# tarball already unpacked in $1. Secrets (/etc/propertyflow/*.env) are provisioned
# separately and are never part of the release.
set -euo pipefail
release_dir=${1:?release dir}
NODE_VERSION=v24.21.0
NODE_DIST="node-${NODE_VERSION}-linux-x64"

id propertyflow >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin propertyflow

if [[ "$(/opt/node/bin/node --version 2>/dev/null)" != "$NODE_VERSION" ]]; then
  tmp=$(mktemp -d)
  curl -fsSLo "$tmp/node.tar.xz" "https://nodejs.org/dist/${NODE_VERSION}/${NODE_DIST}.tar.xz"
  curl -fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt"
  (cd "$tmp" && grep " ${NODE_DIST}.tar.xz\$" SHASUMS256.txt | sed "s/${NODE_DIST}.tar.xz/node.tar.xz/" | sha256sum -c -)
  rm -rf "/opt/${NODE_DIST}" && tar -xJf "$tmp/node.tar.xz" -C /opt
  ln -sfn "/opt/${NODE_DIST}" /opt/node
  rm -rf "$tmp"
fi

install -d -o root -g root -m 0755 /opt/propertyflow
rsync -a --delete --exclude node_modules "$release_dir"/ /opt/propertyflow/
cp /opt/propertyflow/deploy/vps/package.json /opt/propertyflow/package.json
(cd /opt/propertyflow && PATH=/opt/node/bin:$PATH npm install --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root /opt/propertyflow

install -d -o root -g root -m 0700 /etc/propertyflow
install -m 0644 /opt/propertyflow/deploy/systemd/propertyflow-*.service /opt/propertyflow/deploy/systemd/propertyflow-*.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now propertyflow-import.timer propertyflow-keepalive.timer
systemctl list-timers 'propertyflow-*' --no-pager
