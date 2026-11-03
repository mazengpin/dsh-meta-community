# DISCLOSURE — dsh-meta-community `0.9.0`

## 1. What this package is

`dsh-meta-community` is the **community half of the Web4 layer**: a recognised set of independently operated DSH harness instances that fuse their meta-packages, carry the owner's five clauses as machine-readable data, and hold a standing conformance check that goes RED when a clause has no artifact behind it.
The governing document is [`CHARTER.md`](CHARTER.md) — the article of record for this clone, stating what it is, what it carries of the owner's directive, what it demonstrably does, and in the same voice what it does not.
The node image it ships is [`docker/`](docker/): `docker/Dockerfile`, `docker/compose.yaml`, `docker/nodes.env` and the two-container topology they define, with the interface contract in [`docker/NODE-CONTRACT.md`](docker/NODE-CONTRACT.md).
[`CONTEXT.md`](CONTEXT.md) is the reconstruction guide: the problem, the context, the intent and what was deliberately not attempted, the alternatives and why they were rejected, and numbered steps to rebuild a working environment.
This plugin is not `dsh-meta-market`. It does not supersede it, it reads none of its files, and its surface is its own.

## 2. What it does today

`pnpm test` is green, exit code `0`, measured 2026-11-03 (all figures are `passed / declared` from the harnesses' own census lines).

- host half: **42 of 42** (`node src/host/verify/host-half.mjs`).
- node half: **37 of 37** (`node src/node/verify/node-half.mjs`).
- consensus-unit: **72 of 72** (`node src/node/verify/consensus-unit.mjs`), with **5 of 5** required consensus outcomes reached: `committed`, `rejected-peer-disagrees`, `quorum-lost`, `refused-lone-node`, `refused-non-meta-key`.

`pnpm run typecheck` (`tsc --noEmit`) exits `0`; `pnpm run build` (`tsdown`) exits `0` and writes `lib/index.js` at **36.94 kB**.
The built export resolves to an object with exactly the keys `apply`, `inject`, `name`; `name` is `dsh-meta-community` and `inject` is `["webServer"]` — measured by importing `./lib/index.js`, not read from source.
It is **server-only by design: 0 client halves** — there is no `src/client/`, no `./client` export in `package.json`, and no browser panel; the host half registers responses under one prefix (`/meta-community/api`, 7 paths) and the node half serves `/node` paths.
`npm pack --dry-run` was measured after this file was added; the current reading is stated in §8 alongside the count it replaced.

## 3. What it does NOT do

Three docker verifiers exist and **none of them is part of `pnpm test`**:

- `node docker/verify/anonymity.mjs` — **exit 3**.
- `node docker/verify/consensus.mjs` — **exit 2**, printing `EXIT 2 — the fleet was not reachable, so NOTHING about the consensus was measured. This is instrument failure about the TOPOLOGY.`
- `node docker/verify/sharing.mjs` — **exit 3** at the process level, while its own summary prints `verdict: INCOMPLETE, exit 2`; the two readings disagree and the discrepancy is recorded here rather than smoothed over.

All three need a live two-container fleet. With docker present (server version `29.8.0`) but no fleet running, they fail **honestly**: *"fleet was not reachable, so NOTHING about the consensus was measured"*. That is **not a pass**, it measures nothing about consensus, of anonymity, or of sharing, and it is not part of `pnpm test`.
There is no `docker:verify` script in `package.json`; the three verifiers are run by their paths above.
The image is not published, not signed and not built in CI. No container of this image has been run as part of the numbers in §2.

## 4. Data it reads and writes

**Read at mount / boot:**

- The node reads `$SNAPSHOT_DIR/intent-map.json` (**67,128 B**) and `$SNAPSHOT_DIR/meta-packages.json` (**8,587 B**) once at module init and caches them (`src/node/intent.ts`, `src/node/metaPackages.ts`); default `SNAPSHOT_DIR=/app/snapshots`, which is where the image bakes them from `docker/snapshots/`.
- A snapshot carries `source`, `capturedAt`, `status`, `bytes`, `sha256` and the parsed `document`; a missing or malformed file is served as `available: false` with a `reason` and does **not** throw, because absent is not zero.
- The build reads `src/**` and writes `lib/index.js` (the only entry point the host loads).

**Written:**

- **Nothing at runtime.** The container's rootfs is `read_only: true`, the only writable path is a 1 MiB `nosuid,noexec` tmpfs at `/tmp`, there are no volumes and no bind mounts.
- Consensus state (the committed map, term, log length) and the session digest live in process memory only; the session probe reports `retained: 0` and `store: 'none'`.
- Dev-time only: `docker/tools/capture-intent.mjs --url --out` and `docker/tools/capture-meta-packages.mjs --url --out` write a snapshot file on the host; the three verifiers write scratch directories under the OS temp dir.
- This package writes no file belonging to a user, and it reads none.

## 5. Network

**The most important line in this file: no network of strangers has been exercised.**
A node **listens** on `config.port` bound to `0.0.0.0` (`src/node/index.ts`: `server.listen(config.port, '0.0.0.0')`, default `PORT=8090`) — every interface inside its container boundary; `docker/compose.yaml` publishes it only on the host loopback (`127.0.0.1:18091` and `127.0.0.1:18092`).
A node **dials exactly one address**, `PEER_URL`, and only one path on it: `POST ${PEER_URL}/node/consensus/endorse`, bounded by `COMMIT_TIMEOUT_MS` (default `1500`). An unset or empty `PEER_URL` is a legal lone node; a present but unparseable or non-http(s) `PEER_URL` is a named `ConfigError`, never a silent fallback.
`NODE_ID` is a **required environment variable** for a bare node start: with it unset the process refuses with a named `ConfigError` and exit code `1` — measured, `node src/node/index.ts` with `NODE_ID` unset prints `[node] refused to start — ConfigError: NODE_ID is required and must be non-empty…`. `docker/compose.yaml` satisfies it (`NODE_ID: "node-a"`, `NODE_ID: "node-b"`).
What was actually exercised: two containers of the same image, two loopback ports, one private bridge, `PEER_URL` pointing at the other service by compose service name. That is a lab pair. No third party, no internet peer, no stranger's node, no untrusted input source has ever been connected to this code.

## 6. Security posture

**Consensus here is a local algorithm over records this node holds, not a proof about another host.** It is a deterministic two-voter commit at 2 of 2, explicitly not Raft: the local node holds one vote, the peer holds the other, a term increments only on disagreement, and there is no randomness and no clock in the vote (`consensus-unit` scans the code for `Math.random`, `Date.now`, `new Date` and `performance.now` and finds none, with a positive control proving the scanner can see one).
The key space is **closed** — `intent-snapshot`, `meta-packages`, `member-roster` and nothing else — with the value bounded to 256 bytes, so the republished committed map cannot become a store of caller-supplied data. A committed value is final: there is no re-commit path and no un-commit; a different value for a committed key is refused locally before any dial.
**Authors are counted, and authentication of an author is what this layer still owes.**
What exists: `revisionStanding` counts **distinct author strings** and declares `multi-author` at 2 or more; it reports `provenanceVerified: false` **beside** the count in the same response, and the `standing/relabel` control refuses an empty author list rather than defaulting one.
What does **not** exist: any signature or key check. This deployment holds an identifier and no key; the frozen protocol declares no signature field; a search for a signer over every non-test `.ts` file returns 0; and the comparison that would bind an author id to a peer card is declared and unexpressible. **A second author here is indistinguishable from the first author typing a different string**, and the surface says so rather than printing `multi-author` alone.
No secret is read by this package at all: `describeConfig` serves `secretsRead: 0` and topology only, and `docker/nodes.env` carries no credential. Node-to-node endorsement is unauthenticated by design and the link stays inside one private docker network.

## 7. Licence and engines

Licence: **MIT** — see [`LICENSE`](LICENSE).
`engines`: `node: "^22.19.0 || >=24.0.0"` and `dsh: ">=0.2.0-0 <0.3.0"`.
There is no `repository` field in `package.json`. **The release owner sets the `repository` URL at publish time**; nothing here guesses one, and a tarball published without it is not evidence that no repository exists.

## 8. State: SOURCE PREVIEW — information-providing only

**This package is a source preview. It is readable and reviewable; it is NOT installable from source.**
The `pnpm install` / `pnpm run build` / relative `link:` route in [`README.md`](README.md) is for **developing this clone**, not for consuming it: it needs the source tree, this machine's toolchain, and a manual profile edit a consumer does not have.
The `docker compose` route is for **running a node**, not for using the plugin.
A consumer of the plugin installs **only the published pre-release tarball**, which arrives on the `next` dist-tag (`publishConfig.tag: "next"`, `status: "pre-release"`); that tarball does not exist yet.
`npm pack --dry-run` measured on 2026-11-03, with this file added to `files`, gives **41 files / 739.0 kB** unpacked and **213.8 kB** packed; the earlier published reading of **38 files / 718.3 kB** did **not** reproduce before this edit either (the same command then reported 39 files / 720.0 kB with `DISCLOSURE.md` absent), so the measured reading is the one stated and the older pair is not carried forward.
