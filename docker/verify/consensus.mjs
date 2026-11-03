#!/usr/bin/env node
/**
 * ============================================================================
 * CONSENSUS HARNESS — the evidence that "consensus of 2 nodes" actually holds,
 * and actually refuses when it cannot hold
 * ============================================================================
 *
 * Lane: `consensus-harness`. Written against `docker/NODE-CONTRACT.md` §`consensus.ts`.
 * One file, plain ESM, no build step: `node docker/verify/consensus.mjs`.
 *
 * THIS HARNESS DRIVES THE LIVE CONTAINERS, NOT A FAKE. node-a answers on
 * `127.0.0.1:18091` and node-b on `127.0.0.1:18092` (both overridable with
 * `NODE_A_URL` / `NODE_B_URL`). The subject is the running fleet, so a run of
 * this file is a measurement of the topology and not a restatement of the source.
 *
 * WHAT IT ESTABLISHES, IN ONE RECORDED RUN, IN THIS ORDER:
 *
 *   1. BOTH UP        propose on node-a -> `committed`, 2 of 2; then read the
 *                     committed map on BOTH nodes and require the peer's map to
 *                     show the key too. A commit that the peer never recorded is
 *                     a FINDING, and it is reported as one rather than passed.
 *   2. node-b STOPPED propose a DIFFERENT key on node-a -> `quorum-lost`, 1 of 2,
 *                     and the committed map must be BYTE-FOR-BYTE what it was
 *                     before. The map is printed before and after so the
 *                     "did not move" claim is checkable, not asserted.
 *   3. node-b BACK    propose that same key -> `committed`, 2 of 2, and the two
 *                     nodes' committed maps are compared. They are NOT expected
 *                     to be equal across a restart in general, because committed
 *                     state is in memory; the comparison is therefore a CHECK
 *                     whose failure is a real finding rather than a tolerated
 *                     difference. See the report line it produces.
 *   4. DISAGREEMENT   the fourth outcome string, `rejected-peer-disagrees`, is
 *                     attempted end-to-end (a contradicting proposal for an
 *                     already-committed key), and the peer's refusal primitive is
 *                     probed directly against the REAL peer. If the full outcome
 *                     cannot be reached from outside the fleet, the harness says
 *                     so in a NOT-DONE line — it does not silently omit the case
 *                     and it does not dress it as a pass.
 *   5. CLOSED KEYSPACE the vocabulary gate added by AMENDMENT 1 (a) is driven with
 *                     a non-member key, because a gate never driven has not been
 *                     shown to close.
 *
 * THE KEY SPACE IS CLOSED AND THE MAP IS PROCESS MEMORY, SO THIS FILE HAS A
 * PRECONDITION IT CHECKS RATHER THAN ASSUMES. AMENDMENT 1 (a) admits only
 * `intent-snapshot`, `meta-packages` and `member-roster`, and (d) makes a
 * contradicting value a REFUSAL. A fleet on which an earlier run already committed
 * one of those three would therefore refuse this run's proposals — and a harness
 * that measured through that would print a RED that describes residue instead of a
 * defect. So `preflight.keyspace.capacity` CENSUSES the three keys on both nodes and
 * takes the two that are still FREE, because a neighbour lane's acceptance run
 * occupies this vocabulary too and a harness that demanded an empty map would blame
 * the environment for a fleet it could still measure. Only when fewer than two keys
 * remain free does it stop before touching anything, and then the one repair is
 * `docker compose -f docker/compose.yaml restart node-a node-b`, because the
 * committed maps are memory-only and restart empty. The run id lives in the VALUE
 * (a sha256), never in the key, for the same reason: a key carrying a run id is not
 * in the vocabulary and is now REFUSED as `refused-non-meta-key`.
 *
 * THE THREE RULES THIS FILE IS BUILT AROUND, each of which has already produced a
 * wrong published number somewhere in this program:
 *
 *  - AN UNREACHABLE NODE IS `null`, NEVER `false`, NEVER A PASS. A check whose
 *    probe got no answer is INSTRUMENT FAILURE and it fails the run. The only
 *    place "not answered" is a PASSABLE expected value is where ABSENCE IS THE
 *    SUBJECT (step 2: the peer must be gone), and even there the observed value
 *    is printed as `unreachable` rather than as a boolean that could be confused
 *    with a probe that ran.
 *  - A CHECK THAT DID NOT RUN MUST FAIL THE RUN. `REQUIRED_CHECKS` names every
 *    check before any probe happens; the verdict refuses a run in which any of
 *    them left no record, because a check that disappears reads exactly like a
 *    check that passed.
 *  - A COUNT WITHOUT ITS DENOMINATOR IS NOT A CHECK. The summary prints
 *    `passed / required` on every run, including on a red one.
 *
 * THE RESTORE OBLIGATION IS ENFORCED IN A `finally`, NOT IN THE HAPPY PATH.
 * node-b is stopped in step 2 and restarted in a `finally` block that runs even
 * when a check threw, so a failed run cannot leave the fleet degraded. The
 * restoration is itself checked (`finally.b.restored`) and reported, and the file
 * said so rather than promising it.
 *
 * EXIT CODES: `0` all required checks passed and every probe answered; `1` at
 * least one check failed OR at least one probe did not answer; `2` NOTHING COULD BE
 * MEASURED — either the fleet was not reachable, or the closed key space was
 * already occupied by an earlier run. Both are instrument failure about the
 * ENVIRONMENT rather than a finding about the code, and both are reported as such
 * instead of being dressed as a defect.
 *
 * @module dsh-meta-community/verify/consensus
 */

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Topology: where the two nodes are, and where the compose file is
// ---------------------------------------------------------------------------

/** This file lives at `<clone>/docker/verify/`, so the clone root is two levels up. */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const CLONE_ROOT = path.resolve(SCRIPT_DIR, '..', '..')
const COMPOSE_FILE = path.join(CLONE_ROOT, 'docker', 'compose.yaml')

/** The published host ports from `docker/compose.yaml`. Overridable so a rebuild on other ports can be measured without editing this file. */
const NODE_A_URL = (process.env.NODE_A_URL ?? 'http://127.0.0.1:18091').replace(/\/+$/, '')
const NODE_B_URL = (process.env.NODE_B_URL ?? 'http://127.0.0.1:18092').replace(/\/+$/, '')

/** The node ids compose is contracted to set. Asserted, because a harness that reads the wrong node's map is the classic cross-wiring defect. */
const NODE_A_ID = 'node-a'
const NODE_B_ID = 'node-b'

/**
 * A run id, so this run's VALUES cannot be confused with a previous run's.
 *
 * THE RUN ID NOW LIVES IN THE VALUE, NOT IN THE KEY, and that is forced by
 * AMENDMENT 1 (a): the committed key space is CLOSED to the three keys below, so
 * a key such as `up-<runid>` is no longer proposable — it would be refused as
 * `refused-non-meta-key` and this harness would spend every direction measuring
 * the refusal path. Values are a lowercase hex sha256, which is unbounded enough
 * to carry a run id and still be a legal value.
 */
const RUN_ID = `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`

/** sha256 over a label, rendered as lowercase hex — the only value shape the amendment admits besides a member id. */
function valueFor(label) {
  return createHash('sha256').update(`consensus-harness:${RUN_ID}:${label}`).digest('hex')
}

/**
 * AMENDMENT 1 (a)'s closed vocabulary, read from the contract as a table rather
 * than typed at each call site: the committed map is republished by
 * `GET /node/consensus/state`, so any string admitted to it is data the node
 * PRESERVES — which is why the key space is three enumerated keys and not free text.
 */
const VOCABULARY = ['intent-snapshot', 'meta-packages', 'member-roster']

/** Direction 1 takes the first free key and directions 2/3/4b take the second, so a refusal in one direction can never be read as the other's. They are chosen at preflight from the keys that are still FREE, because this harness has to measure the fleet it finds rather than one it insists on. */

/** The four outcome strings the contract allows. Anything else is a contract violation, and is checked. */
const OUTCOMES = ['committed', 'rejected-peer-disagrees', 'quorum-lost', 'refused-lone-node']

