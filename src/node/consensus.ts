/**
 * consensus.ts — a DETERMINISTIC TWO-VOTER COMMIT. THIS IS NOT RAFT, and the code says so on purpose rather than by omission:
 *   - there is NO leader election: both nodes are peers, neither is a leader, and no vote ever chooses one;
 *   - there is NO log replication beyond a committed map: a commit appends one key/value pair to `committed` here, and the peer learns of it by being asked to endorse, not by having a log pushed to it;
 *   - there is ONE voter per node: the local node holds one vote, the peer named by PEER_URL holds the other, and there is no third voter and no membership change;
 *   - a proposal COMMITS ONLY AT 2 OF 2, on an endorsement that matches the same key, value and term.
 * The four outcomes are four STRINGS and never a boolean, because a boolean cannot carry the distinction this protocol exists to preserve: `rejected-peer-disagrees` is a peer that ANSWERED and refused, `quorum-lost` is a peer that did not answer at all. Collapsing them would delete the only mechanical evidence that this code tells an answer apart from an absence — this program's recorded trap is that an absence is not a zero.
 *
 * The vote is a pure function of (local state, the peer's answer): no randomness, no clock and no latency ever enters the verdict, so two containers started in either order reach the same verdict for the same input. `performance.now()` appears only in `peerClient.ts`, as instrumentation.
 *
 * AMENDMENT 1 (Lead, 2026-10-19T11:15Z) binds three things this file implements and one it corrects:
 *   (a) THE KEY SPACE IS CLOSED. `committed` is served back on `GET /node/consensus/state`, so every string that enters it is data this node preserves and republishes — which collides with the owner's requirement that no user data be kept. `propose` therefore accepts only `intent-snapshot`, `meta-packages` and `member-roster`, refuses anything else with the fifth outcome `refused-non-meta-key` and `votes: 0` BEFORE any network call, and bounds `value` to 256 bytes that must be a lowercase hex sha256 or a member id. A closed key space is auditable; a promise is not.
 *   (b) AN ACCEPTED ENDORSEMENT COMMITS ON THE ACCEPTING NODE TOO. The first version endorsed and wrote nothing, so node-b answered `accepted` while its own `committed` map stayed empty: "2 of 2" described an acknowledgement and the two nodes held divergent views of one term. `endorse()` now writes the same `{key, value, term, index}` locally, which is what makes the two-node result checkable from the PEER rather than only from the proposer.
 *   (c) THE ENDORSEMENT ECHOES key and value, and the proposer FAILS CLOSED when either is missing. A guard that an absence satisfies is not a guard.
 *
 * `TERM` starts at 1 and increments ONLY on a disagreement (`rejected-peer-disagrees`). The term is a local disagreement counter, not a replicated election epoch — there is no election to carry one — and the honest consequence is stated here rather than discovered later: a pair whose terms have diverged does not self-heal, because adopting a higher term would be exactly the election behaviour this protocol does not have.
 */
import type { NodeConfig } from './config.ts'
import { requestEndorsement } from './peerClient.ts'

export type ProposalResult =
  | { outcome: 'committed'; term: number; index: number; key: string; value: string; votes: 2; of: 2; peer: string }
  | { outcome: 'rejected-peer-disagrees'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: string; peerReason: string }
  | { outcome: 'quorum-lost'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: string; peerReason: string }
  | { outcome: 'refused-lone-node'; term: number; index: number; key: string; value: string; votes: 1; of: 2; peer: null; peerReason: string }
  | { outcome: 'refused-non-meta-key'; term: number; index: number; key: string; value: string; votes: 0; of: 2; peer: null; peerReason: string }

/**
 * AMENDMENT 1(a): the ONLY keys this node will hold. The map is served back on `GET /node/consensus/state`, so an open key space is a data-retention sink with an HTTP write endpoint — a closed one is checkable.
 * `peer: null` on `refused-non-meta-key` is not decoration: the refusal happens BEFORE the peer is dialled, so no peer was consulted and no vote exists (`votes: 0`).
 */
