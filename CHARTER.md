# dsh-meta-community — CHARTER

The article of record for this clone. It states what this plugin is, what it carries of the owner's
directive, what it demonstrably does, and — in the same place and the same voice — what it does not.

**Read §1 before §2.** The plugin's name suggests it is the meta-market work under another title, and it is not.

---

## 1. What this is, and what it is not

**It is not a supersession of `dsh-meta-market`, and it reads none of that clone's files.** Both clones are separately authorized: `dsh-meta-market` under `D-0053` (owner, 2026-10-16T16:44:27.812Z) and this one under `D-0080` (owner, 2026-10-16T18:32:26.689Z). Neither decision discharges the other, and this clone neither replaces nor reimplements the market surface.

**What it is: the two clauses the market build measured as absent from itself.**

The market clone is a package-exchange surface between two peers. Its charter is 160 lines, and the word `fuse` and the stem `communit*` appear in it **zero times**. Its authoring model is one-owner-per-path plus a single-proposer patch, which is distribution — and, as `task-15` put it, *distribution with one proposer is the opposite of decentralized development*. The word `decentralized` appears in its charter **zero times** as well.

So this clone carries:

| | Clause | What was missing there |
|---|---|---|
| **C1** | community | a community is not a pair; a fusion is not an exchange |
| **C4** | decentralized authorship | one proposer is the antonym of decentralized development |

and it carries the other three clauses honestly, including the two that fail.

**The owner's directive is reproduced verbatim at [`src/host/clauses.ts`](src/host/clauses.ts), spelling intact** (`dialoges`, `aligment`), because a faithful quotation is the point.

---

## 2. The five clauses, graded

Grades describe **this clone's own fidelity**, and nothing else. A reader asking whether some other artifact satisfies a clause must measure that artifact.

| Clause | Grade | What this clone carries | What it does not |
|---|---|---|---|
| **C1** community / fusion | `plan` | a registry with roles, a census, a fusion with per-field provenance | the participants. **A community of one is not a community.** |
| **C2** preconditions | `absent` | `null` — no artifact | both preconditions. The intent map is a map of the **plugin market**, not of a user; and "the other meta plugins are established" is **self-referential as written** |
| **C3** talk, align, cordis-hard-way, philosophy | `plan` | the Cordis-discipline half | no route here can observe another system, **because no route here admits a peer** |
| **C4** social network, decentralized, revise | `plan` | `revisionStanding`, and a **control that is driven** | an authenticated author. **A second author is indistinguishable from the first author typing a different string.** |
| **C5** verify the intent was executed | `exists` | `GET /meta-community/api/clauses/conformance`, **which can go RED** | the team-size half. The owner wrote **ten** lanes; the market charter lists **nine**. This clone cannot fix a lane count by asserting one. |

**No clause is `exists` except C5, and C5 is the process clause rather than a capability.** That is the honest census of a plugin that works and is not yet a community.

### The one grade that moved in this clone's own history

**C3 first cited `GET /meta-market-community/api/clauses/conformance` as its artifact, and that citation was wrong twice:** the path carried a `/meta-market-` prefix this clone does not serve, and the route it named is **C5's instrument, not C3's**. It now carries `artifact: null`, and the conformance check counts it as *no artifact* rather than as a broken one — because those are different states and conflating them is how a missing instrument reads as a working one.

---

## 3. The mechanical census

Every figure with its denominator, taken against the built artifact.