/** Timeouts. `propose` may legitimately wait `COMMIT_TIMEOUT_MS` (1500) for a dead peer, so it gets more room than a read. */
const READ_TIMEOUT_MS = 5_000
const PROPOSE_TIMEOUT_MS = 15_000
const STOP_UNREACHABLE_WAIT_MS = 25_000
const RESTART_HEALTHY_WAIT_MS = 90_000

// ---------------------------------------------------------------------------
// The check engine
// ---------------------------------------------------------------------------
//
// `ok` is deliberately three-valued and the third value is not `false`:
//   true  -> the probe answered and the answer matched the expectation
//   false -> the probe answered and the answer did NOT match
//   null  -> the probe did not answer: INSTRUMENT FAILURE
//
// Collapsing null into false would turn "this container is not listening" into
// "the code is wrong"; collapsing it into true would publish a pass nobody saw.

/** @type {{id: string, expected: string, observed: string, ok: boolean|null, note?: string}[]} */
const results = []

/** The record of what this run actually did to the fleet, printed in the summary. */
const actions = []

/** Observations that are NOT checks and are printed as such, so a caption can never be counted as a check. */
const notes = []

let stoppedPeer = false

/** Every check this run is REQUIRED to produce. A run missing one of these fails even if the others are green. */
const REQUIRED_CHECKS = [
  'preflight.a.health',
  'preflight.b.health',
  'preflight.a.identity',
  'preflight.b.identity',
  'preflight.a.peerUrl',
  'preflight.b.peerUrl',
  'preflight.keyspace.capacity',
  'preflight.image.same',
  'up.propose.outcome',
  'up.propose.votes',
  'up.propose.of',
  'up.state.b.preconditionAbsent',
  'up.state.a.committed',
  'up.state.b.committed',
  'up.state.a.nodeId',
  'up.state.b.nodeId',
  'down.stop.exit',
  'down.b.unreachable',
  'down.propose.outcome',
  'down.propose.votes',
  'down.propose.peerReason',
  'down.state.value.notNew',
  'down.state.map.unchanged',
  'restart.b.health',
  'restart.propose.outcome',
  'restart.propose.votes',
  'restart.state.a.committed',
  'restart.state.b.committed',
  'restart.state.maps.consistent',
  'dis.endorse.matching.accepted',
  'dis.endorse.wrongTerm.accepted',
  'dis.propose.outcome.oneOfFour',
  'dis.propose.rejectKind',
  'dis.state.bothAgree',
  'vocab.propose.outcome',
  'vocab.propose.votes',
  'vocab.state.absent',
  'finally.b.restored',
  'finally.a.healthy',
]

/**
 * Record one check.
 *
 * `observed` is rendered at call time rather than later, because a lazy renderer
 * reading a mutable object would print the value at REPORT time and make the
 * transcript disagree with what the check saw.
 */
function check(id, expected, observed, ok, note) {
  results.push({
    id,
    expected: render(expected),
    observed: render(observed),
    ok: ok === null ? null : Boolean(ok),
    note,
  })
}

