/**
 * ============================================================================
 * THE META-PACKAGES SNAPSHOT — a precalculated artifact, served as a READING
 * ============================================================================
 *
 * The node must answer "which meta-packages does the meta-market infra carry,
 * what is its assembly identity, how many paths does it advertise against how
 * many it serves, and when was this measured" WITHOUT a network and WITHOUT
 * pretending. So the answer is captured once by
 * `docker/tools/capture-meta-packages.mjs` into `docker/snapshots/meta-packages.json`
 * and this module serves that artifact and nothing else.
 *
 * **THE ONE RULE THIS FILE EXISTS TO KEEP: AN UNAVAILABLE SNAPSHOT MUST NEVER BE
 * SERVED AS A ZERO.** `available: false` is not "0 packages", it is "this node has
 * no reading", and the two must be impossible to confuse in the payload — which is
 * why `available` is a separate field from `document` and why every unavailable
 * case carries a `reason` rather than a null document alone. A reader who sees
 * `available: false` learns that the artifact is missing and why; a reader who saw
 * a document of `[]` would learn nothing and would believe it.
 *
 * **A MISSING ARTIFACT MUST NOT CRASH THE NODE.** `buildNodeServer` takes this
 * module's view at startup, so a throw here is a container that does not boot —
 * and a crash on a missing file is indistinguishable, from outside the container,
 * from a container whose code is broken. So every path out of the reader is a
 * `SnapshotView`; there is no throwing branch, including for a directory that does
 * not exist, a file that is not JSON, and a document that is JSON but is not a
 * census.
 *
 * **READ ONCE, THEN CACHED.** The first call for a directory reads the file; every
 * later call for that same directory returns the SAME object without touching the
 * disk. The node passes its `SNAPSHOT_DIR` and never a second value, so this is
 * one read per process — which is what the contract asks for, and which also means
 * a snapshot that changes under a running node cannot silently change the served
 * answer halfway through a request.
 *
 * **TWO DIGESTS, TWO SUBJECTS — AND THE SECOND ONE IS THE ONE THIS FILE CAN
 * CHECK.** `sha256` is of THE RESPONSE BODY AS FETCHED (contract: "sha256 is over
 * those same bytes"), so it commits the node to the exact bytes the capture tool
 * saw; **it is NOT recomputable from the committed file**, because the file stores
 * the PARSED document re-serialised rather than the raw body, and a reader who
 * hashed the file against it would be verifying nothing. `documentSha256`
 * (amended into the contract by the Lead 2026-10-19) is `sha256` over
 * `JSON.stringify(document)` — the document EXACTLY AS STORED — and that IS
 * recomputable with no network.
 *
 * **SO THE SECOND DIGEST IS VERIFIED HERE RATHER THAN MERELY CARRIED.** On every
 * read this module recomputes `documentSha256` from the parsed document and
 * refuses the snapshot on a mismatch, and refuses a missing one too. That is the
 * difference between a digest printed beside a value and a digest that reads it;
 * a carried-but-unchecked digest is a caption, and this program has paid for that
 * distinction repeatedly. A mismatch can only mean the file was edited after
 * capture, because the tool computes the digest from the same parsed value it
 * writes it beside.
 *
 * **THE ALGORITHM IS IN BOTH FIELD NAMES**, never a bare `digest`, so a reader can
 * never compare one against an md5 and call the difference a finding.
 *
 * **NODE 24 NATIVE TYPE STRIPPING RUNS THIS FILE FROM SOURCE** (`node
 * --experimental-strip-types src/node/index.ts`), so every construct here is
 * ERASABLE: no `enum`, no `const enum`, no `namespace`, no parameter properties,
 * no decorators, no `import = require`.
 *
 * @module dsh-meta-community/node/metaPackages
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/**
 * The snapshot's file name inside the snapshot directory.
 *
 * A CONSTANT rather than a literal at the call site, because the capture tool and
 * the reader must agree on one name and two literals is two statements of one fact.
 */
export const META_PACKAGES_SNAPSHOT_FILE = 'meta-packages.json'

/**
 * What the node serves for the meta-packages snapshot.
 *
 * `document` is `unknown` on purpose: this node does not re-shape another
 * assembly's payload. The capture tool's document is `dsh-meta-market`'s own
 * `gui/health` body, and re-typing it here would be this plugin writing another
 * lane's interface — the same error the market assembly refuses when it declines
 * to invent a route table for a lane that declares none.
 */
export type SnapshotView = {
  available: boolean
  /** Why it is unavailable, stated rather than implied. `null` when available. */
  reason: string | null
  /** The URL the snapshot was captured from. */
  source: string | null
  /** ISO string from the snapshot file. */
  capturedAt: string | null
  bytes: number | null
  /** ALGORITHM-NAMED: the field is called `sha256`, never `digest`. */
  sha256: string | null
  document: unknown | null
}

/** One cache slot per snapshot directory: the first read wins, later reads are free. */
const cache = new Map<string, SnapshotView>()

