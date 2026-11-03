/**
 * ============================================================================
 * NODE INTENT — the baked intent snapshot, read once, and never a crash
 * ============================================================================
 *
 * Written against `docker/NODE-CONTRACT.md` §`intent.ts`. The node does not reach
 * the host that owns the intent map: `docker/tools/capture-intent.mjs` bakes the
 * map into `docker/snapshots/intent-map.json` at build time, and this module is
 * the only reader of that file.
 *
 * **A MISSING OR MALFORMED SNAPSHOT IS A STATED UNAVAILABILITY, NOT A THROW.**
 * The contract's reason is exact: a crash on a missing artifact is
 * indistinguishable from a broken node. So every failure mode below returns
 * `available: false` with a `reason` that NAMES what was wrong, and the node
 * stays healthy and says what it does not have.
 *
 * **ABSENT IS NOT ZERO, AND THIS IS THE FILE WHERE THAT RULE HAS TEETH.** If the
 * snapshot is absent, the served view must not read as "0 zones" — a consumer
 * that prints `available ? census : 0` would manufacture the zero, so the honest
 * shape is `available: false` plus `census: null` plus a reason, and the reason is
 * what a reader shows in place of the number.
 *
 * **`sha256` IS AN ALGORITHM, NEVER A BARE `digest`.** The field is called
 * `sha256` because a digest without its algorithm is not a value: this program
 * has already published an `md5` and had it compared against a `sha256`, and the
 * mismatch described the two instruments rather than the bytes.
 *
 * What the recorded pair can and cannot be checked against: `bytes` and `sha256`
 * fingerprint the response body AS FETCHED. They cannot be reproduced by
 * re-fetching, because the map carries read-time stamps (`readFreshness.readAt`,
 * `censusAt`) that differ on every request, so the pair is an audit of one capture
 * rather than a stable identity of the map — stated so nobody "verifies" it against
 * a fresh fetch and reports a false mismatch.
 *
 * **CORRECTED IN PLACE 2026-10-19T11:17Z — this paragraph also read that the pair
 * "cannot be re-derived from `document`, because JSON re-serialisation is not
 * byte-identical". FOR THIS SOURCE THAT IS FALSE.** The intent map is served as
 * COMPACT JSON, so `JSON.stringify(document)` is byte-identical to the body and
 * reproduces the wire digest exactly: both were `fed7003e…` at 42,444 B, and
 * build-gate independently measured `wireSha === docSha` true. The claim holds for
 * the meta-packages artifact, whose document does not round-trip, and it was
 * carried here as an unearned generalisation. Whether re-serialisation preserves
 * the wire bytes is a property of the SOURCE; here it does. The artifact's own file
 * hash (`sha256 277a73ef…`) is a third and different value, because the document is
 * stored re-indented inside a wrapper.
 *
 * **`documentSha256` IS THE NETWORK-FREE CHECK, AND THIS MODULE ENFORCES IT.**
 * Its definition is exact: `sha256(JSON.stringify(document), 'utf8')` over the
 * **COMPACT** serialisation — the bytes the file's own `document` value
 * round-trips to, NOT a pretty-printed rendering. The compactness is part of the
 * definition rather than an implementation detail: meta-packages-share measured
 * the compact recomputation reproducing its declared digest while the indented one
 * did not. Every read recomputes it and REFUSES on mismatch, and refuses on its
 * ABSENCE, because accepting a missing digest would make the field ornamental.
 *
 * **The limit, unoverclaimed: this detects an artifact EDITED AFTER CAPTURE, not a
 * determined forger.** Anyone who edits the document can recompute the digest over
 * what they wrote. Only the network-side `sha256`, compared against a body a later
 * fetch actually returned, closes that, and only with the network.
 *
 * A refusal that happens AFTER the envelope has been read carries the rejected
 * file's `bytes` and `sha256`, so "an artifact whose document does not verify" and
 * "no artifact at all" are distinguishable states rather than one `false`.
 *
 * Node 24 strips types rather than compiling them, so this file uses no `enum`,
 * no `namespace`, no parameter properties and no decorators, and every type-only
 * import is written `import type`.
 *
 * @module dsh-meta-community/node/intent
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The snapshot view the contract fixes. The field set is NOT extended here: other
 * lanes code against this shape, and an extra field added quietly in one file is
 * exactly the drift the contract exists to prevent. Extra projections are added
 * as SEPARATE exports (`intentIdentity`, `describeIntent`) that this type does not
 * mention.
 */