/** Render any value into a one-line string for the transcript. `null` stays visibly `null`; it is never rendered as `false`. */
function render(value) {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** A note is printed with a NOTE tag and is explicitly not counted in the check totals. */
function note(message) {
  notes.push(message)
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
//
// Every call returns a discriminated result and never throws. `answered: false`
// carries the reason, so a failure to reach a node is reportable WITHOUT being
// mistaken for a negative answer from it.

async function request(baseUrl, urlPath, options) {
  const { method = 'GET', body, timeoutMs = READ_TIMEOUT_MS } = options ?? {}
  const url = `${baseUrl}${urlPath}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let json = null
    let parseError = null
    try {
      json = JSON.parse(text)
    } catch (error) {
      parseError = String(error && error.message ? error.message : error)
    }
    return { answered: true, status: response.status, text, json, parseError, url, method }
  } catch (error) {
    const cause = error && error.cause ? error.cause : null
    const detail =
      (error && error.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : null) ??
      (cause && cause.code ? String(cause.code) : null) ??
      String(error && error.message ? error.message : error)
    return { answered: false, error: detail, url, method }
  } finally {
    clearTimeout(timer)
  }
}

/** `GET /node/health` — the probe the compose healthcheck uses, so it is the cheapest honest liveness answer. */
function probeHealth(baseUrl) {
  return request(baseUrl, '/node/health', { timeoutMs: READ_TIMEOUT_MS })
}

/** `GET /node/consensus/state`, tolerantly unwrapping a `{nodeId, state}` envelope but recording which shape answered. */
async function readState(baseUrl) {
  const response = await request(baseUrl, '/node/consensus/state', { timeoutMs: READ_TIMEOUT_MS })
  if (!response.answered || response.status !== 200 || response.json === null) return response
  const body = response.json
  const state = body && typeof body === 'object' && body.committed === undefined && body.state ? body.state : body
  return { ...response, state, shape: state === body ? 'top-level' : 'envelope' }
}

/**
 * `POST /node/consensus/propose`.
 *
 * The body is read from the top level first and from a `result` envelope second,
 * and which one answered is recorded — a tolerant reader that does not say which
 * shape it accepted is how a harness stops measuring the contract.
 */
async function propose(baseUrl, key, value) {
  const response = await request(baseUrl, '/node/consensus/propose', {
    method: 'POST',
    body: { key, value },
    timeoutMs: PROPOSE_TIMEOUT_MS,
  })
  if (!response.answered || response.json === null) return response
  const body = response.json
  const payload =
    body && typeof body === 'object' && body.outcome === undefined && body.result && typeof body.result === 'object'
      ? body.result
      : body
  return { ...response, result: payload, shape: payload === body ? 'top-level' : 'result-envelope' }
}

/** `POST /node/consensus/endorse` — the primitive the PEER calls, probed here directly against the real peer. */
async function endorse(baseUrl, key, value, term) {
  const response = await request(baseUrl, '/node/consensus/endorse', {
    method: 'POST',
    body: { key, value, term },
    timeoutMs: READ_TIMEOUT_MS,
  })
  if (!response.answered || response.json === null) return response
  const body = response.json
  const payload =
    body && typeof body === 'object' && body.accepted === undefined && body.result && typeof body.result === 'object'
      ? body.result
      : body
  return { ...response, result: payload }
}

// ---------------------------------------------------------------------------
// docker compose — the ONLY way node-b is stopped and started
// ---------------------------------------------------------------------------

/**
 * Run one `docker compose` subcommand against the compose file this harness was
 * shipped beside. Never throws: a compose failure is a check with an exit code,
 * because "I could not stop the peer" must not read as "the peer was stopped".
 */
function compose(args, timeoutMs) {
  const command = ['compose', '-f', COMPOSE_FILE, ...args]
  const startedAt = Date.now()
  try {
    const stdout = execFileSync('docker', command, {
      cwd: CLONE_ROOT,
      encoding: 'utf8',
      timeout: timeoutMs ?? 180_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, exitCode: 0, output: String(stdout).trim(), ms: Date.now() - startedAt, command }
  } catch (error) {
    const stdout = error && error.stdout ? String(error.stdout) : ''
    const stderr = error && error.stderr ? String(error.stderr) : ''
    const exitCode = typeof (error && error.status) === 'number' ? error.status : -1
    return {
      ok: false,
      exitCode,
      output: `${stdout}${stderr}`.trim() || String(error && error.message ? error.message : error),
      ms: Date.now() - startedAt,
      command,
    }
  }
}

/**
 * The image a container is actually RUNNING, read from `docker inspect` at call
 * time rather than taken from any message.
 *
 * This exists because the programme spent a day with a builder reporting one image
 * id and the fleet running another: an id REPORTED by a builder and an id OBSERVED
 * by a consumer are two different measurements, and only the second describes what
 * was tested. A transcript that does not name its artifact cannot be reproduced.
 */
function containerImage(name) {
  try {
    const out = execFileSync('docker', ['inspect', '--format', '{{.Image}}', name], { encoding: 'utf8', timeout: 30_000 })
    return { ok: true, image: String(out).trim() || null }
  } catch (error) {
    return { ok: false, image: null, error: String(error && error.message ? error.message : error) }
  }
}

/** Poll a node's health until it answers 200, or until the budget expires. Returns the last probe so a timeout can report WHY. */async function waitUntilHealthy(baseUrl, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last = await probeHealth(baseUrl)
  while (Date.now() < deadline) {
    if (last.answered && last.status === 200) return { healthy: true, last, elapsedMs: budgetMs - (deadline - Date.now()) }
    await sleep(500)
    last = await probeHealth(baseUrl)
  }
  return { healthy: last.answered && last.status === 200, last, elapsedMs: budgetMs }
}

/** Poll a node until it stops answering, or until the budget expires. "Stopped" means a REFUSED CONNECTION, which is an answer from the OS. */
async function waitUntilUnreachable(baseUrl, budgetMs) {
  const deadline = Date.now() + budgetMs
  let last = await probeHealth(baseUrl)
  while (Date.now() < deadline) {
    if (!last.answered) return { unreachable: true, last }
    await sleep(500)
    last = await probeHealth(baseUrl)
  }
  return { unreachable: false, last }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function run() {
  actions.push(`compose file: ${COMPOSE_FILE}`)
  actions.push(`node-a: ${NODE_A_URL}   node-b: ${NODE_B_URL}   run id: ${RUN_ID}`)

  // --- Preflight -----------------------------------------------------------
  //
  // Nothing below may proceed on a fleet that is not up: stopping node-b when it
  // was never running would "pass" step 2 for the wrong reason.

  const healthA = await probeHealth(NODE_A_URL)
  check(
    'preflight.a.health',
    'answered 200 from node-a',
    healthA.answered ? `HTTP ${healthA.status}` : null,
    healthA.answered ? healthA.status === 200 : null,
    healthA.answered ? undefined : `node-a did not answer: ${healthA.error}`,
  )

  const healthB = await probeHealth(NODE_B_URL)
  check(
    'preflight.b.health',
    'answered 200 from node-b',
    healthB.answered ? `HTTP ${healthB.status}` : null,
    healthB.answered ? healthB.status === 200 : null,
    healthB.answered ? undefined : `node-b did not answer: ${healthB.error}`,
  )

  if (!(healthA.answered && healthA.status === 200) || !(healthB.answered && healthB.status === 200)) {
    note(
      'FLEET NOT REACHABLE: no consensus direction was measured. This is INSTRUMENT FAILURE about the TOPOLOGY, not a finding about the code — node-b is NOT stopped, and nothing was changed. compose-topology owns the compose file; this run makes no claim either way about the consensus implementation.',
    )
    return { preflightFailed: true }
  }

  const identityA = await request(NODE_A_URL, '/node/identity', { timeoutMs: READ_TIMEOUT_MS })
  const identityB = await request(NODE_B_URL, '/node/identity', { timeoutMs: READ_TIMEOUT_MS })
  const nodeIdA = identityA.json && typeof identityA.json === 'object' ? identityA.json.nodeId : null
  const nodeIdB = identityB.json && typeof identityB.json === 'object' ? identityB.json.nodeId : null

  check(
    'preflight.a.identity',
    NODE_A_ID,
    identityA.answered ? nodeIdA : null,
    identityA.answered && identityA.status === 200 ? nodeIdA === NODE_A_ID : null,
    identityA.answered ? undefined : `identity probe did not answer: ${identityA.error}`,
  )
  check(
    'preflight.b.identity',
    NODE_B_ID,
    identityB.answered ? nodeIdB : null,
    identityB.answered && identityB.status === 200 ? nodeIdB === NODE_B_ID : null,
    identityB.answered ? undefined : `identity probe did not answer: ${identityB.error}`,
  )

  // The peer URL is topology, not a secret, and it is what makes the two-voter
  // commit possible: a null here means every proposal would be `refused-lone-node`.
  const stateBeforeA = await readState(NODE_A_URL)
  const stateBeforeB = await readState(NODE_B_URL)
  const peerUrlA = stateBeforeA.state ? stateBeforeA.state.peer && stateBeforeA.state.peer.url : null
  const peerUrlB = stateBeforeB.state ? stateBeforeB.state.peer && stateBeforeB.state.peer.url : null

  check(
    'preflight.a.peerUrl',
    'a non-null peer URL (a lone node may not claim a two-node commit)',
    stateBeforeA.state ? peerUrlA : null,
    stateBeforeA.state ? typeof peerUrlA === 'string' && peerUrlA.length > 0 : null,
    stateBeforeA.state ? undefined : `state probe did not answer: ${stateBeforeA.error ?? stateBeforeA.parseError}`,
  )
  check(
    'preflight.b.peerUrl',
    'a non-null peer URL',
    stateBeforeB.state ? peerUrlB : null,
    stateBeforeB.state ? typeof peerUrlB === 'string' && peerUrlB.length > 0 : null,
    stateBeforeB.state ? undefined : `state probe did not answer: ${stateBeforeB.error ?? stateBeforeB.parseError}`,
  )

  // The artifact this run measures, read from the running containers rather than
  // from anyone's message, and required to be the SAME on both sides: two nodes on
  // two different images is a topology defect that would otherwise be invisible in
  // a transcript of HTTP outcomes.
  const imageA = containerImage('meta-community-node-a')
  const imageB = containerImage('meta-community-node-b')
  const imagesMatch = imageA.ok && imageB.ok && imageA.image !== null && imageA.image === imageB.image
  check(
    'preflight.image.same',
    'both containers run the SAME image id, read from docker inspect (a reported id and an observed id must be reconciled, never assumed equal)',
    !imageA.ok || !imageB.ok ? null : { 'node-a': imageA.image, 'node-b': imageB.image },
    !imageA.ok || !imageB.ok ? null : imagesMatch,
    !imageA.ok || !imageB.ok
      ? `docker inspect did not answer: ${imageA.error ?? imageB.error}`
      : imagesMatch
        ? `measured image ${imageA.image}`
        : 'the two containers are running different images, so no outcome below is attributable to one artifact',
  )
  if (imagesMatch) actions.push(`MEASURED IMAGE (docker inspect, both containers): ${imageA.image}`)

  actions.push(`state shape observed: node-a ${stateBeforeA.shape ?? 'no answer'}, node-b ${stateBeforeB.shape ?? 'no answer'}`)
  if (stateBeforeA.state) actions.push(`node-a committed map BEFORE any proposal: ${render(stateBeforeA.state.committed)}`)

  /**
   * THE KEY SPACE IS THREE KEYS AND THE MAP IS PROCESS MEMORY, SO THE HARNESS HAS
   * A PRECONDITION AND IT MUST SAY SO RATHER THAN MEASURE THROUGH IT.
   *
   * AMENDMENT 1 (a) closes the vocabulary and 1 (d) makes an endorsement REFUSE a
   * value that contradicts an already-committed one. Together they mean a fleet on
   * which a previous run already committed `intent-snapshot` to a different value
   * cannot measure direction 1 at all: the proposal is correctly REFUSED, and this
   * harness would print a red `up.propose.outcome` that describes residue rather
   * than a defect. That is a false finding, which is worse than no finding. So the
   * precondition is CHECKED, and a failure is INSTRUMENT FAILURE about the
   * environment (exit 2) with the one repair named: restart both containers, whose
   * committed maps are memory-only and come back empty.
   */
  const priorA = stateBeforeA.state ? stateBeforeA.state.committed ?? {} : null
  const priorB = stateBeforeB.state ? stateBeforeB.state.committed ?? {} : null
  const has = (map, key) => map !== null && Object.prototype.hasOwnProperty.call(map, key)

  /**
   * CHOOSE FROM THE KEYS THAT ARE STILL USABLE RATHER THAN INSISTING ON A PRISTINE
   * FLEET — and the selection rule is the part that matters, not the convenience.
   *
   * Another lane's acceptance run occupies this same three-key vocabulary, so a
   * harness that demanded an empty map would report instrument failure for a fleet
   * it could still measure. But a warm fleet also creates a VACUOUS-PASS hazard that
   * is worse than the blockage: AMENDMENT 1 (b) says an endorsement writes to the
   * accepting node's map, and that claim is only tested if the accepting node did
   * NOT already hold the entry. If node-b already has the key, "both nodes show it"
   * proves nothing at all — the programme's own "agreement on an unanswered request
   * is not agreement" trap, one layer down.
   *
   * So `keyFirst` is chosen to be a key node-b does NOT hold, and a separate check
   * (`up.state.b.preconditionAbsent`) refuses the direction if no such key exists.
   * Where node-a already holds the key, its EXISTING value is proposed: that is an
   * idempotent re-commit on node-a, which Amendment 1 (d) accepts and which still
   * forces node-b to gain the entry, because node-b has nothing to be idempotent
   * about. Which mode was used is printed rather than implied.
   */
  const conflicts = []
  const usable = []
  if (priorA && priorB) {
    for (const key of VOCABULARY) {
      const onA = has(priorA, key) ? priorA[key] : null
      const onB = has(priorB, key) ? priorB[key] : null
      if (onA !== null && onB !== null && onA !== onB) {
        conflicts.push({ key, 'node-a': onA, 'node-b': onB })
        continue
      }
      usable.push({ key, onA, onB })
    }
  }
  /** Direction 1 must be able to make node-b GAIN the entry: prefer absent-on-both, then present-on-a/absent-on-b. */
  const forFirst = usable.filter((entry) => entry.onB === null)
  const firstChoice = forFirst.find((entry) => entry.onA === null) ?? forFirst[0] ?? null
  /** Direction 2/3/4b need a second key; absent-from-both is ideal, and any non-conflicting key that is not the first will do. */
  const forSecond = usable.filter((entry) => entry.key !== (firstChoice ? firstChoice.key : null))
  const secondChoice = forSecond.find((entry) => entry.onA === null) ?? forSecond[0] ?? null

  const keyFirst = firstChoice ? firstChoice.key : null
  const keySecond = secondChoice ? secondChoice.key : null
  const upValue = firstChoice ? (firstChoice.onA !== null ? firstChoice.onA : valueFor('up-committed')) : null
  const upMode = firstChoice ? (firstChoice.onA !== null ? 'idempotent-recommit (node-a already held this value; node-b did not)' : 'fresh-commit on both nodes') : null

  check(
    'preflight.keyspace.capacity',
    'a NON-CONFLICTING pair of closed-vocabulary keys, with the first one ABSENT from node-b (otherwise the peer-write check of Amendment 1 (b) is vacuous)',
    priorA === null || priorB === null ? null : keyFirst !== null && keySecond !== null ? { keyFirst, keySecond, upMode, conflicts, usable: usable.map((entry) => entry.key) } : { usable: usable.map((entry) => entry.key), conflicts },
    priorA === null || priorB === null ? null : keyFirst !== null && keySecond !== null,
    priorA === null || priorB === null
      ? 'a state probe did not answer, so the key space could not be censused'
      : keyFirst !== null && keySecond !== null
        ? `using ${render(keyFirst)} (${upMode}) and ${render(keySecond)}` + (conflicts.length > 0 ? `; REFUSING to build on a pre-existing split for ${conflicts.map((entry) => entry.key).join(', ')}` : '')
        : 'fewer than two non-conflicting keys remain in the closed vocabulary, or none is absent from node-b. Repair: docker compose -f docker/compose.yaml restart node-a node-b (the maps are memory-only and restart empty).',
  )

  if (conflicts.length > 0) {
    note(
      `PRE-EXISTING DIVERGENCE OBSERVED BEFORE THIS RUN TOUCHED ANYTHING: ${render(conflicts)}. These keys already carry two different values on the two nodes, so they are excluded from this run's directions rather than built upon; it is recorded here because a split that predates the measurement must not be attributed to it.`,
    )
  }

  if (priorA === null || priorB === null || keyFirst === null || keySecond === null) {
    note(
      'NO DIRECTION MEASURED: the closed vocabulary has no non-conflicting pair with the first key absent from node-b, so a proposal here would either be refused by AMENDMENT 1 (d) or prove nothing about the peer write. Stopping BEFORE any docker compose command — node-b was not touched, and this run makes no claim about the consensus either way.',
    )
    return { preflightFailed: true, reason: 'key space exhausted or vacuous' }
  }

  // --- Direction 1: both nodes up -> commit --------------------------------

  const upKey = keyFirst
  const upProposal = await propose(NODE_A_URL, upKey, upValue)
  const upOutcome = upProposal.result ? upProposal.result.outcome : null

  check(
    'up.propose.outcome',
    'committed',
    upProposal.result ? upOutcome : null,
    upProposal.result ? upOutcome === 'committed' : null,
    upProposal.result
      ? `propose shape: ${upProposal.shape}; peerReason: ${render(upProposal.result.peerReason ?? '(none)')}`
      : `propose did not answer: ${upProposal.error ?? upProposal.parseError}`,
  )
  check(
    'up.propose.votes',
    '2',
    upProposal.result ? upProposal.result.votes : null,
    upProposal.result ? upProposal.result.votes === 2 : null,
  )
  check(
    'up.propose.of',
    '2',
    upProposal.result ? upProposal.result.of : null,
    upProposal.result ? upProposal.result.of === 2 : null,
  )

  const upStateA = await readState(NODE_A_URL)
  const upStateB = await readState(NODE_B_URL)

  check(
    'up.state.b.preconditionAbsent',
    `${upKey} was ABSENT from node-b before this proposal — otherwise a pass on the peer write proves nothing about AMENDMENT 1 (b)`,
    // `null` is this harness's word for NO ANSWER, so an absence that was MEASURED
    // is printed as the word `absent` and never as the same token.
    firstChoice ? (firstChoice.onB === null ? 'absent' : firstChoice.onB) : null,
    firstChoice ? firstChoice.onB === null : null,
    firstChoice ? `node-b held ${firstChoice.onB === null ? 'no entry' : render(firstChoice.onB)} for this key at preflight; mode ${render(upMode)}` : 'the key selection failed, so there is nothing to have been absent',
  )
  check(
    'up.state.a.committed',
    `${upKey} = ${upValue} in node-a's committed map`,
    upStateA.state ? (upStateA.state.committed ? upStateA.state.committed[upKey] ?? null : null) : null,
    upStateA.state ? Boolean(upStateA.state.committed) && upStateA.state.committed[upKey] === upValue : null,
    upStateA.state ? undefined : `state probe did not answer: ${upStateA.error ?? upStateA.parseError}`,
  )
  check(
    'up.state.b.committed',
    `${upKey} = ${upValue} in node-b's committed map (a commit the peer never recorded is a FINDING)`,
    upStateB.state ? (upStateB.state.committed ? upStateB.state.committed[upKey] ?? null : null) : null,
    upStateB.state ? Boolean(upStateB.state.committed) && upStateB.state.committed[upKey] === upValue : null,
    upStateB.state ? undefined : `state probe did not answer: ${upStateB.error ?? upStateB.parseError}`,
  )
  check(
    'up.state.a.nodeId',
    NODE_A_ID,
    upStateA.state ? upStateA.state.nodeId : null,
    upStateA.state ? upStateA.state.nodeId === NODE_A_ID : null,
  )
  check(
    'up.state.b.nodeId',
    NODE_B_ID,
    upStateB.state ? upStateB.state.nodeId : null,
    upStateB.state ? upStateB.state.nodeId === NODE_B_ID : null,
  )

  actions.push(`DIRECTION 1 (both up): propose(${upKey}) -> ${render(upOutcome)} votes ${upProposal.result ? `${upProposal.result.votes}/${upProposal.result.of}` : 'no answer'}`)
  actions.push(`DIRECTION 1 committed maps: node-a ${upStateA.state ? render(upStateA.state.committed) : 'no answer'} | node-b ${upStateB.state ? render(upStateB.state.committed) : 'no answer'}`)

  /**
   * A DIAGNOSTIC LINE FOR THE FALSIFYING CASE, and it is a NOTE rather than a
   * check on purpose: `peer.lastAnswer` is the node's own account of the last
   * wire exchange, so it names WHERE a refusal came from. When a proposal is
   * refused this line is what distinguishes "the peer refused its vote" from "the
   * peer answered and the client could not read the answer" — two causes that
   * produce the same outcome string and need completely different repairs.
   */
  if (upOutcome !== 'committed') {
    const peerAccountA = upStateA.state && upStateA.state.peer ? upStateA.state.peer.lastAnswer : null
    const peerAccountB = upStateB.state && upStateB.state.peer ? upStateB.state.peer.lastAnswer : null
    note(
      `DIAGNOSTIC for the refused commit: node-a's own peer account is ${render(peerAccountA)}; node-b's is ${render(peerAccountB)}. The value 'answered-without-endorsement' means a 2xx arrived whose body the client could not read as an endorsement — a wire-shape defect, NOT a peer refusing. Compare it against the DIRECT endorse probe in direction 4a: if that probe is accepted while this proposal is refused, the endorsement route is healthy and the client's reader of it is not.`,
    )
  }

  // --- Direction 2: node-b stopped -> quorum-lost --------------------------
  //
  // ORDER IS LOAD-BEARING: the peer must be MEASURED gone before the proposal is
  // sent. A proposal to a peer that is still up would commit 2 of 2 and destroy
  // the test it is supposed to produce.

  const mapBefore = upStateA.state ? JSON.stringify(upStateA.state.committed ?? null) : null

  const stopResult = compose(['stop', 'node-b'], 180_000)
  if (stopResult.ok) stoppedPeer = true
  check(
    'down.stop.exit',
    'docker compose stop node-b exits 0',
    stopResult.exitCode,
    stopResult.ok,
    stopResult.ok ? `${stopResult.ms}ms` : stopResult.output.split('\n').slice(0, 6).join(' | '),
  )
  actions.push(`docker compose stop node-b -> exit ${stopResult.exitCode} in ${stopResult.ms}ms`)

  const stopped = await waitUntilUnreachable(NODE_B_URL, STOP_UNREACHABLE_WAIT_MS)
  check(
    'down.b.unreachable',
    'node-b no longer answers (a refused connection: absence PROBED, not inferred)',
    stopped.unreachable ? 'unreachable' : stopped.last.answered ? `still answered HTTP ${stopped.last.status}` : 'unreachable',
    stopped.unreachable,
    stopped.unreachable ? undefined : 'the peer never stopped answering; step 2 cannot be measured and no proposal was sent',
  )

  if (!stopped.unreachable) {
    note(
      'STEP 2 NOT MEASURED: node-b was stopped (compose exit recorded above) but kept answering, so no proposal was sent. Sending one would have committed 2 of 2 and turned the quorum-lost test into a false pass. The peer will be restored in the finally block.',
    )
    return { preflightFailed: false, aborted: 'node-b did not stop answering' }
  }

  const downKey = keySecond
  /**
   * DIRECTION 2 MUST BE A PROPOSAL THAT WOULD COMMIT IF THE PEER WERE UP. On a warm
   * fleet a key already carrying a value cannot take a second, different one —
   * AMENDMENT 1 (d) refuses it — so proposing a fresh value here would measure the
   * REFUSAL path and call the result `quorum-lost` for the wrong reason. Where the
   * key is already held, its own value is proposed: the commit path is then
   * idempotent rather than novel, and the direction still separates "peer answered"
   * from "peer did not", which is the only thing it exists to separate. The mode is
   * printed with the direction so a reader can weigh it.
   */
  const secondChoiceEntry = usable.find((entry) => entry.key === keySecond) ?? null
  const downValue = secondChoiceEntry && secondChoiceEntry.onA !== null ? secondChoiceEntry.onA : valueFor('down-quorum-lost')
  const downMode = secondChoiceEntry && secondChoiceEntry.onA !== null ? 'idempotent-recommit (this key already held this value on node-a)' : 'fresh-commit'
  const downProposal = await propose(NODE_A_URL, downKey, downValue)
  const downOutcome = downProposal.result ? downProposal.result.outcome : null

  check(
    'down.propose.outcome',
    'quorum-lost',
    downProposal.result ? downOutcome : null,
    downProposal.result ? downOutcome === 'quorum-lost' : null,
    downProposal.result ? `propose shape: ${downProposal.shape}` : `propose did not answer: ${downProposal.error ?? downProposal.parseError}`,
  )
  check(
    'down.propose.votes',
    '1',
    downProposal.result ? downProposal.result.votes : null,
    downProposal.result ? downProposal.result.votes === 1 : null,
  )
  check(
    'down.propose.peerReason',
    'a non-empty peerReason explaining the absent vote',
    downProposal.result ? downProposal.result.peerReason ?? null : null,
    downProposal.result ? typeof downProposal.result.peerReason === 'string' && downProposal.result.peerReason.length > 0 : null,
  )

  const downStateA = await readState(NODE_A_URL)
  const mapAfter = downStateA.state ? JSON.stringify(downStateA.state.committed ?? null) : null
  const afterMap = downStateA.state ? downStateA.state.committed ?? {} : null
  const downKeyAfter = afterMap === null ? null : Object.prototype.hasOwnProperty.call(afterMap, downKey) ? afterMap[downKey] : null

  /**
   * THE EXPECTATION DEPENDS ON WHETHER THE PROPOSAL WAS NOVEL, and the difference is
   * not cosmetic. A FRESH proposal that cannot reach quorum must leave the key
   * ABSENT — that is the strong statement. An IDEMPOTENT proposal (the key already
   * held exactly this value on the proposer) must leave the value UNCHANGED, and
   * "the key is absent" would be a false expectation that fails a correct node. The
   * mode is printed in the expectation itself so a reader can tell which of the two
   * statements this run actually tested, instead of assuming the stronger one.
   */
  const downIsIdempotent = downMode.startsWith('idempotent')
  check(
    'down.state.value.notNew',
    downIsIdempotent
      ? `${downKey} still holds its pre-existing value ${downValue} (an idempotent proposal that could not reach quorum must not alter it)`
      : `${downKey} is NOT in the committed map (a proposal that could not reach quorum must write nothing)`,
    afterMap === null ? null : downKeyAfter === null ? 'absent' : downKeyAfter,
    afterMap === null ? null : downIsIdempotent ? downKeyAfter === downValue : downKeyAfter === null,
    afterMap === null
      ? `state probe did not answer: ${downStateA.error ?? downStateA.parseError}`
      : downIsIdempotent
        ? 'mode idempotent-recommit: the ABSENCE test is not applicable to a key that was already committed, so it is recorded as a value-unchanged test instead'
        : undefined,
  )
  check(
    'down.state.map.unchanged',
    'the committed map is byte-identical to the map recorded before the stop',
    downStateA.state ? (mapAfter === mapBefore ? 'unchanged' : 'MOVED') : null,
    downStateA.state && mapBefore !== null ? mapAfter === mapBefore : null,
    downStateA.state ? `before ${mapBefore} / after ${mapAfter}` : `state probe did not answer: ${downStateA.error ?? downStateA.parseError}`,
  )

  actions.push(`DIRECTION 2 (node-b stopped, ${downMode}): propose(${downKey}) -> ${render(downOutcome)} votes ${downProposal.result ? `${downProposal.result.votes}/${downProposal.result.of}` : 'no answer'} peerReason ${downProposal.result ? render(downProposal.result.peerReason ?? null) : 'n/a'}`)
  actions.push(`DIRECTION 2 committed map BEFORE: ${mapBefore}`)
  actions.push(`DIRECTION 2 committed map AFTER:  ${mapAfter}`)

  // --- Direction 3: node-b restarted -> the same key commits ---------------

  const restart = compose(['start', 'node-b'], 180_000)
  if (restart.ok) stoppedPeer = false
  actions.push(`docker compose start node-b -> exit ${restart.exitCode} in ${restart.ms}ms`)
  if (!restart.ok) {
    note(`RESTART command failed (exit ${restart.exitCode}): ${restart.output.split('\n').slice(0, 6).join(' | ')}. The finally block will retry the restore.`)
  }

  const restored = await waitUntilHealthy(NODE_B_URL, RESTART_HEALTHY_WAIT_MS)
  check(
    'restart.b.health',
    'node-b answers 200 again after `docker compose start node-b`',
    restored.healthy ? 'HTTP 200' : restored.last.answered ? `HTTP ${restored.last.status}` : null,
    restored.healthy,
    restored.last.answered ? `waited ${restored.elapsedMs}ms` : `no answer: ${restored.last.error}`,
  )

  if (!restored.healthy) {
    note('STEP 3 NOT MEASURED: node-b did not come back healthy, so the restart direction was not exercised. The finally block will attempt the restore once more and report whether the fleet was left as found.')
    return { preflightFailed: false, aborted: 'node-b did not return healthy' }
  }

  const backProposal = await propose(NODE_A_URL, downKey, downValue)
  const backOutcome = backProposal.result ? backProposal.result.outcome : null

  check(
    'restart.propose.outcome',
    'committed',
    backProposal.result ? backOutcome : null,
    backProposal.result ? backOutcome === 'committed' : null,
    backProposal.result
      ? `propose shape: ${backProposal.shape}; peerReason: ${render(backProposal.result.peerReason ?? '(none)')}`
      : `propose did not answer: ${backProposal.error ?? backProposal.parseError}`,
  )
  check(
    'restart.propose.votes',
    '2',
    backProposal.result ? backProposal.result.votes : null,
    backProposal.result ? backProposal.result.votes === 2 : null,
  )

  const backStateA = await readState(NODE_A_URL)
  const backStateB = await readState(NODE_B_URL)
  const valueOnA = backStateA.state && backStateA.state.committed ? backStateA.state.committed[downKey] ?? null : null
  const valueOnB = backStateB.state && backStateB.state.committed ? backStateB.state.committed[downKey] ?? null : null

  check(
    'restart.state.a.committed',
    `${downKey} = ${downValue} in node-a`,
    backStateA.state ? valueOnA : null,
    backStateA.state ? valueOnA === downValue : null,
  )
  check(
    'restart.state.b.committed',
    `${downKey} = ${downValue} in node-b`,
    backStateB.state ? valueOnB : null,
    backStateB.state ? valueOnB === downValue : null,
  )

  /**
   * A RESTARTED NODE FORGETS, AND FORGETTING IS NOT DIVERGING — they must not be
   * reported as the same thing. `committed` is process memory with no persistence,
   * so after node-b restarts it can only hold entries committed while it was up;
   * a check demanding `node-a === node-b` would therefore be RED for a legitimate
   * design and would hide the case that actually matters.
   *
   * The check asserts the STRUCTURE of an acceptable difference instead:
   *   - NO key may exist on node-b that node-a does not have (that would be a
   *     truth invented on the peer);
   *   - every key they SHARE must carry the SAME value (a shared key with two
   *     values is the split brain of finding F3);
   *   - node-b must hold at least one entry, or the comparison is between
   *     emptiness and something, which proves nothing.
   * A key node-a has and node-b lacks is then recorded as a NOTE — the honest
   * statement that committed state does not survive a restart — rather than
   * disguised as agreement.
   */
  const mapA = backStateA.state ? backStateA.state.committed ?? {} : null
  const mapB = backStateB.state ? backStateB.state.committed ?? {} : null
  let consistency = null
  if (mapA !== null && mapB !== null) {
    const onlyOnA = Object.keys(mapA).filter((key) => !Object.prototype.hasOwnProperty.call(mapB, key))
    const onlyOnB = Object.keys(mapB).filter((key) => !Object.prototype.hasOwnProperty.call(mapA, key))
    const valueConflicts = Object.keys(mapB)
      .filter((key) => Object.prototype.hasOwnProperty.call(mapA, key) && mapA[key] !== mapB[key])
      .map((key) => ({ key, 'node-a': mapA[key], 'node-b': mapB[key] }))
    consistency = { onlyOnA, onlyOnB, valueConflicts, nodeBEntries: Object.keys(mapB).length }
  }
  const consistent =
    consistency === null
      ? null
      : consistency.onlyOnB.length === 0 && consistency.valueConflicts.length === 0 && consistency.nodeBEntries > 0
  check(
    'restart.state.maps.consistent',
    'no entry exists only on node-b; every shared entry has the same value; node-b holds at least one entry (a forgotten entry is a NOTE, a shared key with two values is a defect)',
    consistency === null ? null : consistent ? 'consistent' : consistency,
    consistent,
    consistency === null
      ? `a state probe did not answer: ${(backStateA.error ?? backStateB.error) ?? 'unknown'}`
      : consistent
        ? consistency.onlyOnA.length > 0
          ? `node-b is a strict subset: it lacks ${consistency.onlyOnA.join(', ')}, committed before its restart — committed state is process memory and did not survive`
          : 'both maps hold the same entries with the same values'
        : 'see the structured difference; a key only on node-b or a shared key with two values is a divergence, not a forgotten entry',
  )

  actions.push(`DIRECTION 3 (node-b back): propose(${downKey}) -> ${render(backOutcome)} votes ${backProposal.result ? `${backProposal.result.votes}/${backProposal.result.of}` : 'no answer'}`)
  actions.push(`DIRECTION 3 committed maps: node-a ${backStateA.state ? render(backStateA.state.committed) : 'no answer'} | node-b ${backStateB.state ? render(backStateB.state.committed) : 'no answer'}`)

  // --- Direction 4: the disagreement path ----------------------------------
  //
  // Two things are attempted, and they are DIFFERENT pieces of evidence.
  //
  //  (a) the peer's refusal PRIMITIVE, driven directly against the REAL peer:
  //      one matching-term endorsement (must be accepted) and one wrong-term
  //      endorsement (must be refused with a reason). This proves the real peer
  //      can say no — which is the only thing `rejected-peer-disagrees` depends on.
  //
  //  (b) a CONTRADICTING PROPOSAL for an already-committed key, driven through
  //      the real propose path. Whether it lands as `rejected-peer-disagrees` is
  //      measured, not assumed: `endorse` refuses on TERM mismatch in the
  //      contract, and a value mismatch is only refusable if the implementation
  //      also compares values. Both outcomes are informative — the string is a
  //      pass, and an overwrite is a FINDING about last-write-wins, printed as one.
  //
  // If (b) does not produce the string, a NOT-DONE line says so in terms, and
  // says the full outcome was exercised ONLY against the unit fake in task-5.

  const bState = await readState(NODE_B_URL)
  const bTerm = bState.state ? bState.state.term : null

  const matching = bState.state && typeof bTerm === 'number' ? await endorse(NODE_B_URL, downKey, downValue, bTerm) : null
  check(
    'dis.endorse.matching.accepted',
    'accepted: true for the SAME key, value and term',
    matching && matching.result ? matching.result.accepted ?? null : null,
    matching && matching.result ? matching.result.accepted === true : null,
    matching && matching.result ? `reason ${render(matching.result.reason ?? null)}` : `endorse probe did not answer: ${matching ? matching.error ?? matching.parseError : 'peer term unknown'}`,
  )

  const wrongTerm = bState.state && typeof bTerm === 'number' ? await endorse(NODE_B_URL, downKey, downValue, bTerm + 7) : null
  check(
    'dis.endorse.wrongTerm.accepted',
    'accepted: false for a term that does not match (the peer must be ABLE to refuse)',
    wrongTerm && wrongTerm.result ? wrongTerm.result.accepted ?? null : null,
    wrongTerm && wrongTerm.result ? wrongTerm.result.accepted === false : null,
    wrongTerm && wrongTerm.result ? `reason ${render(wrongTerm.result.reason ?? null)}` : `endorse probe did not answer: ${wrongTerm ? wrongTerm.error ?? wrongTerm.parseError : 'peer term unknown'}`,
  )

  // (b) the contradicting proposal: same key, DIFFERENT value, on the OTHER node.
  const contradictionValue = valueFor('contradicts')
  const contradiction = await propose(NODE_B_URL, downKey, contradictionValue)
  const contradictionOutcome = contradiction.result ? contradiction.result.outcome : null
  const contradictionPeerReason = contradiction.result ? contradiction.result.peerReason ?? null : null

  check(
    'dis.propose.outcome.oneOfFour',
    `one of ${OUTCOMES.join(' | ')}`,
    contradiction.result ? contradictionOutcome : null,
    contradiction.result ? OUTCOMES.includes(contradictionOutcome) : null,
    contradiction.result ? `propose shape: ${contradiction.shape}` : `propose did not answer: ${contradiction.error ?? contradiction.parseError}`,
  )

  /**
   * THE OUTCOME STRING ALONE IS NOT PROOF OF A DISAGREEMENT, and this check exists
   * because the first version of this file published the opposite claim. In that
   * run the contradicting proposal DID return `rejected-peer-disagrees` — but the
   * peerReason said the answer "carried no endorsement", i.e. it was the same
   * wire-shape defect that refused every other proposal, not a value mismatch.
   * The note below then said the disagreement path was proved end-to-end. It was
   * not: the right string had been produced by the wrong cause, and only the
   * reason field distinguished them. A string is a caption until something reads
   * what produced it.
   */
  const reasonIsARealRefusal =
    contradictionOutcome === 'rejected-peer-disagrees' &&
    typeof contradictionPeerReason === 'string' &&
    !/carry no endorsement|carries no endorsement|no endorsement/i.test(contradictionPeerReason)
  check(
    'dis.propose.rejectKind',
    'the rejection is a DISAGREEMENT (the peer refused its vote or endorsed a different value), not a 2xx whose body was unreadable',
    contradiction.result ? (contradictionOutcome === 'rejected-peer-disagrees' ? contradictionPeerReason : contradictionOutcome) : null,
    contradiction.result ? reasonIsARealRefusal : null,
    contradiction.result
      ? reasonIsARealRefusal
        ? 'the peerReason names a refusal or a mismatch, so the string was produced by a disagreement'
        : 'the peerReason does not name a disagreement; see the NOT-DONE note below'
      : `propose did not answer: ${contradiction.error ?? contradiction.parseError}`,
  )

  // Whatever the outcome, the two nodes must not END the attempt disagreeing
  // about the key: a split-brain left behind by a contradicting proposal is a
  // finding about the consensus, not a detail of the transcript.
  const afterContradictionA = await readState(NODE_A_URL)
  const afterContradictionB = await readState(NODE_B_URL)
  const contradictA = afterContradictionA.state && afterContradictionA.state.committed ? afterContradictionA.state.committed[downKey] ?? null : null
  const contradictB = afterContradictionB.state && afterContradictionB.state.committed ? afterContradictionB.state.committed[downKey] ?? null : null
  check(
    'dis.state.bothAgree',
    `both nodes report the same value for ${downKey} after the contradicting proposal`,
    afterContradictionA.state && afterContradictionB.state ? { 'node-a': contradictA, 'node-b': contradictB } : null,
    afterContradictionA.state && afterContradictionB.state ? contradictA !== null && contradictA === contradictB : null,
  )

  actions.push(`DIRECTION 4a (real peer endorse): matching term accepted ${matching && matching.result ? render(matching.result.accepted) : 'no answer'}; wrong term accepted ${wrongTerm && wrongTerm.result ? render(wrongTerm.result.accepted) : 'no answer'}`)
  actions.push(`DIRECTION 4b (contradicting propose on node-b for an already-committed key): ${render(contradictionOutcome)}; values after: node-a ${render(contradictA)}, node-b ${render(contradictB)}`)

  if (!reasonIsARealRefusal) {
    note(
      `NOT DONE, stated plainly: \`rejected-peer-disagrees\` was NOT driven end-to-end AS A DISAGREEMENT by this run. The contradicting proposal returned ${render(contradictionOutcome)} with peerReason ${render(contradictionPeerReason)} — a string produced by a peer ANSWER THAT COULD NOT BE READ, not by a peer refusing its vote. The full disagreement outcome was therefore exercised ONLY against the unit fake in task-5 (consensus-core's consensus-unit.mjs). What this run does establish about the refusal primitive: direction 4a drove the REAL peer's endorse route directly and it accepted a matching term and refused a wrong term, so the peer can say no; what is NOT established is the propose path mapping that refusal to the string.`,
    )
  } else {
    note('DIRECTION 4 IS END-TO-END AS A DISAGREEMENT: the contradicting proposal produced `rejected-peer-disagrees` against the REAL peer with a peerReason that names a refusal or a mismatch, so the string was produced by the peer saying no rather than by an unreadable answer.')
  }

  // --- Direction 5: the closed key space -----------------------------------
  //
  // AMENDMENT 1 (a) exists because the committed map is REPUBLISHED by
  // `GET /node/consensus/state`, so any string admitted to it is data the node
  // preserves. The gate is structural — a closed vocabulary — and a gate that has
  // never been driven against a non-member key has not been shown to close. So it
  // is driven here with a key that looks exactly like the payload the amendment
  // was written to refuse.

  const intruderKey = 'user-email'
  const intruderValue = valueFor('intruder')
  const intruder = await propose(NODE_A_URL, intruderKey, intruderValue)
  const intruderOutcome = intruder.result ? intruder.result.outcome : null

  check(
    'vocab.propose.outcome',
    'refused-non-meta-key',
    intruder.result ? intruderOutcome : null,
    intruder.result ? intruderOutcome === 'refused-non-meta-key' : null,
    intruder.result ? `peerReason: ${render(intruder.result.peerReason ?? '(none)')}` : `propose did not answer: ${intruder.error ?? intruder.parseError}`,
  )
  check(
    'vocab.propose.votes',
    '0 (a refusal is not a vote, partial or otherwise)',
    intruder.result ? intruder.result.votes : null,
    intruder.result ? intruder.result.votes === 0 : null,
  )

  const afterIntruder = await readState(NODE_A_URL)
  check(
    'vocab.state.absent',
    `${intruderKey} is NOT in the committed map after the refusal`,
    afterIntruder.state ? Object.prototype.hasOwnProperty.call(afterIntruder.state.committed ?? {}, intruderKey) : null,
    afterIntruder.state ? Object.prototype.hasOwnProperty.call(afterIntruder.state.committed ?? {}, intruderKey) === false : null,
    afterIntruder.state ? undefined : `state probe did not answer: ${afterIntruder.error ?? afterIntruder.parseError}`,
  )

  actions.push(`DIRECTION 5 (closed key space): propose(${intruderKey}) -> ${render(intruderOutcome)} votes ${intruder.result ? intruder.result.votes : 'no answer'}`)

  return { preflightFailed: false }
}

