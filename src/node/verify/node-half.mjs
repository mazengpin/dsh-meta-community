/**
 * ============================================================================
 * THE NODE-HALF HARNESS — it drives a RUNNING node, never the source text
 * ============================================================================
 *
 * Modelled on `src/host/verify/host-half.mjs`, and it keeps that suite's two hard
 * lessons rather than only its shape:
 *
 *  1. **A HARNESS IS A PROGRAM, AND ITS EXIT CODE IS READ DIRECTLY.** `tsc` does not
 *     typecheck a `.mjs` file, so an undefined identifier here throws at run time
 *     and `38 of 38 PASS` is still printed by whatever ran before it. This file is
 *     run on every change and its exit code is read without a pipe.
 *  2. **IT ASSERTS ON THE SERIALISED PAYLOAD.** `JSON.parse(JSON.stringify(x))` is
 *     the boundary this file reads, because a `Set`, `Map` or `RegExp` serialises
 *     to `{}` with no error (`D-0071`): the in-memory object looks correct while
 *     the served body has lost the value.
 *
 * **AND IT ASSERTS ITS OWN CHECK POPULATION.** A check whose input is missing is
 * OMITTED rather than refused in most suites, and a check that disappears reads
 * exactly like a check that passed. So every check id is declared up front in
 * `DEFINED_CHECKS`, `check()` refuses an id that is not declared, and `H1` FAILS
 * when any declared id never ran. The three structural checks `H1..H3` are the
 * part of this file whose subject is this file.
 *
 * **THE SUBJECT IS A LISTENER, AND THE SUITE SAYS WHICH ONE.** Primary path is an
 * IN-PROCESS node started through the real `startNode()` with `PORT=0`, so the
 * suite exercises the same assembly a container does — config, both snapshot
 * loaders, consensus, the dispatcher and the 404 body. If the in-process start is
 * blocked (peer modules not yet landed), the suite FALLS BACK to the live container
 * on 18091 and says so in `A1`, because a suite that quietly drove something other
 * than it claims is worse than a suite that admits the substitution.
 *
 * Run: `node src/node/verify/node-half.mjs` (Node 24 strips the node's types).
 *
 * @module dsh-meta-community/node/verify/node-half
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLONE = resolve(HERE, '..', '..', '..')
const SNAPSHOT_DIR = resolve(CLONE, 'docker', 'snapshots')
const LIVE_BASE = 'http://127.0.0.1:18091'

/* ---------------------------------------------------------------------------
 * THE CHECK POPULATION — declared before anything runs, so it can be audited
 * ------------------------------------------------------------------------ */

/**
 * Every check this suite defines, as `[id, title]`.
 *
 * **THIS LIST IS THE DENOMINATOR.** `H1` compares it against the ids that actually
 * ran, so deleting a `check()` call turns the suite RED rather than turning the
 * denominator down — the failure mode the program records as *a check that
 * disappears reads exactly like a pass*.
 */
const DEFINED_CHECKS = [
  ['A1', 'a node listener answered, and the mode is stated'],
  ['A2', 'allPaths() is 16 distinct of 16 expected, so a merged pair cannot hide as a shorter list'],
  ['A3', 'the six node paths and three consensus paths are exactly the contract strings'],
  ['A4', 'the path tables are frozen and allPaths() cannot be pushed onto'],
  ['B1', 'an unknown path answers 404'],
  ['B2', 'the 404 body states pathCount equal to allPaths().length'],
  ['B3', 'the 404 body lists EXACTLY allPaths() — nothing missing, nothing extra'],
  ['B4', 'the 404 body states the method it received and the nodeId that answered'],
  ['C1', 'every advertised path was driven, so no empty loop can pass'],
  ['C2', 'no advertised path returns 404'],
  ['C3', 'a non-zero number of paths actually served 200'],
  ['C4', 'a 405 states the method it received and the methods it allows'],
  ['C5', 'the POST-only paths answer non-404 when driven with POST'],
  ['D1', '/node/identity answers 200 and names its node'],
  ['D2', '/node/identity reports a term and a measured uptime'],
  ['D3', '/node/identity carries the intent snapshot identity'],
  ['D4', '/node/identity carries the meta-packages snapshot identity'],
  ['D5', 'every response carries the x-node-id header, including delegated ones'],
  ['E1', '/node/intent against the REAL snapshot dir reports available:true with bytes and sha256'],
  ['E2', '/node/intent against an EMPTY dir reports available:false with a non-null reason and null bytes/sha256'],
  ['E3', '/node/meta-packages against the REAL snapshot dir reports available:true with bytes and sha256'],
  ['E4', '/node/meta-packages against an EMPTY dir reports available:false with a non-null reason and null bytes/sha256'],
  ['E5', 'a node with an unavailable snapshot is still HEALTHY — absent is not down'],
  ['E6', 'the snapshot verifier refuses on MISMATCH, not on looking tampered — three driven states, with a recomputed-consistent document SERVED'],
  ['F1', '/node/session/probe reports retained as the number 0'],
  ['F2', 'the probe carries a digest WITH its algorithm, and the digest is 64 hex'],
  ['F3', 'two identical payloads produce DIFFERENT digests'],
  ['F4', 'droppedFields equals the payload\u2019s own top-level key count, so the payload was SEEN and dropped'],
  ['F5', 'the probe reports store:none, so the decision is stated as data'],
  ['F6', 'no set-cookie is issued by the probe'],
  ['F7', '/node/anonymity reports its zeros as a FLOOR with a reason, not as proof'],
  ['G1', '/meta-community/api/census still answers 200 through the node dispatcher'],
  ['G2', 'all 7 host paths answer non-404 through the node dispatcher'],
  ['G3', 'the delegated census still reports a community of ONE as plan, so delegation changed nothing'],
  ['H1', 'every DEFINED check ran — a missing check is a failure, not a pass'],
  ['H2', 'no check id ran twice, which would let one hide behind another'],
  ['H3', 'the printed totals agree with the recorded outcomes, so two encodings of one fact cannot disagree'],
]

const DEFINED_IDS = new Set(DEFINED_CHECKS.map(([id]) => id))

let declared = 0
let passed = 0
const failures = []
const ran = []
const duplicateIds = []
const unregisteredIds = []

function check(id, condition, detail = '') {
  if (!DEFINED_IDS.has(id)) {
    unregisteredIds.push(id)
    failures.push(`${id} (NOT DEFINED)`)
    console.log(`  FAIL  ${id} — this id is not in DEFINED_CHECKS, so its population is unaudited`)
    return
  }
  if (ran.includes(id)) duplicateIds.push(id)
  ran.push(id)
  declared += 1
  const title = DEFINED_CHECKS.find(([d]) => d === id)[1]
  if (condition) {
    passed += 1
    console.log(`  PASS  ${id} ${title}${detail ? ' — ' + detail : ''}`)
  } else {
    failures.push(id)
    console.log(`  FAIL  ${id} ${title}${detail ? ' — ' + detail : ''}`)
  }
}

