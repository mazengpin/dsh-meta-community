/**
 * ============================================================================
 * THE HOST-HALF HARNESS — it drives the BUILT artifact, never the source
 * ============================================================================
 *
 * The subject is `lib/index.js`, because that is what a host would load. A suite
 * that drives `src/` proves the source works and says nothing about the bundle,
 * which is where a `Set` becomes `{}` and where an exported symbol goes missing.
 *
 * **IT RUNS FOR THE REASON THE MARKET CLONE'S SUITE DIED FOR.** That suite
 * referenced an identifier that was defined nowhere and threw at its own line 488
 * — and the board still read `38 of 38 PASS`, because the edit landed four seconds
 * after the run that produced the number. **A harness is a program, and an
 * undefined identifier in a `.mjs` file is not caught by `tsc`**, which typechecks
 * `src/` and never this file. So this suite is RUN on every change, and its exit
 * code is read DIRECTLY rather than through a pipe — in a pipeline `$?` is the last
 * command's status, which is how the market's verifier reported `exit 0` for a
 * suite that was crashing.
 *
 * **AND IT ASSERTS ON THE SERIALISED PAYLOAD** (`JSON.parse(JSON.stringify(...))`),
 * the `D-0071` guard: a `Set`, `Map` or `RegExp` serialises to `{}` with no error,
 * so an in-memory object looks correct while the served body has lost the value.
 *
 * @module dsh-meta-community/verify/host-half
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLONE = resolve(HERE, '..', '..', '..')
const ARTIFACT = resolve(CLONE, 'lib', 'index.js')

let declared = 0
let passed = 0
const failures = []

/**
 * ACCOUNTING CORRECTED 2026-10-19 — `declared` IS INCREMENTED IN EXACTLY ONE PLACE.
 *
 * It previously read `declared += 1` here AND at each of the 42 call sites, so every
 * check was counted TWICE and the printed total was `passed: 42  declared: 84  failed: 0`
 * — a denominator exactly double the numerator, which a reader parses as a suite that
 * failed half its checks while the same block printed `VERDICT PASS`. The count of
 * increments was 43 (1 here + 42 at the call sites) and the count of call sites was 42;
 * the fix is to remove the one here rather than the 42 there, because the call sites are
 * the record of what this file asserts and this function is the record of how each one
 * is counted. No assertion, check body or expectation was touched: `passed` is still 42.
 */