// ---------------------------------------------------------------------------
// The restore — in a `finally`, because the happy path is not where it matters
// ---------------------------------------------------------------------------

async function restore() {
  if (!stoppedPeer) {
    // Nothing was stopped, but node-b may still be down from an EARLIER failed
    // run; asking whether the fleet is as we found it is the point, so it is
    // probed either way rather than assumed.
    const probe = await probeHealth(NODE_B_URL)
    check(
      'finally.b.restored',
      'node-b answers 200 (never stopped by this run, and not left down)',
      probe.answered ? `HTTP ${probe.status}` : null,
      probe.answered ? probe.status === 200 : null,
      probe.answered ? undefined : `node-b did not answer at the end of the run: ${probe.error}`,
    )
  } else {
    const started = compose(['start', 'node-b'], 180_000)
    actions.push(`finally: docker compose start node-b -> exit ${started.exitCode} in ${started.ms}ms`)
    if (started.ok) stoppedPeer = false
    const healthy = await waitUntilHealthy(NODE_B_URL, RESTART_HEALTHY_WAIT_MS)
    check(
      'finally.b.restored',
      'node-b answers 200 after the finally-block restart',
      healthy.healthy ? 'HTTP 200' : healthy.last.answered ? `HTTP ${healthy.last.status}` : null,
      healthy.healthy,
      healthy.last.answered ? `waited ${healthy.elapsedMs}ms` : `no answer: ${healthy.last.error}`,
    )
  }

  const probeA = await probeHealth(NODE_A_URL)
  check(
    'finally.a.healthy',
    'node-a still answers 200 (this run never touched it)',
    probeA.answered ? `HTTP ${probeA.status}` : null,
    probeA.answered ? probeA.status === 200 : null,
    probeA.answered ? undefined : `node-a did not answer at the end of the run: ${probeA.error}`,
  )
}