/** A view with everything empty and the reason given. The only non-available shape. */
function unavailable(reason: string, carried: Partial<SnapshotView> = {}): SnapshotView {
  return {
    available: false,
    reason,
    source: carried.source ?? null,
    capturedAt: carried.capturedAt ?? null,
    bytes: carried.bytes ?? null,
    sha256: carried.sha256 ?? null,
    document: null,
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** A sha256 is 64 lowercase hex characters. Anything else is a mislabelled digest. */
function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/**
 * The assembly id, from the same three places the capture tool accepts.
 *
 * The document is `gui/health`'s body, whose identity is `identity.id`; the two
 * other shapes are read too because the SAME assembly answers them elsewhere and a
 * snapshot of either must not be reported as nameless.
 */
function assemblyIdOf(document: unknown): string | null {
  const record = asRecord(document)
  if (record === null) return null
  const identity = asRecord(record.identity)
  const assembly = asRecord(record.assembly)
  return nonEmptyString(record.id)
    ?? (identity === null ? null : nonEmptyString(identity.id))
    ?? (assembly === null ? null : nonEmptyString(assembly.id))
}

/**
 * The registered-path list, or `null`.
 *
 * `null` and `[]` are kept apart deliberately: `[]` is a surface that advertises
 * no route (a real, refusable state) and `null` is a document that states no path
 * table at all (an absent reading). Collapsing them would make the length check
 * below unable to tell which one it was looking at.
 */
function pathListOf(document: unknown): readonly string[] | null {
  const record = asRecord(document)
  if (record === null) return null
  const routes = asRecord(record.routes)
  const candidate = routes !== null && Array.isArray(routes.paths)
    ? routes.paths
    : Array.isArray(record.registered)
      ? record.registered
      : null
  if (candidate === null) return null
  const strings = candidate.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return strings.length === candidate.length ? Object.freeze(strings) : null
}

/**
 * Parse and check the snapshot file's text into a view.
 *
 * EVERY CHECK HERE IS ONE THE CAPTURE TOOL ALSO MAKES, and that duplication is
 * deliberate: the tool's refusal protects the moment of capture, and these checks
 * protect the moment of serving, because a file can be edited, truncated by a bad
 * copy, or committed from an older tool. A node that trusted the file because the
 * tool checked it would be a check that depends on a different process having run.
 */
function viewFromText(text: string, path: string): SnapshotView {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return unavailable(`UNREADABLE: ${path} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`)
  }
  const record = asRecord(parsed)
  if (record === null) return unavailable(`UNREADABLE: ${path} does not hold a JSON object`)

  const source = nonEmptyString(record.source)
  const capturedAt = nonEmptyString(record.capturedAt)
  const status = typeof record.status === 'number' ? record.status : null
  const bytes = typeof record.bytes === 'number' && Number.isInteger(record.bytes) && record.bytes > 0 ? record.bytes : null
  const sha256 = isSha256Hex(record.sha256) ? record.sha256 : null
  const carried: Partial<SnapshotView> = { source, capturedAt, bytes, sha256 }

  if (source === null) return unavailable(`MALFORMED: ${path} carries no source URL, so a reader could not check the capture`, carried)
  if (capturedAt === null) return unavailable(`MALFORMED: ${path} carries no capturedAt stamp, so "when was this measured" is unanswerable`, carried)
  if (status === null) return unavailable(`MALFORMED: ${path} carries no numeric status`, carried)
  if (status !== 200) return unavailable(`REFUSED: ${path} records status ${status}, and a captured non-200 is not a reading of the surface`, carried)
  if (bytes === null) return unavailable(`MALFORMED: ${path} carries no positive integer byte count`, carried)
  if (sha256 === null) return unavailable(`MALFORMED: ${path} carries no 64-hex sha256; a digest without its algorithm named is not a value`, carried)

  const document = record.document ?? null
  if (document === null) return unavailable(`EMPTY: ${path} carries a null document, which is an absent reading rather than a zero`, carried)

  /**
   * THE NETWORK-FREE CHECK, made here rather than left to a reader.
   *
   * `documentSha256` is over `JSON.stringify(document)`, and the document above is
   * that same parsed value, so recomputing it costs one hash and needs nothing but
   * the file. A MISSING digest refuses as well: a snapshot with an uncheckable
   * document is the state this field was added to end, and accepting it silently
   * would make the field optional and therefore ornamental.
   */
  const documentSha256 = isSha256Hex(record.documentSha256) ? record.documentSha256 : null
  if (documentSha256 === null) {
    return unavailable(`MALFORMED: ${path} carries no 64-hex documentSha256, so its document cannot be checked without the network`, carried)
  }
  const recomputed = createHash('sha256').update(JSON.stringify(document), 'utf8').digest('hex')
  if (recomputed !== documentSha256) {
    return unavailable(`TAMPERED: the document in ${path} hashes to ${recomputed} but the file declares documentSha256 ${documentSha256}; the snapshot was edited after capture and is therefore not the artifact the source answered`, carried)
  }

  const id = assemblyIdOf(document)
  if (id === null) return unavailable(`EMPTY: the document in ${path} names no assembly id, so nothing in it can be attributed to a package`, carried)

  const paths = pathListOf(document)
  if (paths === null) return unavailable(`EMPTY: the document in ${path} states no registered path list, so the advertised-path count is unmeasured`, carried)
  if (paths.length === 0) return unavailable(`EMPTY: the document in ${path} advertises 0 paths, and "advertises 0 paths" is the empty census this program refuses to serve as a fact`, carried)

  return { available: true, reason: null, source, capturedAt, bytes, sha256, document }
}

/**
 * Read the meta-packages snapshot from `dir`, once, and never throw.
 *
 * @param dir - the directory holding `meta-packages.json`; the node's `SNAPSHOT_DIR`.
 * @returns a view; `available: false` with a `reason` for every failure, never a throw.
 */
export function loadMetaPackagesSnapshot(dir: string): SnapshotView {
  const cached = cache.get(dir)
  if (cached !== undefined) return cached

  const path = join(dir, META_PACKAGES_SNAPSHOT_FILE)
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const view = unavailable(
      `NOT MEASURED: no readable meta-packages snapshot at ${path} — ${error instanceof Error ? error.message : String(error)}; this is an absent artifact, not a count of zero packages`,
    )
    cache.set(dir, view)
    return view
  }

  const view = viewFromText(text, path)
  cache.set(dir, view)
  return view
}