| | value | how measured |
|---|---|---|
| `pnpm typecheck` | **EXIT 0** | `tsc --noEmit` |
| `pnpm run build` | **EXIT 0** | `tsdown` |
| `lib/index.js` | **36,935 B** (measured 2026-10-19T11:05Z; corrected from 35,801 B — see the note under this table) | `readFileSync().length` |
| source files | **7** (corrected 2026-10-19T11:10Z from 8 — see the note under this table) | `find src/host -type f`: `clauses.ts`, `index.ts`, `routes.ts`, `types.ts`, `community/fusion.ts`, `community/members.ts`, `verify/host-half.mjs` |
| advertised routes — the HOST half | **7** | `REGISTERED_PATHS` at `src/host/routes.ts:40-48`, and the 404 body's own table |
| advertised paths — the CONTAINER node | **9** node paths, **16** in `allPaths()` | measured 2026-10-19T11:05Z under Node v24.21.0: **6** `NODE_PATHS` + **3** `CONSENSUS_PATHS` + **7** host = **16 expected / 16 distinct / 0 duplicates / 0 doubled segments** |
| driven by the harness | **7 of 7, 0 dead** | `G9`, which requires no advertised path to 404 |
| host-half harness | **42 of 42, exit 0** | read **directly**, never through a pipe |
| clauses carried | **5 of 5** | `GET /meta-community/api/clauses` |
| clauses with a runnable artifact | **3 of 5** | the other two are `null` by decision |
| clauses with a falsifier | **5 of 5** | a clause without one is a defect **in `clauses.ts`** |
| community size | **1** | the seeded local instance |
| members `inspected` | **1 of 1** | and `0` are `asserted` |

**CORRECTED 2026-10-19T11:05Z — the `lib/index.js` figure above read `35,801 B` and the built artifact measures `36,935 B`, and this note is the correction rather than a silent edit.** Measured by this lane with `readFileSync('lib/index.js').length` against the built artifact. **What this lane did NOT establish is WHY the bytes moved, and the `+1,134 B` is recorded as unexplained rather than given an invented cause:** the bundle is git-ignored and untracked (`deepseek-root/.gitignore:26` `plugins-src/*/`, so `git ls-files --error-unmatch` returns *"did not match any file(s) known to git"*), which leaves no object hash to diff and no commit to date it; the only timestamp available is the file's own mtime, `2026-10-18 16:49` local. **An explained delta that is wrong is worse than an unexplained one that is stated as such.**

**AND THE RE-RUN OF THE HOST HARNESS AT THE SAME MOMENT EXPOSES A DOUBLED COUNT IN ITS OWN SUMMARY — reported here rather than rounded away, because the number a reader would otherwise close by hand does not close.** `node src/host/verify/host-half.mjs` → **exit 0**, `VERDICT PASS`, and a summary line reading **`passed: 42  declared: 84  failed: 0`**. **`84` is not a denominator of 84 assertions: `check()` increments `declared` (line 37) and every call site increments it again — there are 43 `declared += 1` lines, one of which is that line inside `check()` — so 42 checks print as 84 declared.** The `42 of 42` in the table is the count of PASS lines (**42**) and of `check()` call sites (**42**), and it is correct; the `84` is the instrument's own defect, and it matters because **`42 / 84` is exactly what a careful reader would compute from that line — a 50% pass rate over a suite that passed every check it ran.** The figure to trust is the PASS-line count, and the fix belongs in the harness rather than in this sentence.

**CORRECTED 2026-10-19T11:10Z — the `source files` row read `8` and the instrument returns `7`, and the difference is a POPULATION difference rather than a drift.** Measured: `find src/host -type f | wc -l` → **7** (`clauses.ts`, `index.ts`, `routes.ts`, `types.ts`, `community/fusion.ts`, `community/members.ts`, `verify/host-half.mjs`), reproduced independently by the Lead. **The row now states its instrument as well as its number, because `8` and `7` are two counts over two populations and a bare figure cannot say which one produced it** — a prose census of `src/host/` that counted a directory entry, or an intended file that was never written, would each yield `8` while `find -type f` yields `7`. **What this lane did NOT establish is WHICH of those produced the old figure, and it is recorded as unexplained rather than given an invented cause** — the same form as the `lib/index.js` correction above, and for the same reason: an explained delta that is wrong is worse than an unexplained one that is stated as such.

**The plugin reports itself `plan`, and that verdict is a FIELD rather than a sentence:** `communityKind(census)` returns `plan` for any census whose inspected count is below two, so the code and the claim cannot drift apart. A future edit that made this surface claim `exists` on a one-member registry would turn `D3` of the harness red.

---

## 4. The control, and why it is a control

The owner's standing ruling: *a control that only reads a value back is not a control — show an outcome changing.*