// ---------------------------------------------------------------------------
// Report and exit
// ---------------------------------------------------------------------------

/**
 * The verdict arithmetic, as a PURE function of the recorded checks.
 *
 * It is separated from `report()` for one reason: `--selftest` drives THIS
 * function with synthetic entries, so the thing that decides green-or-red is the
 * thing under test. A verdict computed inline in a printer is a verdict nobody can
 * test without printing.
 */
function summarize(entries, required) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const missing = required.filter((id) => !byId.has(id))
  // The numerator is over the DECLARED population only. A record outside
  // `REQUIRED_CHECKS` is an ad-hoc observation, and letting it into the numerator
  // would let the denominator drift downward while the ratio stayed at 100%.
  const requiredPassed = required.filter((id) => byId.get(id) && byId.get(id).ok === true).length
  const failed = entries.filter((entry) => entry.ok === false).length
  const unanswered = entries.filter((entry) => entry.ok === null).length
  const extraIds = entries.filter((entry) => !required.includes(entry.id)).map((entry) => entry.id)
  return {
    passed: requiredPassed,
    failed,
    unanswered,
    missing,
    extraIds,
    requiredCount: required.length,
    recordedCount: byId.size,
    green: missing.length === 0 && failed === 0 && unanswered === 0 && requiredPassed === required.length,
  }
}

