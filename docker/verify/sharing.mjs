#!/usr/bin/env node
/**
 * ============================================================================
 * SHARING HARNESS — the middle of the owner's directive, made falsifiable
 * ============================================================================
 *
 * The owner's directive names one node capability in the middle of a longer sentence: the node
 * *"will share the intent and meta-packages info for infra of the meta-market"*. A word like "share"
 * is cheap to assert and expensive to prove, so this file is written to make exactly one claim
 * checkable: **two nodes serve the SAME precalculated facts, each from its own baked snapshot, and
 * the check that says so can be made to fail.**
 *
 * Five conjuncts, each of which can go RED on its own:
 *
 *   1. INTENT EQUALITY — `/node/intent` from node-a and node-b agree field by field: the embedding
 *      model, its dimension, the vector count, the zone census (numerator AND denominator), the
 *      in-scope plugin census (numerator AND denominator), the catalog count, the capture stamp, and
 *      the snapshot's sha256. The whole served document is also compared, because a named field list
 *      is a place a field can hide from the check.
 *   2. META-PACKAGES EQUALITY — `/node/meta-packages` agrees on the meta-market assembly's id, kind
 *      and mounted flag, on the registered path count BOTH as a declared number and as the length of
 *      the path list it declares, on the capture stamp and on the snapshot sha256.
 *   3. INDEPENDENCE — each node answers from its OWN baked snapshot rather than by proxying the peer.
 *      Proven by stopping node-b and requiring node-a to keep answering, byte-identically, inside a
 *      latency bound that a proxy to a dead peer could not meet, and with node-a's own `x-node-id`.
 *      Then node-b is restarted (in a `finally`, so a failure cannot leave the stack down) and required
 *      to serve the SAME snapshot as before the restart — which is a second, stronger reading: the
 *      facts survive the process that served them.
 *   4. PRECALCULATION — two calls separated in time return byte-identical bodies with the same
 *      `capturedAt`, and every served identity field equals the snapshot FILE's recorded field, so the
 *      node is reading a build artifact rather than computing a fact per request.
 *   5. POSITIVE CONTROL — the equality comparison is driven RED against a fixture node whose
 *      `SNAPSHOT_DIR` holds a doctored copy of the same snapshots. If this section cannot make the
 *      check fail, the check is a caption and this harness says so and exits non-zero rather than
 *      reporting a pass.
 *
 * WHAT THIS HARNESS REFUSES TO COUNT AS AGREEMENT (each is the reason for a non-zero exit):
 *
 *   - A field ABSENT on one side and present on the other.
 *   - A field null on BOTH sides. `null === null` is two non-answers, not agreement, and a node that
 *     cannot find its snapshot serves exactly that shape.
 *   - A `0` on both sides where a count is expected: a comparison whose two sides both returned
 *     nothing has compared nothing, which is instrument failure rather than a pass.
 *   - An unprobed conjunct. A section that did not run reports NOT MEASURED and fails the run; an
 *     absence of a READING is not an absence of a VALUE.
 *
 * Every number printed here is a numerator with a denominator, and every check is recorded in ONE
 * array from which the totals are DERIVED — there is no second counter that could disagree with the
 * printing. The comparison is two-sided on purpose: node-a vs node-b must be GREEN and node-a vs the
 * doctored fixture must be RED, so a comparator that is merely always-red or always-green fails.
 *
 * Run: `node docker/verify/sharing.mjs`
 * Env: NODE_A_URL / NODE_B_URL (defaults http://127.0.0.1:18091 and :18092), PRE_CALC_GAP_MS (default
 * 2500), REQUEST_TIMEOUT_MS (default 5000), FIXTURE_PORT (default 18093).
 *
 * Exit codes: 0 every check passed · 1 at least one check FAILED · 2 nothing failed but at least one
 * conjunct could not be measured · 3 neither node answered at all (no comparison happened).
 *
 * Plain ESM, no dependencies, no build step, no toolchain — this is a `.mjs` under `docker/` and the
 * contract says so.
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLONE_ROOT = resolve(HERE, '..', '..')
const SNAPSHOT_DIR = resolve(CLONE_ROOT, 'docker', 'snapshots')
const INTENT_SNAPSHOT_FILE = join(SNAPSHOT_DIR, 'intent-map.json')
const META_SNAPSHOT_FILE = join(SNAPSHOT_DIR, 'meta-packages.json')

const NODE_A_URL = (process.env.NODE_A_URL ?? 'http://127.0.0.1:18091').replace(/\/+$/, '')
const NODE_B_URL = (process.env.NODE_B_URL ?? 'http://127.0.0.1:18092').replace(/\/+$/, '')
const GAP_MS = readPositiveInt(process.env.PRE_CALC_GAP_MS, 2500, 'PRE_CALC_GAP_MS')
const REQUEST_TIMEOUT_MS = readPositiveInt(process.env.REQUEST_TIMEOUT_MS, 5000, 'REQUEST_TIMEOUT_MS')
const FIXTURE_PORT = readPositiveInt(process.env.FIXTURE_PORT, 18093, 'FIXTURE_PORT')
const FIXTURE_START_TIMEOUT_MS = readPositiveInt(process.env.FIXTURE_START_TIMEOUT_MS, 20000, 'FIXTURE_START_TIMEOUT_MS')
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker'

/** How long a proxy to a dead peer would plausibly take before giving up; node-a must beat this. */
const INDEPENDENCE_LATENCY_BUDGET_MS = 3000

/** Upper bound on the number of differing JSON paths recorded per comparison, so a big diff stays readable. */
const MAX_DIFF_PATHS = 40

/* ---------------------------------------------------------------------------
 * The record of checks — ONE array, and every total below is DERIVED from it
 * ------------------------------------------------------------------------- */

/** @type {{ section: string, label: string, status: 'PASS'|'FAIL'|'NOT MEASURED', detail: string }[]} */
const checks = []

/** Readings that are NOT assertions. They are printed, and they never enter a count. */
const notes = []

let currentSection = 'startup'

function section(title) {
  currentSection = title
  console.log(`\n=== ${title} ===`)
}

function record(label, status, detail) {
  checks.push({ section: currentSection, label, status, detail })
  const mark = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[NOT MEASURED]'
  console.log(`${mark.padEnd(16)} ${label.padEnd(46)} ${detail}`)
  return status
}

function pass(label, detail) {
  return record(label, 'PASS', detail)
}

function fail(label, detail) {
  return record(label, 'FAIL', detail)
}

function unmeasured(label, detail) {
  return record(label, 'NOT MEASURED', detail)
}

function note(text) {
  notes.push({ section: currentSection, text })
  console.log(`[note]           ${text}`)
}

/**
 * A DIAGNOSTIC READING, not a check.
 *
 * The positive control deliberately drives the comparator RED, so its per-field readings are the
 * EXPECTED RESULT and must not enter the pass/fail count: an instrument that fails when its control
 * succeeds is broken in the most alarming direction. Only the aggregate assertions about a control case
 * (`control.<case>.detected`, `.documentEqualRed`, `.digestUnmoved`) are checks; these observations are
 * printed beside them so a reader can see WHICH field went red.
 */
function observe(label, status, detail) {
  const mark = status === 'PASS' ? '[observed pass]' : '[observed RED ]'
  console.log(`${mark.padEnd(16)} ${label.padEnd(46)} ${detail}`)
}

/**
 * The artifact this run actually measured, read from `docker inspect .Image` rather than from any
 * message or file. A report that cannot name the image behind a number cannot be re-measured: the
 * image under these containers changed three times during this build, and a stale id in a report is the
 * difference between "the sharing claim holds" and "some earlier build's sharing claim held".
 */
const measuredUnder = { nodeA: null, nodeB: null }

/**
 * The positive control's own verdict, kept as a PAIR because its success condition is INEQUALITY.
 *
 * A control succeeds when the comparison reports a difference against a doctored fixture, so counting
 * those readings among the operational checks makes the verdict the inverse of the evidence: the run
 * that proves the equality claim then exits non-zero. `detected / injected` is the sentence the claim
 * rests on, and `cleanRed / cleanTotal` is its other half — identical artifacts must produce ZERO
 * differences, or the comparator is merely always-red.
 */
const controlTally = { detected: 0, injected: 0, casesRun: 0, casesTotal: 0, cleanRed: 0, cleanTotal: 0 }

/* ---------------------------------------------------------------------------
 * Small utilities
 * ------------------------------------------------------------------------- */

function readPositiveInt(raw, fallback, name) {
  if (raw === undefined || raw === '') return fallback
  const text = String(raw).trim()
  if (!/^[0-9]+$/.test(text) || Number(text) <= 0) {
    throw new Error(`${name} must be a positive decimal integer, received ${JSON.stringify(raw)}`)
  }
  return Number(text)
}

function delay(ms) {
  return new Promise((done) => setTimeout(done, ms))
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Present means: the path resolves AND the value is not null/undefined. A null is a NON-ANSWER. */
function resolvePath(root, path) {
  const parts = path.split('.')
  let cursor = root
  for (const part of parts) {
    if (cursor === null || typeof cursor !== 'object') return { found: false, value: undefined }
    if (!Object.hasOwn(cursor, part)) return { found: false, value: undefined }
    cursor = cursor[part]
  }
  return { found: true, value: cursor }
}

function getAtPath(root, path) {
  return resolvePath(root, path)
}

function setAtPath(root, path, value) {
  const parts = path.split('.')
  let cursor = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, parts[i])) return false
    cursor = cursor[parts[i]]
  }
  const last = parts[parts.length - 1]
  if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, last)) return false
  cursor[last] = value
  return true
}

/** Render a value for printing without letting JSON.stringify hide a Set/Map/RegExp as `{}`. */
function show(value) {
  if (value === undefined) return 'ABSENT'
  if (value === null) return 'null'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `array(${value.length})`
  if (typeof value === 'object') return `object(${Object.keys(value).length} keys)`
  return String(value)
}

/**
 * Every differing path between two parsed JSON values.
 *
 * Key order is irrelevant and object identity is irrelevant, so this walks rather than stringifies:
 * two separate parses of one file must compare EQUAL, and `JSON.stringify` equality would also be
 * true here but would tell a reader nothing about WHERE a doctored fixture differs.
 */
function diffDocs(a, b, path, out, limit) {
  const where = path ?? '(root)'
  const collected = out ?? []
  const cap = limit ?? MAX_DIFF_PATHS
  if (collected.length >= cap) return collected
  if (a === b) return collected
  const aObject = a !== null && typeof a === 'object'
  const bObject = b !== null && typeof b === 'object'
  if (!aObject || !bObject) {
    collected.push(where)
    return collected
  }
  const aArray = Array.isArray(a)
  if (aArray !== Array.isArray(b)) {
    collected.push(where)
    return collected
  }
  if (aArray) {
    if (a.length !== b.length) collected.push(`${where}.length`)
    const count = Math.max(a.length, b.length)
    for (let i = 0; i < count && collected.length < cap; i += 1) {
      diffDocs(a[i], b[i], `${where}[${i}]`, collected, cap)
    }
    return collected
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (collected.length >= cap) break
    const inA = Object.hasOwn(a, key)
    const inB = Object.hasOwn(b, key)
    if (!inA || !inB) {
      collected.push(`${where}.${key}`)
      continue
    }
    diffDocs(a[key], b[key], `${where}.${key}`, collected, cap)
  }
  return collected
}