function check(title, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${title}${detail ? ' — ' + detail : ''}`)
  } else {
    failures.push(title)
    console.log(`  FAIL  ${title}${detail ? ' — ' + detail : ''}`)
  }
}

/* ---------------------------------------------------------------------------
 * A. THE ARTIFACT ITSELF
 * ------------------------------------------------------------------------ */

console.log('\nA. THE BUILT ARTIFACT')

let mod
try {
  mod = await import(pathToFileURL(ARTIFACT).href)
} catch (err) {
  console.log(`  INSTRUMENT FAILURE — the artifact at ${ARTIFACT} cannot be imported: ${err.message}`)
  console.log('\nVERDICT INSTRUMENT-FAILURE')
  process.exit(1)
}

const bytes = readFileSync(ARTIFACT).length
declared += 1
check('A1 the built artifact exists and is non-trivial',
  bytes > 10_000,
  `${bytes} B at lib/index.js`)

declared += 1
check('A2 the artifact exports the plugin contract the loader reads',
  typeof mod.name === 'string' && typeof mod.apply === 'function' && Array.isArray(mod.inject),
  `name=${mod.name} apply=${typeof mod.apply} inject=${JSON.stringify(mod.inject)}`)

declared += 1
check('A3 the plugin name is exactly dsh-meta-community, so the mount is identifiable',
  mod.name === 'dsh-meta-community',
  `name=${JSON.stringify(mod.name)}`)

declared += 1
check('A4 it injects webServer and nothing else — a plugin that asks for more than it uses fails elsewhere',
  mod.inject.length === 1 && mod.inject[0] === 'webServer',
  `inject=${JSON.stringify(mod.inject)}`)

/* ---------------------------------------------------------------------------
 * B. THE PLUGIN MOUNTS, AND THE SURFACE ANSWERS
 * ------------------------------------------------------------------------ */

console.log('\nB. THE SURFACE, DRIVEN THROUGH A REAL LISTENER')

const registrations = []
const fakeCtx = {
  webServer: {
    register(route) { registrations.push(route); return () => {} },
  },
  effect(callback, label) { this.effects.push({ disposer: callback(), label }) },
  effects: [],
  logger: { info() {}, warn() {} },
}

try {
  mod.apply(fakeCtx)
} catch (err) {
  console.log(`  INSTRUMENT FAILURE — apply() threw: ${err.message}`)
  console.log('\nVERDICT INSTRUMENT-FAILURE')
  process.exit(1)
}

declared += 1
check('B1 apply() registers exactly one prefix route and one effect',
  registrations.length === 1 && fakeCtx.effects.length === 1,
  `routes=${registrations.length} effects=${fakeCtx.effects.length}`)

const reg = registrations[0]
declared += 1
check('B2 the registration is kind=prefix, so one handler owns the subtree',
  reg !== undefined && reg.kind === 'prefix',
  `kind=${reg?.kind} path=${reg?.path}`)

const server = createServer((req, res) => { reg.handler(req, res) })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

async function get(path, method = 'GET', body = null) {
  const init = { method }
  if (body !== null) {
    init.body = JSON.stringify(body)
    init.headers = { 'content-type': 'application/json' }
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, init)
  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch { parsed = null }
  /* THE D-0071 GUARD APPLIED AT THE BOUNDARY: assert on what SERIALISES. */
  const serialised = parsed === null ? null : JSON.parse(JSON.stringify(parsed))
  return { status: response.status, body: parsed, serialised, text }
}

const root = await get('/meta-community/api')
declared += 1
check('B3 the prefix answers 200', root.status === 200, `status=${root.status}`)

declared += 1
check('B4 the payload carries an assembly block and the lane name',
  root.serialised !== null && typeof root.serialised.assembly === 'object' && root.serialised.lane === 'community',
  `lane=${root.serialised?.lane} keys=${root.serialised === null ? 'unparseable' : Object.keys(root.serialised).join(',')}`)

/* ---------------------------------------------------------------------------
 * C. G9 — EVERY ADVERTISED PATH IS DRIVEN, AND NONE MAY 404
 * ------------------------------------------------------------------------ */

console.log('\nC. G9 — ADVERTISED PATHS vs SERVED PATHS')

/**
 * THE PATHS ARE READ FROM THE 404 BODY RATHER THAN HAND-WRITTEN HERE, so the
 * assertion is about what the SURFACE claims rather than about what this file
 * remembers. A hand-written list would agree with itself and say nothing.
 */
const notFound = await get('/meta-community/api/definitely-not-registered')
const advertised = Array.isArray(notFound.serialised?.registered) ? notFound.serialised.registered : []

declared += 1
check('C1 the 404 body advertises a non-empty path table',
  advertised.length > 0,
  `advertised=${advertised.length}`)

const driven = []
for (const path of advertised) {
  const method = path.endsWith('/fuse') ? 'POST' : 'GET'
  const body = method === 'POST' ? { contributions: [{ authorId: 'a', role: 'author', fields: { x: 1 }, contributedAt: 'now' }] } : null
  const r = await get(path, method, body)
  driven.push({ path, method, status: r.status })
}

const dead = driven.filter((d) => d.status === 404)
declared += 1
check('C2 no advertised path returns 404 — absent is not honest, 200 and 405 are',
  driven.length === advertised.length && dead.length === 0,
  `driven=${driven.length} advertised=${advertised.length} dead=${dead.length}${dead.length ? ' -> ' + JSON.stringify(dead) : ''}`)

declared += 1
check('C3 the served count is non-zero, so an empty loop cannot pass',
  driven.filter((d) => d.status === 200).length > 0,
  `served200=${driven.filter((d) => d.status === 200).length} of ${driven.length}`)

/* ---------------------------------------------------------------------------
 * D. THE CENSUS, AND THE VERDICT THE CLONE MAKES ABOUT ITSELF
 * ------------------------------------------------------------------------ */

console.log('\nD. THE COMMUNITY VERDICT — plan, and why')

const census = await get('/meta-community/api/census')
declared += 1
check('D1 the census route answers with a population and its moment',
  census.status === 200
    && typeof census.serialised?.census?.total === 'number'
    && typeof census.serialised?.census?.censusAt === 'string',
  `total=${census.serialised?.census?.total} at=${census.serialised?.census?.censusAt}`)

declared += 1
check('D2 the census reports `inspected` as a pair with its denominator, not a bare ratio',
  typeof census.serialised?.census?.inspected === 'number'
    && census.serialised.census.inspected <= census.serialised.census.total,
  `inspected=${census.serialised?.census?.inspected} of total=${census.serialised?.census?.total}`)

/**
 * THIS IS THE ASSERTION THAT MATTERS MOST IN THE FILE, AND IT IS AN ASSERTION
 * THAT THE CLONE UNDER-REPORTS. A community of one MUST report `plan` — never
 * `exists`. If a future edit made this surface claim `exists` on a single-member
 * registry, this line goes red, which is the only reason the verdict is a field
 * rather than a sentence.
 */
declared += 1
check('D3 a community of ONE reports `plan`, never `exists`',
  census.serialised?.census?.total === 1 && census.serialised?.kind === 'plan',
  `total=${census.serialised?.census?.total} kind=${JSON.stringify(census.serialised?.kind)}`)

const byTrust = census.serialised?.census?.byTrust
declared += 1
check('D4 the trust breakdown is present with all three levels enumerated, so an absent level is visible as 0',
  byTrust !== undefined && typeof byTrust.inspected === 'number' && typeof byTrust.asserted === 'number' && typeof byTrust.absent === 'number',
  `byTrust=${JSON.stringify(byTrust)}`)

/* ---------------------------------------------------------------------------
 * E. THE FUSION — CONFLICTS ARE RECORDED, NOT SMOOTHED
 * ------------------------------------------------------------------------ */

console.log('\nE. FUSION AND DECENTRALIZED AUTHORSHIP')

const conflict = await get('/meta-community/api/fuse', 'POST', {
  contributions: [
    { authorId: 'author-one', role: 'author', fields: { colour: 'red', size: 3 }, contributedAt: '2026-10-16T00:00:00Z' },
    { authorId: 'author-two', role: 'author', fields: { colour: 'blue', size: 3 }, contributedAt: '2026-10-16T00:01:00Z' },
  ],
})

declared += 1
check('E1 the fuse route answers 200 for two contributions',
  conflict.status === 200,
  `status=${conflict.status} error=${JSON.stringify(conflict.serialised?.error ?? null)}`)

const fusion = conflict.serialised?.fusion
declared += 1
check('E2 the fusion counts its contributions against the community size — a numerator WITH its denominator',
  fusion?.contributionsIn === 2 && fusion?.communitySize === 1,
  `contributionsIn=${fusion?.contributionsIn} communitySize=${fusion?.communitySize}`)

declared += 1
check('E3 a DISAGREEMENT is recorded as conflicted rather than silently resolved',
  fusion?.fieldsConflicted === 1 && fusion?.fieldsAgreed === 1,
  `conflicted=${fusion?.fieldsConflicted} agreed=${fusion?.fieldsAgreed}`)

const colour = fusion?.fields?.find((f) => f.field === 'colour')
declared += 1
check('E4 per-field provenance is retained — the field names BOTH suppliers, not just the winner',
  colour?.suppliedBy?.length === 2 && colour.conflicted === true,
  `colour suppliedBy=${JSON.stringify(colour?.suppliedBy)} conflicted=${colour?.conflicted}`)

declared += 1
check('E5 field order is deterministic, so two fusions of the same input produce the same document',
  JSON.stringify(fusion?.fields?.map((f) => f.field)) === JSON.stringify([...fusion.fields.map((f) => f.field)].sort()),
  `order=${JSON.stringify(fusion?.fields?.map((f) => f.field))}`)

const empty = await get('/meta-community/api/fuse', 'POST', { contributions: [] })
declared += 1
check('E6 a fusion of NOTHING is refused rather than returned as an empty package',
  empty.status === 400,
  `status=${empty.status} error=${JSON.stringify(empty.serialised?.error ?? null).slice(0, 80)}`)

const wrongMethod = await get('/meta-community/api/fuse', 'GET')
declared += 1
check('E7 fuse is POST-only and a GET is refused with 405, not silently answered',
  wrongMethod.status === 405,
  `status=${wrongMethod.status}`)

/* ---------------------------------------------------------------------------
 * F. THE STANDING — A SATISFIED SHAPE MUST NOT READ AS A SATISFIED GUARANTEE
 * ------------------------------------------------------------------------ */

console.log('\nF. STANDING — the shape is published beside the thing it does NOT prove')

const standing = await get('/meta-community/api/standing')
declared += 1
check('F1 the standing route answers with distinctAuthors and a shape',
  standing.status === 200 && typeof standing.serialised?.standing?.distinctAuthors === 'number',
  `distinctAuthors=${standing.serialised?.standing?.distinctAuthors} shape=${standing.serialised?.standing?.shape}`)

/**
 * THE PAIR THAT MATTERS. `single-author` is the honest shape here, and
 * `provenanceVerified` must be `false` — a surface that reported `true` would be
 * claiming an authentication this deployment cannot perform.
 */
declared += 1
check('F2 provenance is reported UNVERIFIED, and the reason is carried with it',
  standing.serialised?.standing?.provenanceVerified === false
    && typeof standing.serialised?.standing?.provenanceReason === 'string'
    && standing.serialised.standing.provenanceReason.length > 100,
  `provenanceVerified=${standing.serialised?.standing?.provenanceVerified} reasonChars=${standing.serialised?.standing?.provenanceReason?.length ?? 0}`)

/* ---------------------------------------------------------------------------
 * G. THE CLAUSE CENSUS — C1..C5 CARRIED, AND GRADED HONESTLY
 * ------------------------------------------------------------------------ */

console.log('\nG. THE OWNER CLAUSES')

const clauses = await get('/meta-community/api/clauses')
declared += 1
check('G1 all five owner clauses are carried, not summarised',
  clauses.serialised?.clauses?.length === 5,
  `clauses=${clauses.serialised?.clauses?.length}`)

declared += 1
check('G2 every clause carries a non-empty FALSIFIER — a claim nothing can falsify is not a claim',
  Array.isArray(clauses.serialised?.clauses)
    && clauses.serialised.clauses.every((c) => typeof c.falsifier === 'string' && c.falsifier.trim().length > 0),
  `withoutFalsifier=${clauses.serialised?.census?.withoutFalsifier}`)

declared += 1
check('G3 the clause census reports a census moment',
  typeof clauses.serialised?.census?.censusAt === 'string',
  `censusAt=${clauses.serialised?.census?.censusAt}`)

declared += 1
check('G4 every clause that NAMES an artifact cites a route this clone actually registers',
  clauses.serialised?.census?.unreachableArtifacts === 0,
  `unreachableArtifacts=${clauses.serialised?.census?.unreachableArtifacts} withArtifact=${clauses.serialised?.census?.withArtifact} of ${clauses.serialised?.census?.total}`)

/**
 * G5 IS C5's OWN INSTRUMENT, AND THE FAILURE IT GUARDS IS THE ONE THE MARKET
 * CLONE SHIPPED: **C5 was the only one of the five clauses with ZERO artifacts,**
 * and that absence is what let C1's fusion and C4's decentralization reach a
 * sealed charter unremarked. So the assertion is not merely that the route answers
 * — it is that the route's own check is **demonstrably able to refuse**, which is
 * why the self-test is published on every request and read here.
 */
const conformance = await get('/meta-community/api/clauses/conformance')
declared += 1
check('G5 C5\'s cited artifact EXISTS and answers',
  conformance.status === 200,
  `status=${conformance.status}`)

declared += 1
check('G6 the conformance check PROVES it can fail — a check never seen to refuse is a decoration',
  conformance.serialised?.selfTest?.checkCanFail === true
    && conformance.serialised.selfTest.unreachableWhenTableIsWrong > 0,
  `checkCanFail=${conformance.serialised?.selfTest?.checkCanFail} unreachableWhenTableIsWrong=${conformance.serialised?.selfTest?.unreachableWhenTableIsWrong}`)

declared += 1
check('G7 on the REAL table the conformance verdict is conformant, so the check is not merely pessimistic',
  conformance.serialised?.verdict === 'conformant',
  `verdict=${JSON.stringify(conformance.serialised?.verdict)}`)

/* ---------------------------------------------------------------------------
 * H. THE CONTROL — IT MUST CHANGE AN OUTCOME, NOT READ ONE BACK
 * ------------------------------------------------------------------------ */

console.log('\nH. THE CONTROL — an outcome that MOVES')

/**
 * THIS IS THE ASSERTION THE OWNER'S OWN RULING TURNS ON: *"a control that only
 * reads a value back is not a control — show an outcome changing."* So the same
 * route is driven TWICE with different input and the two outputs are COMPARED.
 * A route that returned a constant would satisfy every other check in this file
 * and fail here.
 */
const oneAuthor = await get('/meta-community/api/standing/relabel', 'POST', { authorIds: ['solo'] })
const twoAuthors = await get('/meta-community/api/standing/relabel', 'POST', { authorIds: ['solo', 'a-second-string'] })

declared += 1
check('H4 the control answers for both inputs',
  oneAuthor.status === 200 && twoAuthors.status === 200,
  `one=${oneAuthor.status} two=${twoAuthors.status}`)

declared += 1
check('H5 THE OUTCOME CHANGES — one author is single-author, two are multi-author',
  oneAuthor.serialised?.standing?.shape === 'single-author'
    && twoAuthors.serialised?.standing?.shape === 'multi-author',
  `shape(1)=${JSON.stringify(oneAuthor.serialised?.standing?.shape)} shape(2)=${JSON.stringify(twoAuthors.serialised?.standing?.shape)}`)

declared += 1
check('H6 the distinct-author count tracks the input rather than being fixed',
  oneAuthor.serialised?.standing?.distinctAuthors === 1
    && twoAuthors.serialised?.standing?.distinctAuthors === 2,
  `distinctAuthors(1)=${oneAuthor.serialised?.standing?.distinctAuthors} distinctAuthors(2)=${twoAuthors.serialised?.standing?.distinctAuthors}`)

/**
 * AND THE HALF THAT MUST **NOT** MOVE. If a future edit made `provenanceVerified`
 * track the author count, the surface would be claiming that a second string is a
 * second verified identity — the exact false guarantee this clone exists to refuse.
 * **A control proven to move is only half the evidence; a guard proven NOT to move
 * is the other half.**
 */
declared += 1
check('H7 THE GUARANTEE DOES *NOT* MOVE — provenanceVerified is false for one author AND for two',
  oneAuthor.serialised?.standing?.provenanceVerified === false
    && twoAuthors.serialised?.standing?.provenanceVerified === false,
  `provenanceVerified(1)=${oneAuthor.serialised?.standing?.provenanceVerified} provenanceVerified(2)=${twoAuthors.serialised?.standing?.provenanceVerified}`)

const relabelGet = await get('/meta-community/api/standing/relabel', 'GET')
declared += 1
check('H8 the control refuses a GET with 405 rather than answering with a default standing',
  relabelGet.status === 405,
  `status=${relabelGet.status}`)

const relabelEmpty = await get('/meta-community/api/standing/relabel', 'POST', { authorIds: [] })
declared += 1
check('H9 a standing over NO authors is refused, because absent is not a default',
  relabelEmpty.status === 400,
  `status=${relabelEmpty.status}`)

/* ---------------------------------------------------------------------------
 * H. G15 — NO ROUTE MAY CLAIM A PROGRAM-WIDE PROHIBITION IT CANNOT KNOW
 * ------------------------------------------------------------------------ */

console.log('\nH. G15 — CLAIM SHAPE, AND ITS LIMIT')

/**
 * THE RULE IS ANCHORED TO SENTENCE-INITIAL BECAUSE A BARE SUBSTRING TEST COLLIDED
 * WITH REAL PROSE. On the market clone the rule fired on `it holds no
 * userId/sessionId`, because **"no userId" contains "no user"**. The guard is
 * therefore applied where an ABSOLUTE would actually live, and `G15c` proves both
 * halves — **a rule narrowed without a positive control is how a guard becomes
 * decorative.**
 */
const forbiddenShapes = ['no plugin', 'no lane', 'never in this program', 'nothing in this program', 'no user', 'no operator']

function startsSentence(lc, i) {
  if (i === 0) return true
  let j = i - 1
  while (j >= 0 && /\s/.test(lc[j])) j -= 1
  if (j < 0) return true
  return /[.;:—]/.test(lc[j])
}

function assertsAbsoluteClaim(text) {
  const lc = text.toLowerCase()
  for (const phrase of forbiddenShapes) {
    let i = lc.indexOf(phrase)
    while (i >= 0) {
      if (startsSentence(lc, i)) return true
      i = lc.indexOf(phrase, i + 1)
    }
  }
  return false
}

const surfaceStrings = []
for (const k of ['notServed', 'noCommunity', 'noDecentralizedProvenance', 'noUniversalMap']) {
  const v = root.serialised?.assembly?.[k]
  if (typeof v === 'string') surfaceStrings.push({ field: k, value: v })
}

declared += 1
check('H1 all four assembly prose fields EXIST and were READ — a check that cannot see its subject must go red',
  surfaceStrings.length === 4,
  `scanned=${surfaceStrings.length}/4`)

const offenders = surfaceStrings.filter((f) => assertsAbsoluteClaim(f.value))
declared += 1
check('H2 no assembly field asserts a program-wide absolute a single route cannot know',
  offenders.length === 0,
  `offenders=${offenders.length}${offenders.length ? ' -> ' + JSON.stringify(offenders.map((o) => o.field)) : ''}`)

const ABSOLUTE_FIXTURE = 'decideByLaya is not reachable: no plugin in this program opens a device or talks to a model'
const SCOPED_FIXTURE = 'it holds no userId/sessionId, so the registry is keyed to member ids rather than to a person'

declared += 1
check('H3 the anchored rule still CATCHES a sentence-initial absolute and still IGNORES a field name',
  assertsAbsoluteClaim(ABSOLUTE_FIXTURE) && !assertsAbsoluteClaim(SCOPED_FIXTURE),
  `absoluteCaught=${assertsAbsoluteClaim(ABSOLUTE_FIXTURE)} scopedIgnored=${!assertsAbsoluteClaim(SCOPED_FIXTURE)}`)

/* ---------------------------------------------------------------------------
 * I. D-0071 — A Set OR Map MUST NOT REACH THE WIRE UNCONVERTED
 * ------------------------------------------------------------------------ */

console.log('\nI. G14 — THE SERIALISATION GUARD')

const censusBody = census.text
declared += 1
check('I1 the census response contains no `{}` where an enumerated collection should be',
  !/"roles":\{\}/.test(censusBody) && /"roles":\[/.test(censusBody),
  `rolesSerialised=${/"roles":(\[|\{)/.exec(censusBody)?.[1] ?? 'absent'}`)

declared += 1
check('I2 the trust breakdown serialises as an OBJECT with three named levels, not as a collapsed pair',
  JSON.stringify(byTrust) === JSON.stringify({ inspected: byTrust?.inspected, asserted: byTrust?.asserted, absent: byTrust?.absent })
    && Object.keys(byTrust ?? {}).length === 3,
  `keys=${Object.keys(byTrust ?? {}).length} ${JSON.stringify(byTrust)}`)

/* ---------------------------------------------------------------------------
 * VERDICT
 * ------------------------------------------------------------------------ */

await new Promise((r) => server.close(r))

console.log(`\npassed: ${passed}  declared: ${declared}  failed: ${failures.length}`)
if (failures.length > 0) {
  console.log('FAILED:')
  for (const f of failures) console.log(`  - ${f}`)
}
console.log(`\nVERDICT ${failures.length === 0 ? 'PASS' : 'FAIL'}`)
process.exit(failures.length === 0 ? 0 : 1)