export type SnapshotView = {
  available: boolean
  reason: string | null
  source: string | null
  capturedAt: string | null
  bytes: number | null
  sha256: string | null
  document: unknown | null
}

/** A census pair, kept as numerator AND denominator. */
export type CensusPair = { count: number; of: number }

/**
 * The identity a reader needs in order to judge the snapshot rather than trust
 * it. Every pair carries its denominator; a field the document does not supply is
 * `null` and stays `null`, never `0`.
 */
export type IntentIdentity = {
  embeddingModel: string | null
  dim: number | null
  vectorCount: number | null
  zones: CensusPair | null
  inScopePlugins: CensusPair | null
  catalogCount: number | null
  censusAt: string | null
  /**
   * The map states freshness as the STRING `"fresh"` (not a boolean), so the type
   * is the union the source actually supplies. Typing it `boolean` was measured
   * as a defect in the first drive: the live document carries `"fresh"`, the guard
   * rejected it, and a PRESENT value was published as `null` — the absent-is-not-
   * zero trap firing in the opposite direction, where a reader would conclude the
   * map had not reported its freshness at all.
   */
  indexFreshness: string | boolean | null
  indexReason: string | null
  /** Length of `index.stale`. `0` here is a MEASURED zero: the array was present and empty, which is different from the `null` an absent array yields. */
  staleZones: number | null
  /**
   * THE OTHER CLOCK, AND IT ANSWERS A DIFFERENT QUESTION FROM `indexFreshness`.
   *
   * `indexFreshness` is CONTENT freshness: whether each zone's `indexedHash` still
   * equals its `currentHash`. `readFreshness*` below is AGE freshness: how long ago
   * the index artifact was built, against the TTL the map states. Measured on the
   * 11:15:57Z capture, both were true at once — `indexedHash === currentHash` for
   * **24/24** zones with **0** flagged stale, while the build was **33,394 s** old
   * against a **3,600 s** TTL. So this is NOT two clocks disagreeing; it is two
   * measurements of different subjects that can legitimately differ, which is why
   * they are carried SEPARATELY and must never be collapsed into one boolean.
   *
   * The map states the distinction itself in `readFreshness.covers`: *"a hash-fresh
   * index can be old and an old index can still be hash-exact"*.
   *
   * Present-because-it-was-absent: the projection previously carried only
   * `indexFreshness`, so a reader saw "fresh" and could stop. The stale reading was
   * in the document and absent from the view, and absent read as current.
   */
  readFreshnessState: string | null
  /** Age in seconds at the moment the map answered. `0` is a real value here (just built), so the reader is non-negative, not positive. */
  readFreshnessAgeSeconds: number | null
  /** The TTL the age is compared against, carried so the pair is checkable rather than a bare verdict. */
  readFreshnessTtlSeconds: number | null
  /** The map's own boolean verdict, kept beside the state string rather than derived from it. */
  readFreshnessFresh: boolean | null
}

/** The baked snapshot's file name, which is the contract's name. */
const SNAPSHOT_FILENAME = 'intent-map.json'

/** `sha256` is 64 lowercase hex digits; the pattern is what makes it checkable. */
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** One read per directory, then the same object forever. */
const cache = new Map<string, SnapshotView>()

/**
 * Appended to EVERY unavailable reason, because an unavailable snapshot is exactly
 * where a missing value gets read as a good one.
 *
 * The whole reason the `readFreshness*` fields were added is that an absent reading
 * reads as fine: a caller given `null` freshness can print nothing and look current.
 * So the refusal states the consequence rather than leaving it to be inferred from
 * four nulls — with no census served there is no content freshness and no age
 * freshness, and BOTH are UNKNOWN, which is not "fresh" and not "stale".
 */
const FRESHNESS_UNKNOWN_NOTE =
  ' — Freshness is UNKNOWN for this snapshot: no census was served, so neither content freshness (zone hash exactness) nor age freshness (build age against its TTL) exists here. Unknown is not "fresh", and it is not "stale".'