/* ---------------------------------------------------------------------------
 * HTTP
 * ------------------------------------------------------------------------- */

async function httpGet(url) {
  const started = Date.now()
  let response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    return {
      ok: false,
      url,
      at: started,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
  let buffer
  try {
    buffer = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    return {
      ok: false,
      url,
      at: started,
      latencyMs: Date.now() - started,
      error: `body could not be read: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  const raw = buffer.toString('utf8')
  let json = null
  try {
    json = JSON.parse(raw)
  } catch {
    json = null
  }
  return {
    ok: true,
    url,
    at: started,
    status: response.status,
    nodeIdHeader: response.headers.get('x-node-id'),
    bytes: buffer.length,
    sha256: sha256Hex(buffer),
    raw,
    json,
    latencyMs: Date.now() - started,
  }
}

/** The request must have answered 2xx AND parsed as JSON, or the comparison has no subject. */
function usable(reading) {
  return reading.ok === true && reading.status >= 200 && reading.status < 300 && reading.json !== null
}

function explainReading(reading) {
  if (!reading.ok) return `no answer: ${reading.error}`
  if (reading.status < 200 || reading.status >= 300) return `answered HTTP ${reading.status}`
  return 'answered but the body did not parse as JSON'
}

/* ---------------------------------------------------------------------------
 * Field specifications — the ONE list of what "the same facts" means
 * ------------------------------------------------------------------------- */

/**
 * Intent fields.
 *
 * Each entry names CANDIDATE paths, in order, and the FIRST that resolves is used and NAMED in the
 * output. Candidates exist because `intent.ts` is another lane's file and a served shape may nest the
 * census slightly differently; naming the path that was actually read is what keeps this harness from
 * silently comparing a field it did not find.
 */
const INTENT_FIELDS = [
  { label: 'model', paths: ['snapshot.document.index.identity.model'] },
  { label: 'dim', paths: ['snapshot.document.index.identity.dim'] },
  { label: 'vectorCount', paths: ['snapshot.document.index.identity.vectorCount'] },
  { label: 'zones.count', paths: ['snapshot.document.corpus.zones.count'] },
  { label: 'zones.of', paths: ['snapshot.document.corpus.zones.of'] },
  { label: 'inScopePlugins.count', paths: ['snapshot.document.corpus.inScopePlugins.count'] },
  { label: 'inScopePlugins.of', paths: ['snapshot.document.corpus.inScopePlugins.of'] },
  { label: 'catalogCount', paths: ['snapshot.document.corpus.catalogCount'] },
  { label: 'censusAt', paths: ['snapshot.document.censusAt'] },
  { label: 'capturedAt', paths: ['snapshot.capturedAt'] },
  { label: 'snapshotSha256', paths: ['snapshot.sha256'] },
]

const META_FIELDS = [
  { label: 'assemblyId', paths: ['snapshot.document.identity.id', 'snapshot.document.assembly.id', 'snapshot.document.id'] },
  { label: 'assemblyKind', paths: ['snapshot.document.identity.kind', 'snapshot.document.assembly.kind', 'snapshot.document.kind'] },
  { label: 'assemblyMounted', paths: ['snapshot.document.identity.mounted', 'snapshot.document.assembly.mounted', 'snapshot.document.mounted'] },
  { label: 'registeredPathCount', paths: ['snapshot.document.routes.advertised', 'snapshot.document.registeredPathCount', 'snapshot.document.assembly.registeredPathCount'] },
  {
    label: 'registeredPathsLength',
    arrayPaths: ['snapshot.document.routes.paths', 'snapshot.document.registeredPaths', 'snapshot.document.paths'],
  },
  { label: 'capturedAt', paths: ['snapshot.capturedAt'] },
  { label: 'snapshotSha256', paths: ['snapshot.sha256'] },
]

/**
 * Resolve one field against one served body.
 *
 * @returns {{ state: 'present'|'absent', value: unknown, from: string|null }}
 */
function resolveField(body, spec) {
  for (const path of spec.paths ?? []) {
    const hit = resolvePath(body, path)
    if (hit.found && hit.value !== undefined) return { state: 'present', value: hit.value, from: path }
  }
  for (const path of spec.arrayPaths ?? []) {
    const hit = resolvePath(body, path)
    if (hit.found && Array.isArray(hit.value)) return { state: 'present', value: hit.value.length, from: `${path}.length` }
  }
  return { state: 'absent', value: undefined, from: null }
}

/**
 * Compare one field across two served bodies and record exactly one check.
 *
 * The three refusal cases are stated in the FAIL detail rather than collapsed into "values differ",
 * because "both sides are null" and "the values differ" are different defects and a reader acts
 * differently on each.
 */
function compareField(prefix, spec, aBody, bBody, sink) {
  const label = `${prefix}.${spec.label}`
  const a = resolveField(aBody, spec)
  const b = resolveField(bBody, spec)

  if (a.state === 'absent' && b.state === 'absent') {
    return sink(label, 'FAIL', `ABSENT ON BOTH SIDES (a=${show(a.value)}, b=${show(b.value)}) — two non-answers are not agreement`)
  }
  if (a.state === 'absent') {
    return sink(label, 'FAIL', `ABSENT on a, PRESENT on b (b=${show(b.value)}) — a field present on one side only is a FAIL by contract`)
  }
  if (b.state === 'absent') {
    return sink(label, 'FAIL', `PRESENT on a (a=${show(a.value)}), ABSENT on b — a field present on one side only is a FAIL by contract`)
  }
  if (a.value === null && b.value === null) {
    return sink(label, 'FAIL', 'null on BOTH sides — two non-answers, not agreement')
  }
  if (a.value === null || b.value === null) {
    return sink(label, 'FAIL', `a=${show(a.value)} b=${show(b.value)} — one side answered and the other did not`)
  }
  if (typeof a.value === 'number' && !Number.isFinite(a.value)) {
    return sink(label, 'FAIL', `a=${show(a.value)} is not a finite number`)
  }
  if (typeof b.value === 'number' && !Number.isFinite(b.value)) {
    return sink(label, 'FAIL', `b=${show(b.value)} is not a finite number`)
  }
  if (typeof a.value !== typeof b.value) {
    return sink(label, 'FAIL', `TYPE differs — a=${show(a.value)} (${typeof a.value}), b=${show(b.value)} (${typeof b.value})`)
  }
  if (a.value !== b.value) {
    return sink(label, 'FAIL', `a=${show(a.value)} b=${show(b.value)} — VALUES DIFFER`)
  }
  return sink(label, 'PASS', `a=${show(a.value)} b=${show(b.value)}  (read at ${a.from}${a.from === b.from ? '' : ` / ${b.from}`})`)
}

/**
 * Compare one whole served snapshot across two nodes: every named field, then the document itself.
 *
 * @returns {{ equal: number, total: number, red: string[] }}
 */
function compareSnapshotPair(prefix, specs, aBody, bBody, sink) {
  const red = []
  const collecting = (label, status, detail) => {
    sink(label, status, detail)
    if (status !== 'PASS') red.push(label)
    return status
  }
  for (const spec of specs) compareField(prefix, spec, aBody, bBody, collecting)

  const documentLabel = `${prefix}.documentEqual`
  const aDocument = aBody?.snapshot?.document
  const bDocument = bBody?.snapshot?.document
  if (aDocument === undefined || aDocument === null || bDocument === undefined || bDocument === null) {
    collecting(documentLabel, 'FAIL', `document ABSENT (a=${show(aDocument)}, b=${show(bDocument)}) — the whole-document comparison has no subject`)
  } else {
    const differences = diffDocs(aDocument, bDocument, '(document)', [], MAX_DIFF_PATHS)
    if (differences.length === 0) {
      collecting(documentLabel, 'PASS', `whole document identical (a and b both ${Buffer.byteLength(JSON.stringify(aDocument))} B re-serialised, 0 differing paths)`)
    } else {
      collecting(documentLabel, 'FAIL', `${differences.length} differing path(s): ${differences.slice(0, 8).join(', ')}${differences.length > 8 ? ', …' : ''}`)
    }
  }
  return { red, total: specs.length + 1, equal: specs.length + 1 - red.length }
}

/* ---------------------------------------------------------------------------
 * Docker helpers (used for the independence conjunct and as a fixture fallback)
 * ------------------------------------------------------------------------- */

function runCommand(command, args, timeoutMs) {
  return new Promise((settle) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* the process may already be gone */ }
      settle({ ok: false, code: null, stdout, stderr: `${stderr}\n[timed out after ${timeoutMs}ms]`.trim() })
    }, timeoutMs ?? 60000)
    child.once('error', (error) => {
      clearTimeout(timer)
      settle({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}`.trim() })
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      settle({ ok: code === 0, code, stdout, stderr })
    })
  })
}

/**
 * Find the running container whose PUBLISHED host port matches, so the harness never hard-codes a
 * container name another lane is free to change. Returns null when nothing matches, which is a
 * reading that must be reported rather than smoothed over.
 */
async function findContainerByHostPort(hostPort) {
  const listed = await runCommand(DOCKER, ['ps', '--format', '{{.ID}}|{{.Ports}}|{{.Names}}|{{.Image}}'], 30000)
  if (!listed.ok) return { container: null, reason: `\`${DOCKER} ps\` failed: ${listed.stderr.split('\n').slice(-2).join(' ')}`, table: [] }
  const table = []
  for (const line of listed.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [id, ports, names, image] = trimmed.split('|')
    table.push({ id, ports, names, image })
    const publishes = new RegExp(`[:.]${hostPort}->`)
    if (publishes.test(ports ?? '')) return { container: table[table.length - 1], reason: null, table }
  }
  return { container: null, reason: `no running container publishes host port ${hostPort}`, table }
}

/**
 * The image id behind each node, from `docker inspect .Image`.
 *
 * Recorded as a CHECK rather than a caption because "node-a and node-b agree" means nothing if the two
 * containers were started from DIFFERENT images: that would be a comparison of two builds, dressed up as
 * an agreement between two nodes.
 */
async function readImageIdentity(name, baseUrl) {
  const hostPort = new URL(baseUrl).port || '80'
  const located = await findContainerByHostPort(hostPort)
  if (located.container === null) return { ok: false, reason: located.reason }
  const inspected = await runCommand(DOCKER, ['inspect', '--format', '{{.Image}}|{{.Config.Image}}|{{.Created}}|{{.Id}}', located.container.id], 30000)
  if (!inspected.ok) {
    return { ok: false, reason: `\`${DOCKER} inspect ${located.container.id}\` failed: ${inspected.stderr.trim().split('\n').slice(-2).join(' ')}` }
  }
  const [imageSha, imageTag, created, containerId] = inspected.stdout.trim().split('|')
  return { ok: true, name, imageSha, imageTag, created, containerId, containerName: located.container.names, hostPort }
}

/**
 * Is this command line a DIRECT invocation of one of the verify harnesses?
 *
 * **THE NAIVE TEST WAS WRONG AND THIS HARNESS MEASURED ITSELF WITH IT.** A process listing matches the
 * full command line, and every agent's shell command is itself run by a Node wrapper whose command line
 * CONTAINS the harness path as text (`node bin.ts -- bash -c "… node docker/verify/sharing.mjs …"`).
 * The first version matched those wrappers, so the harness reported 2–5 "other harnesses running" on
 * every poll, waited its whole budget, and skipped the independence conjunct — a false positive that
 * would have suppressed the very measurement it was protecting. The discriminator is that a direct run
 * ENDS with the harness path as its last argument; a wrapper's command line ends with shell syntax.
 */
