# CONTEXT — dsh-meta-community

## (a) The problem it solves

A harness instance can be excellent alone and still have no way to know whether its meta-packages agree with anyone else's, and no way to say so without either trusting a server or storing what its users did.
`dsh-meta-community` is the smallest honest answer: a set of independently operated instances that **fuse** their meta-packages, carry the owner's five clauses as machine-readable data, and hold a standing conformance check that goes RED when a clause has no artifact behind it.
The hard half is not the fusion — it is doing it while **no user data is provably saved**, and the package is shaped around that constraint rather than around a feature list.

## (b) The context it was built in

It is the **community half of the Web4 layer**: peers are recognised harness instances, not accounts, and the unit of trust is a member record rather than a login.
The governing document is [`CHARTER.md`](CHARTER.md) — the article of record, written to state in one voice what the plugin is, what it carries of the owner's directive, what it demonstrably does, and what it does not.
The constraint that shaped every decision is the owner's requirement that **no data of the user shall be provably saved**: a read-only container root, no volumes and no bind mounts, one 1 MiB `noexec,nosuid` tmpfs, a capped log, a closed consensus key vocabulary, and a session probe that reports `retained: 0` and `store: 'none'` instead of promising prudence.
Second constraint: **consensus must be deterministic and clock-free**, so two containers started in either order reach the same verdict for the same input; the vote carries no randomness and no time.
Third constraint: the package must not impersonate a capability it does not have — a surface that counts author strings says `provenanceVerified: false` beside the count, and a node that cannot read its snapshot serves `available: false` with a reason rather than `0 zones`.

## (c) The intent, and what was deliberately NOT attempted

The intent is a **reviewable, runnable skeleton of a community node** — the host half mounted in a harness, the node half containerised, and every claim on the surface checkable by a command — not a production federation.
Deliberately **not** attempted, and each for a stated reason:

- **A live two-container fleet was never exercised in the rounds that produced the current numbers.** The three fleet verifiers are present and honest, but with no fleet up they exit `3`, `2` and `3` and the consensus verifier prints *"the fleet was not reachable, so NOTHING about the consensus was measured"*. That is an unmeasured topology, not a pass, and it is not part of `pnpm test`. The reason is practical: the fleet needs a running docker engine and two containers, and the measurements behind §2 of [`DISCLOSURE.md`](DISCLOSURE.md) were taken on a machine where the harness suite, not the fleet, was the subject.
- **Author authentication.** No keypair, no signature field on the frozen protocol, and the comparison binding an author id to a peer card is declared and unexpressible. A second author is indistinguishable from the first typing a different string, and the surface says so.
- **Any network of strangers.** Two containers of the same image on one private bridge is the whole of what has ever run; no third party, no internet peer, no hostile input source.
- **A full consensus protocol.** The commit is a deterministic two-voter rule at 2 of 2, explicitly **not Raft**, and the file says which of the five outcomes each refusal is.
- **Any model call, GPU access or device open.** The intent snapshot is a precalculated artifact; nothing in this build embeds anything.

## (d) Alternatives considered and rejected

- **Raft, or a lease-based leader.** Rejected: two voters at 2 of 2 need neither, and a clock or a random election would make the verdict depend on start order, which the contract forbids.
- **Storing committed state on a volume.** Rejected: a named volume is a durable, inspectable store that outlives the container, so it would contradict the anonymity claim at the platform layer.
- **A free-text key space in the committed map.** Rejected after measurement: the map is republished on `GET /node/consensus/state`, so an open key space turns the node into a store of caller-supplied data; the vocabulary is now closed to `intent-snapshot`, `meta-packages`, `member-roster` with a 256-byte value bound.
- **The market clone's one-owner-per-path, single-proposer authoring model.** Rejected as the model for this layer: distribution with one proposer is the opposite of decentralised development, and the community half exists to carry the decentralised clause.
- **A browser panel for this plugin.** Rejected: it is server-only by design, 0 client halves, and a panel would have added a second surface with no measurement behind it.
- **Anything else.** **NOT RECORDED.** No further alternative has a recorded rejection in this package, and none is invented here.

## (e) Recreate a working environment

POSIX shell commands only: `node`, `pnpm`, `git`, and `docker compose` where a node container is genuinely needed. No other shell is used or required at any step.

1. `git clone <this repository> && cd dsh-meta-community` — or copy an existing checkout into `plugins-src/`; the tree is self-contained.
2. `node --version` — must satisfy `^22.19.0 || >=24.0.0`; the node half runs from source under Node 24 type stripping, so no build step exists inside the container.
3. `pnpm install` — installs `typescript`, `tsdown` and `@types/node` only; there are no runtime dependencies.
4. `pnpm run typecheck` — `tsc --noEmit`, expected exit `0`.
5. `pnpm run build` — writes `lib/index.js`, the single entry point the host loads.
6. `pnpm test` — host half, node half and consensus-unit in that order; expected exit `0` with `42/42`, `37/37` and `72/72`.
7. To run ONE node without a container: `NODE_ID=node-a node src/node/index.ts`. `NODE_ID` is required; with it unset the process refuses with a named `ConfigError` and exit `1`. `PORT` (default `8090`), `SNAPSHOT_DIR` (default `/app/snapshots`) and `COMMIT_TIMEOUT_MS` (default `1500`) are optional.
8. To run the two-node fleet: `docker compose -f docker/compose.yaml up --build` — same image twice, differing only in `NODE_ID` and `PEER_URL`, on one private bridge, host ports `127.0.0.1:18091` and `127.0.0.1:18092`.
9. With the fleet up, measure it: `node docker/verify/consensus.mjs`, `node docker/verify/sharing.mjs`, `node docker/verify/anonymity.mjs`. Without a fleet these exit non-zero and measure nothing; that is the expected reading, not a failure to hide.
10. `docker compose -f docker/compose.yaml down` when done; there is nothing to keep, because nothing is persisted.
11. Do not mount this clone into a live profile unless you are developing it: a profile consumes a clone through a **relative** `link:` plus a `dsh.profile.bundles` entry naming `dsh-meta-community`, and a restart is required for anything except a bundles change.

## (f) What to read next

[`README.md`](README.md) for the surface and the checks, [`DISCLOSURE.md`](DISCLOSURE.md) for what is measured, what is invented-free and what is still owed, [`CHARTER.md`](CHARTER.md) for the article of record, [`ROADMAP.md`](ROADMAP.md) for what `1.0.0` still requires, and [`docker/NODE-CONTRACT.md`](docker/NODE-CONTRACT.md) for the node interface every lane codes against.