/* ---------------------------------------------------------------------------
 * 0. REACH A LISTENER — in-process first, live container as a stated fallback
 * ------------------------------------------------------------------------ */

console.log('\n0. REACHING A NODE')

const MODE = { kind: 'in-process', reason: null }

let startNode
let closeNode
let loadIntentSnapshot
let loadMetaPackagesSnapshot
let auditPaths
let allPaths
let NODE_PATHS
let CONSENSUS_PATHS
let REGISTERED_PATHS
let startError = null

try {
  const indexMod = await import('../index.ts')
  startNode = indexMod.startNode
  closeNode = indexMod.closeNode
  const pathsMod = await import('../paths.ts')
  auditPaths = pathsMod.auditPaths
  allPaths = pathsMod.allPaths
  NODE_PATHS = pathsMod.NODE_PATHS
  CONSENSUS_PATHS = pathsMod.CONSENSUS_PATHS
  const intentMod = await import('../intent.ts')
  loadIntentSnapshot = intentMod.loadIntentSnapshot
  const metaMod = await import('../metaPackages.ts')
  loadMetaPackagesSnapshot = metaMod.loadMetaPackagesSnapshot
  const hostMod = await import('../../host/routes.ts')
  REGISTERED_PATHS = hostMod.REGISTERED_PATHS
} catch (err) {
  startError = err
  MODE.kind = 'live-18091'
  MODE.reason = err instanceof Error ? err.message : String(err)
  console.log(`  in-process import FAILED, falling back to the live node on 18091: ${MODE.reason}`)
}

/** An empty directory: the fixture that must produce available:false rather than a zero. */
const EMPTY_DIR = await mkdtemp(join(tmpdir(), 'node-half-empty-'))
/**
 * The real snapshot directory is NOT created here, deliberately: a suite that mkdirs
 * its own fixture cannot tell "the artifact was captured" from "the directory this
 * harness made exists". If it is absent, `E1`/`E3` go red with the path stated, and
 * the finding belongs to the capture lanes rather than to a fixture this file invented.
 */

let mainServer = null
let emptyServer = null
let mainBase = null
let emptyBase = null

if (MODE.kind === 'in-process') {
  try {
    const started = await startNode({ NODE_ID: 'probe-main', PORT: '0', SNAPSHOT_DIR })
    mainServer = started.server
    const address = mainServer.address()
    mainBase = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
  } catch (err) {
    MODE.kind = 'live-18091'
    MODE.reason = err instanceof Error ? err.message : String(err)
    console.log(`  in-process start FAILED, falling back to the live node on 18091: ${MODE.reason}`)
  }
}