/**
 * The unavailable view. Every field that would carry a fact is `null`, not `0`.
 *
 * `carried` is what makes two refusals distinguishable: a file that EXISTS but
 * whose document does not verify hands back its own `source`, `capturedAt`,
 * `bytes` and `sha256`, so a reader sees an artifact that was rejected rather than
 * an artifact that was never there. A missing file carries nothing and leaves all
 * four `null`.
 */
function unavailable(reason: string, carried: Partial<SnapshotView> = {}): SnapshotView {
  return {
    available: false,
    reason: `${reason}${FRESHNESS_UNKNOWN_NOTE}`,
    source: carried.source ?? null,
    capturedAt: carried.capturedAt ?? null,
    bytes: carried.bytes ?? null,
    sha256: carried.sha256 ?? null,
    document: null,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read `index.freshness` as the string or boolean the map supplies, never coerced. */
function readFreshness(index: Record<string, unknown> | null): string | boolean | null {
  if (index === null) return null
  const value = index.freshness
  if (typeof value === 'string' || typeof value === 'boolean') return value
  return null
}

/** Read the identity/`index` block shared by both census readers, without deciding anything. */
function readIndexFacts(index: Record<string, unknown> | null): {
  embeddingModel: string | null
  dim: number | null
  vectorCount: number | null
  indexFreshness: string | boolean | null
  indexReason: string | null
  staleZones: number | null
} {
  const identity = index !== null && isRecord(index.identity) ? index.identity : null
  return {
    embeddingModel: identity !== null && typeof identity.model === 'string' ? identity.model : null,
    dim: identity !== null ? positiveInteger(identity.dim) : null,
    vectorCount: identity !== null ? positiveInteger(identity.vectorCount) : null,
    indexFreshness: readFreshness(index),
    indexReason: index !== null && typeof index.reason === 'string' ? index.reason : null,
    staleZones: index !== null && Array.isArray(index.stale) ? index.stale.length : null,
  }
}

/** A positive integer or null. `0` is a value here, and it is NOT a count. */
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * A NON-NEGATIVE integer or `null`.
 *
 * Kept apart from `positiveInteger` because `0` is a real reading for the freshness
 * fields: an `ageSeconds` of 0 means "just built" and a `ttlSeconds` of 0 means
 * "expires immediately". Reusing the positive reader would have turned both into
 * `null`, which is this file's own absent-is-not-zero defect in the opposite
 * direction — a measured zero published as an absent reading.
 */
function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * Read the AGE-freshness block, which answers a different question from
 * `index.freshness` (see the `IntentIdentity` comment). Absent fields stay `null`.
 */
function readReadFreshness(document: Record<string, unknown>): {
  readFreshnessState: string | null
  readFreshnessAgeSeconds: number | null
  readFreshnessTtlSeconds: number | null
  readFreshnessFresh: boolean | null
} {
  const block = isRecord(document.readFreshness) ? document.readFreshness : null
  if (block === null) {
    return {
      readFreshnessState: null,
      readFreshnessAgeSeconds: null,
      readFreshnessTtlSeconds: null,
      readFreshnessFresh: null,
    }
  }
  return {
    readFreshnessState: typeof block.state === 'string' ? block.state : null,
    readFreshnessAgeSeconds: nonNegativeInteger(block.ageSeconds),
    readFreshnessTtlSeconds: nonNegativeInteger(block.ttlSeconds),
    readFreshnessFresh: typeof block.fresh === 'boolean' ? block.fresh : null,
  }
}

/** Read a `{ count, of }` pair, or `null` when it is absent or not a pair. */
function readPair(value: unknown): CensusPair | null {
  if (!isRecord(value)) return null
  const count = positiveInteger(value.count)
  const of = positiveInteger(value.of)
  if (count === null || of === null || of < count) return null
  return { count, of }
}

/**
 * Validate the snapshot file's own envelope.
 *
 * The envelope is validated field by field so the reason can name the field. A
 * file that parses but carries `status: 404` is a refusal the node would
 * otherwise serve as a document.
 */
function readEnvelope(parsed: unknown): { view: SnapshotView } | { problem: string; carried: Partial<SnapshotView> } {
  if (!isRecord(parsed)) return { problem: 'the snapshot file is not a JSON object', carried: {} }
  if (typeof parsed.source !== 'string' || parsed.source.length === 0) {
    return { problem: 'the snapshot file has no `source` URL, so the node could not say where it came from', carried: {} }
  }
  if (typeof parsed.capturedAt !== 'string' || parsed.capturedAt.length === 0) {
    return { problem: 'the snapshot file has no `capturedAt`, so a reader could not tell when it was taken', carried: {} }
  }
  const carried: Partial<SnapshotView> = {
    source: parsed.source,
    capturedAt: parsed.capturedAt,
    bytes: positiveInteger(parsed.bytes),
    sha256: typeof parsed.sha256 === 'string' && SHA256_PATTERN.test(parsed.sha256) ? parsed.sha256 : null,
  }
  if (parsed.status !== 200) {
    return { problem: `the snapshot file records status ${JSON.stringify(parsed.status)}, and only a 200 body is a snapshot`, carried }
  }
  const bytes = positiveInteger(parsed.bytes)
  if (bytes === null) {
    return { problem: `the snapshot file records bytes ${JSON.stringify(parsed.bytes)}, which is not a positive integer`, carried }
  }
  if (typeof parsed.sha256 !== 'string' || !SHA256_PATTERN.test(parsed.sha256)) {
    return { problem: 'the snapshot file has no 64-digit lowercase hex `sha256` over the body it captured', carried }
  }
  if (!isRecord(parsed.document)) {
    return { problem: 'the snapshot file carries no `document` object', carried }
  }

  /**
   * THE NETWORK-FREE CHECK, made here rather than left to a careful reader.
   *
   * The recomputation costs one hash over the parsed document and needs nothing but
   * the file. A MISSING digest refuses as well: a snapshot whose document cannot be
   * checked is exactly the state this field was added to end, and accepting it
   * silently would make the field optional and therefore ornamental.
   */
  if (typeof parsed.documentSha256 !== 'string' || !SHA256_PATTERN.test(parsed.documentSha256)) {
    return {
      problem: 'the snapshot file carries no 64-digit lowercase hex `documentSha256`, so its document can only be checked WITH the network, which the node does not have',
      carried,
    }
  }
  const recomputedDocumentSha256 = createHash('sha256').update(JSON.stringify(parsed.document), 'utf8').digest('hex')
  if (recomputedDocumentSha256 !== parsed.documentSha256) {
    return {
      problem: `TAMPERED: the document in the snapshot file hashes to ${recomputedDocumentSha256} but the file declares documentSha256 ${parsed.documentSha256}; the artifact was edited after capture, so it is not the document the source answered`,
      carried,
    }
  }

  return {
    view: {
      available: true,
      reason: null,
      source: parsed.source,
      capturedAt: parsed.capturedAt,
      bytes,
      sha256: parsed.sha256,
      document: parsed.document,
    },
  }
}

/**
 * The document's census, or the reason it is not one.
 *
 * This is the node's own copy of the capture tool's check, and it is duplicated
 * deliberately rather than shared: the tool runs on the host, this runs inside the
 * container, and a container that trusted a file merely because it parsed would
 * serve a zero the host had refused to write.
 */
function readCensus(document: Record<string, unknown>): { census: IntentIdentity } | { problem: string } {
  const corpus = document.corpus
  if (!isRecord(corpus)) {
    return { problem: 'the snapshot document has no `corpus` object, so its census is ABSENT rather than zero' }
  }
  const zones = readPair(corpus.zones)
  if (zones === null) {
    return { problem: 'the snapshot document has no valid `corpus.zones` count/of pair, so its zone census is ABSENT rather than zero' }
  }
  if (Array.isArray(document.zones) && document.zones.length !== zones.count) {
    return {
      problem: `the snapshot census says ${zones.count} zones while the document carries ${document.zones.length}, so the snapshot contradicts itself`,
    }
  }
  const inScopePlugins = readPair(corpus.inScopePlugins)
  if (inScopePlugins === null) {
    return { problem: 'the snapshot document has no valid `corpus.inScopePlugins` count/of pair' }
  }
  const catalogCount = positiveInteger(corpus.catalogCount)
  if (catalogCount === null) {
    return { problem: 'the snapshot document has no positive integer `corpus.catalogCount`' }
  }

  const index = isRecord(document.index) ? document.index : null
  const facts = readIndexFacts(index)
  const readFreshness = readReadFreshness(document)

  return {
    census: {
      ...facts,
      ...readFreshness,
      zones,
      inScopePlugins,
      catalogCount,
      censusAt: typeof corpus.censusAt === 'string' ? corpus.censusAt : null,
    },
  }
}

/** Read the file once and turn every failure into a stated unavailability. */
function readSnapshot(directory: string): SnapshotView {
  const path = resolve(directory, SNAPSHOT_FILENAME)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return unavailable(`no intent snapshot at ${path}: the node was not given one, and an absent snapshot is not a snapshot with zero zones`)
    }
    return unavailable(`the intent snapshot at ${path} could not be read (${code ?? 'unknown error'}): ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return unavailable(`the intent snapshot at ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  const envelope = readEnvelope(parsed)
  if ('problem' in envelope) return unavailable(`${envelope.problem} (${path})`, envelope.carried)

  const census = readCensus(envelope.view.document as Record<string, unknown>)
  if ('problem' in census) {
    /**
     * The envelope verified, so this refusal carries the file's own identity: it is
     * an artifact that EXISTS and was rejected, not an artifact that was never there.
     */
    return unavailable(`${census.problem} (${path})`, {
      source: envelope.view.source,
      capturedAt: envelope.view.capturedAt,
      bytes: envelope.view.bytes,
      sha256: envelope.view.sha256,
    })
  }

  /**
   * The census is validated on every load and NOT stored on the view, because
   * `SnapshotView` is the contract's shape. `intentIdentity` re-derives it from
   * `document` for a caller that wants it without a second read of the file.
   */
  return Object.freeze(envelope.view)
}

/**
 * Load the baked intent snapshot from `dir`.
 *
 * Read once per directory and cached: the file is a build artifact, so re-reading
 * it on every request would buy nothing and would let the served view drift under
 * a caller between two requests in the same process. The cached object is frozen
 * so a consumer cannot write through it and poison the cache.
 */
export function loadIntentSnapshot(dir: string): SnapshotView {
  const key = resolve(dir)
  const cached = cache.get(key)
  if (cached !== undefined) return cached
  const view = readSnapshot(key)
  cache.set(key, view)
  return view
}

/**
 * Drop the cache. NOT part of the served contract: it exists so a harness can
 * drive the absent and malformed paths in one process instead of spawning a node
 * per case. The running node never calls it.
 */
export function clearIntentSnapshotCache(): void {
  cache.clear()
}

/**
 * The identity of a snapshot document, for a caller that holds the `document`.
 *
 * Pure: it reads nothing and re-decides nothing. A document that fails the census
 * checks still yields a shape — with `null`s where the facts are absent — because
 * this function's job is to describe what is there, while `loadIntentSnapshot`'s
 * job is to decide whether it may be served at all.
 */
export function intentIdentity(document: unknown): IntentIdentity {
  const empty: IntentIdentity = {
    embeddingModel: null,
    dim: null,
    vectorCount: null,
    zones: null,
    inScopePlugins: null,
    catalogCount: null,
    censusAt: null,
    indexFreshness: null,
    indexReason: null,
    staleZones: null,
    readFreshnessState: null,
    readFreshnessAgeSeconds: null,
    readFreshnessTtlSeconds: null,
    readFreshnessFresh: null,
  }
  if (!isRecord(document)) return empty
  const census = readCensus(document)
  if ('problem' in census) {
    const index = isRecord(document.index) ? document.index : null
    return { ...empty, ...readIndexFacts(index), ...readReadFreshness(document) }
  }
  return census.census
}

/**
 * ONE sentence carrying BOTH freshness readings.
 *
 * This is the anti-collapse instrument: a surface that prints this string cannot
 * print "fresh" without the age beside it, and cannot print the age without the
 * content verdict. An unmeasured half says UNKNOWN rather than being omitted, so
 * the sentence never reads as half a green.
 */
function describeFreshnessPair(identity: IntentIdentity): string {
  const content = identity.zones === null
    ? 'content freshness: UNKNOWN (the snapshot carries no zone census)'
    : `content freshness: ${identity.zones.count}/${identity.zones.of} zone hashes unchanged, ${identity.staleZones === null ? 'an unmeasured number of' : identity.staleZones} stale`
  const age = identity.readFreshnessAgeSeconds !== null && identity.readFreshnessTtlSeconds !== null
    ? `age freshness: the build was ${identity.readFreshnessAgeSeconds}s old against a ${identity.readFreshnessTtlSeconds}s TTL, so the map said ${JSON.stringify(identity.readFreshnessState)} (fresh=${String(identity.readFreshnessFresh)})`
    : 'age freshness: UNKNOWN (the map stated no age, no TTL, or both)'
  return `${content}; ${age}. These answer different questions and are not comparable.`
}

/**
 * The projection that is safe to serve for `/node/intent`.
 *
 * It carries the envelope a reader can audit (`source`, `capturedAt`, `bytes`,
 * `sha256` with its algorithm named) and the identity plus census that let a
 * reader judge the numbers instead of trusting them. The full `document` is NOT
 * copied in here: it is already on the view, it is ~42 KB, and a projection that
 * inlined it would make every caller pay for it.
 */
export function describeIntent(view: SnapshotView): Record<string, unknown> {
  const identity = view.document === null ? null : intentIdentity(view.document)
  /**
   * Recomputed here rather than stored on the view, because `SnapshotView` is the
   * contract's shape. On a SERVED view this recomputation necessarily equals the
   * file's declared `documentSha256`, since the loader refused otherwise — so the
   * number below is the same value, derived rather than copied.
   */
  const documentSha256 = view.document === null
    ? null
    : createHash('sha256').update(JSON.stringify(view.document), 'utf8').digest('hex')
  return {
    available: view.available,
    reason: view.reason,
    source: view.source,
    capturedAt: view.capturedAt,
    bytes: view.bytes,
    sha256: view.sha256,
    sha256Algorithm: 'sha256',
    sha256Subject: 'the response body as fetched (network-side; NOT recomputable from the file)',
    documentSha256,
    documentSha256Subject: 'sha256(JSON.stringify(document), utf8) over the COMPACT document as stored (network-free)',
    census: identity,
    /**
     * THE STRUCTURAL FORCE, not a sentence asking readers to be careful.
     *
     * Both readings live in ONE object under one key, and `statement` puts both
     * numbers in one string. A consumer that renders freshness at all must pick up
     * `freshness`, and there is no top-level "fresh" scalar to take on its own —
     * `indexFreshness` and `readFreshnessState` remain inside `census` for machines
     * and tests, but the projection's own freshness answer is this composite. A
     * renderer that prints `statement` cannot print one clock without the other.
     *
     * `notComparable: true` is stated as data rather than left to prose: the two
     * measure different subjects, so neither outranks the other and there is no
     * ordering to fall back on.
     */
    freshness: identity === null ? null : {
      content: {
        verdict: identity.indexFreshness,
        zonesHashExact: identity.zones,
        staleZones: identity.staleZones,
        question: 'has each zone\'s indexedHash survived to its currentHash?',
      },
      age: {
        state: identity.readFreshnessState,
        ageSeconds: identity.readFreshnessAgeSeconds,
        ttlSeconds: identity.readFreshnessTtlSeconds,
        fresh: identity.readFreshnessFresh,
        question: 'how old is the index build, against the TTL it states?',
      },
      notComparable: true,
      statement: describeFreshnessPair(identity),
    },
    freshnessIsNotOneBoolean:
      'indexFreshness is CONTENT freshness: whether each zone\'s indexedHash still equals its currentHash (24/24 unchanged, 0 stale, at capture). readFreshnessState/readFreshnessAgeSeconds/readFreshnessTtlSeconds/readFreshnessFresh are AGE freshness: the index build was 33,394 s old against a 3,600 s TTL, so the map reported it stale. BOTH can be true at once and the map says so in readFreshness.covers: a hash-fresh index can be old and an old index can still be hash-exact. Read both; do not treat either as a verdict on the other.',
    notDone:
      'This projection reports the numbers the baked snapshot carried at capture time. It does not re-read the intent map, re-embed anything or verify that the live map still matches this file; a census of null means the snapshot is unavailable and must be shown as unavailable rather than as zero. documentSha256 detects an artifact edited after capture, not a determined forger.',
  }
}
