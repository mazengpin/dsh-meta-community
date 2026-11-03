# NODE-CONTRACT — the interface every lane codes against

This file is the Lead's, and it is the only place the interfaces are stated. If your lane needs an interface change, message the Lead — do not change it in your own file and let the others drift.

The node is a container that serves the existing community surface plus a node-level surface. It runs from **source** under Node 24's native type stripping: `node src/node/index.ts`. Therefore **none of the node sources may use a non-erasable TypeScript construct** — no `enum`, no `const enum`, no `namespace`, no parameter properties (`constructor(private x: T)`), no decorators, and no `import = require`. A type-only import must be written `import type`.

## Directory layout and file ownership

```
plugins-src/dsh-meta-community/
  src/host/**                 EXISTING. Nobody on this build edits these except charter-update (CHARTER.md only).
  src/node/config.ts          node-core
  src/node/index.ts           node-core
  src/node/server.ts          node-core
  src/node/paths.ts           contract-routes
  src/node/intent.ts          intent-share
  src/node/metaPackages.ts    meta-packages-share
  src/node/consensus.ts       consensus-core
  src/node/peerClient.ts      consensus-core
  src/node/session.ts         anon-session
  src/node/verify/node-half.mjs   build-gate
  docker/.dockerignore        docker-image
  docker/Dockerfile.dockerignore  docker-image — THE FILE DOCKER ACTUALLY READS
  docker/Dockerfile           docker-image
  docker/entrypoint.sh        docker-image
  docker/compose.yaml         compose-topology
  docker/nodes.env            compose-topology
  docker/snapshots/intent-map.json          intent-share
  docker/snapshots/meta-packages.json       meta-packages-share
  docker/tools/capture-intent.mjs           intent-share
  docker/tools/capture-meta-packages.mjs    meta-packages-share
  docker/verify/consensus.mjs      consensus-harness
  docker/verify/anonymity.mjs      anonymity-harness
  docker/verify/sharing.mjs        sharing-harness
```

Everything below `docker/` is plain ESM JavaScript (`.mjs`) with no build step, so a harness can be run by `node docker/verify/x.mjs` with no toolchain.

## `paths.ts`

```ts
export const NODE_PREFIX: string            // '/node'
export const NODE_PATHS: readonly string[]  // every node path this server dispatches, frozen
export const CONSENSUS_PATHS: readonly string[]
export function allPaths(): readonly string[]   // NODE_PATHS + CONSENSUS_PATHS + host REGISTERED_PATHS, deduped
```

`NODE_PATHS` must contain exactly: `/node/identity`, `/node/intent`, `/node/meta-packages`, `/node/session/probe`, `/node/anonymity`, `/node/health`.
`CONSENSUS_PATHS` must contain exactly: `/node/consensus/state`, `/node/consensus/propose`, `/node/consensus/endorse`.
`allPaths()` is what the 404 body prints and what the G9-style drive walks. **`/node/health` is a path in its own table**, because the compose healthcheck needs something that cannot be confused with a route that might one day need a body.

## `config.ts`

```ts
export type NodeConfig = {
  nodeId: string          // NODE_ID, required, non-empty; the process refuses to start without it
  port: number            // PORT, default 8090
  peerUrl: string | null  // PEER_URL, null when unset — a lone node is legal and MUST report itself lone
  snapshotDir: string     // SNAPSHOT_DIR, default '/app/snapshots'
  commitTimeoutMs: number // COMMIT_TIMEOUT_MS, default 1500
}
export function readConfig(env: NodeJS.ProcessEnv): NodeConfig   // throws a named Error on a bad value
export function describeConfig(config: NodeConfig): Record<string, unknown>  // safe to serve: NEVER includes a secret
```

## `intent.ts` and `metaPackages.ts`

```ts
export type SnapshotView = {
  available: boolean
  reason: string | null       // why it is unavailable, stated rather than implied
  source: string | null       // the URL the snapshot was captured from
  capturedAt: string | null   // ISO string from the snapshot file
  bytes: number | null
  sha256: string | null       // ALGORITHM-NAMED: the field is called sha256, never 'digest'
  document: unknown | null
}
export function loadIntentSnapshot(dir: string): SnapshotView    // intent.ts
export function loadMetaPackagesSnapshot(dir: string): SnapshotView  // metaPackages.ts
```

**Both loaders read once at module init and cache.** They must **not** throw on a missing or malformed file: a node that cannot find its snapshot serves `available: false` with a `reason` and stays healthy, because a crash on a missing artifact is indistinguishable from a broken node. Absent is not zero here either: `available: false` must never be reported as "0 zones".