if (MODE.kind === 'live-18091') {
  mainBase = LIVE_BASE
} else {
  const emptyStarted = await startNode({ NODE_ID: 'probe-empty', PORT: '0', SNAPSHOT_DIR: EMPTY_DIR })
  emptyServer = emptyStarted.server
  const address = emptyServer.address()
  emptyBase = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`
}

/**
 * The client. `serialised` is the D-0071 boundary: assertions read THIS, never the
 * in-memory object a route returned.
 */
function client(base) {
  return async function get(path, method = 'GET', body = null) {
    const init = { method, redirect: 'manual' }
    if (body !== null) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
      init.headers = { 'content-type': 'application/json' }
    }
    const response = await fetch(`${base}${path}`, init)
    const text = await response.text()
    let parsed = null
    try { parsed = JSON.parse(text) } catch { parsed = null }
    const serialised = parsed === null ? null : JSON.parse(JSON.stringify(parsed))
    const headers = {}
    for (const [k, v] of response.headers.entries()) headers[k.toLowerCase()] = v
    return { status: response.status, body: parsed, serialised, text, headers }
  }
}

const get = client(mainBase)
const getEmpty = emptyBase === null ? null : client(emptyBase)

/**
 * Fixture nodes for `E6`: each one is a real listener over a DOCTORED snapshot
 * directory, so the subject of that check is the served view and not a loader's
 * return value read in the abstract.
 *
 * The directories and servers are tracked so cleanup happens even when a check
 * throws: a suite that leaves three temp trees and three listeners behind on failure
 * is a suite whose second run measures its first run's leftovers.
 */
const FIXTURE_DIRS = []
const FIXTURE_SERVERS = []

async function openFixtureNode(dir) {
  const started = await startNode({
    NODE_ID: `probe-fixture-${FIXTURE_SERVERS.length + 1}`,
    PORT: '0',
    SNAPSHOT_DIR: dir,
  })
  FIXTURE_SERVERS.push(started.server)
  const address = started.server.address()
  return client(`http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`)
}

/* ---------------------------------------------------------------------------
 * A. THE PATH TABLE — the denominator every later section is measured against
 * ------------------------------------------------------------------------ */

console.log('\nA. THE PATH TABLE AND THE SUBJECT')

let advertised = []
let pathsFromTable = []

if (MODE.kind === 'in-process') {
  pathsFromTable = [...allPaths()]
  advertised = pathsFromTable
} else {
  /**
   * In live mode there is no importable table, so the advertised list is read from
   * the 404 body — which is the point of that body being authoritative. `A2` is
   * still FAILED rather than skipped, because `auditPaths()` cannot be run this way
   * and a check that cannot see its subject must go red.
   */
  const probe = await get('/definitely-not-a-path')
  advertised = Array.isArray(probe.serialised?.paths) ? probe.serialised.paths : []
  pathsFromTable = advertised
}

const hello = await get('/node/health')
check(
  'A1',
  hello.status === 200 && hello.serialised?.ok === true,
  `mode=${MODE.kind} base=${mainBase} status=${hello.status}${MODE.reason ? ' fallbackReason=' + MODE.reason : ''}`,
)

const audit = MODE.kind === 'in-process' ? auditPaths() : null
if (audit === null) {
  check('A2', false, 'auditPaths() is not reachable in live mode, so the distinct-vs-expected census was NOT measured')
} else {
  check(
    'A2',
    audit.distinct === audit.expected && audit.duplicatePaths.length === 0 && audit.doubledSegmentPaths.length === 0,
    `distinct=${audit.distinct} expected=${audit.expected} bySource=${JSON.stringify(audit.bySource)} duplicatePaths=${JSON.stringify(audit.duplicatePaths)} doubled=${JSON.stringify(audit.doubledSegmentPaths)}`,
  )
}

const CONTRACT_NODE_PATHS = [
  '/node/identity',
  '/node/intent',
  '/node/meta-packages',
  '/node/session/probe',
  '/node/anonymity',
  '/node/health',
]
const CONTRACT_CONSENSUS_PATHS = [
  '/node/consensus/state',
  '/node/consensus/propose',
  '/node/consensus/endorse',
]

if (MODE.kind !== 'in-process') {
  check('A3', false, 'the node/consensus tables are not importable in live mode, so the contract set was NOT compared')
} else {
  const nodeSetEqual = JSON.stringify([...NODE_PATHS].sort()) === JSON.stringify([...CONTRACT_NODE_PATHS].sort())
  const consensusSetEqual = JSON.stringify([...CONSENSUS_PATHS].sort()) === JSON.stringify([...CONTRACT_CONSENSUS_PATHS].sort())
  check(
    'A3',
    nodeSetEqual && consensusSetEqual,
    `node=${JSON.stringify(NODE_PATHS)} consensus=${JSON.stringify(CONSENSUS_PATHS)} `,
  )
}

if (MODE.kind !== 'in-process') {
  check('A4', false, 'the tables are not importable in live mode, so frozenness was NOT measured')
} else {
  let pushThrew = false
  try { allPaths().push('/node/forged') } catch { pushThrew = true }
  check(
    'A4',
    Object.isFrozen(NODE_PATHS) && Object.isFrozen(CONSENSUS_PATHS) && Object.isFrozen(allPaths()) && pushThrew,
    `frozenNode=${Object.isFrozen(NODE_PATHS)} frozenConsensus=${Object.isFrozen(CONSENSUS_PATHS)} frozenAll=${Object.isFrozen(allPaths())} pushThrew=${pushThrew}`,
  )
}

/* ---------------------------------------------------------------------------
 * B. THE 404 BODY — the one place whose job is to be authoritative
 * ------------------------------------------------------------------------ */

console.log('\nB. THE 404 BODY')

const notFound = await get('/node/definitely-not-registered')
check('B1', notFound.status === 404, `status=${notFound.status}`)

const advertisedInBody = Array.isArray(notFound.serialised?.paths) ? notFound.serialised.paths : []
const expectedCount = pathsFromTable.length
check(
  'B2',
  typeof notFound.serialised?.pathCount === 'number'
    && notFound.serialised.pathCount === expectedCount
    && expectedCount > 0,
  `pathCount=${notFound.serialised?.pathCount} allPaths().length=${expectedCount}`,
)

const missingFromBody = pathsFromTable.filter((p) => !advertisedInBody.includes(p))
const extraInBody = advertisedInBody.filter((p) => !pathsFromTable.includes(p))
check(
  'B3',
  missingFromBody.length === 0 && extraInBody.length === 0 && advertisedInBody.length === expectedCount,
  `body=${advertisedInBody.length} table=${expectedCount} missing=${JSON.stringify(missingFromBody)} extra=${JSON.stringify(extraInBody)}`,
)

check(
  'B4',
  notFound.serialised?.method === 'GET'
    && notFound.serialised?.path === '/node/definitely-not-registered'
    && typeof notFound.serialised?.nodeId === 'string'
    && notFound.serialised.nodeId.length > 0,
  `method=${JSON.stringify(notFound.serialised?.method)} path=${JSON.stringify(notFound.serialised?.path)} nodeId=${JSON.stringify(notFound.serialised?.nodeId)}`,
)

/* ---------------------------------------------------------------------------
 * C. G9 — EVERY ADVERTISED PATH IS DRIVEN, AND NONE MAY 404
 * ------------------------------------------------------------------------ */

console.log('\nC. G9 — ADVERTISED PATHS vs SERVED PATHS')

/**
 * The paths are the TABLE's, not a hand-written list here: a list this file retyped
 * would agree with itself and say nothing about the server. `GET` is driven against
 * every path first, because 405 on a POST-only route is the HONEST answer and 404 is
 * the failure — then the POST-only routes are driven a second time with their real
 * method in `C5`.
 */
const driven = []
for (const path of pathsFromTable) {
  const r = await get(path, 'GET')
  driven.push({ path, method: 'GET', status: r.status, body: r.serialised })
}

check(
  'C1',
  driven.length === expectedCount && driven.length > 0,
  `driven=${driven.length} advertised=${expectedCount}`,
)

const dead = driven.filter((d) => d.status === 404)
check(
  'C2',
  dead.length === 0,
  `dead=${dead.length} of ${driven.length}${dead.length ? ' -> ' + JSON.stringify(dead.map((d) => d.path)) : ''}`,
)

const served200 = driven.filter((d) => d.status === 200)
check('C3', served200.length > 0, `served200=${served200.length} of ${driven.length}`)

/**
 * THE 405 BODY HAS TWO POPULATIONS AND THEY ARE ASSERTED SEPARATELY, because the
 * contract fixes different obligations for them. A 405 the NODE dispatcher emits
 * must state the method received AND the methods it allows; a 405 the DELEGATED
 * host handler emits belongs to a body this file must not rewrite, so the node's
 * obligation there is the one every response has — `x-node-id` — plus the host's own
 * `method` field. Collapsing the two into one test is how a delegated body gets
 * graded against a rule written for the dispatcher (or, worse, how the dispatcher's
 * rule gets relaxed to make a host body pass).
 */
const refused405 = driven.filter((d) => d.status === 405)
const nodeRefused = refused405.filter((d) => d.path.startsWith('/node/'))
const hostRefused = refused405.filter((d) => !d.path.startsWith('/node/'))
const badNode405 = nodeRefused.filter((d) => d.body?.method !== 'GET' || !Array.isArray(d.body?.allow))
const badHost405 = hostRefused.filter((d) => d.body?.method !== 'GET')
check(
  'C4',
  nodeRefused.length > 0 && hostRefused.length > 0 && badNode405.length === 0 && badHost405.length === 0,
  `refused405=${refused405.length} node=${nodeRefused.length} host=${hostRefused.length} badNode=${JSON.stringify(badNode405.map((d) => d.path))} badHost=${JSON.stringify(badHost405.map((d) => d.path))}`,
)

/**
 * THE POST-ONLY PATHS, DRIVEN WITH THEIR OWN METHOD. Each body is the smallest one
 * that the route accepts and that cannot mutate anything a later check reads: a
 * session probe payload, a lone-node proposal, and an endorsement the local node
 * will refuse on term grounds rather than accept.
 */
const POST_BODIES = {
  '/node/session/probe': { fields: { a: 1 } },
  '/node/consensus/propose': { key: 'suite-probe', value: 'v' },
  '/node/consensus/endorse': { key: 'suite-probe', value: 'v', term: 1 },
  '/meta-community/api/fuse': { contributions: [{ authorId: 'a', role: 'author', fields: { x: 1 }, contributedAt: 'now' }] },
  '/meta-community/api/standing/relabel': { authorIds: ['solo'] },
}
const postDriven = []
for (const [path, body] of Object.entries(POST_BODIES)) {
  if (!pathsFromTable.includes(path)) continue
  const r = await get(path, 'POST', body)
  postDriven.push({ path, status: r.status })
}
const postDead = postDriven.filter((d) => d.status === 404)
const postBroken = postDriven.filter((d) => d.status !== 200)
check(
  'C5',
  postDriven.length === Object.keys(POST_BODIES).length && postDead.length === 0 && postBroken.length === 0,
  `driven=${postDriven.length} of ${Object.keys(POST_BODIES).length} dead=${postDead.length} non200=${JSON.stringify(postBroken)}`,
)

/* ---------------------------------------------------------------------------
 * D. /node/identity
 * ------------------------------------------------------------------------ */

console.log('\nD. /node/identity')

const identity = await get('/node/identity')
check(
  'D1',
  identity.status === 200 && typeof identity.serialised?.nodeId === 'string' && identity.serialised.nodeId.length > 0,
  `status=${identity.status} nodeId=${JSON.stringify(identity.serialised?.nodeId)}`,
)

check(
  'D2',
  typeof identity.serialised?.term === 'number'
    && Number.isSafeInteger(identity.serialised.term)
    && typeof identity.serialised?.uptimeMs === 'number'
    && identity.serialised.uptimeMs > 0,
  `term=${identity.serialised?.term} uptimeMs=${identity.serialised?.uptimeMs}`,
)

/**
 * THE TWO SNAPSHOT IDENTITIES, ASSERTED BY SHAPE RATHER THAN BY VALUE. The values
 * depend on which artifact was captured; the SHAPE is the contract, and a shape
 * check is what catches `sha256` being renamed to `digest` or an `available:false`
 * arriving with `bytes: 0` (absent is not zero).
 */
function snapshotIdentityShapeProblem(view) {
  if (view === null || typeof view !== 'object') return 'identity missing'
  if (typeof view.available !== 'boolean') return 'available is not a boolean'
  if (!('reason' in view)) return 'reason is absent rather than null-or-string'
  if (view.available === false) {
    if (typeof view.reason !== 'string' || view.reason.trim().length === 0) {
      return 'available:false without a non-empty reason'
    }
    /**
     * THERE ARE TWO KINDS OF UNAVAILABILITY AND THEY MUST NOT BE CONFLATED, which is
     * a correction to this check's first version rather than a relaxation of it. A
     * MISSING artifact has no bytes and no digest; an artifact that is PRESENT but
     * whose document cannot be verified (a capture that predates its own tool, a
     * tampered document) may legitimately carry `bytes` and `sha256` of the file that
     * was rejected — `unavailable(reason, carried)` in `metaPackages.ts` does exactly
     * that, and it tells a reader WHICH file was refused. The first version demanded
     * nulls in both cases, which would have forced a lane to discard a measured fact
     * to satisfy a harness. The invariant kept is the one that can still fail: the
     * pair is reported TOGETHER or not at all, and a carried pair must be well formed.
     * The strictly-null case is asserted separately by `E2`/`E4`, driven against a
     * real empty directory, which is the only place absence is a measured fact.
     */
    const bytesKnown = view.bytes !== null
    const digestKnown = view.sha256 !== null
    if (bytesKnown !== digestKnown) return 'available:false carried a byte count without its sha256, or the reverse'
    if (bytesKnown && !(typeof view.bytes === 'number' && view.bytes > 0 && /^[0-9a-f]{64}$/.test(view.sha256))) {
      return 'available:false carried a malformed bytes/sha256 pair'
    }
    return null
  }
  if (typeof view.bytes !== 'number' || view.bytes <= 0) return 'available:true without a positive byte count'
  if (typeof view.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(view.sha256)) return 'available:true without an algorithm-named sha256'
  if (typeof view.capturedAt !== 'string') return 'available:true without a capturedAt'
  return null
}

const intentShape = snapshotIdentityShapeProblem(identity.serialised?.intent)

/**
 * THE TWO CLOCKS, ASSERTED RATHER THAN TOLERATED. The intent artifact records its
 * index build as `readFreshness.state: "stale"` (age 33,394 s against a 3,600 s TTL)
 * while `index.freshness` says `"fresh"`. Those answer DIFFERENT questions — has every
 * zone hash survived, versus how old is the build clock — and the fix was to carry
 * both, side by side, with a statement that they are not comparable.
 *
 * A check that ignored the new fields would not have noticed the fix at all, so this
 * asserts the SHAPE of the pair and the ANTI-COLLAPSE property: the statement must name
 * both numbers in one string, because the failure mode is a later edit reducing the pair
 * to one boolean, which would read as "fresh" to anyone quoting the surviving clock.
 */
function freshnessProblem(view) {
  if (view === null || typeof view !== 'object') return 'the intent identity is not an object'
  const census = view.census
  const freshness = view.freshness
  if (census === undefined || freshness === undefined) {
    return 'the identity projection carries NEITHER `census` nor `freshness`; intent.ts exports describeIntent() with both and no route serves it'
  }
  if (!('readFreshnessState' in census) || !('readFreshnessAgeSeconds' in census) || !('indexFreshness' in census)) {
    return 'the census block does not carry the readFreshness triple beside indexFreshness, so the two clocks cannot both be read'
  }
  if (freshness.notComparable !== true) return 'freshness.notComparable is not true, so the two readings are presented as one answer'
  if (typeof freshness.content?.verdict !== 'string') return 'freshness.content.verdict is absent'
  if (typeof freshness.age?.state !== 'string') return 'freshness.age.state is absent'
  if (typeof freshness.statement !== 'string') return 'freshness.statement is absent'
  /**
   * THE ANTI-COLLAPSE ASSERTION: both numbers must survive into the sentence, because a
   * statement that keeps only the verdict is exactly how one clock silently becomes the
   * answer. Values are read from the payload, never hard-coded, so the check survives a
   * re-capture and still refuses a statement that dropped a number.
   */
  const zonesPair = freshness.content?.zonesHashExact
  const pair = typeof zonesPair?.count === 'number' && typeof zonesPair?.of === 'number' ? `${zonesPair.count}/${zonesPair.of}` : null
  const age = typeof freshness.age?.ageSeconds === 'number' ? String(freshness.age.ageSeconds) : null
  if (pair === null || !freshness.statement.includes(pair)) return `freshness.statement does not name the content pair ${pair}`
  if (age === null || !freshness.statement.includes(age)) return `freshness.statement does not name the build age ${age}`
  if (typeof view.documentSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(view.documentSha256)) {
    return 'the projection does not carry documentSha256, the only digest on the artifact that is recomputable offline'
  }
  return null
}

const intentFreshness = freshnessProblem(identity.serialised?.intent)

/**
 * AND THE SERVED `documentSha256` IS CHECKED AGAINST THE FILE, not against itself.
 * `describeIntent()` RECOMPUTES that digest from the document it parsed; it does not
 * copy the file's declared value, so a route could report a self-consistent digest for
 * a document the file never vouched for and every shape assertion here would pass. The
 * file on disk is the second opinion, and reading it in this suite is what makes the
 * equality evidence rather than a restatement.
 */
let declaredDocumentSha = null
let declaredDocumentShaProblem = null
try {
  const onDisk = JSON.parse(readFileSync(join(SNAPSHOT_DIR, 'intent-map.json'), 'utf8'))
  declaredDocumentSha = typeof onDisk.documentSha256 === 'string' ? onDisk.documentSha256 : null
  if (declaredDocumentSha === null) declaredDocumentShaProblem = 'the snapshot file on disk carries no documentSha256 to compare against'
} catch (err) {
  declaredDocumentShaProblem = `the snapshot file on disk could not be read for comparison: ${err instanceof Error ? err.message : String(err)}`
}
const servedDocumentSha = identity.serialised?.intent?.documentSha256 ?? null
const shaCrossCheck = declaredDocumentShaProblem ?? (servedDocumentSha === declaredDocumentSha
  ? null
  : `the served documentSha256 ${JSON.stringify(servedDocumentSha)} does not equal the file's declared ${JSON.stringify(declaredDocumentSha)}, so the projection recomputed a digest the artifact never vouched for`)

check(
  'D3',
  intentShape === null && intentFreshness === null && shaCrossCheck === null,
  `intentShape=${intentShape ?? 'ok'} freshness=${intentFreshness ?? 'ok'} shaCrossCheck=${shaCrossCheck ?? `ok (${servedDocumentSha})`} keys=${identity.serialised?.intent ? Object.keys(identity.serialised.intent).join(',') : 'absent'}`,
)

const metaShape = snapshotIdentityShapeProblem(identity.serialised?.metaPackages)
check('D4', metaShape === null, `metaPackages=${JSON.stringify(identity.serialised?.metaPackages)} problem=${metaShape ?? 'none'}`)

/**
 * THE HEADER IS HOW A DELEGATED BODY STILL IDENTIFIES ITS NODE: the host handler
 * composes its own body and must not be rewritten, so the dispatcher sets
 * `x-node-id` before dispatch and this check reads it on BOTH kinds of response.
 */
const nodeIdsOnHeader = [
  { path: '/node/health', nodeId: hello.headers['x-node-id'] },
  { path: '/meta-community/api/census', nodeId: (await get('/meta-community/api/census')).headers['x-node-id'] },
]
const headerMissing = nodeIdsOnHeader.filter((r) => typeof r.nodeId !== 'string' || r.nodeId.length === 0)
check(
  'D5',
  headerMissing.length === 0,
  `withHeader=${nodeIdsOnHeader.length - headerMissing.length} of ${nodeIdsOnHeader.length} ${JSON.stringify(nodeIdsOnHeader)}`,
)

/* ---------------------------------------------------------------------------
 * E. ABSENT IS NOT ZERO — both snapshot availability cases are DRIVEN
 * ------------------------------------------------------------------------ */

console.log('\nE. SNAPSHOT AVAILABILITY — BOTH DIRECTIONS')

const intentReal = await get('/node/intent')
check(
  'E1',
  intentReal.status === 200
    && intentReal.serialised?.available === true
    && typeof intentReal.serialised?.snapshot?.bytes === 'number'
    && intentReal.serialised.snapshot.bytes > 0
    && /^[0-9a-f]{64}$/.test(intentReal.serialised?.snapshot?.sha256 ?? ''),
  `status=${intentReal.status} available=${intentReal.serialised?.available} bytes=${intentReal.serialised?.snapshot?.bytes} sha256=${intentReal.serialised?.snapshot?.sha256} (subject: the response body AS FETCHED at capture time, per NODE-CONTRACT — NOT the hash of the committed FILE, which differs; offline reproducibility is a property of the SOURCE's serialisation and of no assertion here, and it holds for this artifact only because the map is served compact, so the wire digest equals documentSha256. This green asserts the digest is PRESENT and WELL-FORMED, never that it reproduces) snapshotDir=${SNAPSHOT_DIR}`,
)

if (getEmpty === null) {
  check('E2', false, 'no empty-dir node was started, so the available:false direction was NOT driven')
  check('E4', false, 'no empty-dir node was started, so the available:false direction was NOT driven')
  check('E5', false, 'no empty-dir node was started, so health-without-artifact was NOT measured')
} else {
  const intentEmpty = await getEmpty('/node/intent')
  const snap = intentEmpty.serialised?.snapshot
  check(
    'E2',
    intentEmpty.status === 200
      && intentEmpty.serialised?.available === false
      && typeof snap?.reason === 'string'
      && snap.reason.trim().length > 0
      && snap.bytes === null
      && snap.sha256 === null
      && snap.document === null,
    `status=${intentEmpty.status} available=${intentEmpty.serialised?.available} reasonChars=${snap?.reason?.length ?? 0} bytes=${JSON.stringify(snap?.bytes)} sha256=${JSON.stringify(snap?.sha256)} document=${JSON.stringify(snap?.document)}`,
  )

  const metaEmpty = await getEmpty('/node/meta-packages')
  const msnap = metaEmpty.serialised?.snapshot
  check(
    'E4',
    metaEmpty.status === 200
      && metaEmpty.serialised?.available === false
      && typeof msnap?.reason === 'string'
      && msnap.reason.trim().length > 0
      && msnap.bytes === null
      && msnap.sha256 === null
      && msnap.document === null,
    `status=${metaEmpty.status} available=${metaEmpty.serialised?.available} reasonChars=${msnap?.reason?.length ?? 0} bytes=${JSON.stringify(msnap?.bytes)} sha256=${JSON.stringify(msnap?.sha256)} document=${JSON.stringify(msnap?.document)}`,
  )

  const emptyHealth = await getEmpty('/node/health')
  check(
    'E5',
    emptyHealth.status === 200
      && emptyHealth.serialised?.ok === true
      && emptyHealth.serialised?.intentAvailable === false
      && emptyHealth.serialised?.metaPackagesAvailable === false,
    `status=${emptyHealth.status} ok=${emptyHealth.serialised?.ok} intentAvailable=${emptyHealth.serialised?.intentAvailable} metaPackagesAvailable=${emptyHealth.serialised?.metaPackagesAvailable}`,
  )
}

const metaReal = await get('/node/meta-packages')
check(
  'E3',
  metaReal.status === 200
    && metaReal.serialised?.available === true
    && typeof metaReal.serialised?.snapshot?.bytes === 'number'
    && metaReal.serialised.snapshot.bytes > 0
    && /^[0-9a-f]{64}$/.test(metaReal.serialised?.snapshot?.sha256 ?? ''),
  `status=${metaReal.status} available=${metaReal.serialised?.available} bytes=${metaReal.serialised?.snapshot?.bytes} sha256=${metaReal.serialised?.snapshot?.sha256} (subject: the response body AS FETCHED at capture time; hashing the committed file gives a DIFFERENT value, so this green is about the digest being present and WELL-FORMED, never about it reproducing offline — the reproducible field on that artifact is documentSha256, which this suite deliberately does not claim on)`,
)

/* ---------------------------------------------------------------------------
 * E6. THE VERIFIER'S DISCRIMINATOR — three driven states, one of them a POSITIVE
 * ------------------------------------------------------------------------ */

console.log('\nE6. SNAPSHOT VERIFICATION — THREE DRIVEN STATES')

/**
 * THE GAP THIS CLOSES, AND WHY IT IS THREE STATES RATHER THAN ONE.
 *
 * `D4` asserts the carried-pair rule on every run but only ever DRIVEN the "neither"
 * branch, via a real empty directory. The complementary branch — a rejection that
 * carries `bytes` + `sha256` because the FILE was read and refused — was observed
 * once by accident and tested nowhere.
 *
 * A second REFUSAL fixture would still have closed nothing: two refusals cannot tell
 * "verifies the digest" from "refuses a document that looks touched", which is the
 * same shape as a check that cannot fail. **State 2 is the falsifier** — a document
 * deliberately different from the capture, with the digest recomputed to match, must
 * be SERVED. A loader that refused everything would pass states 1 and 3 and fail
 * here, which is why state 2 is the one that makes this check mean something.
 *
 * AND THE MUTATION IS ASSERTED EFFECTIVE BEFORE THE LOADER IS ASKED ANYTHING. A
 * sibling lane's first version of this fixture set `readFreshness.state` to the value
 * the artifact already held, so nothing moved, its "must refuse" control served, and
 * it nearly reported its own loader as broken. The tell was that the digest quoted
 * was still the original. Here the edited document's digest is recomputed and
 * compared to the declared one BEFORE any state is written, and a no-op FAILS `E6`
 * rather than being silently absorbed.
 */
const e6 = { problems: [], mutation: null, states: [] }

try {
  if (MODE.kind !== 'in-process') {
    throw new Error('no in-process start is available, so no fixture node could be created and this branch was NOT driven')
  }
  const snapshotPath = join(SNAPSHOT_DIR, 'intent-map.json')
  const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const declared = parsed.documentSha256
  const recordedBytes = parsed.bytes
  const recordedWireSha = parsed.sha256
  const originalZones = parsed.document?.corpus?.zones?.count
  if (typeof declared !== 'string' || !/^[0-9a-f]{64}$/.test(declared)) {
    throw new Error(`${snapshotPath} carries no 64-hex documentSha256, so this check has no digest to keep consistent`)
  }
  if (typeof originalZones !== 'number') {
    throw new Error(`${snapshotPath} has no numeric document.corpus.zones.count to change, so there is no mutation to make`)
  }

  /**
   * THE MUTATION MUST STAY INSIDE THE LOADER'S DOCUMENT INVARIANTS, and this took THREE
   * measured attempts rather than one reasoned one — each failure inside this check was
   * the check working.
   *
   *   1. `zones.count` 24 → 25 with `of` left at 24: refused by `readPair`, because a
   *      count above its denominator is not a pair (`no valid corpus.zones count/of pair`).
   *   2. `count` AND `of` 24 → 25 together: refused by the loader's SELF-CONTRADICTION
   *      check, `the snapshot census says 25 zones while the document carries 24`.
   *      So `corpus.zones.count` is not a free number — it must equal `document.zones.length`.
   *   3. therefore the census is moved WITH the collection it counts: one zone definition
   *      is dropped and `count` follows the array to 23 of 24. That is inside the schema,
   *      self-consistent, and observable in the served document.
   *
   * The lesson for any later fixture here: the loader validates the document BEFORE the
   * digest, so a fixture that breaks a document invariant fails for a reason that has
   * nothing to do with the digest — and would be read as a verifier defect.
   */
  const zonesOf = parsed.document?.corpus?.zones?.of
  if (typeof zonesOf !== 'number' || zonesOf !== originalZones) {
    throw new Error(`${snapshotPath} reports zones ${JSON.stringify(originalZones)} of ${JSON.stringify(zonesOf)}; this fixture expects a full census so the mutation can drop one zone definition and keep the pair valid`)
  }
  const mutatedDoc = JSON.parse(JSON.stringify(parsed.document))
  const droppedZone = Array.isArray(mutatedDoc.zones) ? mutatedDoc.zones.pop() : null
  if (droppedZone === null) {
    throw new Error(`${snapshotPath} carries no document.zones array, so no zone definition can be dropped and the census cannot be moved consistently`)
  }
  const mutatedZones = mutatedDoc.zones.length
  mutatedDoc.corpus.zones.count = mutatedZones
  const recomputed = createHash('sha256').update(JSON.stringify(mutatedDoc), 'utf8').digest('hex')
  e6.mutation = { before: declared, after: recomputed, moved: recomputed !== declared, zonesFrom: originalZones, zonesTo: mutatedZones, droppedZone: droppedZone?.id ?? null }
  if (recomputed === declared) {
    e6.problems.push(
      `mutation NO-OP: the edited document still hashes to the DECLARED ${declared}, so every state below would test nothing`,
    )
  }

  async function driveState(label, envelope) {
    const dir = await mkdtemp(join(tmpdir(), 'node-half-e6-'))
    FIXTURE_DIRS.push(dir)
    writeFileSync(join(dir, 'intent-map.json'), JSON.stringify(envelope, null, 2))
    const request = await openFixtureNode(dir)
    const response = await request('/node/intent')
    const snap = response.serialised?.snapshot
    const state = {
      label,
      status: response.status,
      available: response.serialised?.available,
      reasonStart: typeof snap?.reason === 'string' ? snap.reason.slice(0, 40) : null,
      bytes: snap?.bytes,
      sha256: typeof snap?.sha256 === 'string' ? snap.sha256.slice(0, 12) : snap?.sha256 ?? null,
      documentNull: snap?.document === null,
      zones: snap?.document?.corpus?.zones?.count ?? null,
    }
    e6.states.push(state)
    return { state, snap, response }
  }

  // STATE 1 — the document is changed and the digest is LEFT STALE: must be refused.
  const staleEnvelope = JSON.parse(JSON.stringify(parsed))
  staleEnvelope.document = mutatedDoc
  staleEnvelope.documentSha256 = declared
  const one = await driveState('1-changed-doc-stale-digest', staleEnvelope)
  if (one.state.available !== false) e6.problems.push(`state 1 served a changed document with a stale digest (available=${one.state.available})`)
  if (one.snap?.document !== null) e6.problems.push('state 1 carried a document beside a refusal, so the rejected content was served anyway')
  if (typeof one.snap?.reason !== 'string' || !/^TAMPERED/.test(one.snap.reason)) {
    e6.problems.push(`state 1's reason does not begin TAMPERED: ${JSON.stringify(one.snap?.reason ?? null).slice(0, 80)}`)
  } else {
    if (!one.snap.reason.includes(recomputed)) e6.problems.push('state 1\'s reason does not name the RECOMPUTED digest, so a reader cannot see what was computed')
    if (!one.snap.reason.includes(declared)) e6.problems.push('state 1\'s reason does not name the DECLARED digest, so a reader cannot see what was expected')
  }
  if (one.snap?.bytes !== recordedBytes) e6.problems.push(`state 1 carried bytes=${JSON.stringify(one.snap?.bytes)} rather than the rejected file's ${recordedBytes}`)
  if (one.snap?.sha256 !== recordedWireSha) e6.problems.push('state 1 carried a sha256 that is not the rejected file\'s own digest')

  // STATE 2 — THE FALSIFIER: the same changed document with the digest RECOMPUTED must be SERVED.
  const consistentEnvelope = JSON.parse(JSON.stringify(parsed))
  consistentEnvelope.document = mutatedDoc
  consistentEnvelope.documentSha256 = recomputed
  const two = await driveState('2-changed-doc-consistent-digest', consistentEnvelope)
  if (two.state.available !== true) e6.problems.push(`state 2 REFUSED a document whose digest is consistent (available=${two.state.available}); a verifier that refuses everything passes the refusal states and fails here, which is the whole point of this state`)
  if (two.state.zones !== mutatedZones) e6.problems.push(`state 2 did not serve the edited value: zones=${JSON.stringify(two.state.zones)} wanted ${mutatedZones}`)
  if (mutatedZones === originalZones) e6.problems.push('state 2\'s served value equals the original, so the served document was not the edited one')

  /**
   * STATE 2b — NOT IN THE REQUESTED SET, ADDED BECAUSE STATE 2'S FIRST RUN REFUSED FOR
   * A DIFFERENT REASON AND THAT REASON IS ITSELF EVIDENCE. A document edited to an
   * INVALID census (`count` one above `of`) is refused even when its digest is
   * recomputed to match: the loader has a DOCUMENT-VALIDITY gate in front of the digest
   * gate. Two gates, two reasons, and a suite that only knew the digest one would
   * misattribute the next such refusal to tampering.
   */
  const invalidEnvelope = JSON.parse(JSON.stringify(parsed))
  const invalidDoc = JSON.parse(JSON.stringify(parsed.document))
  invalidDoc.corpus.zones.count = (parsed.document?.corpus?.zones?.of ?? originalZones) + 1
  invalidEnvelope.document = invalidDoc
  invalidEnvelope.documentSha256 = createHash('sha256').update(JSON.stringify(invalidDoc), 'utf8').digest('hex')
  const twoB = await driveState('2b-invalid-census-consistent-digest', invalidEnvelope)
  if (twoB.state.available !== false) e6.problems.push(`state 2b SERVED a document whose census is invalid (available=${twoB.state.available}), so the document-validity gate is not in front of the digest gate`)
  if (typeof twoB.snap?.reason !== 'string' || !/count\/of pair|corpus\.zones/.test(twoB.snap.reason)) {
    e6.problems.push(`state 2b was refused for a reason that does not name the census: ${JSON.stringify(twoB.snap?.reason ?? null).slice(0, 90)}`)
  }

  // STATE 3 — the digest is ABSENT: refused, and the rejected file's pair is carried.
  const absentEnvelope = JSON.parse(JSON.stringify(parsed))
  delete absentEnvelope.documentSha256
  const three = await driveState('3-digest-absent', absentEnvelope)
  if (three.state.available !== false) e6.problems.push(`state 3 served a document with no documentSha256 (available=${three.state.available})`)
  if (typeof three.snap?.reason !== 'string' || !three.snap.reason.includes('documentSha256')) {
    e6.problems.push('state 3\'s reason does not name the missing documentSha256, so the absence is implied rather than stated')
  }
  if (three.snap?.bytes !== recordedBytes || three.snap?.sha256 !== recordedWireSha) {
    e6.problems.push('state 3 did not carry the rejected file\'s bytes+sha256 pair, which is the branch D4 asserts but nobody drove')
  }
  if (three.snap?.document !== null) e6.problems.push('state 3 carried a document beside a refusal')
} catch (err) {
  e6.problems.push(`the fixture set could not be driven: ${err instanceof Error ? err.message : String(err)}`)
}

check(
  'E6',
  e6.problems.length === 0 && e6.mutation?.moved === true && e6.states.length === 4,
  `mutation before=${e6.mutation?.before?.slice(0, 8) ?? 'absent'} after=${e6.mutation?.after?.slice(0, 8) ?? 'absent'} moved=${e6.mutation?.moved} states=${JSON.stringify(e6.states)} problems=${JSON.stringify(e6.problems)}`,
)

/* ---------------------------------------------------------------------------
 * F. THE SESSION PROBE — retained 0, and two identical payloads must DIFFER
 * ------------------------------------------------------------------------ */

console.log('\nF. THE SESSION PROBE')

const PAYLOAD = { alpha: 1, beta: 'two', gamma: { nested: true } }
const probeOne = await get('/node/session/probe', 'POST', PAYLOAD)
const probeTwo = await get('/node/session/probe', 'POST', PAYLOAD)
const p1 = probeOne.serialised?.probe
const p2 = probeTwo.serialised?.probe

check('F1', p1?.retained === 0 && p2?.retained === 0, `retained(1)=${JSON.stringify(p1?.retained)} retained(2)=${JSON.stringify(p2?.retained)}`)

check(
  'F2',
  typeof p1?.sessionDigest === 'string'
    && /^[0-9a-f]{64}$/.test(p1.sessionDigest)
    && p1?.digestAlgorithm === 'sha256'
    && p2?.digestAlgorithm === 'sha256',
  `algorithm=${JSON.stringify(p1?.digestAlgorithm)} digestChars=${p1?.sessionDigest?.length ?? 0} digest=${p1?.sessionDigest ?? 'absent'}`,
)

/**
 * THE ONE PROPERTY THAT MAKES THE DIGEST NOT A KEY DERIVED FROM THE PAYLOAD: the
 * same payload twice must produce two different digests. If these were equal the
 * digest would be a function of what the user sent, which is the beginning of a
 * store.
 */
check(
  'F3',
  typeof p1?.sessionDigest === 'string' && typeof p2?.sessionDigest === 'string' && p1.sessionDigest !== p2.sessionDigest,
  `digest(1)=${p1?.sessionDigest ?? 'absent'} digest(2)=${p2?.sessionDigest ?? 'absent'} differ=${p1?.sessionDigest !== p2?.sessionDigest}`,
)

check(
  'F4',
  p1?.droppedFields === Object.keys(PAYLOAD).length
    && p2?.droppedFields === Object.keys(PAYLOAD).length
    && p1?.observedFields === Object.keys(PAYLOAD).length,
  `dropped(1)=${p1?.droppedFields} dropped(2)=${p2?.droppedFields} observed=${p1?.observedFields} payloadKeys=${Object.keys(PAYLOAD).length}`,
)

check('F5', p1?.store === 'none' && p2?.store === 'none', `store(1)=${JSON.stringify(p1?.store)} store(2)=${JSON.stringify(p2?.store)}`)

check(
  'F6',
  !('set-cookie' in probeOne.headers) && !('set-cookie' in probeTwo.headers),
  `headers=${JSON.stringify(Object.keys(probeOne.headers))}`,
)

const anon = await get('/node/anonymity')
check(
  'F7',
  anon.status === 200
    && anon.serialised?.anonymity?.zeroIsFloor === true
    && typeof anon.serialised?.anonymity?.zeroFloorStatement === 'string'
    && anon.serialised.anonymity.zeroFloorStatement.length > 100
    && Array.isArray(anon.serialised?.anonymity?.notProvenByThisModule),
  `status=${anon.status} zeroIsFloor=${anon.serialised?.anonymity?.zeroIsFloor} statementChars=${anon.serialised?.anonymity?.zeroFloorStatement?.length ?? 0} notProven=${anon.serialised?.anonymity?.notProvenByThisModule?.length ?? 0}`,
)

/* ---------------------------------------------------------------------------
 * G. THE HOST SURFACE STILL ANSWERS — the node did not break the plugin
 * ------------------------------------------------------------------------ */

console.log('\nG. THE HOST COMMUNITY SURFACE')

const census = await get('/meta-community/api/census')
check(
  'G1',
  census.status === 200
    && typeof census.serialised?.census?.total === 'number'
    && typeof census.serialised?.census?.censusAt === 'string',
  `status=${census.status} total=${census.serialised?.census?.total} at=${census.serialised?.census?.censusAt}`,
)

const hostPaths = MODE.kind === 'in-process'
  ? [...REGISTERED_PATHS]
  : advertised.filter((p) => p.startsWith('/meta-community/api'))
const hostDriven = []
for (const path of hostPaths) {
  const method = path.endsWith('/fuse') || path.endsWith('/relabel') ? 'POST' : 'GET'
  const body = method === 'POST' ? POST_BODIES[path] : null
  const r = await get(path, method, body)
  hostDriven.push({ path, method, status: r.status })
}
const hostDead = hostDriven.filter((d) => d.status === 404)
check(
  'G2',
  hostDriven.length === 7 && hostDead.length === 0,
  `driven=${hostDriven.length} dead=${hostDead.length}${hostDead.length ? ' -> ' + JSON.stringify(hostDead.map((d) => d.path)) : ''} statuses=${JSON.stringify(hostDriven.map((d) => d.status))}`,
)

check(
  'G3',
  census.serialised?.census?.total === 1 && census.serialised?.kind === 'plan',
  `total=${census.serialised?.census?.total} kind=${JSON.stringify(census.serialised?.kind)}`,
)

/* ---------------------------------------------------------------------------
 * H. THE SUITE'S OWN CHECKS — its subject is this file
 * ------------------------------------------------------------------------ */

console.log('\nH. THE SUITE AUDITS ITSELF')

const structural = new Set(['H1', 'H2', 'H3'])
const nonStructural = DEFINED_CHECKS.map(([id]) => id).filter((id) => !structural.has(id))
const neverRan = nonStructural.filter((id) => !ran.includes(id))
check(
  'H1',
  neverRan.length === 0,
  `ran=${ran.filter((id) => nonStructural.includes(id)).length} defined=${nonStructural.length}${neverRan.length ? ' NEVER RAN -> ' + JSON.stringify(neverRan) : ''}`,
)

check(
  'H2',
  duplicateIds.length === 0 && unregisteredIds.length === 0,
  `duplicateIds=${JSON.stringify(duplicateIds)} unregisteredIds=${JSON.stringify(unregisteredIds)}`,
)

/**
 * TWO ENCODINGS OF ONE FACT MUST NOT BE ABLE TO DISAGREE, and here the two are the
 * counters (`declared`, `passed`) and the printed `failures` list. The population
 * comparison against `DEFINED_CHECKS.length` deliberately does NOT live here: this
 * check is itself one of the defined checks, so an equality including the total
 * would be false on every honest run and true only by luck. The population is `H1`'s
 * subject, and the final verdict requires `declared === DEFINED_CHECKS.length` after
 * all three structural checks have run.
 */
check(
  'H3',
  declared === passed + failures.length,
  `declared=${declared} passed+failures=${passed + failures.length} failed=${failures.length}`,
)

/* ---------------------------------------------------------------------------
 * CLEANUP AND VERDICT
 * ------------------------------------------------------------------------ */

if (mainServer !== null) await closeNode(mainServer)
if (emptyServer !== null) await closeNode(emptyServer)
/** `E6`'s fixture listeners and trees are released here, on the failure path too. */
for (const fixtureServer of FIXTURE_SERVERS) await closeNode(fixtureServer)
for (const fixtureDir of FIXTURE_DIRS) await rm(fixtureDir, { recursive: true, force: true })
await rm(EMPTY_DIR, { recursive: true, force: true })

const missingOrFailing = failures.length
console.log(`\nmode: ${MODE.kind}  base: ${mainBase}`)
console.log(`passed: ${passed}  declared: ${declared}  defined: ${DEFINED_CHECKS.length}  failed: ${missingOrFailing}`)
if (failures.length > 0) {
  console.log('FAILED:')
  for (const f of failures) console.log(`  - ${f}`)
}
console.log(`\nVERDICT ${failures.length === 0 && declared === DEFINED_CHECKS.length ? 'PASS' : 'FAIL'}`)
process.exit(failures.length === 0 && declared === DEFINED_CHECKS.length ? 0 : 1)