export const META_KEY_VOCABULARY: readonly string[] = ['intent-snapshot', 'meta-packages', 'member-roster']
const SHA256_HEX = /^[0-9a-f]{64}$/
const MEMBER_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/
const MAX_VALUE_BYTES = 256

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

export type Endorsement = { accepted: boolean; reason: string; term: number; key: string; value: string }

function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`consensus: ${field} must be a non-empty string; received ${typeof value}${typeof value === 'string' ? ' (length 0)' : ''}`)
  }
  return value
}

/** Why a key may not enter this node's map, or null when it may. Exported so a harness can assert the vocabulary rather than trusting one string. */
export function metaKeyProblem(key: string): string | null {
  if (META_KEY_VOCABULARY.includes(key)) {
    return null
  }
  return `key ${JSON.stringify(key)} is not in the closed meta vocabulary (${META_KEY_VOCABULARY.join(', ')}); the committed map is served back on /node/consensus/state, so an arbitrary key would turn this node into a store of caller-supplied data`
}

/** Why a value may not enter this node's map, or null when it may: at most 256 bytes, and a lowercase hex sha256 or a member id. */
export function metaValueProblem(value: string): string | null {
  const bytes = new TextEncoder().encode(value).length
  if (bytes > MAX_VALUE_BYTES) {
    return `value is ${bytes} bytes, above the ${MAX_VALUE_BYTES}-byte bound; this map holds a digest or a member id, not a document`
  }
  if (SHA256_HEX.test(value) || MEMBER_ID.test(value)) {
    return null
  }
  return `value is neither a lowercase hex sha256 nor a member id ([a-z0-9][a-z0-9._:-]{0,127}); the committed map is a closed meta store and must not become free text`
}

export class Consensus {
  private readonly config: NodeConfig
  private readonly fetchImpl: typeof fetch | undefined
  private readonly committedMap: Record<string, string>
  private readonly committedLog: Array<{ key: string; value: string; term: number; index: number }>
  private currentTerm: number
  private proposalCount: number
  private lastOutcome: ProposalResult['outcome'] | null
  private peerLastAnswer: string | null
  private peerLastLatencyMs: number | null

  constructor(config: NodeConfig, fetchImpl?: typeof fetch) {
    if (config === null || typeof config !== 'object') {
      throw new TypeError('consensus: config is required')
    }
    this.config = config
    this.fetchImpl = fetchImpl
    this.committedMap = {}
    this.committedLog = []
    this.currentTerm = 1
    this.proposalCount = 0
    this.lastOutcome = null
    this.peerLastAnswer = null
    this.peerLastLatencyMs = null
  }

