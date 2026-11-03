# dsh-meta-community

> **Status: PRE-RELEASE `0.9.1-next.3` — built locally, NOT yet published to npm.** The intended dist-tag is `next`, not `latest`; the tarball is produced in `pre_release/_artifacts/` and publishing is an owner step, never performed by this repository.
> Its API, wire records and panel contracts may change between `0.9.x` releases, and each package carries its own `ROADMAP.md` naming what `1.0.0` still requires.
> A published tarball is a snapshot of a moving surface: read `ROADMAP.md` before depending on a shape.

Pre-release version `0.9.1-next.3`. The community half of the Web4 meta layer: a recognised set of independently operated DSH harness instances that fuse their meta-packages, carry the owner five clauses as machine-readable data, and hold a standing conformance check that goes RED when a clause has no artifact behind it.

## What the community layer is for

A harness instance can be well built and still have no way to know whether its meta-packages agree with anyone else's, and no way to say so without either trusting a server or storing what its users did.
This layer is the smallest honest answer to that: peers hand over contributions, the layer fuses them into one document that records which supplier each field came from, carries a small set of written commitments as data, and keeps a check that reports what it could not verify instead of folding it into a success.
It is not a social network, not a marketplace, and not an account system. Nothing here decides who is trustworthy; it decides what is checkable.

## What a member is, and why it is an artifact rather than an account

A member is recognised by an artifact, not by an account: a package name, a version, a capability table with citations, a disclosure of what it does not do, and a stable route prefix.
That bundle can be read and re-checked by a stranger without the author's help or machine, which is the only property that matters here.
An account would add nothing a reviewer can inspect. The thing under review is the record, and an identity that cannot be re-derived from the record is a claim about a person rather than evidence about a package.

## What this layer can check

- A package's own harnesses run and print a verdict with a numerator and a denominator, and the chain stops at the first red one rather than reporting a partial run as a whole.
- Every clause carries a non-empty falsifier, and every artifact a clause names must be a route the process actually registers.
- The conformance check recomputes that census on every request and runs a positive control, so a green verdict cannot stand if the check itself has gone blind.
- A fused document can be re-derived from the inputs: field order is sorted, so equal contributions produce a byte-identical result, and a disagreement is recorded as a conflict with the conflicting suppliers named.
- Distinct author strings are counted, and a count of two or more is reported as `multi-author` — as a shape, not as a proof of separate people.

## What this layer cannot check

- It cannot verify that a clause is *measured* by the artifact it cites, only that the artifact exists and its route is registered. A clause with no artifact and a clause whose artifact measures nothing both read as conformant.
- It cannot show a live peer network. Consensus here is a local algorithm over records this node holds, not a proof about another host; the commit is a deterministic two-voter rule at 2 of 2, explicitly not Raft, and it needs a real peer to reach a verdict.
- It cannot claim a fleet result. The fleet verifiers fail honestly with `the fleet was not reachable, so NOTHING about the consensus was measured`, and that reading measures nothing about the consensus, anonymity or sharing.
- It cannot promise durability: the member roster lives in process memory, and a restart returns it to the single seeded member.
- It cannot identify a stranger's node: the only peer address is one configured URL, dialled on exactly one path.

## Author authentication does not exist

**A name is a claim, not a credential.** No keypair is held, the frozen wire protocol declares no signature field, and no signing primitive exists anywhere in this tree; the surface prints `provenanceVerified: false` beside the author count rather than printing `multi-author` alone.
The practical consequence is exact: **a second author here is indistinguishable from the first author typing a different string**, and no community feature — vouching, moderation, revocation, reputation — can be built on top of a count that cannot tell those two cases apart.
The package says this about itself rather than around it, and `1.0.0` still owes authentication of an author rather than a count of authors.

## Out of scope