function directHarnessInvocation(commandLine) {
  const text = commandLine.trim()
  if (/subprocess-local[\\/]src[\\/]bin\.ts/.test(text)) return false
  return /node(?:\.exe)?"?\s+"?[^"\s]*verify[\\/](?:consensus|anonymity|sharing)\.mjs"?\s*$/.test(text)
}

/**
 * Node processes that would be disturbed by stopping node-b.
 *
 * Stopping a container another lane is measuring is this program's own historical defect (an
 * instrument quietly changing the object under measurement), so the check is attempted and its result
 * is reported — including when it could not be read at all.
 */
async function runningHarnessProcesses() {
  const results = []
  if (process.platform === 'win32') {
    /**
     * Windows listing WITHOUT a shell interpreter: `wmic` is asked in LIST form and its key=value
     * blocks are parsed directly, so no script file and no interpreter is involved.
     * If the instrument is absent on this build, the answer is `readable: false` WITH the reason —
     * an unread listing is reported, never counted as "no other harness is running".
     */
    const listed = await runCommand('wmic', ['process', 'where', "name='node.exe'", 'get', 'ProcessId,CommandLine', '/format:list'], 30000)
    if (!listed.ok) {
      const detail = (listed.stderr.split('\n')[0] ?? '').trim()
      return { readable: false, reason: `process listing failed: ${detail.length > 0 ? detail : 'wmic did not run'}`, matches: [] }
    }
    let pendingPid = null
    let pendingCommandLine = null
    const flush = () => {
      if (pendingPid !== null && pendingCommandLine !== null && pendingPid !== process.pid && directHarnessInvocation(pendingCommandLine)) {
        results.push({ pid: pendingPid, commandLine: pendingCommandLine.trim() })
      }
      pendingPid = null
      pendingCommandLine = null
    }
    for (const rawLine of listed.stdout.split('\n')) {
      const line = rawLine.trim()
      if (line.length === 0) { flush(); continue }
      if (line.startsWith('CommandLine=')) pendingCommandLine = line.slice('CommandLine='.length)
      else if (line.startsWith('ProcessId=')) {
        const pid = Number(line.slice('ProcessId='.length))
        pendingPid = Number.isFinite(pid) ? pid : null
      }
    }
    flush()
    return { readable: true, reason: null, matches: results }
  }
  const listed = await runCommand('ps', ['-eo', 'pid=,args='], 30000)
  if (!listed.ok) return { readable: false, reason: 'process listing failed', matches: [] }
  for (const line of listed.stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = /^(\d+)\s+(.*)$/.exec(trimmed)
    if (match === null) continue
    const pid = Number(match[1])
    if (pid === process.pid) continue
    if (directHarnessInvocation(match[2])) results.push({ pid, commandLine: match[2].trim() })
  }
  return { readable: true, reason: null, matches: results }
}

/* ---------------------------------------------------------------------------
 * Fixture nodes — the positive control's instrument
 * ------------------------------------------------------------------------- */

async function waitForHealth(baseUrl, timeoutMs, exitPromise) {
  const deadline = Date.now() + timeoutMs
  let lastReason = 'no attempt made'
  while (Date.now() < deadline) {
    if (exitPromise !== undefined) {
      const exited = await Promise.race([exitPromise, Promise.resolve(SYMBOL_STILL_RUNNING)])
      if (exited !== SYMBOL_STILL_RUNNING) return { ok: false, reason: `fixture exited before answering: ${exited.detail}` }
    }
    const reading = await httpGet(`${baseUrl}/node/health`)
    if (usable(reading) && reading.json?.ok === true) return { ok: true, reading }
    lastReason = reading.ok ? `health answered HTTP ${reading.status}` : reading.error
    await delay(250)
  }
  return { ok: false, reason: `health never came up within ${timeoutMs}ms (${lastReason})` }
}

const SYMBOL_STILL_RUNNING = Symbol('still-running')

/**
 * Start a fixture node whose SNAPSHOT_DIR is a directory this harness built.
 *
 * Two strategies, in order, because either one may be unavailable on a given machine and the control
 * must say WHICH was used rather than claim a method it did not run: (a) a local process from source
 * under Node 24's native type stripping, (b) a container of the same image the real node runs.
 */
async function startFixtureNode(tag, snapshotDir, port) {
  const nodeId = `fixture-${tag}`
  const baseUrl = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    NODE_ID: nodeId,
    PORT: String(port),
    SNAPSHOT_DIR: snapshotDir,
  }
  delete env.PEER_URL

  const sourceEntry = join(CLONE_ROOT, 'src', 'node', 'index.ts')
  let localFailure = null
  if (existsSync(sourceEntry)) {
    const child = spawn(process.execPath, ['src/node/index.ts'], {
      cwd: CLONE_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const exit = new Promise((settle) => {
      child.once('exit', (code, signal) => {
        settle({ detail: `exit=${code ?? 'null'} signal=${signal ?? 'none'} stderr=${stderr.trim().split('\n').slice(-3).join(' ')}` })
      })
    })
    exit.catch(() => {})
    const health = await waitForHealth(baseUrl, FIXTURE_START_TIMEOUT_MS, exit)
    if (health.ok) {
      return {
        ok: true,
        method: 'local process from source (node src/node/index.ts)',
        nodeId,
        baseUrl,
        stdout,
        stop: async () => {
          try { child.kill() } catch { /* already gone */ }
          await Promise.race([exit, delay(3000)])
        },
      }
    }
    localFailure = health.reason
    try { child.kill() } catch { /* already gone */ }
    await Promise.race([exit, delay(2000)])
  } else {
    localFailure = `no ${sourceEntry}`
  }

  const located = await findContainerByHostPort(new URL(NODE_A_URL).port || '80')
  if (located.container === null) {
    return {
      ok: false,
      method: null,
      nodeId,
      reason: `local fixture could not start (${localFailure}); the docker fallback needs the real node's image and ${located.reason}`,
    }
  }
  const image = located.container.image
  const name = `dsh-sharing-fixture-${tag}-${Date.now()}`
  const started = await runCommand(
    DOCKER,
    ['run', '-d', '--rm', '--name', name, '-p', `${port}:8090`, '-e', `NODE_ID=${nodeId}`, '-e', 'SNAPSHOT_DIR=/app/snapshots', '-v', `${snapshotDir}:/app/snapshots:ro`, image],
    120000,
  )
  if (!started.ok) {
    return { ok: false, method: null, nodeId, reason: `local fixture failed (${localFailure}); docker run of ${image} failed: ${started.stderr.trim().split('\n').slice(-2).join(' ')}` }
  }
  const health = await waitForHealth(baseUrl, FIXTURE_START_TIMEOUT_MS)
  if (!health.ok) {
    await runCommand(DOCKER, ['rm', '-f', name], 60000)
    return { ok: false, method: null, nodeId, reason: `local fixture failed (${localFailure}); docker fixture did not become healthy: ${health.reason}` }
  }
  return {
    ok: true,
    method: `container of the real image ${image}`,
    nodeId,
    baseUrl,
    stop: async () => { await runCommand(DOCKER, ['rm', '-f', name], 60000) },
  }
}

/* ---------------------------------------------------------------------------
 * Mutation helpers for the doctored fixture
 * ------------------------------------------------------------------------- */

function bumpString(root, path, suffix) {
  const hit = getAtPath(root, path)
  if (!hit.found || typeof hit.value !== 'string') return false
  return setAtPath(root, path, `${hit.value}${suffix}`)
}

function bumpNumber(root, path) {
  const hit = getAtPath(root, path)
  if (!hit.found || typeof hit.value !== 'number') return false
  return setAtPath(root, path, hit.value + 1)
}

function flipBoolean(root, path) {
  const hit = getAtPath(root, path)
  if (!hit.found || typeof hit.value !== 'boolean') return false
  return setAtPath(root, path, !hit.value)
}

/** Drop one registered path AND its declared count together, so no internal coherence check is broken. */
function dropOneRegisteredPath(document) {
  const paths = getAtPath(document, 'routes.paths')
  if (!paths.found || !Array.isArray(paths.value) || paths.value.length === 0) return false
  paths.value.pop()
  const advertised = getAtPath(document, 'routes.advertised')
  if (advertised.found && typeof advertised.value === 'number') {
    setAtPath(document, 'routes.advertised', advertised.value - 1)
  }
  return true
}

/**
 * Build a snapshot directory for a fixture node.
 *
 * `mutations === null` is the CLEAN case: the two files are copied BYTE FOR BYTE, so the clean fixture
 * is the same artifact the real node was built from rather than a re-serialisation of it.
 *
 * A doctored document must also carry a MATCHING `documentSha256`, because `metaPackages.ts` recomputes
 * that digest on every read and refuses a snapshot it cannot verify (`TAMPERED: …`). That refusal is
 * correct and was measured here the first time this harness ran without recomputing the digest — the
 * fixture answered `available: false` and no comparison happened. Re-deriving the digest is what makes
 * the fixture a *coherently* doctored artifact: it is not editing a file behind the loader's back, it
 * is serving a snapshot that a different capture could genuinely have produced, which is precisely the
 * case the agreement check has to catch.
 */
function buildFixtureSnapshotDir(tag, mutations) {
  const dir = mkdtempSync(join(tmpdir(), `dsh-sharing-${tag}-`))
  const intentPath = join(dir, 'intent-map.json')
  const metaPath = join(dir, 'meta-packages.json')

  if (mutations === null) {
    copyFileSync(INTENT_SNAPSHOT_FILE, intentPath)
    copyFileSync(META_SNAPSHOT_FILE, metaPath)
    return { dir, appliedIntent: [], appliedMeta: [], doctored: false }
  }

  const intentEnvelope = JSON.parse(readFileSync(INTENT_SNAPSHOT_FILE, 'utf8'))
  const metaEnvelope = JSON.parse(readFileSync(META_SNAPSHOT_FILE, 'utf8'))
  const appliedIntent = mutations.intent?.(intentEnvelope.document) ?? []
  const appliedMeta = mutations.meta?.(metaEnvelope.document) ?? []

  if (mutations.envelopeSha === true) {
    intentEnvelope.sha256 = sha256Hex(Buffer.from(`doctored-intent-${tag}`, 'utf8'))
    metaEnvelope.sha256 = sha256Hex(Buffer.from(`doctored-meta-${tag}`, 'utf8'))
  }

  /**
   * Keep every recorded digest true to the document now in the file. `documentSha256` is
   * `sha256(JSON.stringify(document))` — the construction `metaPackages.ts:218` verifies — and the
   * intent envelope carries no such field today, so this is a no-op for it rather than a guess.
   */
  for (const envelope of [intentEnvelope, metaEnvelope]) {
    if (typeof envelope.documentSha256 === 'string') {
      envelope.documentSha256 = sha256Hex(Buffer.from(JSON.stringify(envelope.document), 'utf8'))
    }
  }

  writeFileSync(intentPath, JSON.stringify(intentEnvelope, null, 2), 'utf8')
  writeFileSync(metaPath, JSON.stringify(metaEnvelope, null, 2), 'utf8')
  return { dir, appliedIntent, appliedMeta, doctored: true }
}

/* ---------------------------------------------------------------------------
 * Section 1 and 2 — cross-node equality
 * ------------------------------------------------------------------------- */

function sectionSummary(prefixLabel, result) {
  const suffix = result.red.length === 0 ? 'AGREEMENT' : `DISAGREEMENT on ${result.red.length}`
  console.log(`-- ${prefixLabel}: ${result.equal} of ${result.total} compared readings equal — ${suffix}`)
}

async function compareRouteAcrossNodes({ title, path, specs, prefix }) {
  section(title)
  const a = await httpGet(`${NODE_A_URL}${path}`)
  const b = await httpGet(`${NODE_B_URL}${path}`)

  p(['a:', NODE_A_URL, 'b:', NODE_B_URL])
  const readability = []
  for (const [name, reading] of [['node-a', a], ['node-b', b]]) {
    if (!usable(reading)) {
      unmeasured(`${prefix}.${name}.answered`, `${reading.url} ${explainReading(reading)}`)
      readability.push(name)
      continue
    }
    pass(`${prefix}.${name}.answered`, `HTTP ${reading.status}, ${reading.bytes} B, sha256 ${reading.sha256.slice(0, 16)}…, nodeId=${show(reading.json?.nodeId)}`)
  }

  const availability = []
  for (const [name, reading] of [['node-a', a], ['node-b', b]]) {
    if (!usable(reading)) { availability.push(name); continue }
    const available = reading.json?.available
    if (available === true) pass(`${prefix}.${name}.available`, 'available=true (the snapshot file was found and validated)')
    else {
      fail(`${prefix}.${name}.available`, `available=${show(available)} reason=${show(reading.json?.snapshot?.reason ?? reading.json?.reason)} — two nodes sharing nothing are not sharing`)
      availability.push(name)
    }
  }

  /**
   * Each node must identify ITSELF. A node that proxied its peer would carry the PEER's id in the
   * body while the request was addressed to this node, which is the cheapest way to catch proxying.
   */
  for (const [name, reading] of [['node-a', a], ['node-b', b]]) {
    if (!usable(reading)) { unmeasured(`${prefix}.${name}.selfIdentifies`, 'no body to read an identity from'); continue }
    const bodyId = reading.json?.nodeId
    const headerId = reading.nodeIdHeader
    if (typeof bodyId !== 'string' || bodyId.length === 0) {
      fail(`${prefix}.${name}.selfIdentifies`, `body carries no nodeId (body=${show(bodyId)}, header=${show(headerId)})`)
    } else if (headerId !== null && headerId !== bodyId) {
      fail(`${prefix}.${name}.selfIdentifies`, `x-node-id header ${show(headerId)} disagrees with body nodeId ${show(bodyId)}`)
    } else {
      pass(`${prefix}.${name}.selfIdentifies`, `body nodeId=${show(bodyId)}, x-node-id=${show(headerId)}`)
    }
  }

  const result = { equal: 0, total: 0, red: [] }
  if (readability.length > 0) {
    unmeasured(`${prefix}.fieldComparison`, `${readability.length} of 2 nodes gave no usable answer, so no field was compared — a comparison with no subject is instrument failure, not agreement`)
    return { a, b, result, compared: false }
  }
  result.total = specs.length + 1
  const compared = compareSnapshotPair(prefix, specs, a.json, b.json, (label, status, detail) => {
    record(label, status, detail)
    if (status !== 'PASS') result.red.push(label)
  })
  result.equal = specs.length + 1 - result.red.length
  sectionSummary(prefix, result)
  return { a, b, result, compared: true }
}

/** Print a set of values on one line, used for the header readings. */
function p(values) {
  console.log(values.map((value) => String(value)).join(' '))
}

/* ---------------------------------------------------------------------------
 * Section 3 — independence
 * ------------------------------------------------------------------------- */

async function proveIndependence({ aIntentBefore, aMetaBefore }) {
  section(`3. INDEPENDENCE — does node-a answer from its OWN snapshot while node-b is down?`)

  const located = await findContainerByHostPort(new URL(NODE_B_URL).port || '80')
  if (located.container === null) {
    unmeasured('independence.nodeBContainer', `${located.reason}; container table had ${located.table.length} row(s) — nothing was stopped, so independence was NOT probed`)
    return { restarted: false, bIntentAfter: null, bMetaAfter: null }
  }
  note(`node-b container ${located.container.id} (${located.container.names}) publishes the port; ${located.table.length} running container(s) listed`)

  /**
   * Wait for a quiet moment before stopping a container another lane may be measuring.
   *
   * The poll is bounded: if other harnesses are still running after the budget, this conjunct reports
   * NOT MEASURED rather than stopping node-b under them. A measurement that damages a peer's
   * measurement is the same defect class as an instrument that changes its own subject, and this
   * program has paid for that one with a deleted tree.
   */
  const waitBudgetMs = readPositiveInt(process.env.HARNESS_QUIET_WAIT_MS, 90000, 'HARNESS_QUIET_WAIT_MS')
  const deadline = Date.now() + waitBudgetMs
  let harnesses = await runningHarnessProcesses()
  while (harnesses.readable && harnesses.matches.length > 0 && Date.now() < deadline) {
    note(`waiting for ${harnesses.matches.length} other harness process(es) (${harnesses.matches.map((match) => match.pid).join(', ')}) to finish before touching node-b; ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s left of the budget`)
    await delay(10000)
    harnesses = await runningHarnessProcesses()
  }

  if (!harnesses.readable) {
    note(`concurrent-harness detection could NOT be read (${harnesses.reason}); the stop below may disturb another lane's measurement and that possibility is recorded rather than assumed away`)
  } else if (harnesses.matches.length > 0) {
    unmeasured(
      'independence.noConcurrentHarness',
      `${harnesses.matches.length} other harness process(es) still running after ${Math.round(waitBudgetMs / 1000)}s (${harnesses.matches.map((match) => match.pid).join(', ')}); stopping node-b would corrupt their measurement, so this conjunct was NOT probed`,
    )
    return { restarted: false, bIntentAfter: null, bMetaAfter: null }
  } else {
    pass('independence.noConcurrentHarness', '0 other verify/*.mjs harness processes were running when the stop was attempted')
  }

  let containerId = located.container.id
  let stopped = false
  try {
    let stop = await runCommand(DOCKER, ['stop', containerId], 60000)
    /**
     * The stack is rebuilt by other lanes, so the id discovered a moment ago can be gone by the time the
     * stop runs — measured here as `No such container: 5a2617e8f126` while a recreate was in flight. That
     * is a race in the environment, not a defect of the node, so the container is re-discovered ONCE by
     * its published port and the stop is retried; a second failure is reported rather than retried again.
     */
    if (!stop.ok && /no such container/i.test(stop.stderr)) {
      const refreshed = await findContainerByHostPort(new URL(NODE_B_URL).port || '80')
      if (refreshed.container !== null && refreshed.container.id !== containerId) {
        note(`node-b was replaced between discovery and stop (${containerId} → ${refreshed.container.id}); re-discovered by published port and stopping the CURRENT container`)
        containerId = refreshed.container.id
        stop = await runCommand(DOCKER, ['stop', containerId], 60000)
      }
    }
    if (!stop.ok) {
      unmeasured('independence.stoppedNodeB', `\`${DOCKER} stop ${containerId}\` failed (exit ${stop.code}): ${stop.stderr.trim().split('\n').slice(-2).join(' ')}`)
      return { restarted: false, bIntentAfter: null, bMetaAfter: null }
    }
    stopped = true
    pass('independence.stoppedNodeB', `container ${containerId} stopped (exit 0); peer is now genuinely down`)

    /** Confirm the peer really is unreachable, otherwise "node-a answered" proves nothing. */
    const peerProbe = await httpGet(`${NODE_B_URL}/node/health`)
    if (peerProbe.ok && peerProbe.status !== undefined && peerProbe.status >= 200 && peerProbe.status < 300) {
      fail('independence.peerActuallyDown', `node-b still answered HTTP ${peerProbe.status} after the stop — the instrument did not remove the peer, so the readings below are void`)
    } else {
      pass('independence.peerActuallyDown', `${explainReading(peerProbe)} — the peer is not answering, which is what makes the next reading evidence`)
    }

    for (const [label, path, before] of [
      ['intent', '/node/intent', aIntentBefore],
      ['meta-packages', '/node/meta-packages', aMetaBefore],
    ]) {
      if (before === null || !usable(before)) {
        unmeasured(`independence.nodeA.${label}`, `no pre-stop reading of node-a ${path} to compare against`)
        continue
      }
      const during = await httpGet(`${NODE_A_URL}${path}`)
      if (!usable(during)) {
        fail(`independence.nodeA.${label}DuringPeerDown`, `${during.url} ${explainReading(during)} — node-a stopped answering when node-b went down, which means node-a DEPENDS on node-b: that is the finding this conjunct exists to catch`)
        continue
      }
      pass(`independence.nodeA.${label}DuringPeerDown`, `HTTP ${during.status}, ${during.bytes} B, ${during.latencyMs}ms, sha256 ${during.sha256.slice(0, 16)}… while node-b was down`)
      if (during.latencyMs > INDEPENDENCE_LATENCY_BUDGET_MS) {
        fail(`independence.nodeA.${label}Latency`, `${during.latencyMs}ms exceeds the ${INDEPENDENCE_LATENCY_BUDGET_MS}ms budget a proxy to a dead peer would blow; a cached local answer does not`)
      } else {
        pass(`independence.nodeA.${label}Latency`, `${during.latencyMs}ms <= ${INDEPENDENCE_LATENCY_BUDGET_MS}ms budget`)
      }
      if (during.sha256 === before.sha256) {
        pass(`independence.nodeA.${label}Unchanged`, `served body byte-identical to the pre-stop body (sha256 ${during.sha256.slice(0, 16)}…)`)
      } else {
        fail(`independence.nodeA.${label}Unchanged`, `served body CHANGED when the peer went down: before ${before.sha256.slice(0, 16)}… after ${during.sha256.slice(0, 16)}… — the answer was not a local constant`)
      }
    }
  } finally {
    if (stopped) {
      const started = await runCommand(DOCKER, ['start', containerId], 120000)
      if (!started.ok) {
        fail('independence.nodeBRestarted', `\`${DOCKER} start ${containerId}\` failed (exit ${started.code}): ${started.stderr.trim().split('\n').slice(-2).join(' ')} — the stack is LEFT WITH node-b DOWN and this must be repaired by hand`)
      } else {
        pass('independence.nodeBRestarted', `container ${containerId} started (exit 0)`)
      }
    }
  }

  const healthy = await waitForHealth(NODE_B_URL, 30000)
  if (!healthy.ok) {
    unmeasured('independence.nodeBHealthyAfterRestart', healthy.reason)
    return { restarted: stopped, bIntentAfter: null, bMetaAfter: null }
  }
  note(`node-b health after restart: ${healthy.reading.bytes} B, sha256 ${healthy.reading.sha256.slice(0, 16)}…`)

  /**
   * The stronger reading: after a process restart node-b serves the SAME snapshot it served before.
   * A node that computed its facts would be entitled to differ; a node reading a baked artifact is not.
   */
  const bIntentAfter = await httpGet(`${NODE_B_URL}/node/intent`)
  const bMetaAfter = await httpGet(`${NODE_B_URL}/node/meta-packages`)
  for (const [label, after, path] of [['intent', bIntentAfter, '/node/intent'], ['meta-packages', bMetaAfter, '/node/meta-packages']]) {
    if (!usable(after)) {
      unmeasured(`independence.nodeB.${label}AfterRestart`, `${after.url} ${explainReading(after)}`)
      continue
    }
    const digest = after.json?.snapshot?.sha256
    if (typeof digest !== 'string') {
      fail(`independence.nodeB.${label}AfterRestart`, `served snapshot carries no sha256 (${show(digest)})`)
      continue
    }
    pass(`independence.nodeB.${label}AfterRestart`, `node-b serves snapshot sha256 ${digest.slice(0, 16)}… after the restart`)
  }
  return { restarted: stopped, bIntentAfter, bMetaAfter }
}

/* ---------------------------------------------------------------------------
 * Section 4 — precalculation
 * ------------------------------------------------------------------------- */

function readSnapshotFile(path) {
  if (!existsSync(path)) return { ok: false, reason: `${path} does not exist on the host` }
  const buffer = readFileSync(path)
  let json = null
  try {
    json = JSON.parse(buffer.toString('utf8'))
  } catch (error) {
    return { ok: false, reason: `${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  return { ok: true, path, bytes: buffer.length, fileSha256: sha256Hex(buffer), json }
}

async function provePrecalculation({ aIntentBefore, aMetaBefore, bIntentBefore, bMetaBefore }) {
  section('4. PRECALCULATION — is the served fact a build artifact rather than a per-request computation?')

  /**
   * FIRST, ask whether the PROCESS that answered is still the same process.
   *
   * A container recreation between the two calls replaces the ARTIFACT as well as the process, so two
   * differing bodies would say nothing about per-request computation. The first version of this harness
   * reported `the route is computing per request` on 2026-10-19 while three lanes were rebuilding the
   * stack — a confident, wrong finding, because the instrument had changed its own subject. The
   * container ids are re-read from `docker inspect` here and compared with section 0's.
   */
  const nowImageA = await readImageIdentity('node-a', NODE_A_URL)
  const nowImageB = await readImageIdentity('node-b', NODE_B_URL)
  const replaced = []
  for (const [nodeName, now, before] of [['node-a', nowImageA, measuredUnder.nodeA], ['node-b', nowImageB, measuredUnder.nodeB]]) {
    if (before === null) continue
    if (!now.ok) {
      note(`could not re-read ${nodeName}'s container id (${now.reason}); a replacement between the two calls cannot be ruled out, and that risk is recorded rather than assumed away`)
      continue
    }
    if (now.containerId !== before.containerId) replaced.push(nodeName)
  }
  if (replaced.length > 0) {
    note(`CONTAINER REPLACED between section 0 and this section for ${replaced.join(', ')} — the byte-identity and capturedAt pairs for those nodes are VOID rather than failed, because a DIFFERENT ARTIFACT answered the second call`)
  } else if (nowImageA.ok && nowImageB.ok) {
    pass('precalc.containersStable', `both containers are still the processes section 0 measured (${nowImageA.containerId.slice(0, 12)}, ${nowImageB.containerId.slice(0, 12)}), so a body difference would belong to the node and not to a rebuild`)
  } else {
    unmeasured('precalc.containersStable', 'the container ids could not be re-read, so stability of the pair is unproven')
  }

  /**
   * Two calls separated in time must return a BYTE-IDENTICAL body. The raw bytes are compared, not a
   * parsed value, because a parsed comparison forgives key reordering and whitespace — exactly the
   * differences a recomputation would show.
   */
  const readings = [
    ['intent', 'node-a', NODE_A_URL, '/node/intent', aIntentBefore],
    ['intent', 'node-b', NODE_B_URL, '/node/intent', bIntentBefore],
    ['meta-packages', 'node-a', NODE_A_URL, '/node/meta-packages', aMetaBefore],
    ['meta-packages', 'node-b', NODE_B_URL, '/node/meta-packages', bMetaBefore],
  ]

  note(`waiting ${GAP_MS}ms between the first and the second call, so the two readings are separated in time rather than in code`)
  await delay(GAP_MS)

  for (const [label, nodeName, baseUrl, path, before] of readings) {
    const key = `precalc.${label}.${nodeName}`
    if (before === null || !usable(before)) {
      unmeasured(`${key}.secondCall`, `no first reading of ${baseUrl}${path} to repeat`)
      continue
    }
    if (replaced.includes(nodeName)) {
      unmeasured(`${key}.byteIdentical`, `${nodeName}'s container was replaced between the two calls, so this pair compares two different artifacts and says nothing about per-request computation`)
      unmeasured(`${key}.capturedAtStable`, `${nodeName}'s container was replaced between the two calls; the stamps belong to different artifacts`)
      continue
    }
    const after = await httpGet(`${baseUrl}${path}`)
    if (!usable(after)) {
      fail(`${key}.secondCall`, `${after.url} ${explainReading(after)}`)
      continue
    }
    const gap = after.at - before.at
    if (after.sha256 === before.sha256 && after.raw === before.raw) {
      pass(`${key}.byteIdentical`, `two calls ~${gap}ms apart returned byte-identical bodies: ${after.bytes} B, sha256 ${after.sha256.slice(0, 16)}…`)
    } else {
      fail(`${key}.byteIdentical`, `bodies differ between two calls ~${gap}ms apart: ${before.bytes} B ${before.sha256.slice(0, 16)}… vs ${after.bytes} B ${after.sha256.slice(0, 16)}… — the route is computing per request`)
    }
    const beforeStamp = before.json?.snapshot?.capturedAt
    const afterStamp = after.json?.snapshot?.capturedAt
    if (beforeStamp !== undefined && beforeStamp !== null && beforeStamp === afterStamp) {
      pass(`${key}.capturedAtStable`, `capturedAt=${show(afterStamp)} on both calls`)
    } else {
      fail(`${key}.capturedAtStable`, `capturedAt moved or is absent: ${show(beforeStamp)} then ${show(afterStamp)}`)
    }
  }

  /**
   * The served identity must equal the FILE's recorded identity. This is the conjunct that ties the
   * container's answer to the artifact in `docker/snapshots/` instead of to whatever the process holds
   * in memory; the recorded `sha256` is over the original HTTP body, so it is compared as a recorded
   * value and never recomputed from the file's JSON (re-serialisation is not byte-identical).
   */
  let fileIntentReading = aIntentBefore
  let fileMetaReading = aMetaBefore
  if (replaced.includes('node-a')) {
    const freshIntent = await httpGet(`${NODE_A_URL}/node/intent`)
    const freshMeta = await httpGet(`${NODE_A_URL}/node/meta-packages`)
    if (usable(freshIntent)) fileIntentReading = freshIntent
    if (usable(freshMeta)) fileMetaReading = freshMeta
    note('re-read node-a after the replacement, so the served-vs-file comparison below is against the CURRENT artifact rather than the previous one')
  }

  const fileMismatches = []
  for (const [label, fileResult, served] of [
    ['intent', readSnapshotFile(INTENT_SNAPSHOT_FILE), fileIntentReading],
    ['meta-packages', readSnapshotFile(META_SNAPSHOT_FILE), fileMetaReading],
  ]) {
    const key = `precalc.${label}.file`
    if (!fileResult.ok) {
      fail(`${key}.readable`, fileResult.reason)
      continue
    }
    pass(`${key}.readable`, `${fileResult.path}: ${fileResult.bytes} B on disk, sha256(file bytes)=${fileResult.fileSha256.slice(0, 16)}…, recorded sha256=${show(fileResult.json?.sha256)}`)
    if (served === null || !usable(served)) {
      unmeasured(`${key}.servedMatchesFile`, 'no usable served body to compare against the file')
      continue
    }
    const servedSnapshot = served.json?.snapshot
    if (servedSnapshot?.sha256 === fileResult.json?.sha256) {
      pass(`${key}.servedSha256`, `served sha256 ${String(servedSnapshot.sha256).slice(0, 16)}… equals the file's recorded sha256`)
    } else {
      fail(`${key}.servedSha256`, `served ${show(servedSnapshot?.sha256)} differs from the file's recorded ${show(fileResult.json?.sha256)}`)
      fileMismatches.push(label)
    }
    if (servedSnapshot?.capturedAt === fileResult.json?.capturedAt) {
      pass(`${key}.servedCapturedAt`, `served capturedAt=${show(servedSnapshot?.capturedAt)} equals the file's`)
    } else {
      fail(`${key}.servedCapturedAt`, `served ${show(servedSnapshot?.capturedAt)} differs from the file's ${show(fileResult.json?.capturedAt)}`)
    }
    const differences = diffDocs(servedSnapshot?.document, fileResult.json?.document, '(document)', [], MAX_DIFF_PATHS)
    if (servedSnapshot?.document === undefined || servedSnapshot?.document === null) {
      fail(`${key}.servedDocument`, 'the served snapshot carries no document, so nothing served can be tied to the file')
    } else if (differences.length === 0) {
      pass(`${key}.servedDocument`, 'the served document is identical, path for path, to the document recorded in the file')
    } else {
      fail(`${key}.servedDocument`, `${differences.length} differing path(s): ${differences.slice(0, 8).join(', ')}`)
    }
  }

  if (fileMismatches.length > 0) {
    /**
     * The diagnosis, stated so a reader acts on the right thing. If the two NODES agree with each other
     * while the file on disk says something else, the sharing claim still holds and the DEFECT is that
     * the deployed image is not the artifact in the repository — a rebuild, not a routing bug. The
     * sections above prove the cross-node half independently, so this note can say which half failed.
     */
    note(
      `served-vs-file mismatch on ${fileMismatches.length} of 2 route(s) (${fileMismatches.join(', ')}): the cross-node comparison in sections 1 and 2 is a SEPARATE conjunct, so if those were GREEN the two nodes agree with each other and the deployed image simply does not carry the snapshot now committed under docker/snapshots/ — a stale image, not a sharing failure`,
    )
  } else {
    note('served-vs-file: 0 of 2 routes mismatch — the deployed nodes serve exactly the artifacts committed under docker/snapshots/')
  }


  /**
   * EXTRA, and explicitly not part of the pass count: if the live capture source is still reachable,
   * re-hash its body and compare with the recorded sha256. It only means something when the source has
   * not moved since the capture, so a moved source is reported as NOT COMPARABLE rather than as a
   * failure of the node.
   */
  const intentFile = readSnapshotFile(INTENT_SNAPSHOT_FILE)
  if (intentFile.ok && typeof intentFile.json?.source === 'string') {
    const source = intentFile.json.source
    const live = await httpGet(source)
    if (!usable(live)) {
      note(`source re-hash NOT MEASURED: ${source} ${explainReading(live)} — this is an extra reading and is excluded from the pass count`)
    } else if (live.json?.censusAt !== intentFile.json?.document?.censusAt) {
      note(`source re-hash NOT COMPARABLE: the live source's censusAt (${show(live.json?.censusAt)}) has moved since the capture (${show(intentFile.json?.document?.censusAt)}), so its sha256 cannot equal the recorded one for a reason that says nothing about the node`)
    } else if (live.sha256 === intentFile.json?.sha256) {
      note(`source re-hash AGREES: sha256 of the live ${source} body ${live.sha256.slice(0, 16)}… equals the snapshot file's recorded sha256 — the artifact records the bytes that source actually served`)
    } else {
      note(`source re-hash DISAGREES: live body ${live.bytes} B sha256 ${live.sha256.slice(0, 16)}… against recorded ${show(intentFile.json?.sha256)}; same censusAt, so this is a real divergence and worth a reader's attention`)
    }
  }
}

/* ---------------------------------------------------------------------------
 * Section 5 — the positive control
 * ------------------------------------------------------------------------- */

/**
 * Start a fixture node on a snapshot directory, read both routes from it, and stop it.
 *
 * The two identity assertions matter more than they look: a stale server already listening on the
 * fixture port would answer happily, and a reading from a server this harness did not start is not the
 * fixture's reading. `available: false` is reported as its own outcome because a fixture that could not
 * serve a document has not exercised the comparison at all.
 */
async function readFixture({ tag, snapshotDir, port }) {
  const fixture = await startFixtureNode(tag, snapshotDir, port)
  if (!fixture.ok) return { ok: false, reason: `fixture ${tag} could not be started: ${fixture.reason}` }
  try {
    note(`fixture ${fixture.nodeId} running as ${fixture.method} on port ${port}`)
    const intent = await httpGet(`${fixture.baseUrl}/node/intent`)
    const meta = await httpGet(`${fixture.baseUrl}/node/meta-packages`)
    for (const [name, reading] of [['intent', intent], ['meta-packages', meta]]) {
      if (!usable(reading)) return { ok: false, reason: `fixture ${tag} did not answer ${name}: ${explainReading(reading)}` }
      if (reading.json?.nodeId !== fixture.nodeId) {
        return { ok: false, reason: `${name} was answered by ${show(reading.json?.nodeId)} and not by fixture ${fixture.nodeId}, so this reading is not the fixture's` }
      }
      if (reading.json?.available !== true) {
        return { ok: false, reason: `fixture ${tag} REFUSED the ${name} snapshot (available=false, reason=${show(reading.json?.snapshot?.reason)})` }
      }
    }
    return { ok: true, intent: intent.json, meta: meta.json, method: fixture.method, nodeId: fixture.nodeId }
  } finally {
    await fixture.stop()
  }
}

/**
 * One control case: build a doctored snapshot dir, start a fixture node on it, and compare that node
 * against the REAL node-a with the same comparator the equality sections use.
 *
 * The assertion is not "the fixture differs"; it is "the comparator reports RED on exactly the labels
 * this case mutated". A comparator that was always red would fail the GREEN half of the pair, and one
 * that was always green fails here — so the pair is the check.
 */
async function runControlCase({ caseTag, mutations, expectedIntentFields, expectedMetaFields, expectation, baselineIntent, baselineMeta, port }) {
  console.log(`\n-- control case ${caseTag}: ${expectation}`)
  const built = buildFixtureSnapshotDir(caseTag, mutations)
  const applied = { intent: built.appliedIntent, meta: built.appliedMeta }
  let fixture = null
  const outcome = {
    caseTag,
    ran: false,
    redIntent: [],
    redMeta: [],
    skipped: null,
    method: null,
    expectedIntent: expectedIntentFields.map((field) => `control.${caseTag}.intent.${field}`),
    expectedMeta: expectedMetaFields.map((field) => `control.${caseTag}.meta.${field}`),
  }
  try {
    if (applied.intent.length === 0 && applied.meta.length === 0 && mutations.envelopeSha !== true) {
      outcome.skipped = 'no mutation could be applied to the snapshot documents, so this case would test nothing'
      return outcome
    }
    fixture = await startFixtureNode(caseTag, built.dir, port)
    if (!fixture.ok) {
      outcome.skipped = `fixture node could not be started: ${fixture.reason}`
      return outcome
    }
    outcome.method = fixture.method
    note(`fixture ${fixture.nodeId} running as ${fixture.method}`)
    const intentReading = await httpGet(`${fixture.baseUrl}/node/intent`)
    const metaReading = await httpGet(`${fixture.baseUrl}/node/meta-packages`)
    for (const [name, reading] of [['intent', intentReading], ['meta-packages', metaReading]]) {
      if (!usable(reading)) {
        outcome.skipped = `fixture did not answer ${name}: ${explainReading(reading)}`
        return outcome
      }
      if (reading.json?.nodeId !== fixture.nodeId) {
        outcome.skipped = `${name} was answered by ${show(reading.json?.nodeId)} and not by the fixture ${fixture.nodeId}, so this reading is not the fixture's`
        return outcome
      }
      if (reading.json?.available !== true) {
        outcome.skipped = `the fixture REFUSED the doctored ${name} snapshot (available=false, reason=${show(reading.json?.snapshot?.reason)}) — the loader's own validation rejected the mutation, so this case cannot serve as a control`
        return outcome
      }
    }
    outcome.ran = true
    compareSnapshotPair(`control.${caseTag}.intent`, INTENT_FIELDS, baselineIntent, intentReading.json, (label, status, detail) => {
      observe(label, status, detail)
      if (status !== 'PASS') outcome.redIntent.push(label)
    })
    compareSnapshotPair(`control.${caseTag}.meta`, META_FIELDS, baselineMeta, metaReading.json, (label, status, detail) => {
      observe(label, status, detail)
      if (status !== 'PASS') outcome.redMeta.push(label)
    })
    outcome.fixtureIntent = intentReading.json
    outcome.fixtureMeta = metaReading.json
    /**
     * In a DOCUMENT case the body digest must stay EQUAL: the doctored envelope keeps the `sha256` it
     * was captured with, so only the document comparison can see the edit. That reading is recorded
     * here because it is the evidence that the whole-document conjunct is load-bearing rather than a
     * second copy of the sha256 check.
     */
    outcome.documentCaseSha256Equal = intentReading.json?.snapshot?.sha256 === baselineIntent?.snapshot?.sha256
      && metaReading.json?.snapshot?.sha256 === baselineMeta?.snapshot?.sha256
      && mutations.envelopeSha !== true
    return outcome
  } finally {
    if (fixture !== null && fixture.ok === true) await fixture.stop()
    try { rmSync(built.dir, { recursive: true, force: true }) } catch { /* a leftover temp dir is not a measurement */ }
  }
}

// Module-level references to node-a's real bodies, captured in sections 1 and 2 and reused by the
// control. They are the SAME objects the equality sections compared, so the control cannot accidentally
// compare against a different node-a answer than the one that was certified GREEN.
let aIntentBody = null
let aMetaBody = null

async function positiveControl() {
  section('5. POSITIVE CONTROL — can the equality comparison be driven RED?')

  if (!existsSync(INTENT_SNAPSHOT_FILE) || !existsSync(META_SNAPSHOT_FILE)) {
    unmeasured(
      'control.snapshotFilesReadable',
      `${existsSync(INTENT_SNAPSHOT_FILE) ? '' : INTENT_SNAPSHOT_FILE + ' '}${existsSync(META_SNAPSHOT_FILE) ? '' : META_SNAPSHOT_FILE + ' '}absent on the host, so a doctored copy cannot be built`,
    )
    return { cases: [], baseline: false }
  }

  /**
   * THE GREEN HALF, built from the SNAPSHOT FILES rather than from node-a — and the choice is a
   * measurement decision, not a convenience.
   *
   * Two clean fixture nodes are started from two byte-for-byte copies of the same two files. They must
   * agree on every compared reading, or the comparator reports a difference where there is none and a
   * RED doctored reading would prove nothing. Comparing against node-a here would instead test whether
   * the DEPLOYED image matches the file on disk — which is section 4's subject, and which currently
   * FAILS for meta-packages. Folding that drift into the control would make the control uninterpretable
   * for a reason that has nothing to do with whether the comparison can see an edit.
   */
  const cleanDirs = [buildFixtureSnapshotDir('clean-one', null), buildFixtureSnapshotDir('clean-two', null)]
  let first = null
  let second = null
  try {
    first = await readFixture({ tag: 'clean-one', snapshotDir: cleanDirs[0].dir, port: FIXTURE_PORT })
    if (first.ok) second = await readFixture({ tag: 'clean-two', snapshotDir: cleanDirs[1].dir, port: FIXTURE_PORT + 1 })
  } finally {
    for (const built of cleanDirs) {
      try { rmSync(built.dir, { recursive: true, force: true }) } catch { /* a leftover temp dir is not a measurement */ }
    }
  }

  if (first === null || !first.ok) {
    unmeasured('control.cleanPairGreen', `the first clean fixture could not serve the snapshots: ${first?.reason ?? 'not attempted'}`)
    return { cases: [], baseline: false }
  }
  if (second === null || !second.ok) {
    unmeasured('control.cleanPairGreen', `the second clean fixture could not serve the snapshots: ${second.reason}`)
    return { cases: [], baseline: false }
  }

  const cleanRed = []
  const cleanSink = (label, status) => { if (status !== 'PASS') cleanRed.push(label) }
  compareSnapshotPair('control.cleanPair.intent', INTENT_FIELDS, first.intent, second.intent, cleanSink)
  compareSnapshotPair('control.cleanPair.meta', META_FIELDS, first.meta, second.meta, cleanSink)
  const cleanTotal = INTENT_FIELDS.length + 1 + META_FIELDS.length + 1
  controlTally.cleanRed = cleanRed.length
  controlTally.cleanTotal = cleanTotal
  if (cleanRed.length === 0) {
    pass('control.cleanPairGreen', `0 of ${cleanTotal} compared readings differ between two fixture nodes started from byte-identical snapshot copies — the comparator is not always red`)
  } else {
    fail('control.cleanPairGreen', `${cleanRed.length} of ${cleanTotal} readings disagreed between two clean fixtures copied from the same bytes (${cleanRed.join(', ')}) — the comparator sees a difference where there is none, so a RED doctored reading below would prove nothing`)
  }

  /**
   * Where the deployed node-a stands relative to these files, stated as a reading rather than folded
   * into the control. Section 4 already charges the mismatch; this note says in one line WHAT it is.
   */
  if (aMetaBody !== null && typeof aMetaBody === 'object') {
    const drift = diffDocs(first.meta?.snapshot?.document, aMetaBody.snapshot?.document, '(document)', [], MAX_DIFF_PATHS)
    if (drift.length === 0) {
      note('the clean fixture and DEPLOYED node-a serve the same meta-packages document')
    } else {
      note(
        `the clean fixture (from docker/snapshots/meta-packages.json, capturedAt ${show(first.meta?.snapshot?.capturedAt)}) differs from DEPLOYED node-a (capturedAt ${show(aMetaBody.snapshot?.capturedAt)}) in ${drift.length} path(s): ${drift.slice(0, 5).join(', ')} — the DEPLOYED IMAGE PREDATES THE FILE ON DISK; that is section 4's finding and it is why the control's baseline is the clean pair`,
      )
    }
  }

  const cases = []
  cases.push(
    await runControlCase({
      caseTag: 'strings',
      mutations: {
        intent: (document) => {
          const applied = []
          if (bumpString(document, 'index.identity.model', '-doctored')) applied.push('intent.model')
          return applied
        },
        meta: (document) => {
          const applied = []
          if (bumpString(document, 'identity.id', '-doctored')) applied.push('meta.assemblyId')
          if (bumpString(document, 'identity.kind', '-doctored')) applied.push('meta.assemblyKind')
          return applied
        },
      },
      expectedIntentFields: ['model'],
      expectedMetaFields: ['assemblyId', 'assemblyKind'],
      expectation: 'a doctored STRING identity must be caught by the named-field comparison',
      baselineIntent: first.intent,
      baselineMeta: first.meta,
      port: FIXTURE_PORT,
    }),
  )

  cases.push(
    await runControlCase({
      caseTag: 'counts',
      mutations: {
        intent: (document) => {
          const applied = []
          if (bumpNumber(document, 'index.identity.dim')) applied.push('intent.dim')
          if (bumpNumber(document, 'corpus.catalogCount')) applied.push('intent.catalogCount')
          return applied
        },
        meta: (document) => {
          const applied = []
          if (dropOneRegisteredPath(document)) {
            applied.push('meta.registeredPathCount')
            applied.push('meta.registeredPathsLength')
          }
          return applied
        },
      },
      expectedIntentFields: ['dim', 'catalogCount'],
      expectedMetaFields: ['registeredPathCount', 'registeredPathsLength'],
      expectation: 'doctored COUNTS (a dimension, the catalog count, and one registered path dropped together with its declared count so the document stays internally coherent) must be caught',
      baselineIntent: first.intent,
      baselineMeta: first.meta,
      port: FIXTURE_PORT,
    }),
  )

  cases.push(
    await runControlCase({
      caseTag: 'sha256',
      mutations: { envelopeSha: true },
      expectedIntentFields: ['snapshotSha256'],
      expectedMetaFields: ['snapshotSha256'],
      expectation: 'a doctored snapshot sha256 must be caught by the sha256 comparison, while the documents stay equal',
      baselineIntent: first.intent,
      baselineMeta: first.meta,
      port: FIXTURE_PORT,
    }),
  )

  /**
   * A FOURTH control, and the one that guards this harness's own rule about NON-ANSWERS.
   *
   * A node given an EMPTY SNAPSHOT_DIR must serve `available: false` with a non-null reason, and the
   * availability predicate the equality sections use (`available === true`) must refuse it. Two nodes
   * serving `null` in every field must never compare as equal: `null === null` is two non-answers, and a
   * comparator that treated it as agreement would be a caption exactly when the artifacts were missing.
   */
  const emptyDir = mkdtempSync(join(tmpdir(), 'dsh-sharing-absent-'))
  let absent = null
  try {
    absent = await readFixture({ tag: 'absent', snapshotDir: emptyDir, port: FIXTURE_PORT })
  } finally {
    try { rmSync(emptyDir, { recursive: true, force: true }) } catch { /* a leftover temp dir is not a measurement */ }
  }
  if (absent !== null && absent.ok === true) {
    fail('control.absentSnapshot.detected', 'a fixture with an EMPTY snapshot directory served available:true — an absent artifact was reported as a reading, which is the absent-is-not-zero defect at its source')
  } else if (absent !== null) {
    const text = String(absent.reason ?? '')
    if (/available=false/.test(text) && /reason="[^"]+"/.test(text)) {
      pass('control.absentSnapshot.detected', `a fixture with an EMPTY snapshot directory was refused by the same predicate the equality sections use — ${text}`)
    } else {
      fail('control.absentSnapshot.detected', `the empty-snapshot fixture failed for a reason that does not name unavailability: ${text}`)
    }
  }

  const ran = cases.filter((outcome) => outcome.ran)
  const skipped = cases.filter((outcome) => !outcome.ran)
  controlTally.casesTotal = cases.length
  for (const outcome of skipped) {
    unmeasured(`control.${outcome.caseTag}.ran`, `case did NOT run: ${outcome.skipped}`)
  }
  if (ran.length === 0) {
    unmeasured('control.anyCaseRan', `0 of ${cases.length} control cases ran, so the equality check has NOT been shown able to fail — it is a caption until it is`)
    return { cases, baseline: false }
  }

  let detected = 0
  let injected = 0
  for (const outcome of ran) {
    const expected = [...outcome.expectedIntent, ...outcome.expectedMeta]
    const actual = new Set([...outcome.redIntent, ...outcome.redMeta])
    const missing = expected.filter((label) => !actual.has(label))
    injected += expected.length
    detected += expected.length - missing.length
    const key = `control.${outcome.caseTag}`
    if (missing.length === 0) {
      pass(`${key}.detected`, `${expected.length} of ${expected.length} mutated label(s) reported RED: ${expected.join(', ')}`)
    } else {
      fail(`${key}.detected`, `mutated ${expected.length} label(s) but only ${expected.length - missing.length} came back RED; MISSING: ${missing.join(', ')}; red were: ${[...actual].join(', ')}`)
    }
    /**
     * The whole-document comparison must also be RED in a document case: it is the conjunct that
     * catches a field nobody named, so a document mutation it missed would be a real gap.
     */
    if (outcome.caseTag !== 'sha256') {
      const documentLabels = [outcome.redIntent, outcome.redMeta].flat().filter((label) => label.endsWith('.documentEqual'))
      if (documentLabels.length === 2) {
        pass(`${key}.documentEqualRed`, 'both whole-document comparisons reported RED, as they must when a document was mutated')
      } else {
        fail(`${key}.documentEqualRed`, `expected 2 RED whole-document comparisons, observed ${documentLabels.length} (${documentLabels.join(', ') || 'none'})`)
      }
      if (outcome.documentCaseSha256Equal === true) {
        pass(`${key}.digestUnmoved`, 'the served snapshot sha256 was EQUAL to the baseline throughout this case, so the RED readings above came from the DOCUMENT comparison and could not have come from the digest')
      } else {
        fail(`${key}.digestUnmoved`, 'the served snapshot sha256 also moved in this document case, so a RED reading cannot be attributed to the document conjunct')
      }
    } else {
      /**
       * The mirror image, and the sharpest single reading in this file: in the sha256 case the served
       * documents are UNTOUCHED, so the document comparison must stay GREEN while the sha256 comparison
       * goes RED. That is the evidence that the two conjuncts are independent rather than the same
       * check written twice.
       */
      const documentRed = [...outcome.redIntent, ...outcome.redMeta].some((label) => label.endsWith('.documentEqual'))
      const shaRed = [...outcome.redIntent, ...outcome.redMeta].filter((label) => label.endsWith('.snapshotSha256'))
      if (!documentRed && shaRed.length === 2) {
        pass(
          'control.conjunctIndependence',
          `documents stayed EQUAL while both sha256 comparisons went RED (${shaRed.join(', ')}) — the sha256 conjunct is load-bearing on its own, and in the document cases the sha256 field stayed EQUAL, so neither conjunct can be dropped for the other`,
        )
      } else {
        fail('control.conjunctIndependence', `documents red=${documentRed}, sha256 red=${shaRed.length} of 2 — the two conjuncts did not separate as they must`)
      }
    }
  }

  if (injected > 0) {
    pass('control.mutationCoverage', `${detected} of ${injected} injected mutations were reported RED across ${ran.length} of ${cases.length} control case(s)`)
  } else {
    unmeasured('control.mutationCoverage', 'no mutation was injected, so there is nothing to detect')
  }
  controlTally.detected = detected
  controlTally.injected = injected
  controlTally.casesRun = ran.length
  return { cases: ran, baseline: injected > 0 && detected === injected }
}

/* ---------------------------------------------------------------------------
 * Main
 * ------------------------------------------------------------------------- */

async function main() {
  console.log('SHARING HARNESS — cross-node intent + meta-packages equality, with a positive control')
  console.log(`  workspace : ${CLONE_ROOT}`)
  console.log(`  snapshots : ${SNAPSHOT_DIR}`)
  console.log(`  node-a    : ${NODE_A_URL}`)
  console.log(`  node-b    : ${NODE_B_URL}`)
  console.log(`  fixture   : port ${FIXTURE_PORT}`)
  console.log(`  gap       : ${GAP_MS}ms between the two precalculation calls`)

  /** Preconditions: both nodes must be up before anything is compared. */
  section('0. PRECONDITIONS — are there two nodes to compare?')
  const reachable = { a: false, b: false }
  for (const [name, baseUrl] of [['node-a', NODE_A_URL], ['node-b', NODE_B_URL]]) {
    const reading = await httpGet(`${baseUrl}/node/health`)
    if (usable(reading) && reading.json?.ok === true) {
      pass(`preflight.${name}.health`, `HTTP ${reading.status}, ${reading.bytes} B, nodeId=${show(reading.json?.nodeId)}, term=${show(reading.json?.term)}, uptimeMs=${show(reading.json?.uptimeMs)}`)
      reachable[name === 'node-a' ? 'a' : 'b'] = true
    } else {
      unmeasured(`preflight.${name}.health`, `${baseUrl}/node/health ${explainReading(reading)} — the stack is not up, so nothing below can be compared`)
    }
  }

  if (!reachable.a || !reachable.b) {
    structural()
    return { exitCode: 3, reason: 'at least one node did not answer, so no cross-node comparison happened' }
  }

  /** Which artifact is under measurement — from `docker inspect`, not from a message or a file. */
  const imageA = await readImageIdentity('node-a', NODE_A_URL)
  const imageB = await readImageIdentity('node-b', NODE_B_URL)
  for (const [key, image] of [['nodeA', imageA], ['nodeB', imageB]]) {
    const nodeName = key === 'nodeA' ? 'node-a' : 'node-b'
    if (!image.ok) {
      unmeasured(`preflight.${nodeName}.image`, `${image.reason} — the artifact behind this run cannot be named`)
      continue
    }
    measuredUnder[key] = { imageSha: image.imageSha, imageTag: image.imageTag, created: image.created, containerId: image.containerId, containerName: image.containerName }
    pass(`preflight.${nodeName}.image`, `container ${image.containerName} (${image.containerId.slice(0, 12)}) on image ${image.imageSha} (${image.imageTag}), created ${image.created}`)
  }
  if (imageA.ok && imageB.ok) {
    if (imageA.imageSha === imageB.imageSha) {
      pass('preflight.sameImage', `both containers run image ${imageA.imageSha} — one artifact, two nodes, so a field difference cannot be a build difference`)
    } else {
      fail('preflight.sameImage', `node-a runs ${imageA.imageSha} and node-b runs ${imageB.imageSha}: the two nodes are DIFFERENT BUILDS, so any agreement between them would be a coincidence rather than shared facts`)
    }
  } else {
    unmeasured('preflight.sameImage', 'at least one image id could not be read, so the two nodes cannot be shown to run the same artifact')
  }

  const intentPair = await compareRouteAcrossNodes({
    title: '1. INTENT — do both nodes serve the SAME precalculated intent facts?',
    path: '/node/intent',
    specs: INTENT_FIELDS,
    prefix: 'intent',
  })
  aIntentBody = usable(intentPair.a) ? intentPair.a.json : null

  const metaPair = await compareRouteAcrossNodes({
    title: '2. META-PACKAGES — do both nodes serve the SAME meta-market assembly facts?',
    path: '/node/meta-packages',
    specs: META_FIELDS,
    prefix: 'meta',
  })
  aMetaBody = usable(metaPair.a) ? metaPair.a.json : null

  /** The node identities must differ, or the two "nodes" are one process answering twice. */
  if (usable(intentPair.a) && usable(intentPair.b)) {
    const aId = intentPair.a.json?.nodeId
    const bId = intentPair.b.json?.nodeId
    if (typeof aId === 'string' && typeof bId === 'string' && aId.length > 0 && bId.length > 0 && aId !== bId) {
      pass('identity.twoDistinctNodes', `node-a is ${show(aId)} and node-b is ${show(bId)} — two processes, not one answering twice`)
    } else {
      fail('identity.twoDistinctNodes', `node-a=${show(aId)} node-b=${show(bId)} do not identify two distinct nodes, so "agreement" could be one process read twice`)
    }
  } else {
    unmeasured('identity.twoDistinctNodes', 'no pair of usable bodies to read identities from')
  }

  /**
   * PRECALCULATION IS MEASURED BEFORE INDEPENDENCE, deliberately.
   *
   * Sections 3 and 4 are numbered by the brief, but they are RUN in this order: the byte-identity pair
   * is taken while the stack is undisturbed, because the independence conjunct stops a container. Doing
   * it the other way around makes the pair vulnerable to a stop/start between its two halves — and, as
   * it turned out, to another lane recreating the stack — for a reason that has nothing to do with
   * precalculation.
   */
  await provePrecalculation({
    aIntentBefore: intentPair.a,
    aMetaBefore: metaPair.a,
    bIntentBefore: intentPair.b,
    bMetaBefore: metaPair.b,
  })

  const independence = await proveIndependence({
    aIntentBefore: intentPair.a,
    aMetaBefore: metaPair.a,
  })

  /**
   * The independence section restarted node-b, so the control's node-a bodies must be re-confirmed as
   * CURRENT before they are used as the control's baseline. A stale baseline would be a caption.
   */
  if (independence.restarted) {
    section('4b. BASELINE RE-CONFIRM — is node-a still serving what sections 1 and 2 certified?')
    for (const [label, path, before] of [
      ['intent', '/node/intent', intentPair.a],
      ['meta-packages', '/node/meta-packages', metaPair.a],
    ]) {
      const again = await httpGet(`${NODE_A_URL}${path}`)
      if (!usable(again)) {
        fail(`baseline.nodeA.${label}`, `${again.url} ${explainReading(again)} after the restart cycle`)
      } else if (before !== null && usable(before) && again.sha256 === before.sha256) {
        pass(`baseline.nodeA.${label}`, `byte-identical to the section-1/2 reading (${again.bytes} B, sha256 ${again.sha256.slice(0, 16)}…)`)
      } else {
        fail(`baseline.nodeA.${label}`, `node-a's ${label} body changed across the restart cycle, so the control's baseline is stale`)
      }
    }
  }

  const control = await positiveControl()

  /**
   * The GREEN half of the two-sided comparison, stated as its own check: if the equality sections were
   * red too, "the check can fail" would be trivially true and worthless.
   */
  if (intentPair.compared && metaPair.compared && intentPair.result.red.length === 0 && metaPair.result.red.length === 0) {
    pass('control.baselineIsGreen', `the real node-a vs node-b comparison reported 0 disagreements across ${intentPair.result.total + metaPair.result.total} compared readings, so a RED control reading means the mutation was caught rather than that the comparator is always red`)
  } else if (!intentPair.compared || !metaPair.compared) {
    unmeasured('control.baselineIsGreen', 'sections 1 or 2 did not compare, so there is no green baseline for the control to be contrasted with')
  } else {
    fail('control.baselineIsGreen', `the real node pair already disagreed (${intentPair.result.red.length + metaPair.result.red.length} red reading(s)), so a red control case cannot distinguish a caught mutation from a broken comparator`)
  }

  return structural()
}

/**
 * The structural section: the arithmetic of the record itself.
 *
 * The totals are DERIVED from `checks` — there is no second counter — and this section asserts that
 * derivation is well-formed, so a status outside the three known values cannot silently vanish from
 * both the pass count and the failure count.
 */
/** Tally the record. ONE derivation, used by every printed total in this file. */
function summarize() {
  const known = new Set(['PASS', 'FAIL', 'NOT MEASURED'])
  return {
    pass: checks.filter((entry) => entry.status === 'PASS').length,
    fail: checks.filter((entry) => entry.status === 'FAIL').length,
    unmeasured: checks.filter((entry) => entry.status === 'NOT MEASURED').length,
    total: checks.length,
    unknown: checks.filter((entry) => !known.has(entry.status)),
  }
}

/**
 * The structural section: the arithmetic of the record itself.
 *
 * **THE SNAPSHOT IS TAKEN BEFORE THIS SECTION RECORDS ANYTHING, AND THAT IS THE POINT.** Recording a
 * check changes the record it describes, so an identity asserted AFTER the append is asserted against a
 * different population. The first green run of this harness printed `115 + 13 + 1 = 131` for exactly that
 * reason — the two encodings drifted by the three checks that were being written while they were read.
 * So closure is asserted on the pre-append snapshot, and the growth caused by this section is asserted
 * separately, by count.
 */
function structural() {
  section('STRUCTURAL — the arithmetic of this harness\'s own record')
  const snapshot = summarize()

  if (snapshot.unknown.length === 0) {
    pass('meta.everyCheckHasAKnownStatus', `0 of ${snapshot.total} check(s) carried a status outside PASS/FAIL/NOT MEASURED before this section ran`)
  } else {
    fail('meta.everyCheckHasAKnownStatus', `${snapshot.unknown.length} of ${snapshot.total} check(s) carry an unknown status: ${snapshot.unknown.map((entry) => entry.label).join(', ')} — such a check vanishes from every total`)
  }

  if (snapshot.pass + snapshot.fail + snapshot.unmeasured === snapshot.total) {
    pass('meta.totalsReconcile', `${snapshot.pass} PASS + ${snapshot.fail} FAIL + ${snapshot.unmeasured} NOT MEASURED = ${snapshot.total} recorded (snapshot taken BEFORE this section's own checks were appended)`)
  } else {
    fail('meta.totalsReconcile', `${snapshot.pass} + ${snapshot.fail} + ${snapshot.unmeasured} != ${snapshot.total} — the record and the totals disagree`)
  }

  const comparedPass = checks.filter((entry) => entry.status === 'PASS' && /^(preflight|intent|meta|precalc|independence|control)\./.test(entry.label)).length
  if (comparedPass > 0) {
    pass('meta.comparedSomething', `${comparedPass} of ${snapshot.total} check(s) produced a real reading; a run whose every comparison was vacuous would score 0 here`)
  } else {
    unmeasured('meta.comparedSomething', `0 of ${snapshot.total} check(s) produced a real reading — a 0 on both sides is instrument failure, not agreement`)
  }

  /**
   * The control's verdict as a PAIR, in its own sentence, because its success condition is INEQUALITY.
   * `detected / injected` is what makes the equality claim survive review; `cleanRed / cleanTotal` is the
   * half that stops an always-red comparator from passing.
   */
  const controlPair = controlTally.injected > 0
    ? `${controlTally.detected} of ${controlTally.injected} doctored difference(s) DETECTED across ${controlTally.casesRun} of ${controlTally.casesTotal} control case(s); clean-pair differences ${controlTally.cleanRed} of ${controlTally.cleanTotal}`
    : 'control NOT MEASURABLE: no doctored difference was injected, so the equality check has not been shown able to fail'
  if (controlTally.injected > 0 && controlTally.detected === controlTally.injected && controlTally.cleanRed === 0) {
    pass('meta.controlVerdict', `${controlPair} — the comparison SEES every doctored difference and reports NONE on identical artifacts`)
  } else if (controlTally.injected === 0 || controlTally.cleanTotal === 0) {
    unmeasured('meta.controlVerdict', controlPair)
  } else {
    fail('meta.controlVerdict', `${controlPair} — the control is not two-sided`)
  }

  /**
   * A check that RAN but was never recorded reads exactly like a check that passed, so the number of
   * checks this section adds is itself asserted, before the last of them is appended.
   */
  const beforeLast = summarize()
  const recordedByThisSection = 4
  if (beforeLast.total === snapshot.total + recordedByThisSection) {
    pass('meta.structuralChecksCounted', `this section recorded exactly ${beforeLast.total - snapshot.total} check(s) before this one, and every one of them is in the record — a check that ran and was not counted cannot hide here`)
  } else {
    fail('meta.structuralChecksCounted', `this section recorded ${beforeLast.total - snapshot.total} check(s) where it records ${recordedByThisSection} before the final one — a check ran and was discarded, or a count names checks that did not run`)
  }

  const final = summarize()
  const bySection = new Map()
  for (const entry of checks) {
    const bucket = bySection.get(entry.section) ?? { pass: 0, fail: 0, unmeasured: 0, total: 0 }
    bucket.total += 1
    if (entry.status === 'PASS') bucket.pass += 1
    else if (entry.status === 'FAIL') bucket.fail += 1
    else bucket.unmeasured += 1
    bySection.set(entry.section, bucket)
  }
  console.log('\n--- per-section census (pass / total, with failures and unmeasured named) ---')
  for (const [title, bucket] of bySection) {
    console.log(`  ${bucket.pass} of ${bucket.total} passed · ${bucket.fail} failed · ${bucket.unmeasured} not measured  — ${title}`)
  }

  const failures = checks.filter((entry) => entry.status === 'FAIL')
  const unmeasuredEntries = checks.filter((entry) => entry.status === 'NOT MEASURED')
  const identityCloses = final.pass + final.fail + final.unmeasured === final.total

  console.log('\n=== VERDICT ===')
  console.log(`two conjuncts, two readings:`)
  console.log(`  cross-node agreement : ${controlTally.cleanTotal === 0 ? 'not measured' : `${controlTally.cleanTotal - controlTally.cleanRed} of ${controlTally.cleanTotal} compared readings equal between two nodes started from identical artifacts`}`)
  console.log(`  control (must differ): ${controlTally.injected === 0 ? 'not measured' : `${controlTally.detected} of ${controlTally.injected} doctored differences detected`}`)
  console.log(`checks: ${final.pass} passed / ${final.fail} failed / ${final.unmeasured} not measured (total recorded ${final.total})`)
  console.log(`identity: ${final.pass} + ${final.fail} + ${final.unmeasured} = ${final.total} — ${identityCloses ? 'closes' : 'DOES NOT CLOSE'}`)
  if (failures.length > 0) {
    console.log('FAILED checks:')
    for (const entry of failures) console.log(`  - ${entry.label}: ${entry.detail}`)
  }
  if (unmeasuredEntries.length > 0) {
    console.log('NOT MEASURED checks (an unprobed conjunct is not a pass):')
    for (const entry of unmeasuredEntries) console.log(`  - ${entry.label}: ${entry.detail}`)
  }

  let exitCode = 0
  let verdict = 'AGREEMENT + CONTROL SATISFIED'
  if (!identityCloses || final.fail > 0) {
    exitCode = 1
    verdict = 'FAILED'
  } else if (final.unmeasured > 0) {
    exitCode = 2
    verdict = 'INCOMPLETE'
  } else if (final.pass === 0) {
    exitCode = 3
    verdict = 'NOTHING COMPARED'
  }

  const summary = {
    verdict,
    exitCode,
    images: measuredUnder,
    control: {
      detected: controlTally.detected,
      injected: controlTally.injected,
      casesRun: controlTally.casesRun,
      casesTotal: controlTally.casesTotal,
      cleanPairDifferences: controlTally.cleanRed,
      cleanPairCompared: controlTally.cleanTotal,
    },
    checks: { pass: final.pass, fail: final.fail, notMeasured: final.unmeasured, total: final.total },
    disagreements: failures.map((entry) => entry.label),
    unmeasured: unmeasuredEntries.map((entry) => entry.label),
    notes: notes.map((entry) => entry.text),
  }
  console.log(`\nverdict: ${verdict}, exit ${exitCode}`)
  console.log(`SHARING-RESULT ${JSON.stringify(summary)}`)
  return { exitCode, verdict, summary }
}

let result
try {
  result = await main()
} catch (error) {
  console.error(`\nHARNESS CRASHED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  result = { exitCode: 1, verdict: 'CRASHED' }
}
process.exitCode = result.exitCode
