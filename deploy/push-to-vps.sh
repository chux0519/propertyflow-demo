#!/usr/bin/env bash
# Ships the committed importer (not the web app) to the VPS and runs install.sh.
#   deploy/push-to-vps.sh <ssh-host>
# The VPS needs no GitHub access: the release is a `git archive` of HEAD.
set -euo pipefail
host=${1:?ssh host}
cd "$(git rev-parse --show-toplevel)"
rev=$(git rev-parse --short HEAD)
git archive --format=tar HEAD workers scripts deploy fixtures/kyero/sample-feed.xml \
  | ssh "$host" "rm -rf /tmp/propertyflow-release && mkdir -p /tmp/propertyflow-release && tar -x -C /tmp/propertyflow-release && echo $rev > /tmp/propertyflow-release/REVISION"
ssh "$host" "sudo bash /tmp/propertyflow-release/deploy/vps/install.sh /tmp/propertyflow-release && rm -rf /tmp/propertyflow-release"
echo "deployed $rev to $host"