- **Web3 and economics.** No token, no incentive design, no valuation, no on-chain layer is published, and none is planned here.
- **Moderation.** Roles exist as a closed vocabulary with no route to set or strip them; there is no ban, revoke or invite path.
- **Peer discovery and admission.** There is no registry, seed list, gossip or membership-exchange route; a roster only the seed can write cannot admit a member.
- **Content exchange.** No route accepts a package, a roster or a peer card. What two nodes "share" is equality of two readings of the same baked snapshots, not a transfer between them.
- **A browser panel.** Server-only by design: no client half, no panel.
- **Durable storage.** A read-only container root, no volumes and one small tmpfs; nothing a user did is kept, and the roster is derived rather than stored.
- **Distribution.** The image is not published, not signed and not built in CI, and no container of it has ever been run as part of the numbers in `DISCLOSURE.md`.
- **Inference and devices.** The intent snapshot is a precalculated artifact; nothing in this build embeds anything, calls a model or opens a device.

## Adopting it inside DSH — the published release only

This package is adopted by a deployment that stages its **published pre-release** tarball; the source tree in front of you is readable and reviewable and is not an install target.
No package-manager command is prescribed here, because how a deployment stages artifacts is the deployment choice, not this package choice.
What the deployment must already have: a profile whose web server serves loopback routes, the member plugins this layer composes over, and an operator who has decided which members are in scope.
A profile enables the package through its bundle list, which carries one loader row from the bundle patch; the client half is served from the package own client export, and a bundles change hot-reloads while a boot-time load needs a restart.
Read [`DISCLOSURE.md`](DISCLOSURE.md) before depending on any shape: this package states what it can check and what it cannot, and a reader who skips it will mistake the first for the second.

## Separate from the market half

This plugin is separate from `dsh-meta-market`. It does not supersede it, it reads none of its source files, and its surface is its own. One node route serves a captured snapshot of that plugin's published health response, which is a copy taken at build time rather than a live read of another package.

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

## Roadmap at a glance

A glance, not a second record: the authoritative list — with the evidence for every done row, the reason for every deferred one and the rows marked `NOT MEASURED` — is [`ROADMAP.md`](ROADMAP.md). Where this list and that file differ, that file is right and this list is the defect.

- **What this package is**
- **What is measured today**
- **What 1.0.0 still requires**
- **Limits, stated rather than implied**
- **Compatibility seam**
- **How this roadmap is graded**

The roadmap currently carries **0** row(s) marked `NOT MEASURED`; a row moves to done only when its own command prints a green result.

## Checks

```
pnpm run typecheck   # tsc --noEmit, exits 0
pnpm run build       # tsdown, writes lib/index.js
pnpm test            # RED, exit code 1, measured 2026-11-03 on this tree
```

**`pnpm test` currently exits `1`**, and the honest reading of it is in `DISCLOSURE.md` §2: host half **42 of 42** (exit 0); node half **36 of 37** with **E3 failed**, because the baked meta-packages snapshot no longer matches its own declared digest and the loader refuses it as `TAMPERED` — the refusal is correct, the artifact is what needs re-capturing; consensus-unit **not run**, because the chain stops at the first red command. This block previously advertised `42/42`, `37/37` and `72/72`, which the artifact no longer supports.

The three docker verifiers are **not** part of `pnpm test` and `package.json` carries no `docker:verify` script: they are `node docker/verify/anonymity.mjs`, `node docker/verify/consensus.mjs` and `node docker/verify/sharing.mjs`, and they drive the two-container fleet, so they need a running fleet. Without one they fail honestly — measured exits **3**, **2** and **3**, with consensus printing `EXIT 2 — the fleet was not reachable, so NOTHING about the consensus was measured. This is instrument failure about the TOPOLOGY.` — which is not a pass and measures nothing about the consensus. The sharing verifier exits **3** at the process level while its own summary prints `verdict: INCOMPLETE, exit 2`, because the printed verdict and the process status are produced by two different computations; the split is recorded rather than smoothed over, and the two numbers describe one run.

## License

MIT. See `LICENSE`.
