#!/bin/sh
# docker/entrypoint.sh — the node container's entrypoint.
# The interface contract (docker/NODE-CONTRACT.md) requires the source to run from /app/src under Node 24's native type stripping, so this script starts `node /app/src/node/index.ts` and does nothing else: no package manager, no build step, no network.
# It uses `exec` on purpose. Without exec the shell stays as PID 1, `docker stop` sends SIGTERM to the shell, and the node process keeps running until the 10 s kill timeout turns a graceful shutdown into a SIGKILL. With exec, the node process BECOMES PID 1 and receives SIGTERM directly, which is what src/node/index.ts's graceful-close handler needs in order to run.
# An explicit command overrides the default. `docker run <image> node -e ...` and `docker run <image> node /app/src/node/index.ts` both work, because a non-empty argument list is executed verbatim instead of being appended to the default command — appending it would build `node /app/src/node/index.ts node -e ...`, which is not a valid argv for the node.
set -e
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node /app/src/node/index.ts
