# dsh-meta-community

> **Status: PRE-RELEASE `0.9.0` — under active development.** This package is published on the `next` dist-tag, not `latest`.
> Its API, wire records and panel contracts may change between `0.9.x` releases, and each package carries its own `ROADMAP.md` naming what `1.0.0` still requires.
> A published tarball is a snapshot of a moving surface: read `ROADMAP.md` before depending on a shape.

Pre-release version `0.9.0`. The community half of the Web4 meta layer: a recognised set of independently operated DSH harness instances that fuse their meta-packages under MULTIPLE authenticated authors, carry the owner five clauses as machine-readable data, and hold a standing conformance check that goes RED when a clause has no artifact behind it.

This plugin is separate from `dsh-meta-market`. It does not supersede it, it reads none of its files, and its surface is its own.

## Develop it (host half)

**These steps are for DEVELOPING this clone. They are not how a consumer installs the plugin.**
A consumer installs only the published pre-release tarball from the `next` dist-tag; that tarball does not exist yet, and nothing in this repository is installable from source. See [`DISCLOSURE.md`](DISCLOSURE.md) §8.

Two commands, no manual steps, from a checkout on this machine:

```
pnpm install
pnpm run build
```

`pnpm run build` writes `lib/index.js`, which is the only entry point the host loads (`main` and `exports[.]`). Then let a profile consume this clone through a RELATIVE `link:` and add a `dsh.profile.bundles` entry naming `dsh-meta-community`; the bundle patch `cordis.patch.yml` is an empty top-level YAML array by design, so the loader row lives in the profile patch layer and mounts exactly once:

```
- insert:
    - id: dsh-meta-community
      name: dsh-meta-community
```

Restart the harness once the bundles entry is in place.

## Host surface

One prefix registration owns seven JSON paths:

- `/meta-community/api/members`
- `/meta-community/api/census`
- `/meta-community/api/fuse`
- `/meta-community/api/standing`
- `/meta-community/api/clauses`
- `/meta-community/api/clauses/conformance`
- `/meta-community/api/standing/relabel`

The surface reports itself as `plan`, not as `exists`, while the community holds fewer than two members. That verdict is a field derived from the census rather than written by hand, so the code and the claim cannot drift apart. One member is seeded at mount: this instance.

## Node half (optional)

**This route runs a NODE. It is not how a consumer uses the plugin.**
The consensus node runs from source under Node 24 native type stripping, so the container has no build step. Two nodes plus the peer link:

```
docker compose -f docker/compose.yaml up --build
```

A single node, one process, no container:

```
NODE_ID=node-a node src/node/index.ts
```

`NODE_ID` is the only required variable. The rest default (`PORT=8090`, `SNAPSHOT_DIR=/app/snapshots`, `COMMIT_TIMEOUT_MS=1500`); a variable that is present and malformed is a named refusal with a non-zero exit, never a silent coercion. Two pre-calculated snapshots are baked in and loaded once at boot: `docker/snapshots/intent-map.json` and `docker/snapshots/meta-packages.json`.

## Checks

```
pnpm run typecheck   # tsc --noEmit
pnpm run build       # tsdown, writes lib/index.js
pnpm test            # host-half 42/42, node-half 37/37, consensus-unit 72/72
```

The three docker verifiers are **not** part of `pnpm test` and `package.json` carries no `docker:verify` script: they are `node docker/verify/anonymity.mjs`, `node docker/verify/consensus.mjs` and `node docker/verify/sharing.mjs`, and they drive the two-container fleet, so they need a running fleet. Without one they fail honestly — measured exits **3**, **2** and **3**, with consensus printing `EXIT 2 — the fleet was not reachable, so NOTHING about the consensus was measured. This is instrument failure about the TOPOLOGY.` — which is not a pass and measures nothing about the consensus.

## License

MIT. See `LICENSE`.