`POST /meta-community/api/standing/relabel` takes a set of author strings and **returns a shape that moves with the input**:

| input | `shape` | `distinctAuthors` | `provenanceVerified` |
|---|---|---|---|
| `["solo"]` | `single-author` | 1 | **false** |
| `["solo","a-second-string"]` | **`multi-author`** | **2** | **false** |

**The shape MOVES and the guarantee DOES NOT.** That is not a shortfall in the route; it is the finding. `provenanceVerified` is false for one author and for two, because this deployment holds an identifier and no key: the signer search over every non-test `.ts` file returns 0, the frozen protocol declares no signature field, and the market lane measured that the comparison binding an author to a peer card is declared at `gate.ts:131` and **unexpressible at that signature**.

**A control proven to move is half the evidence; a guard proven NOT to move is the other half**, which is why the harness asserts both — `H5` and `H7`.

---

## 5. What can go red

A charter that cannot fail is a description. Four instruments here can:

1. **`GET /meta-community/api/clauses/conformance`** — checks that every clause citing an artifact cites a **registered** route, and that every clause carries a falsifier. **It publishes its own positive control on every request:** a census taken against a path table containing only a path nothing cites must report a non-zero `unreachableArtifacts`, and if it reports `0` the surface says the check is blind rather than letting a green verdict stand. Measured: `checkCanFail: true`, `unreachableWhenTableIsWrong: 3`.
2. **`src/host/verify/host-half.mjs`** — 42 assertions against the **built** artifact, driving a real listener. It asserts on the **serialised** payload (`JSON.parse(JSON.stringify(...))`), because a `Set`, `Map` or `RegExp` serialises to `{}` with no error and an in-memory object looks correct while the served body has lost the value.
3. **`G9`** — every advertised path is driven, and none may return 404. Absent is not honest; `200` and `405` both are.
4. **`G15`** — no assembly prose field may assert a program-wide absolute that a single route cannot know, **anchored to sentence-initial** because a bare substring test collided with the field name `userId` (`"no userId"` contains `"no user"`). `H3` proves the narrowed rule still catches the claim it was written for.

---

## 6. Three traps this clone paid for, recorded so the next lane does not

1. **A harness is a program, and `tsc` does not check it.** The market clone's suite referenced `assemblyStringFields`, defined it nowhere, and threw at its own line 488 — while the board read `38 of 38 PASS`, because the edit landed four seconds after the run that produced the number. **The count was right for its moment; what moved was the INSTRUMENT, which is strictly worse than a stale population.** Guard: the suite is RUN on every change.
2. **In a pipeline, `$?` is the LAST command's status.** The market verifier reported `exit 0` for a suite that was crashing, because it read `$?` after a `grep` that always succeeded. Guard: redirect to a file and read the exit code directly — which is how this clone's figures were taken.
3. **A comment that names a path can terminate the comment it is inside.** The first repair of trap 1 wrote a TypeScript glob inside a block comment; the `*` and `/` in it closed the comment early and the prose became code. **Running caught it; reading would not have.**

---

## 7. Standing constraints this clone obeys

