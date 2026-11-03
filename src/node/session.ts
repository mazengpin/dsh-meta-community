/**
 * The anonymity instrument: a session probe that retains nothing.
 *
 * The owner's requirement is that no user data may be provably saved on a node
 * and that sessions are completely anonymous. This module is the INSTRUMENT for
 * that requirement, not the proof of it: a module cannot prove what the rest of
 * the process does with the filesystem, the logs or a container layer. The proof
 * is the canary sweep in `docker/verify/anonymity.mjs`, which submits a unique
 * string and then searches the writable layer, the logs and the container
 * filesystem for it, with a positive control proving the search can find one.
 *
 * What this module CAN demonstrate, from inside the process:
 *
 *   - the same payload submitted twice yields two DIFFERENT session digests,
 *     so the digest is not a key derived from the payload and the payload is not
 *     the thing being remembered;
 *   - the payload's own top-level field count is reported, so a caller sees the
 *     payload was SEEN and DROPPED rather than never received.
 *
 * The salt is generated once per process, held in a module-level binding, and is
 * never exported, logged, served or written to disk. There is no getter for it.
 *
 * @module dsh-meta-community/node/session
 */

import { createHash, randomBytes } from 'node:crypto'

/** Digest algorithm, named as data so a served body can never be read as an unlabelled hex string. */
export type DigestAlgorithm = 'sha256'

/** The probe result. `retained` and `store` say the same thing twice on purpose: one is a count, one is a decision. */
export type SessionProbe = {
  observedFields: number
  droppedFields: number
  sessionDigest: string
  digestAlgorithm: DigestAlgorithm
  retained: 0
  store: 'none'
  note: string
}

/**
 * The counters behind the anonymity report.
 *
 * Every field is read at report time and NO code path in this module, or in the
 * node, increments any of them, because no cookie jar, no token mint and no
 * session store exists. That is what makes each `0` a DERIVED value rather than
 * a typed-in constant — and it is also why every `0` is a FLOOR and not a
 * proof: a counter can only report what it is wired to, and nothing in this
 * process is wired to the container layer the canary sweep inspects.
 *
 * The moment a store is added, it must increment the matching counter here. The
 * canary harness in `docker/verify/anonymity.mjs` is what catches a store that
 * is added WITHOUT incrementing, which is why the harness and not this field is
 * the proof.
 */
type AnonymityCounters = {
  cookiesIssued: number
  tokensIssued: number
  sessionRecordsWritten: number
  payloadBytesRetained: number
}

const counters: AnonymityCounters = {
  cookiesIssued: 0,
  tokensIssued: 0,
  sessionRecordsWritten: 0,
  payloadBytesRetained: 0,
}

/** Salt width in bytes. Reported because the WIDTH is not the secret and is part of the instrument's identity. */
const SALT_BYTES = 32

/**
 * The per-process salt: generated exactly once, at module init, in memory only.
 *
 * Deliberately not exported and deliberately not reachable through any function.
 * The only thing that touches it is the digest, which emits a one-way hash. A
 * reader of any served body therefore learns nothing about it, and a writer of
 * any log line has nothing to write.
 */
const SALT: Buffer = randomBytes(SALT_BYTES)

/** Monotonic in-memory call counter, so two probes can never share a nonce even if the random half repeats. */
let nonceCounter = 0

/** The domain tag, so this hash can never be confused with a hash of the same tuple taken for another purpose. */
const DIGEST_DOMAIN = 'dsh-meta-community/node/session/v1'

/**
 * Count the payload's own top-level enumerable string keys.
 *
 * A non-object payload has no field census to take, and this function does not
 * pretend otherwise by reporting a measured zero: it reports `0` fields because
 * a primitive or `null` HAS no top-level fields, and `probeSession` states the
 * shape in its `note` so a reader cannot mistake that `0` for "the object I sent
 * had no keys". `Object.keys` is not applied to a primitive, because it returns
 * the indexed characters of a string and would invent fields for a payload that
 * has none.
 */
function topLevelFieldCount(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) {
    return 0
  }
  return Object.keys(payload).length
}

/** True only for a payload that actually has a top-level key census. */
function hasFieldCensus(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null
}

