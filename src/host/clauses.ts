/**
 * ============================================================================
 * THE OWNER'S FIVE CLAUSES, AS DATA RATHER THAN PROSE
 * ============================================================================
 *
 * WHY THIS FILE EXISTS AT ALL, AND IT IS THE WHOLE POINT OF THIS CLONE.
 *
 * `dsh-meta-market` was built, typechecked, harness-verified — and then audited
 * against the owner's directive and found wanting. The verdict from `task-15`
 * was **ZERO of five clauses fully captured**, and the diagnosis was not
 * carelessness: **the CHARTER was written BEFORE the owner's directive existed
 * and was never reconciled to it.** No document in that program was ever charged
 * with carrying the owner's intent, so nothing carried it.
 *
 * The evidence that clinched it was C5 — *"run the agent team of 10 and actively
 * orchestrate them to verify intent of that message was really passed and
 * executed"* — which appeared in **0 of 160 CHARTER lines**. **A charter with no
 * clause requiring intent verification cannot detect its own narrowing.** The
 * fusion (C1) and the decentralization (C4) reached a sealed charter unremarked
 * precisely because nothing was checking.
 *
 * **SO THIS FILE INVERTS THE ORDER OF AUTHORITY.** In `dsh-meta-market`, the
 * clauses were prose in a human's message, paraphrased into a charter, and the
 * build followed the paraphrase. Here the clauses are a **typed array**, each
 * carrying **its own verbatim text**, **the artifact that would go RED if it
 * were unmet**, and **whether that artifact EXISTS**. The build reads them. The
 * conformance check reads them. A reviewer reads them. **There is one copy and it
 * is not a summary of a message.**
 *
 * THE HONEST LIMIT, STATED HERE RATHER THAN DISCOVERED LATER: **this file's
 * clause list is the same C1–C5 DECOMPOSITION the Lead used**, and that
 * decomposition is itself a reading. A reader who believes a clause boundary is
 * wrong should re-cut it here — **the verbatim text is carried per clause so a
 * re-cut is possible without corrupting the source.** The owner's words are also
 * preserved unedited in the program workspace at
 * `research/owner-directive-verbatim.md`; this file holds the typed form and
 * that file holds the unmodified quotation, and neither is allowed to drift from
 * the other without the conformance check going RED.
 *
 * @module dsh-meta-community/host/clauses
 */

/**
 * Whether a clause's backing artifact is real, planned, or missing entirely.
 *
 * **Three kinds, never flattened** — the program rule. The distinction that
 * matters here is `absent` versus `plan`: a `plan` clause has a named artifact
 * someone intends to build, and an `absent` clause has **nothing that could go
 * RED**, which is the state C5 was in and the state this file exists to make
 * impossible to overlook.
 */
export type ClauseKind = 'exists' | 'plan' | 'absent'

/**
 * One owner clause, with the evidence that would falsify its verdict.
 *
 * `falsifier` is REQUIRED and may not be empty, because **a claim that nothing
 * can fail is not a claim** — the rule this program arrived at after publishing
 * a threshold whose own lane then falsified it (`D-0076`).
 */
export interface ClauseRecord {
  /** Stable id, cited by the conformance check and by every record. */
  readonly id: 'C1' | 'C2' | 'C3' | 'C4' | 'C5'
  /** The owner's words, VERBATIM. Never a paraphrase. Do not tidy the spelling. */
  readonly verbatim: string
  /** What this clause requires, in one line, in the checker's terms. */
  readonly requires: string
  /** This plugin's honest verdict on its OWN fidelity to that clause. */
  readonly kind: ClauseKind
  /** The command or route that would go RED if the clause were unmet, or null when none exists. */
  readonly artifact: string | null
  /**
   * The observation that would force this verdict to change.
   *
   * Non-empty for every clause. A clause whose falsifier is empty is reported by
   * the conformance check as a defect in THIS FILE, not as a pass.
   */
  readonly falsifier: string
  /** What this plugin does NOT satisfy about the clause, stated rather than omitted. */
  readonly shortfall: string
}

/**
 * The five clauses, with this plugin's own honest self-assessment.
 *
 * **`kind` here describes THIS PLUGIN's fidelity, not the world's.** A reader
 * wanting to know whether some other artifact satisfies a clause must go and
 * measure that artifact; this array is this clone's own claim and is falsifiable
 * against it.
 */