function report() {
  console.log('')
  console.log('='.repeat(78))
  console.log('CONSENSUS HARNESS — two-node evidence, one recorded run')
  console.log('='.repeat(78))
  console.log('')

  console.log('ACTIONS TAKEN AGAINST THE FLEET')
  for (const action of actions) console.log(`  - ${action}`)
  console.log('')

  console.log('TRANSCRIPT (observed vs expected, one line per check)')
  for (const entry of results) {
    const tag = entry.ok === true ? 'PASS' : entry.ok === false ? 'FAIL' : 'INSTRUMENT-FAILURE'
    console.log(`  [${tag}] ${entry.id}`)
    console.log(`          expected: ${entry.expected}`)
    console.log(`          observed: ${entry.observed}`)
    if (entry.note) console.log(`          note:     ${entry.note}`)
  }
  console.log('')

  if (notes.length > 0) {
    console.log('NOTES (not checks — never counted in the totals below)')
    for (const item of notes) console.log(`  - ${item}`)
    console.log('')
  }

  const summary = summarize(results, REQUIRED_CHECKS)

  console.log('SUMMARY')
  console.log(`  checks passed:            ${summary.passed} / ${summary.requiredCount}`)
  console.log(`  checks failed:            ${summary.failed}`)
  console.log(`  checks that got NO answer: ${summary.unanswered}  (instrument failure — counted as NOT passed)`)
  console.log(`  checks recorded:          ${summary.recordedCount} / ${summary.requiredCount} required`)
  if (summary.missing.length > 0) {
    console.log(`  CHECKS THAT NEVER RAN:    ${summary.missing.join(', ')}`)
    console.log('  A check that did not run is not a check that passed; this run is RED on that alone.')
  }
  if (summary.extraIds.length > 0) {
    console.log(`  ad-hoc records (not in the required population, not counted as passes): ${summary.extraIds.join(', ')}`)
  }
  // The "fleet left as found" caption is DERIVED from the restore check, not from
  // this harness's own belief about what it did. The first version printed "yes"
  // while node-b was refusing connections — a caption contradicting a check two
  // lines above it, which is the exact defect this program keeps paying for.
  const restoredEntry = results.find((entry) => entry.id === 'finally.b.restored')
  const fleetLine =
    restoredEntry === undefined
      ? 'UNKNOWN — the restore probe never ran (instrument failure)'
      : restoredEntry.ok === true
        ? 'yes — node-b answers 200 at the end of the run'
        : restoredEntry.ok === false
          ? `NO — node-b answered ${restoredEntry.observed}, not 200`
          : 'NO READING — node-b did not answer the restore probe (instrument failure, NOT a clean fleet)'
  console.log(`  fleet left as found:      ${fleetLine}`)
  console.log('')

  console.log(`VERDICT: ${summary.green ? 'GREEN' : 'RED'}`)
  console.log('')
  return summary
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * `--selftest` — MUTATION AGAINST THIS HARNESS'S OWN INSTRUMENTS.
 *
 * A harness that has only ever printed PASS has not been shown able to print
 * anything else. Each case below moves ONE value in a synthetic record and
 * requires the verdict to move with it; if a case does not behave as declared,
 * the selftest itself is red. This is why the verdict lives in `summarize()` and
 * not inline in the printer: the thing under test is the function that decides.
 *
 * It touches no container and no network.
 */
function selftest() {
  const cases = []
  const expectCase = (name, condition, detail) => cases.push({ name, ok: Boolean(condition), detail })

  const required = ['a', 'b']
  const greenEntries = [
    { id: 'a', expected: 'x', observed: 'x', ok: true },
    { id: 'b', expected: 'y', observed: 'y', ok: true },
  ]

  // Case 0: the control. A green record MUST read green, or every case below is vacuous.
  expectCase('control: two passing checks are GREEN', summarize(greenEntries, required).green === true, JSON.stringify(summarize(greenEntries, required)))

  // Case 1: move one observed value to a disagreement. The verdict must go RED and must name one FAIL.
  const wrong = [greenEntries[0], { id: 'b', expected: 'y', observed: 'NOT y', ok: false }]
  const wrongSummary = summarize(wrong, required)
  expectCase('mutation 1: a disagreeing check is RED', wrongSummary.green === false && wrongSummary.failed === 1, JSON.stringify(wrongSummary))

  // Case 2: a probe that got NO ANSWER is `null`, and it must be counted as
  // NOT PASSED. The classic defect is collapsing it into either neighbour.
  const unanswered = [greenEntries[0], { id: 'b', expected: 'y', observed: 'null', ok: null }]
  const unansweredSummary = summarize(unanswered, required)
  expectCase(
    'mutation 2: an unanswered check is RED and NOT counted as passed',
    unansweredSummary.green === false && unansweredSummary.unanswered === 1 && unansweredSummary.passed === 1,
    JSON.stringify(unansweredSummary),
  )

  // Case 3: a check that never ran. Two passing records for two required ids is
  // green; dropping one id must fail the run even though nothing disagreed.
  const missing = summarize([greenEntries[0]], required)
  expectCase(
    'mutation 3: a check that never ran fails the run',
    missing.green === false && missing.missing.length === 1 && missing.missing[0] === 'b',
    JSON.stringify(missing),
  )

  // Case 4: the transcript must distinguish `null` from `false`. Two values would
  // otherwise print the same word, and an unprobed surface would read as a clean one.
  expectCase('mutation 4: null renders as "null", false renders as "false"', render(null) === 'null' && render(false) === 'false', `${render(null)} vs ${render(false)}`)

  // Case 5: an ad-hoc record outside the required population must be NAMED, not
  // counted. It may not enter the numerator (that would inflate a ratio whose
  // denominator is fixed) and it may not turn a green run red merely by existing.
  const oversized = summarize([...greenEntries, { id: 'c', expected: '', observed: '', ok: true }], required)
  expectCase(
    'mutation 5: an extra passing record is named and does not inflate the numerator',
    oversized.green === true && oversized.passed === 2 && oversized.extraIds.length === 1 && oversized.extraIds[0] === 'c',
    JSON.stringify(oversized),
  )

  // Case 6: an extra record that FAILED must still fail the run — extras are not
  // exempt from the verdict, they are only excluded from the denominator.
  const extraFailure = summarize([...greenEntries, { id: 'c', expected: '', observed: '', ok: false }], required)
  expectCase('mutation 6: an extra record that failed still fails the run', extraFailure.green === false && extraFailure.failed === 1, JSON.stringify(extraFailure))

  const failed = cases.filter((entry) => !entry.ok)
  console.log('CONSENSUS HARNESS SELFTEST — the instruments, driven against values they must refuse')
  for (const entry of cases) console.log(`  [${entry.ok ? 'PASS' : 'FAIL'}] ${entry.name}\n          ${entry.detail}`)
  console.log('')
  console.log(`SELFTEST: ${failed.length === 0 ? 'OK' : 'BROKEN'} — ${cases.length - failed.length} / ${cases.length} cases behaved as declared`)
  console.log('')
  process.exitCode = failed.length === 0 ? 0 : 1
}

async function main() {
  if (process.argv.includes('--selftest')) {
    selftest()
    return
  }

  let outcome = { preflightFailed: false }
  try {
    outcome = await run()
  } catch (error) {
    // A thrown harness bug must not leave node-b stopped, and it must not read as
    // a product failure: it is recorded as instrument failure and the run is red.
    results.push({
      id: 'harness.exception',
      expected: 'the harness completes without throwing',
      observed: String(error && error.stack ? error.stack.split('\n')[0] : error),
      ok: null,
    })
  } finally {
    try {
      await restore()
    } catch (error) {
      results.push({
        id: 'finally.restore.threw',
        expected: 'the restore block completes',
        observed: String(error && error.stack ? error.stack.split('\n')[0] : error),
        ok: null,
      })
    }
  }

  const summary = report()

  if (outcome.preflightFailed) {
    console.log('EXIT 2 — the fleet was not reachable, so NOTHING about the consensus was measured. This is instrument failure about the TOPOLOGY.')
    process.exitCode = 2
    return
  }
  process.exitCode = summary.green ? 0 : 1
}

await main()