- **No GPU, no device, no model.** `llama.cpp` is the only route to the card in this program and it is not this plugin's route. This clone opens no device, acquires no context, and calls no model.
- **No `package.json` in the meta workspace.** This clone lives in `plugins-src/`, like every other clone.
- **The profile consumes clones by relative `link:` only**, and **a restart is part of every plugin change.**
- **CORRECTED 2026-10-19T11:04Z — this bullet said the plugin was not mounted, and that is now false on measurement. It read: *"**This plugin is NOT MOUNTED.** It is built and routable; no host has loaded it, and the live 3083 answers 404 on every path in §3."* The measurement that made it stale: `GET http://127.0.0.1:3083/meta-community/api/census` answers **HTTP 200**, **685 B** of JSON, carrying `censusAt: "2026-10-19T11:04:06.496Z"`, `kind: "plan"`, and `inspected: 1` of `total: 1` — taken independently by the Lead and by this lane, by the same route and at the same minute, so this is two measurements of one fact rather than one measurement quoted twice.** The clone is also a declared dependency of the profile it runs in: `profiles-tree/personal-dev/package.json:48` carries `"dsh-meta-community": "link:../../plugins-src/dsh-meta-community"` — a relative `link:`, as the profile rule requires — and names it in the bundles array at `:101`. **What is true now: SERVED from the live host at its own prefix, answering 200 where this bullet said 404.** The distinction the old bullet drew is KEPT because it is still the right distinction — **ROUTABLE is what a process can do; SERVED is what a listener answers** — and what changed is which of the two the running system is entitled to claim. **This lane did not measure WHEN the mount happened and does not attribute the decision**; the owner's mounting decision is the owner's to record, and what is corrected here is only the measurement that had not caught up with it. **The history is kept above rather than deleted, because a charter whose corrections erase their own prior text cannot show that it changes when the world does.**
- **The `dsh-meta-*` gate now authorizes exactly two names.** `ls -d plugins-src/dsh-meta-* | grep -vE 'dsh-meta-(market|community)$' | wc -l` must be `0`. **The earlier form authorized only `dsh-meta-market` and would have flagged this clone as a breach** — the `D-METAGATE` error arriving through the text written to prevent it. Corrected in `AGENTS.md` before any deleting command was run.

---

## 8. Node mode — the container, and what it is not

**There are two ways to run this code, and they are deliberately not the same artifact.** The host loads a Cordis plugin from `lib/index.js`; the container runs `src/node/index.ts` from source under Node 24's native type stripping. **Measured 2026-10-19T11:05Z under Node v24.21.0: `allPaths()` is 16 paths — 6 `NODE_PATHS` + 3 `CONSENSUS_PATHS` + 7 host `REGISTERED_PATHS` — reported as 16 expected against 16 distinct, 0 duplicates and 0 doubled segments.** The arithmetic is the audit's own rather than this prose's: `auditPaths()` returns `expected` as the sum of the three tables, so a reader can close the identity without the author's help, and a `distinct` one short of `expected` names the paths that collided instead of silently dropping one.

**Dispatch order is contract, not preference: node paths first, then anything under `/meta-community/api` is DELEGATED to the existing host handler, then a 404 that prints the whole `allPaths()` table with its length, the method received and the `nodeId` that answered.** The delegation target is the same `buildHandler().handler` the mounted plugin registers (`src/host/index.ts:51,65`), so **the container does not reimplement the community surface — it wraps it**, and a repair to a host route reaches both the host and the node in one edit rather than two that drift. VERIFIED (read) at `src/node/server.ts`.

**The path table and the dispatcher are checked against each other at CONSTRUCTION time, in both directions** (`assertDispatchMatchesPathTable`): a path advertised with no branch, a branch served with no advertisement, or an advertised path outside `/node` is a startup failure naming every offender, not a 404 a reader has to notice. That is the market build's doubled-segment defect (`D-0071`) turned into a construction-time refusal before it can fire here.

**`lib/index.js` contains only the host entry, and that is not a hole.** Measured 2026-10-19T11:05Z: the bundle is **36,935 B**, exports exactly `{ apply, inject, name }` (`lib/index.js:706`), and a token scan finds **0** occurrences of each node-only string — `/node/health`, `/node/intent`, `readConfig`, `probeSession`, `Consensus`, `buildNodeServer` — against a positive control on the same file that finds the host path `/meta-community/api/members` **2** times, so those zeros are readings and not a filter blind to its subject. The build config names the reason: `tsdown.config.ts` has ONE entry, `src/host/index.ts`. **The node was not tree-shaken out of that bundle; it was never in it**, because it is not a Cordis plugin and no host will ever `apply()` it — it starts a listener of its own. Running it from source is what makes that safe rather than sloppy: there is no stale bundle beside the source for the container to disagree with, and `docker/Dockerfile` copies `src/`, `package.json` and `docker/snapshots` only — no `lib/`, no `npm install`, no `tsc`, no `tsdown`, no network beyond the base image. `package.json` is copied for one field, `"type": "module"`, without which Node would resolve the `.ts` entrypoint as CommonJS and fail.

---

## 9. Sharing intent and meta-packages info