export const OWNER_CLAUSES: readonly ClauseRecord[] = Object.freeze([
  Object.freeze({
    id: 'C1',
    verbatim: 'fuse meta plugin for the meta-market-community',
    requires: 'One plugin that FUSES the market into a community, rather than one that only exchanges packages between two peers.',
    kind: 'plan',
    artifact: 'GET /meta-community/api/census',
    falsifier: 'If the community surface reports zero recognised members while at least one peer card is locally present, the fusion half is not implemented and this clause drops to `absent`.',
    shortfall: 'The community REGISTRY and the fusion operation exist here; the participants do not. A community of one is the honest current state, and this clause stays `plan` until a second authenticated member exists — which C4 currently prevents.',
  }),
  Object.freeze({
    id: 'C2',
    verbatim: 'It shall basically give the capabilities for system where intent of user is already formed and the other meta plugins are established',
    requires: 'BOTH preconditions of the target system: a formed user intent, AND other meta plugins already established.',
    kind: 'absent',
    artifact: null,
    falsifier: 'A formed user intent existing anywhere on this deployment, or two or more `dsh-meta-*` plugins besides this one and `dsh-meta-market`, would move this clause off `absent`.',
    shortfall: 'BOTH preconditions are FALSE and this is the most load-bearing thing this clone knows. (a) The intent map is a map of the PLUGIN MARKET, not of a user: its 24 vectors are keyed to ZONE ids, it holds no userId/sessionId, its `owner` fields name 565 plugin AUTHORS, and the only user-shaped file is `.anonymous-user-id` — anonymous by its own name. **The clause fails on the word USER, not on FORMED: the map IS formed, and it is nobody\'s.** (b) "The other meta plugins are established" is SELF-REFERENTIAL as written — it asks the system to already contain the thing being built; a scoped census finds exactly 1 `dsh-meta-*` clone apart from this one and it is the market plugin, against a denominator of 28 clones. **This clause has NO ARTIFACT because there is nothing here to check: it is a precondition, not a capability, and it is unmet.**',
  }),
  Object.freeze({
    id: 'C3',
    verbatim: 'To talk to other systems that belongs to the other users and align the meta packages with universal intent map, cordis hard way and following philosophy of whole project',
    requires: 'Talk to OTHER users\' systems, align packages to a UNIVERSAL intent map, build the Cordis hard way, and follow the whole project\'s philosophy.',
    kind: 'plan',
    artifact: null,
    falsifier: 'A single recorded exchange with a peer that is not a process spawned by this same harness, or an intent map whose vectors are embedded from a corpus larger than one catalog snapshot, would move this clause off `plan`.',
    shortfall: 'Four halves, each measured elsewhere and each short. "Talk to other systems": **NO peer has ever been contacted** — `peersContacted` was `{count: 0, of: 0}`, zero BY CONSTRUCTION, and no inbound dialogue route exists anywhere. "Universal": the map is LOCAL — 4,527 catalog rows -> 688 in scope -> 24 zones, and since only 24 strings were ever embedded, **98.5% of the catalog is unreachable** by similarity to it. "Cordis hard way": held (0 matches for cuda/nvidia/torch/device/gpu and 0 for any device acquisition in the market clone). "Philosophy of whole project": **carried by this file as C5 does not carry it in the market clone — it has no instrument there at all.** **AND THIS CLAUSE HAS NO ARTIFACT, WHICH IS A CORRECTION RATHER THAN AN OMISSION:** it first cited the conformance route, and that was wrong twice — the path carried a `/meta-market-` prefix this clone does not serve, and the route it named is C5\'s instrument rather than C3\'s. **No route in this clone can observe another system, because no route in this clone admits a peer**, so there is nothing here to point at and `null` says so.',
  }),
  Object.freeze({
    id: 'C4',
    verbatim: 'Also there will be inter system "social network of web4" that allows 2 or more system initiate safely dialoges and manage the total system aligment between of big base of users to aligned intent zones/maps and meta-plugins will be "decentralized" way developed, users can receive patches, revise the meta-market and etc',
    requires: 'A social network of 2+ systems, safe dialogues, TOTAL alignment management across a BIG BASE of users, DECENTRALIZED development, and the ability for users to receive patches AND REVISE the meta-market.',
    kind: 'plan',
    artifact: 'GET /meta-community/api/members',
    falsifier: 'A second authenticated author — an author whose patch is distinguishable from the first author typing a different string — would move the decentralization half to `exists`. It cannot move while the deployment holds an identifier and no key.',
    shortfall: 'THE CENTRAL CLAUSE OF THIS CLONE, AND THE ONE THE MARKET BUILD MEASURABLY FAILED. **`decentralized` appears 0 times in the market CHARTER and 0 `.md` files outside `context/`**, and its authoring model is one-owner-per-path plus a single-proposer patch proposal — which is DISTRIBUTION, and **distribution with one proposer is the opposite of decentralized development.** This clone carries the word AND a mechanism; the mechanism is `src/host/authors/`, and it does not work here for a reason that is measured rather than assumed: **the market lane proved that `from === card.instanceId` is declared at `gate.ts:131` and implemented NOWHERE**, so `from` is checked for non-emptiness only and `literally-any-string` is accepted. **A second author is indistinguishable from the first author typing a different string.** Also short: "big base of users" is unreachable at this capacity (100,000 peers needs 4.31 h to witness once against a 60 s round); "manage the TOTAL alignment" has **no object at all** — no aggregate over peers exists anywhere; and `revise the meta-market` had no route.',
  }),
  Object.freeze({
    id: 'C5',
    verbatim: 'Run the agent team of 10 and actively orchestrate them to verify intent of that message was really passed and executed',
    requires: 'A team running, AND — the half that matters — that the intent of the message was VERIFIED to have been passed and executed.',
    kind: 'exists',
    artifact: 'GET /meta-community/api/clauses/conformance',
    falsifier: 'A clause in this array with an empty `falsifier`, or a clause whose `artifact` names a route that returns 404, would turn the conformance check RED — which is what makes this clause\'s instrument real rather than asserted.',
    shortfall: 'The verification HALF is now real here and was absent there: **C5 was the only one of the five clauses with ZERO artifacts in the market build, and its absence is exactly what let C1\'s fusion and C4\'s decentralization reach a sealed charter unremarked.** The team-size half is NOT met and is not met by this file: the owner wrote "the agent team of 10" and the market CHARTER\'s own §6 lists NINE lanes. This clone cannot fix a lane count by asserting one.',
  }),
])

