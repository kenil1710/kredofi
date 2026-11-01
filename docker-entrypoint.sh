#!/bin/sh
# The Fly volume at /data is root-owned when first mounted: make it writable for the `node` user,
# then drop root and run the server as `node`.
set -e
mkdir -p /data/submitted
chown -R node:node /data
# setpriv keeps root's HOME; wasmtime writes its compile cache under $HOME, so point it at node's.
export HOME=/home/node
exec setpriv --reuid=node --regid=node --init-groups "$@"