**Two snapshots are baked into the image, and they are PRECALCULATED ARTIFACTS rather than views computed per request.** The shape was six fields — `source`, `capturedAt`, `status`, `bytes`, `sha256`, `document` — and it now carries a SEVENTH on one of the two artifacts: **`documentSha256`, computed over the document exactly as stored** (`JSON.stringify(document)`). **Measured 2026-10-19T11:13Z: `meta-packages.json` carries 7 keys including `documentSha256`; `intent-map.json` still carries 6 and no `documentSha256`.** So the field is **PRESENT on one artifact and FORTHCOMING on the other**, and this section states which is which rather than quoting whichever version reads better.

**Measured 2026-10-19T11:05Z, `docker/snapshots/intent-map.json`: 67,040 B on disk with file sha256 `b3c3acb2…`; the body it records is 42,444 B with sha256 `68d18bfb…`; captured `2026-10-19T11:05:10.851Z` from `http://127.0.0.1:3083/intent-map/api/map` at `status 200`.** The document's own identity: **model `qwen3-embedding:0.6b`, dim 1024, vectorCount 24**, over a corpus of **zones 24 of 24** and **in-scope plugins 688 of 688** out of a **catalog of 4,527** — and its corpus `censusAt` is `2026-10-15T15:22:03.708Z`, four days older than the capture: **the snapshot carries a stale corpus faithfully instead of re-indexing it, and the identity fields are what let a reader see that.**

**Measured 2026-10-19T11:13Z, `docker/snapshots/meta-packages.json` (the re-captured artifact): 8,587 B on disk with file sha256 `48410729…`; the body it records is 7,762 B with sha256 `f5ad8434…`; the document it stores is 6,124 B with `documentSha256` `09968bea…`; captured `2026-10-19T11:11:24.569Z`.** Its `source` remains `http://127.0.0.1:3083/meta-market/api/gui/health` — the meta-market assembly's own health surface rather than its root, which is a fact a reader of `source` can check. The document's identity: **assembly `dsh-meta-market`, `kind: "exists"`, `mounted: true`, prefix `/meta-market/api`**, with its mount block naming the manifest it was measured against — `.../profiles-tree/personal-dev/package.json`, **4,487 B**, `linkedInDependencies: true`, `listedInBundles: true`, and a bundles census of **1 of 49** entries containing the package.

**SIX byte/digest figures can live in one of these artifacts, each over a different subject, and swapping any two manufactures a confident, meaningless mismatch.** The subjects are the file on disk (envelope included), the HTTP body as fetched (envelope excluded), and the document as stored:

| artifact | file bytes | sha256(file) | recorded `bytes` | `sha256` (fetched body) | document bytes | `documentSha256` (stored document) |
|---|---|---|---|---|---|---|
| `intent-map.json` | **67,040** | `b3c3acb2…` | **42,444** | `68d18bfb…` | **42,444** (same bytes) | **absent** — 6 keys at 11:13Z |
| `meta-packages.json` | **8,587** | `48410729…` | **7,762** | `f5ad8434…` | **6,124** | `09968bea…` |

**And the network-free check that this shape makes possible is now a FIELD on one artifact and still an accident on the other, measured 2026-10-19T11:13Z.** On `meta-packages.json`, `sha256(JSON.stringify(document))` equals the declared `documentSha256` **exactly** — `09968bea…`, **6,124 B, match** — so the stored document can be checked with no network at all, and the recorded body digest `f5ad8434…` covers a DIFFERENT and larger subject (**7,762 B**). On `intent-map.json` the field is still absent, and the artifact is verifiable only because its recorded `sha256` happens to reproduce from its stored document (`68d18bfb…`, **42,444 B, match**) — **an accident of that body being stored verbatim, not a property the shape guarantees.** The paragraph below records what this check found when it could not reproduce, because **a section that quietly becomes right is worse than one that shows its repair.**