/**
 * The owner's directive, VERBATIM, as one string.
 *
 * Reproduced with the owner's original spelling (`dialoges`, `aligment`) and
 * original line breaks, because **a faithful quotation is the point**. A reader
 * comparing this against the program workspace's copy at
 * `research/owner-directive-verbatim.md` should find them equal; the conformance
 * check reports the comparison as a fact rather than assuming it.
 */
export const OWNER_DIRECTIVE_VERBATIM = [
  'fuse meta plugin for the meta-market-community;',
  'It shall basically give the capabilities for system where intent of user is already formed and the other meta plugins are established;',
  'To talk to other systems that belongs to the other users and align the meta packages with universal intent map, cordis hard way and following philosophy of whole project;',
  'Also there will be inter system "social network of web4" that allows 2 or more system initiate safely dialoges and manage the total system aligment between of big base of users to aligned intent zones/maps and meta-plugins will be "decentralized" way developed, users can receive patches, revise the meta-market and etc;',
  'Run the agent team of 10 and actively orchestrate them to verify intent of that message was really passed and executed;',
].join('\n')

/** A clause count, with its denominator, so a reader never sees a bare number. */
export interface ClauseCensus {
  readonly total: number
  readonly byKind: Readonly<Record<ClauseKind, number>>
  /** Clauses with a named runnable artifact; the numerator over `total`. */
  readonly withArtifact: number
  /** Clauses whose `falsifier` is empty — a defect in THIS FILE when non-zero. */
  readonly withoutFalsifier: number
  /**
   * Artifacts that name a route this clone does NOT register.
   *
   * **This field exists because the first version of this array named three routes
   * that do not exist** — `GET /meta-market-community/api/community`, `.../clauses/conformance`
   * and `.../members` where the registered path was `/meta-community/api/...`. **Two
   * defects in one**: a wrong PREFIX, and a path with no branch behind it. A clause
   * citing a 404 is a clause with NO artifact wearing the shape of one, which is
   * this program's `D-0071` defect exactly.
   */
  readonly unreachableArtifacts: number
  /** The moment this census was taken. **A population without a moment is not a count.** */
  readonly censusAt: string
}

/**
 * Count the clauses. **Every figure carries its denominator, and the census is STAMPED.**
 *
 * `withoutFalsifier` and `unreachableArtifacts` are reported rather than thrown
 * because a file defect and a world defect are different things: both are defects
 * in THIS array, and the conformance check turns them RED, but a reader asking "how
 * faithful is this clone?" should still get a census rather than an exception.
 *
 * @param registeredPaths - the routes this clone actually serves. Passed in rather
 *   than imported so the two cannot agree by sharing a wrong constant: a caller
 *   that hands over a path this file also believes makes the check circular.
 * @param now - injected clock, so a harness can freeze it and assert the stamp.
 */
export function clauseCensus(
  registeredPaths: readonly string[] = [],
  now: () => Date = () => new Date(),
): ClauseCensus {
  const byKind: Record<ClauseKind, number> = { exists: 0, plan: 0, absent: 0 }
  let withArtifact = 0
  let withoutFalsifier = 0
  let unreachableArtifacts = 0
  for (const c of OWNER_CLAUSES) {
    byKind[c.kind] += 1
    if (c.artifact !== null && c.artifact.length > 0) {
      withArtifact += 1
      /**
       * THE ARTIFACT IS EXTRACTED FROM ITS OWN PROSE AND LOOKED UP, so a clause
       * cannot cite a route that was never registered. `null` (no artifact) is not
       * counted here — that is `withArtifact`'s job, and conflating them would let
       * a missing artifact read as a broken one.
       */
      const cited = c.artifact.split(' ').find((t) => t.startsWith('/'))
      if (cited !== undefined && registeredPaths.length > 0 && !registeredPaths.includes(cited)) {
        unreachableArtifacts += 1
      }
    }
    if (c.falsifier.trim().length === 0) withoutFalsifier += 1
  }
  return {
    total: OWNER_CLAUSES.length,
    byKind,
    withArtifact,
    withoutFalsifier,
    unreachableArtifacts,
    censusAt: now().toISOString(),
  }
}