  /** Propose a key/value pair for commit. `index` is the position the pair WOULD take; it only takes it on `committed`. */
  async propose(key: string, value: string): Promise<ProposalResult> {
    requireText('key', key)
    requireText('value', value)
    this.proposalCount += 1
    const term = this.currentTerm
    const index = this.committedLog.length + 1
    /**
     * AMENDMENT 1(a) runs FIRST, before the peer is dialled: a proposal this node would never accept is not forwarded to the peer, so a refused key cannot reach the peer's map through this node either.
     */
    const keyProblem = metaKeyProblem(key)
    if (keyProblem !== null) {
      return this.finish({
        outcome: 'refused-non-meta-key',
        term,
        index,
        key,
        value,
        votes: 0,
        of: 2,
        peer: null,
        peerReason: `${keyProblem}; the proposal is refused locally, before any dial, so it has 0 votes and no peer was consulted`,
      })
    }
    const valueProblem = metaValueProblem(value)
    if (valueProblem !== null) {
      return this.finish({
        outcome: 'refused-non-meta-key',
        term,
        index,
        key,
        value,
        votes: 0,
        of: 2,
        peer: null,
        peerReason: `${valueProblem}; the proposal is refused locally, before any dial, so it has 0 votes and no peer was consulted (the outcome string names the closed meta store this map is, and the value bound is stated here rather than implied)`,
      })
    }
    const peerUrl = this.config.peerUrl
    if (peerUrl === null) {
      return this.finish({
        outcome: 'refused-lone-node',
        term,
        index,
        key,
        value,
        votes: 1,
        of: 2,
        peer: null,
        peerReason: 'PEER_URL is unset: a lone node holds 1 of 2 votes and this protocol never commits on one vote',
      })
    }
    /**
     * THE PROPOSER MUST NOT RE-COMMIT A KEY THIS NODE HAS ALREADY DECIDED. A contradiction guard on the endorser alone constrains the VOTER and not the WRITER: measured by an independent review and confirmed by the Lead by reading these lines, `intent-snapshot` was committed as one value, a second proposal carried a different one, and it returned `committed` 2 of 2 with the map then holding the replacement. It only looked safe because the peer happened to hold the same key; when the peer does NOT hold it — a restart destroys its map — there is no contradiction for the peer to refuse, both nodes converge on the overwrite, and the invariant stated below the endorsement was silently false.
     * The refusal is expressed as `rejected-peer-disagrees` because that is what a contradiction is, and the `peerReason` leads with `refused LOCALLY` and names this node's own committed value and term, so a reader can tell "my own node already decided this" from "the peer refused". `votes: 1` is honest: the local node holds one of the two votes and that vote is AGAINST this proposal. `peer` names the second voter the proposal would have needed; the reason states that it was never consulted, which is checkable on the wire because `peer.lastAnswer` and `peer.lastLatencyMs` do not move.
     * This sits after the lone-node check only because a lone node can never commit, so it can never hold a value to contradict.
     */
    const existingLocal = this.committedMap[key]
    if (existingLocal !== undefined && existingLocal !== value) {
      return this.finish({
        outcome: 'rejected-peer-disagrees',
        term,
        index,
        key,
        value,
        votes: 1,
        of: 2,
        peer: peerUrl,
        peerReason: `refused LOCALLY, before any dial (the peer was NOT consulted): this node has already committed key ${JSON.stringify(key)} = ${JSON.stringify(existingLocal)} at term ${String(this.committedTermFor(key))}, and a committed value is FINAL on this node in BOTH roles — the endorser refuses to contradict it and the proposer refuses to overwrite it. A different value for this key requires a process restart: this map has no re-commit path and no un-commit`,
      })
    }
    const reply = await requestEndorsement({
      peerUrl,
      key,
      value,
      term,
      nodeId: this.config.nodeId,
      index,
      timeoutMs: this.config.commitTimeoutMs,
      fetchImpl: this.fetchImpl,
    })
    this.peerLastLatencyMs = reply.latencyMs
    if (reply.kind === 'unreachable') {
      this.peerLastAnswer = 'unreachable'
      return this.finish({
        outcome: 'quorum-lost',
        term,
        index,
        key,
        value,
        votes: 1,
        of: 2,
        peer: peerUrl,
        peerReason: `the peer did not answer, so there is no second vote: ${reply.reason}`,
      })
    }
    if (reply.kind === 'refused') {
      this.peerLastAnswer = `answered-http-${reply.status}`
      return this.finish({
        outcome: 'quorum-lost',
        term,
        index,
        key,
        value,
        votes: 1,
        of: 2,
        peer: peerUrl,
        peerReason: `a response arrived but it was not a vote, and quorum is not established: ${reply.reason}`,
      })
    }
    const answer = reply.answer
    if (answer === null) {
      this.peerLastAnswer = 'answered-without-endorsement'
      return this.finish({
        outcome: 'rejected-peer-disagrees',
        term,
        index,
        key,
        value,
        votes: 1,
        of: 2,
        peer: peerUrl,
        peerReason: `the peer answered HTTP ${reply.status} with ${reply.rawBytes} bytes that carry no endorsement; an answer without an endorsement is not a vote`,
      })
    }
    if (!answer.accepted) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer answered and refused its vote: ${answer.reason}`,
      })
    }
    if (answer.term !== term) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer endorsed at term ${answer.term} but the proposal carried term ${term}; a vote for another term is not a vote for this one`,
      })
    }
    /**
     * FAIL CLOSED on the pair. A peer that says `accepted: true` while naming NO key or NO value has endorsed nothing this proposal can be matched against, and the earlier form of these guards (`answer.key !== null && answer.key !== key`) passed unconditionally in exactly that case — an endorsement of nothing was a commit.
     * A missing key is therefore a REFUSAL, not a pass: absent is not a zero, and here it is not an agreement either.
     */
    if (answer.key === null) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer answered accepted:true but named NO key; an endorsement that names nothing cannot match key ${JSON.stringify(key)}, so it is refused rather than passed`,
      })
    }
    if (answer.value === null) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer answered accepted:true for key ${JSON.stringify(answer.key)} but named NO value; an endorsement that names no value cannot match value ${JSON.stringify(value)}, so it is refused rather than passed`,
      })
    }
    if (answer.key !== key) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer endorsed key ${JSON.stringify(answer.key)} but the proposal carried key ${JSON.stringify(key)}`,
      })
    }
    if (answer.value !== value) {
      this.peerLastAnswer = 'refused-endorsement'
      return this.reject({
        term,
        index,
        key,
        value,
        peer: peerUrl,
        peerReason: `the peer endorsed value ${JSON.stringify(answer.value)} for key ${JSON.stringify(key)} but the proposal carried value ${JSON.stringify(value)}; a mismatched endorsement is never a commit`,
      })
    }
    this.peerLastAnswer = 'accepted'
    /**
     * Only a key this node does NOT already hold appends a new log entry. An identical re-proposal still has to win the peer's endorsement — the pair's agreement is the point — but it must not append a second entry for one committed fact, or `logLength` would count re-affirmations as decisions.
     */
    if (existingLocal === undefined) {
      this.committedLog.push({ key, value, term, index: this.committedLog.length + 1 })
    }
    this.committedMap[key] = value
    return this.finish({
      outcome: 'committed',
      term,
      index: this.committedLog.length,
      key,
      value,
      votes: 2,
      of: 2,
      peer: peerUrl,
    })
  }

  /** The term at which this node committed `key`, read from its own log — used so a local refusal can name the term it is defending. */
  private committedTermFor(key: string): number | null {
    for (let i = this.committedLog.length - 1; i >= 0; i -= 1) {
      const entry = this.committedLog[i]
      if (entry.key === key) {
        return entry.term
      }
    }
    return null
  }

  /**
   * The PEER calls this to cast its one vote. It accepts only at the local term, ECHOES the key and the value it accepted, and — AMENDMENT 1(b) — WRITES the same `{key, value, term, index}` into this node's own committed map on accept.
   * The write is what makes "2 of 2" a state rather than an acknowledgement: the first version answered `accepted` and stored nothing, so the proposer held a commit the peer had never recorded. `index` is assigned locally as this node's next log position; the two nodes agree on it whenever they commit the same proposals in the same order, and the map, not the index, is what the two-node check compares.
   * A REFUSAL STILL WRITES NOTHING — neither branch below touches the map before the term and vocabulary checks pass.
   * The closed vocabulary and the value bound are enforced HERE as well as in `propose`, because this route is also unauthenticated: a gate on the proposer only would leave the peer's map writable directly by anyone who can POST to it.
   */
  endorse(key: string, value: string, term: number): Endorsement {
    requireText('key', key)
    requireText('value', value)
    const keyProblem = metaKeyProblem(key)
    if (keyProblem !== null) {
      return { accepted: false, reason: keyProblem, term: this.currentTerm, key, value }
    }
    const valueProblem = metaValueProblem(value)
    if (valueProblem !== null) {
      return { accepted: false, reason: valueProblem, term: this.currentTerm, key, value }
    }
    if (typeof term !== 'number' || !Number.isInteger(term) || term < 1) {
      return { accepted: false, reason: `refused a vote whose term is not a positive integer (received ${String(term)})`, term: this.currentTerm, key, value }
    }
    if (term !== this.currentTerm) {
      return { accepted: false, reason: `term mismatch: the proposal carries term ${term} and this node is at term ${this.currentTerm}`, term: this.currentTerm, key, value }
    }
    /**
     * THE ENDORSER MUST NOT CONTRADICT ITSELF. Measured on the live pair by `consensus-harness`: node-a endorsed a value that contradicted a key node-a had already committed, both nodes then held different values for one key, and BOTH reported 2 of 2 — a split brain reachable with two ordinary POSTs and no fault injection. The contract's rule 3 constrains the proposer; nothing constrained the endorser, so this is the missing half.
     * A value already committed on this node is therefore FINAL on this node: a different value for the same key is refused, and the refusal travels back as `rejected-peer-disagrees` so the proposer writes nothing. An identical value is accepted idempotently without a second log entry, because re-endorsing what this node already holds cannot produce disagreement.
     * The honest consequence, stated rather than left to be discovered: within one process lifetime this map has no re-commit path — a key committed here keeps its value until the process restarts, because there is no log to reorder and no rollback, which is one more thing this protocol is not (it is not Raft).
     * AND THAT SENTENCE IS ONLY TRUE BECAUSE OF A GUARD ON THE OTHER SIDE OF THE WIRE. For a while it was not: the endorser refused a contradicting value while the PROPOSER overwrote it unconditionally, so the invariant held only while the peer happened to hold the key too. `propose` now refuses a different value for a key it has already committed, before any dial, which is what makes the claim above enforced rather than asserted — a comment promising an invariant the code breaks is a stale gate inside this module.
     */
    const existing = this.committedMap[key]
    if (existing !== undefined && existing !== value) {
      return {
        accepted: false,
        reason: `this node has already committed key ${JSON.stringify(key)} = ${JSON.stringify(existing)}; it refuses to endorse the contradicting value ${JSON.stringify(value)}, because endorsing it would leave two nodes holding two truths for one key while both claimed 2 of 2`,
        term: this.currentTerm,
        key,
        value,
      }
    }
    if (existing === value) {
      return {
        accepted: true,
        reason: `term ${term} matches and key ${JSON.stringify(key)} already holds this exact value on this node; the endorsement is idempotent and no second log entry is written`,
        term: this.currentTerm,
        key,
        value,
      }
    }
    const index = this.committedLog.length + 1
    this.committedLog.push({ key, value, term, index })
    this.committedMap[key] = value
    return {
      accepted: true,
      reason: `term ${term} matches this node's term; key ${JSON.stringify(key)} value ${JSON.stringify(value)} is endorsed AND written into this node's committed map at index ${index}, so the peer holds the same entry the proposer is about to hold`,
      term: this.currentTerm,
      key,
      value,
    }
  }

  state(): ConsensusState {
    return {
      nodeId: this.config.nodeId,
      term: this.currentTerm,
      logLength: this.committedLog.length,
      committed: { ...this.committedMap },
      proposals: this.proposalCount,
      lastOutcome: this.lastOutcome,
      peer: { url: this.config.peerUrl, lastAnswer: this.peerLastAnswer, lastLatencyMs: this.peerLastLatencyMs },
      quorum: { required: 2, of: 2 },
    }
  }

  private reject(args: { term: number; index: number; key: string; value: string; peer: string; peerReason: string }): ProposalResult {
    this.currentTerm += 1
    return this.finish({
      outcome: 'rejected-peer-disagrees',
      term: args.term,
      index: args.index,
      key: args.key,
      value: args.value,
      votes: 1,
      of: 2,
      peer: args.peer,
      peerReason: `${args.peerReason}; term moves to ${this.currentTerm} because a disagreement is the only event that moves it`,
    })
  }

  private finish(result: ProposalResult): ProposalResult {
    this.lastOutcome = result.outcome
    return result
  }
}