**FOUND 2026-10-19T11:10Z, NOW SUPERSEDED — the network-free check failed on one of the two files, and the failure is kept here because the repair is the more valuable artifact.** Measured then: `sha256(JSON.stringify(document))` reproduced the recorded `sha256` **exactly** for `intent-map.json` (`68d18bfb…`, **42,444 B, match**), and did **NOT** on `meta-packages.json` — re-serialising that stored document gave **7,769 B** hashing to `9a73efba…`, against a recorded **9,511 B / `3af43263…`**, **a 1,742-byte difference between the body that was hashed and the document that was stored.** The recorded `sha256` named the FETCHED BODY as its subject while the node served the DOCUMENT, so the digest could not vouch for what was actually served — and a reader comparing across the two pairs would have concluded the opposite of the truth in both directions.

**REPAIRED BY RE-CAPTURE, NOT BY ARGUMENT, and the field is now a CHECK rather than a number — measured 2026-10-19T11:13Z.** `meta-packages-share` regenerated the snapshot at **`2026-10-19T11:11:24.569Z`**, and the artifact above is that one: 7 keys, three distinct byte counts (**8,587** file / **7,762** body / **6,124** document) and three distinct digests, each over its own subject. **The loader now recomputes and REFUSES in both directions** (`src/node/metaPackages.ts:214-220`, VERIFIED (read) and re-measured by re-serialising the stored document myself): a missing or non-64-hex `documentSha256` is refused as **`MALFORMED` — "it cannot be checked without the network"** — and a mismatch is refused as **`TAMPERED`, with the recomputed and declared digests BOTH named in the reason**, so an edited snapshot is distinguishable from an absent one instead of collapsing both into `available: false`. **That distinction is the whole point: a refusal that cannot say whether the artifact was missing or altered is a refusal a reader cannot act on.**

**AND A SECOND NUMBER MOVED FOR THE SAME REASON, RECORDED AS TWO INSTANTS RATHER THAN AS A HEALING — measured 2026-10-19T11:13Z, both readings true of their own stamp.** The meta-packages document's window census read **9 of 10 answered, `gaps: 1`, providers 6** at `census.generatedAt 2026-10-19T11:04:41.747Z`; the re-captured document reads **10 of 10 answered, `gaps: []`, providers 6** at `11:10:37.914Z`. **A slow window answering six minutes later is a fact about two instants, not an artifact healing itself**, and neither reading is wrong. **The current consequence is worth stating because it is easy to get backwards: the RUNNING containers still serve the PRE-REPAIR artifact** — `/node/meta-packages` on both `18091` and `18092` answers `sha256 3af43263…`, `bytes 9,511`, `capturedAt 2026-10-19T11:05:34.464Z`, `windowsAnswered 9`, `gaps 1` — **because the snapshots are baked into the image, so a re-capture on disk changes what the NEXT build serves and not what this one does.** A reader who compared the disk file to the served body without that sentence would report a defect that is only a rebuild pending.

**Neither loader computes anything on the request path.** `loadIntentSnapshot(dir)` and `loadMetaPackagesSnapshot(dir)` read ONCE at module init and cache, so two calls separated in time return the same `capturedAt` and the same digest. **That is the mechanical difference between a snapshot and a query, and it is checkable without trusting this sentence.**

**A missing or malformed snapshot is served as `available: false` with a `reason`, never as zeros.** The loaders must not throw on a missing file, and the route answers 200 with the reason, because **a crash or a 5xx on a missing artifact is indistinguishable from a broken node** — and `available: false` must never surface as "0 zones", which is this program's absent-is-not-zero rule arriving on a shared artifact rather than on a field. A node with no snapshot is a HEALTHY node that says what it lacks, which is why `/node/health` reports the two `Available` flags without turning either into a status.

**Both artifacts are on disk at 2026-10-19T11:10Z and both loaders exist, so the cross-node equality is now MEASURED — by this lane, read-only, on the two running containers.** `GET /node/intent` on `127.0.0.1:18091` (node-a) and `127.0.0.1:18092` (node-b) return the **same 9 of 9 compared fields**: `available: true`, sha256 `68d18bfb…`, bytes `42,444`, `capturedAt 2026-10-19T11:05:10.851Z`, model `qwen3-embedding:0.6b`, dim `1024`, vectorCount `24`, zones `24` of `24`; and `GET /node/meta-packages` on both returns the same sha256 `3af43263…` and the same `capturedAt 2026-10-19T11:05:34.464Z` — **the PRE-REPAIR artifact baked into the running image, not the re-captured file on disk: what this paragraph measures is that the two nodes agree with EACH OTHER, and both are one build behind the disk.**