/**
 * A fresh request nonce: monotonic counter plus 16 random bytes.
 *
 * The counter is what makes "two identical payloads produce different digests"
 * a GUARANTEE rather than a probability. Nothing here is user data, and neither
 * half is retained after the digest is computed.
 */
function nextNonce(): string {
  nonceCounter += 1
  return `${nonceCounter}:${randomBytes(16).toString('hex')}`
}

/**
 * sha256 over (process salt, node id, request nonce).
 *
 * The tuple is LENGTH-PREFIX-framed before hashing, so a `nodeId` or a nonce
 * that contains the separator cannot relocate the boundaries and collide with a
 * different tuple. The output is lowercase hex and the algorithm is named in the
 * result as data, because a digest without its algorithm is not a value.
 */
function digestSession(nodeId: string, nonce: string): string {
  const parts: readonly string[] = [DIGEST_DOMAIN, SALT.toString('hex'), nodeId, nonce]
  const framed = parts.map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`).join('|')
  return createHash('sha256').update(framed, 'utf8').digest('hex')
}

/**
 * Probe a session payload and retain nothing.
 *
 * The payload is read for its field census and then dropped. No reference to it
 * escapes this function: the result carries a digest over (salt, nodeId, nonce)
 * and two counts, and the counts are the only facts that survive the call.
 */
export function probeSession(nodeId: string, payload: unknown): SessionProbe {
  const observedFields = topLevelFieldCount(payload)
  const droppedFields = observedFields
  const sessionDigest = digestSession(nodeId, nextNonce())
  const shapeNote = hasFieldCensus(payload)
    ? `${observedFields} top-level field(s) counted`
    : 'the payload was not an object record, so there was no field census to take and 0 is the count of fields a non-record has'
  const note = `seen and dropped: ${shapeNote}; ${droppedFields} of ${observedFields} dropped and 0 retained (retained: 0, store: 'none'); the sessionDigest is over (process salt, nodeId, per-call nonce) and over no byte of the payload, so it is not a key derived from what was sent`
  return {
    observedFields,
    droppedFields,
    sessionDigest,
    digestAlgorithm: 'sha256',
    retained: 0,
    store: 'none',
    note,
  }
}

/**
 * The anonymity report, as fields rather than as an assertion.
 *
 * Every count is READ from the counter object above, never coerced: this file
 * contains no falsy-or-nullish zero fallback on any count, because a coercion
 * would turn an absent count into a measured-looking zero. The report states in its own fields that a
 * counter's zero is a floor and that the proof lives in the canary sweep, and it
 * names that file, so a reader is never asked to take provenness on trust.
 */
export function anonymityReport(nodeId: string): Record<string, unknown> {
  return {
    nodeId,
    digestAlgorithm: 'sha256',
    sessionStore: 'none',
    cookiesIssued: counters.cookiesIssued,
    tokensIssued: counters.tokensIssued,
    sessionRecordsWritten: counters.sessionRecordsWritten,
    payloadBytesRetained: counters.payloadBytesRetained,
    saltLocation: 'process memory only',
    saltBytes: SALT_BYTES,
    saltGenerated: 'once per process, at module init',
    saltExported: false,
    saltLogged: false,
    saltServed: false,
    saltWrittenToDisk: false,
    registryLifetime: 'in-memory, discarded at restart',
    zeroIsFloor: true,
    zeroFloorStatement: 'Every 0 above is a FLOOR reported by a counter this process owns, not a proof: a counter can only report what it is wired to, and nothing here is wired to the container writable layer, the container logs or the filesystem reachable by docker exec. The proof is the canary sweep in docker/verify/anonymity.mjs, which submits a unique string and searches those surfaces for it, with a positive control container that deliberately stores the same canary to show the search can find one.',
    proofFile: 'docker/verify/anonymity.mjs',
    proofIsCanarySweep: true,
    notProvenByThisModule: [
      'that no byte of a payload reaches the container writable layer',
      'that no byte of a payload reaches the process or container logs',
      'that no byte of a payload reaches any file reachable by docker exec',
      'that a future store added outside this module would be caught by these counters',
    ],
  }
}