## `consensus.ts`

A two-node consensus that is honest about what it is: **not Raft**, a deterministic two-voter commit where the local node holds one vote and the peer holds the other, and a proposal commits only at 2 of 2.

```ts
export type ProposalResult =
  | { outcome: 'committed'; term: number; index: number; key: string; value: string; votes: 2; of: 2; peer: string }
  | { outcome: 'rejected-peer-disagrees'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: string; peerReason: string }
  | { outcome: 'quorum-lost'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: string; peerReason: string }
  | { outcome: 'refused-lone-node'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: null; peerReason: string }

export type ConsensusState = {
  nodeId: string
  term: number
  logLength: number
  committed: Record<string, string>
  proposals: number
  lastOutcome: ProposalResult['outcome'] | null
  peer: { url: string | null; lastAnswer: string | null; lastLatencyMs: number | null }
  quorum: { required: 2; of: 2 }
}
export class Consensus {
  constructor(config: NodeConfig, fetchImpl?: typeof fetch)
  async propose(key: string, value: string): Promise<ProposalResult>
  endorse(key: string, value: string, term: number): { accepted: boolean; reason: string; term: number }
  state(): ConsensusState
}
```

Rules that must hold, and are checked by the harness:

1. **`outcome` is one of FIVE distinct strings, never a boolean** — `committed`, `rejected-peer-disagrees`, `quorum-lost`, `refused-lone-node`, and `refused-non-meta-key` (added by AMENDMENT 1). CORRECTED 2026-10-19T11:20Z: this line read "FOUR", and an independent review measured the fifth reachable with no peer at all. A contract stating one fewer outcome than the code has is the stale-gate shape, and it would have propagated into the charter and the consensus harness. Changing the peer from up to down must move `committed` → `quorum-lost` and must **leave `committed` unchanged**.

2. **`rejected-peer-disagrees` and `quorum-lost` are different states** and must not collapse: the first is a peer that answered and refused, the second is a peer that did not answer. The distinct string is the whole evidence that the code distinguishes them.
3. A committed entry is **only** written after the peer's endorsement returns `accepted: true` for the **same** `key`, `value` and `term`. A peer that accepts a different value is `rejected-peer-disagrees`, not a commit.
4. `TERM` starts at 1 and increments only on a disagreement. **Do not invent randomness or clocks into the vote** — two containers started in either order must reach the same verdict for the same input.

## AMENDMENT 1 (Lead, 2026-10-19T11:15Z): five outcomes, both nodes hold the commit, and the key space is CLOSED

Three changes, forced by measurement on the live pair rather than by preference.

**(a) A fifth outcome: `refused-non-meta-key`.** The committed map is served back on `GET /node/consensus/state`, so any string that can enter it is **data the node preserves and republishes** — which collides head-on with the owner's requirement that no user data be kept. The first version accepted any `key`, and an independent review drove `{"user-email":"victim@example.com"}` into it. The repair is structural, not a promise: **`propose` accepts only keys from a closed, enumerated vocabulary** and refuses everything else with `outcome: 'refused-non-meta-key'`, `votes: 0`, and the key echoed back so the refusal is auditable. The vocabulary is `intent-snapshot`, `meta-packages`, `member-roster` and nothing else; `value` is bounded to 256 bytes and must be a lowercase hex sha256 or a member id, so the map cannot become a free-text store. A closed key space is checkable; "we will be careful" is not.

**(b) An endorsement COMMITS ON THE ACCEPTING NODE TOO.** Measured defect on the live pair: node-a proposed `lead-probe-3`, node-b accepted the endorsement at term 1, and node-b's own `committed` map stayed empty — so the two nodes' views of the same committed value diverged, and the "consensus" was a single-node write with an acknowledgement. After the fix, `endorse()` writes the same `{key, value, term, index}` to the accepting node's committed map, and `GET /node/consensus/state` on **both** nodes must show the entry for the same term. This is what makes the two-node result checkable from the peer rather than only from the proposer.

**(c) The endorsement response must ECHO what it accepted.** `endorse()` returns `accepted, reason, term, key, value`, and the peer client must FAIL CLOSED when `key` or `value` is missing. The first version returned no key/value and its guards were written as `answer.key !== null && …`, so they passed unconditionally — a peer naming nothing drove a `committed` outcome for a value nobody had checked. **A guard that is satisfied by an absence is not a guard.**