**That is equality of two READINGS, and a reading can be equal for the wrong reason.** It is a caption until something makes it able to fail: **that each node answers from its OWN baked snapshot rather than proxying its peer, and that the comparison goes RED against a doctored snapshot, are the harness's steps and NOT MEASURED here.** `docker/verify/sharing.mjs` exists (**52,141 B** at `11:10Z`) and **has not been run by this lane**, so the honest split is: **the shared payload is measured equal — 9 of 9 fields across 2 nodes — and the CHECK that it can fail is NOT MEASURED.** Nothing in this section should be read as that harness having passed.

---

## 10. Consensus of two

**The vote is a deterministic two-voter commit: the local node holds one vote, the peer named by `PEER_URL` holds the other, and a proposal commits ONLY at 2 of 2, on an endorsement matching the same key, value and term.** The outcome is one of FOUR STRINGS and never a boolean:

| `outcome` | votes | what happened |
|---|---|---|
| `committed` | **2 of 2** | the peer endorsed the same key, value and term; the pair is appended to `committed` |
| `rejected-peer-disagrees` | **1 of 2** | the peer ANSWERED and refused, or endorsed a different value or term |
| `quorum-lost` | **1 of 2** | the peer did NOT answer: timeout, refused connection, or a non-2xx |
| `refused-lone-node` | **1 of 2** | no `PEER_URL` was configured, so there is no second voter at all |

**`rejected-peer-disagrees` and `quorum-lost` must not collapse, and the distinct string is the whole evidence that the code tells an answer apart from an absence.** A peer that accepts a different value is a disagreement, not a commit: `committed` is written only after a matching endorsement, and an endorsement never mutates the committed map on its own.

**It is not Raft, and the code says so rather than leaving a reader to discover it:** there is **no leader election** — both nodes are peers, neither is a leader and no vote ever chooses one; there is **no log replication beyond a committed map** — a commit appends one key/value pair here and the peer learns of it by being asked to endorse, not by having a log pushed to it; there is **one voter per node**, with no third voter and no membership change; and the vote is a pure function of local state plus the peer's answer, so no randomness, clock or latency enters the verdict and two containers started in either order reach the same verdict for the same input.

**And the limit is stated in the direction that costs something: this protocol tolerates exactly ONE node being down, and it tolerates it BY REFUSING — `quorum-lost`, votes 1 of 2, committed map unchanged — not by continuing.** A pair that has fallen back to one node commits nothing until the second returns; that is the design rather than a gap in it, and a reader who wanted availability should read the four outcomes as the answer. **The consequence of having no election is stated for the same reason: `TERM` starts at 1 and increments only on a disagreement, so it is a local disagreement counter and not a replicated epoch — a pair whose terms have diverged does NOT self-heal, because adopting a higher term would be exactly the election behaviour this protocol does not have.**

**NOT MEASURED, AND THE FIRST REAL ATTEMPT DID NOT COMMIT — recorded at 2026-10-19T11:10Z because this is the state the live system is in, not the state the design promises.** Both containers are up and healthy (`meta-community-node-a`, `meta-community-node-b`, `docker ps` at `11:09:50Z`), and reading `GET /node/consensus/state` on both gives **`committed: {}` — the committed map is EMPTY — with `logLength: 0`, `lastOutcome: "rejected-peer-disagrees"`, `peer.lastAnswer: "answered-without-endorsement"`, and `peer.lastLatencyMs` 23 ms on node-a against 53 ms on node-b** (node-a `proposals: 6`, node-b `proposals: 1`). **A peer that answers in 23–53 ms is being read as having answered WITHOUT an endorsement, so nothing has committed against a real peer.**

