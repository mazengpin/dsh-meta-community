# syntax=docker/dockerfile:1
# docker/Dockerfile — the containerized community NODE, `metateam/meta-community-node`.
# Build context is the CLONE ROOT (`plugins-src/dsh-meta-community`), not this directory: the command is `docker build -f docker/Dockerfile -t metateam/meta-community-node:local .` run from the clone root, which is why every COPY source below is written relative to the clone root.
# The node runs FROM SOURCE under Node 24's native type stripping (`node /app/src/node/index.ts`), so this Dockerfile deliberately has NO `npm install`, NO `tsc`, NO `tsdown` and NO network access beyond the base image. The host bundle (`lib/index.js`) is built by tsdown on the host and is NOT copied in: shipping a stale bundle beside the source would create two answers to "what code is running", and the container is required to run the source.
# No secret and no credential is given an ENV or a COPY: the only variables set here are the non-secret runtime contract (NODE_ENV, SNAPSHOT_DIR). NODE_ID, PORT, PEER_URL and COMMIT_TIMEOUT_MS are supplied at RUN time by the compose topology lane, not baked into the image, so one image serves both nodes.
# No HEALTHCHECK on purpose: health is the compose service's job (docker/compose.yaml, `GET /node/health` with node's own fetch, because the image has no curl). A healthcheck baked into the image would be duplicated, and duplicated checks drift.

FROM node:24-alpine

# NODE_ENV=production is the required runtime state, not a build optimisation — there is no build step here for it to optimise.
ENV NODE_ENV=production

# SNAPSHOT_DIR default is /app/snapshots, which is where the precalculated snapshot artifacts are copied below. src/node/config.ts reads SNAPSHOT_DIR with this same default, so the image and the code agree without any runtime flag.
ENV SNAPSHOT_DIR=/app/snapshots

WORKDIR /app

# A FIXED uid/gid of 10001, created before the copies so `--chown=10001:10001` below refers to an account that already exists. It is fixed on purpose: docker/compose.yaml asserts `user: "10001:10001"`, and a uid that came from the base image's own user table would be a number nobody agreed on. `-S` (system) keeps the account out of the login path; the shell is nologin because nothing in this image is meant to be an interactive login.
RUN addgroup -g 10001 -S metanode \
 && adduser -u 10001 -D -G metanode -h /app -s /sbin/nologin metanode

# Only the three things the node actually reads. package.json is copied for its `"type": "module"` marker, which is what makes Node 24 treat the .ts sources as ESM — without it the type-stripping entrypoint resolves as CommonJS and fails.
# Ownership is set by `--chown` ON THE COPY ITSELF, and the entrypoint's mode by `--chmod`, so there is no `RUN chown -R` layer. MEASURED 2026-10-19 by image-audit and confirmed with `docker history`: a `RUN chmod … && chown -R 10001:10001 /app` after these copies writes the WHOLE tree into a new layer — it was 418 kB against 442.8 kB of COPY content beneath it, i.e. ~95% of /app stored twice — because a metadata change copies the file up. Folding it into the copy costs nothing and removes the duplicate, and the earlier comment that described that layer as metadata-only was wrong about what Docker does.
COPY --chown=10001:10001 package.json /app/package.json
COPY --chown=10001:10001 src /app/src
COPY --chown=10001:10001 docker/snapshots /app/snapshots
COPY --chown=10001:10001 --chmod=0555 docker/entrypoint.sh /app/entrypoint.sh

# Run as the numeric uid:gid, not as the name, because a numeric USER needs no /etc/passwd lookup inside the container — which is what lets the container start even with a read-only rootfs and no writable /etc.
USER 10001:10001

# 8090 is the contract's default PORT (docker/NODE-CONTRACT.md, config.ts). Publishing it is documentation of the intent; the compose lane maps host 18091/18092 to it.
EXPOSE 8090

# EXEC form, so the kernel runs docker/entrypoint.sh directly as PID 1 with no shell wrapper in front of it. The script itself `exec`s node, so SIGTERM from `docker stop` reaches the node process and its graceful-close handler runs instead of being swallowed by a shell.
ENTRYPOINT ["/app/entrypoint.sh"]