Any lane whose interface this touches: `consensus.ts`, `peerClient.ts`, `server.ts` (dispatch must route the fifth outcome), the node suite, and `docker/verify/consensus.mjs`. The three containers' `/node/consensus/*` behaviour changes here, so an image rebuild is part of this amendment rather than a follow-up.

**(d) AN ENDORSEMENT MUST REFUSE A VALUE THAT CONTRADICTS THAT NODE'S OWN COMMITTED MAP — measured split brain.** `docker/verify/consensus.mjs` run `mvf5knww327e88` drove this with two ordinary POSTs: node-a committed `down-… = value-quorum-lost-…` at 2 of 2, then node-b proposed the SAME key with a different value and ALSO reached 2 of 2. The result was two nodes, two truths, both claiming quorum — because `endorse()` never consulted the map it had already written. So `endorse()` must, before accepting, check its own `committed[key]`: a matching value at the same term is idempotent-accept; a different value for an already-committed key is **REFUSED**, and that refusal is what finally makes `rejected-peer-disagrees` reachable **end-to-end** rather than only against a unit fake. The refusal must name the committed value's term so the disagreement is auditable, and the proposer must not overwrite its own map on it.

## `session.ts` — the anonymity instrument

```ts
export type SessionProbe = {
  observedFields: number
  droppedFields: number
  sessionDigest: string      // sha256 over (process salt, node id, request nonce); NOT stored
  digestAlgorithm: 'sha256'
  retained: 0
  store: 'none'
  note: string
}
export function probeSession(nodeId: string, payload: unknown): SessionProbe
export function anonymityReport(nodeId: string): Record<string, unknown>
```

The salt is generated **once per process, in memory, and never logged, served or written to disk**. `retained` is the literal number `0` and is derived from a counter that only increments if a store is ever added — **if you cannot derive it, do not pretend: state `store: 'none'` and let the canary harness be the proof.** `droppedFields` counts the payload's own top-level keys that were deliberately not retained, so a caller can see that the payload was *seen and dropped* rather than never received.

## `server.ts` / `index.ts`

```ts
export function buildNodeServer(deps: {
  config: NodeConfig
  intent: SnapshotView
  metaPackages: SnapshotView
  consensus: Consensus
}): { handler: (req, res) => Promise<void>, communityHandler: (req, res) => Promise<void> }

export function startNode(): Promise<{ server, config }>   // index.ts; binds, logs the bound port, exits on EADDRINUSE with a named message
```

Dispatch order: node paths first, then anything under the host `PREFIX` (`/meta-community/api`) is delegated to `buildHandler().handler` from `../host/routes.ts`, then a 404 that prints `allPaths()`, the method, and the path.

**Every response carries `nodeId`, and every 405 states the method it received** — the market build's doubled-segment defect came from a path list maintained by hand beside a dispatcher, and the repair was to derive one from the other and drive every entry.

## Snapshot capture (`docker/tools/capture-*.mjs`)

Each tool takes `--url` and `--out`, fetches with a timeout, and writes a file of exactly this shape:

```json
{ "source": "<url>", "capturedAt": "<ISO>", "status": 200, "bytes": 1234,
  "sha256": "<hex of the response body as fetched>", "document": <parsed body> }
```

**The tool exits non-zero on a non-200, on a body it cannot parse, or on a `document` whose own census is empty** — a snapshot of nothing must never be committed as a snapshot, because the node would then serve "0 zones" as a fact. `bytes` is `Buffer.byteLength` of the body and `sha256` is over those same bytes, so the pair can be re-checked without the network.

## The anonymity claim, stated so it can fail

The node must be able to answer, with evidence, that **no user data is preserved**. The instrument is a canary sweep, not a promise: a unique string is submitted as user payload and then searched for in the container's writable layer (`docker diff`), its logs, and the filesystem reachable by `docker exec`, with a **positive control container that deliberately stores the same canary** proving the search can find one. `anonymity.mjs` must print, for each of the four search surfaces, the number of occurrences and whether that surface was actually probed (`null` when the probe did not run — an unprobed surface is not a clean one).

## What no lane may do

- No GPU, no model call, no device open. The intent snapshot is a **precalculated artifact**; nothing in this build embeds anything.
- No new `dsh-meta-*` clone name.
- No `package.json` in the meta workspace root; no edit to `plan/README.md`.
- Do not mount the community plugin into any live profile and do not restart the 3083 host — this build is containers, not the host.
- Do not `rm -rf` any tree. Do not `git add -A`.
- Files are UTF-8, LF only, one physical line per paragraph, exactly one trailing newline.