**The cause is a wire-shape mismatch, measured in the code and not inferred from the symptom:** `src/node/server.ts:266` answers `/node/consensus/endorse` with `{ ok, nodeId, result: { accepted, reason, term, key, value } }` (its sibling at `:244` wraps `/node/consensus/propose`'s result the same way), while `src/node/peerClient.ts:75` requires `record.accepted` at the TOP level — so a faithful endorsement parses as no endorsement and the vote is lost in the envelope. **The second half of the defect has since been repaired: an endorsement did not echo `key` and `value`, which made the contract's "same key, value and term" rule unexpressible at the wire, and `Endorsement` now carries both (`src/node/consensus.ts:33`) with the proposer comparing them before it commits.** **The envelope mismatch is under repair at the time of writing (2026-10-19T11:10Z).**

**So the two-node RESULT stays NOT MEASURED, and the shape of what would replace this marker is specific: `committed` with both nodes up, `quorum-lost` with one stopped, and the committed map shown BEFORE and AFTER so the reader can see it did not move.** `docker/verify/consensus.mjs` exists (**52,141 B** at `11:10Z`) and **has not been run by this lane**; the table above is the DESIGN and the code's contract (VERIFIED (read) at `src/node/consensus.ts`, `src/node/peerClient.ts`, `docker/NODE-CONTRACT.md`), and the state readings above are VERIFIED (ran). **A charter that recorded this as working today would be wrong within the hour, in the direction that flatters us — and the numbers here are the ones a reader can re-take in one command rather than the ones that would read best.**

---

## 11. Anonymity — what is not kept, and what would prove it

**Three things are not kept, and they are FIELDS rather than prose:** every session probe returns `retained: 0` and `store: 'none'`; `/node/anonymity` reports `cookiesIssued: 0`, `tokensIssued: 0`, `sessionRecordsWritten: 0` and `payloadBytesRetained: 0`; and the per-process salt is generated once at module init, held in a module-level binding with **no getter**, and never exported, logged, served or written to disk — the only thing reported about it is its width, 32 bytes, because the width is not the secret and is part of the instrument's identity.

**The probe demonstrates two properties from inside the process and claims nothing beyond them.** The same payload submitted twice yields two DIFFERENT digests — the digest is over (process salt, nodeId, per-call nonce) and over no byte of the payload, so it is not a key derived from what was sent — and `droppedFields` counts the payload's own top-level keys, so a caller can see the payload was **SEEN AND DROPPED** rather than never received. A monotonic nonce counter beside the random half is what makes "two identical payloads differ" a guarantee rather than a probability.

**But every `0` here is a FLOOR, and this charter says so where the numbers are rather than only where they are convenient:** a counter reports only what it is wired to, and nothing in this process is wired to the container's writable layer, its logs, or the filesystem reachable by `docker exec`. **The proof is the canary sweep `docker/verify/anonymity.mjs`, not this section**: a unique string is submitted as user payload and then searched for on four surfaces — the container writable layer, the logs, the container filesystem, and the image layers — each reported with an occurrence count **and** whether that surface was actually probed, **`null` when it was not, because an unprobed surface is not a clean one**; and a **POSITIVE CONTROL** fixture container deliberately stores the same canary, so a failure to find it there is reported as instrument failure rather than as a clean sweep. **A sweep whose control cannot find a canary it planted has measured nothing, and the harness exits non-zero for exactly that reason.**

**The platform-layer half is configuration in one file and measurement in another.** `docker/compose.yaml` sets `read_only: true`, one `tmpfs` at `/tmp` capped at 1 MiB with `noexec,nosuid`, `cap_drop: [ALL]`, `no-new-privileges:true`, no volumes and no bind mounts, and a `json-file` log capped at 1 MiB with no rotation history — and **the file states in its own header that whether those hold is measured in the RUNNING container, not read from the config.** The claim is the file; the proof is the run.

**NOT MEASURED at 2026-10-19T11:10Z: the sweep itself.** `docker/verify/anonymity.mjs` now **EXISTS (41,712 B, written `11:09Z`)** and the two containers are up and healthy, **so the run is possible at this moment — and no run of it is recorded here.** This charter states a method and no result; a reader who needs the result runs that file, and a reader who was handed this section as proof of anonymity has been handed the wrong thing.
