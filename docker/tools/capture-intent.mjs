#!/usr/bin/env node
/**
 * ============================================================================
 * capture-intent.mjs — bake the live intent map into a node snapshot
 * ============================================================================
 *
 * Written against `docker/NODE-CONTRACT.md` §"Snapshot capture". The tool is run
 * ONCE, on the host that owns the intent map, and its output is committed as
 * `docker/snapshots/intent-map.json`; the container never reaches the host.
 *
 * Usage:
 *   node docker/tools/capture-intent.mjs \
 *     --url http://127.0.0.1:3083/intent-map/api/map \
 *     --out docker/snapshots/intent-map.json
 *
 * **THE REFUSALS ARE THE POINT, NOT THE BUREAUCRACY.** A snapshot of nothing
 * would be served by the node as a fact — the contract's own words are that the
 * node would then serve "0 zones", which this program's absent-is-not-zero rule
 * forbids. So the tool exits non-zero, and writes NO file, when:
 *
 *   - the response status is not 200 (a 404 body is the one body whose job is to
 *     be authoritative, and it must never become a snapshot);
 *   - the body cannot be parsed as JSON;
 *   - the document's census is absent or empty (zones count absent or 0, or
 *     `corpus` themselves absent);
 *   - the census disagrees with the document it summarises — `corpus.zones.count`
 *     against the length of the `zones` array, and `count` against `of`. Two
 *     encodings of one fact that can disagree are two facts, and a snapshot that
 *     asserts both must not pick one silently.
 *
 * Redirects are NOT followed (`redirect: 'manual'`): a redirect is not the
 * document, and following it could capture a login page as a successful capture
 * with an unparseable body — or, worse, a 200 HTML body that parses to nothing.
 *
 * `bytes` is `Buffer.byteLength` of the body and `sha256` is over those same
 * bytes, so the pair is a fingerprint of what the network returned.
 *
 * **CORRECTED IN PLACE 2026-10-19T11:17Z — this paragraph previously read that
 * `sha256` "cannot be re-derived from `document`" and that a reader who re-hashed
 * `JSON.stringify(document)` "would get a mismatch and blame the file". MEASURED ON
 * THIS ARTIFACT, THAT IS FALSE.** The intent map is served as COMPACT JSON, so
 * `JSON.stringify(JSON.parse(body))` is byte-identical to the body and
 * `sha256(JSON.stringify(document))` reproduces the wire digest exactly — both came
 * out `fed7003e…` at 42,444 B on the 11:15:57Z capture, and build-gate re-measured
 * `wireSha === docSha` true at 11:16:44Z. The old sentence described the
 * meta-packages artifact, whose document does NOT round-trip, and it was carried
 * here as an unearned generalisation: the same false-justification shape
 * (`D-0073`) that build-gate found in its own `E1` detail string from this same
 * measurement.
 *
 * What is true, and is a property of the SOURCE rather than of this tool: whether
 * the wire digest is recomputable offline depends on whether the source's
 * serialisation survives a parse-and-re-stringify. Here it does; a host that
 * pretty-prints would lose it. **The artifact's own file hash is a third, different
 * value** (`sha256 277a73ef…`), because the document is stored re-indented inside a
 * wrapper — so "the file's hash", "the wire hash" and "the document hash" are three
 * named subjects and must never be quoted interchangeably.
 *
 * **TWO DIGESTS, TWO SUBJECTS, AND BOTH NAMED IN THEIR OWN FIELD** (amended by
 * the Lead 2026-10-19, matching `capture-meta-packages.mjs`):
 *
 *   - `sha256` is over THE RESPONSE BODY AS FETCHED. It commits this file to what
 *     the source sent, and it is the network-side check.
 *   - `documentSha256` is `sha256(JSON.stringify(document), 'utf8')` over the
 *     **COMPACT** serialisation — the same bytes this file's `document` value
 *     round-trips to, NOT a pretty-printed rendering. **The compactness is part of
 *     the DEFINITION, not an implementation detail**: meta-packages-share measured
 *     the compact recomputation reproducing its declared digest while the indented
 *     one did not, so a reader who guesses the wrong serialisation gets a mismatch
 *     that describes their instrument and not the file.
 *
 * **Why the second digest exists: to make the DOCUMENT checkable offline without
 * assuming the source's serialisation survived the round trip.** The committed file
 * stores the document re-indented inside a wrapper, so hashing the FILE reproduces
 * neither digest — the file's own hash is `sha256 277a73ef…`, a third value.
 * `documentSha256` names the document's own bytes, so the artifact can be checked
 * with no network. **Where the source is compact — as the intent map is — it will
 * EQUAL the wire `sha256`; that equality is a property of the source, not a
 * redundancy and not a defect in either field.** CORRECTED 2026-10-19T11:17Z: this
 * paragraph previously opened "the first one is not recomputable offline", which
 * contradicts the correction above and was false for this host.
 *
 * **The limit, stated so it is not overclaimed: this detects an artifact EDITED
 * AFTER CAPTURE, not a determined forger.** Anyone who edits the document can
 * recompute the digest over what they wrote. Only the network-side `sha256`,
 * compared against a body a later fetch actually returned, closes that — and only
 * with the network. That comparison cannot be made by re-hashing this file either,
 * because the intent map carries read-time stamps (`readFreshness.readAt`,
 * `censusAt`), so every fetch differs and a "mismatch" on a fresh fetch has
 * measured the clock rather than the file.
 *
 * Exit codes are distinct so a caller can tell WHY it refused:
 *   0 captured   2 usage   3 network   4 non-200   5 unparseable
 *   6 empty/inconsistent census   7 write failure
 *
 * This is plain ESM with no build step and no dependency outside Node, so it can
 * be run by `node docker/tools/capture-intent.mjs` with no toolchain.
 */

import { createHash } from 'node:crypto'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/** The one HTTP method this tool uses. GET only: it never writes to the host. */
const METHOD = 'GET'

/** Default network budget. The live map is ~42 KB and answers in milliseconds. */
const DEFAULT_TIMEOUT_MS = 20_000

const EXIT_OK = 0
const EXIT_USAGE = 2
const EXIT_NETWORK = 3
const EXIT_HTTP = 4
const EXIT_UNPARSEABLE = 5
const EXIT_CENSUS = 6
const EXIT_WRITE = 7

/** Print a refusal to stderr and leave with its own code. Never writes a file. */
function refuse(code, message) {
  process.stderr.write(`capture-intent: REFUSED (exit ${code}): ${message}\n`)
  process.exit(code)
}

/** The usage text. Printed on a bad argument rather than a stack trace. */
function usage() {
  return 'usage: node docker/tools/capture-intent.mjs --url <http(s) url> --out <path> [--timeout-ms <n>]'
}

/**
 * Parse the arguments strictly.
 *
 * An unknown flag is a refusal, not something to skip: a typo in `--out` that
 * was silently ignored would write the snapshot to the default path while the
 * caller believed it had written it elsewhere.
 */
function parseArgs(argv) {
  const args = { url: null, out: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const equals = token.indexOf('=')
    const flag = equals === -1 ? token : token.slice(0, equals)
    const inline = equals === -1 ? null : token.slice(equals + 1)
    const takeValue = () => {
      if (inline !== null) return inline
      const next = argv[index + 1]
      if (next === undefined) refuse(EXIT_USAGE, `${flag} requires a value\n${usage()}`)
      index += 1
      return next
    }
    if (flag === '--url') args.url = takeValue()
    else if (flag === '--out') args.out = takeValue()
    else if (flag === '--timeout-ms') {
      const raw = takeValue()
      if (!/^[0-9]+$/.test(raw)) refuse(EXIT_USAGE, `--timeout-ms must be a decimal integer, received ${JSON.stringify(raw)}`)
      const value = Number(raw)
      if (value <= 0) refuse(EXIT_USAGE, '--timeout-ms must be greater than 0')
      args.timeoutMs = value
    } else refuse(EXIT_USAGE, `unknown argument ${JSON.stringify(token)}\n${usage()}`)
  }
  if (args.url === null || args.url.length === 0) refuse(EXIT_USAGE, `--url is required\n${usage()}`)
  if (args.out === null || args.out.length === 0) refuse(EXIT_USAGE, `--out is required\n${usage()}`)
  let parsed
  try {
    parsed = new URL(args.url)
  } catch {
    refuse(EXIT_USAGE, `--url is not a URL: ${JSON.stringify(args.url)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    refuse(EXIT_USAGE, `--url must be http or https, received ${JSON.stringify(parsed.protocol)}`)
  }
  return args
}

/** A positive integer or null. `0` is a value here, and it is NOT a count. */
function positiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

/**
 * Read the document's own census, or explain why it is not one.
 *
 * Returns `{ census }` on success and `{ problem }` on refusal, so the caller
 * prints a reason that names the field rather than "bad document".
 */
function readCensus(document) {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    return { problem: 'the body parsed but is not a JSON object, so it has no census' }
  }
  const corpus = document.corpus
  if (corpus === null || typeof corpus !== 'object' || Array.isArray(corpus)) {
    return { problem: 'the document has no `corpus` object: its census is ABSENT, which is not zero' }
  }
  const zoneCensus = corpus.zones
  if (zoneCensus === null || typeof zoneCensus !== 'object') {
    return { problem: '`corpus.zones` is absent: the zone census is ABSENT, which is not zero' }
  }
  const count = positiveInteger(zoneCensus.count)
  if (count === null) {
    return { problem: `\`corpus.zones.count\` is ${JSON.stringify(zoneCensus.count)}, which is not a positive integer — a snapshot of nothing is not a snapshot` }
  }
  const of = positiveInteger(zoneCensus.of)
  if (of === null) {
    return { problem: `\`corpus.zones.of\` is ${JSON.stringify(zoneCensus.of)}, which is not a positive integer` }
  }
  if (of < count) {
    return { problem: `\`corpus.zones.of\` (${of}) is smaller than \`count\` (${count}), so the census cannot be true` }
  }
  if (Array.isArray(document.zones) && document.zones.length !== count) {
    return { problem: `the census says ${count} zones and the document carries ${document.zones.length}: two encodings of one fact disagree, so the snapshot is inconsistent` }
  }
  const pluginCensus = corpus.inScopePlugins
  if (pluginCensus === null || typeof pluginCensus !== 'object') {
    return { problem: '`corpus.inScopePlugins` is absent: the plugin census is ABSENT, which is not zero' }
  }
  const pluginCount = positiveInteger(pluginCensus.count)
  const pluginOf = positiveInteger(pluginCensus.of)
  if (pluginCount === null) {
    return { problem: `\`corpus.inScopePlugins.count\` is ${JSON.stringify(pluginCensus.count)}, which is not a positive integer` }
  }
  if (pluginOf === null) {
    return { problem: `\`corpus.inScopePlugins.of\` is ${JSON.stringify(pluginCensus.of)}, which is not a positive integer` }
  }
  if (pluginOf < pluginCount) {
    return { problem: `\`corpus.inScopePlugins.of\` (${pluginOf}) is smaller than \`count\` (${pluginCount})` }
  }
  const catalogCount = positiveInteger(corpus.catalogCount)
  if (catalogCount === null) {
    return { problem: `\`corpus.catalogCount\` is ${JSON.stringify(corpus.catalogCount)}, which is not a positive integer` }
  }
  return {
    census: {
      zones: { count, of },
      inScopePlugins: { count: pluginCount, of: pluginOf },
      catalogCount,
      censusAt: typeof corpus.censusAt === 'string' ? corpus.censusAt : null,
      model: readIdentityField(document, 'model'),
      dim: readIdentityField(document, 'dim'),
      vectorCount: readIdentityField(document, 'vectorCount'),
    },
  }
}

/** Read one field of `index.identity`, which is where the vector identity lives. */
function readIdentityField(document, field) {
  const index = document.index
  if (index === null || typeof index !== 'object') return null
  const identity = index.identity
  if (identity === null || typeof identity !== 'object') return null
  const value = identity[field]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const outPath = resolve(args.out)

  let response
  try {
    response = await fetch(args.url, {
      method: METHOD,
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(args.timeoutMs),
    })
  } catch (error) {
    refuse(EXIT_NETWORK, `GET ${args.url} failed within ${args.timeoutMs} ms: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (response.status !== 200) {
    refuse(EXIT_HTTP, `GET ${args.url} answered ${response.status} ${response.statusText}, and only 200 is a capture. A non-200 body is a refusal by the host, not a document.`)
  }

  let body
  try {
    body = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    refuse(EXIT_NETWORK, `the ${response.status} body could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }

  const bytes = Buffer.byteLength(body)
  const sha256 = createHash('sha256').update(body).digest('hex')

  if (bytes === 0) {
    refuse(EXIT_CENSUS, 'the body is 0 bytes: an empty body is an empty census, not a document')
  }

  let document
  try {
    document = JSON.parse(body.toString('utf8'))
  } catch (error) {
    refuse(EXIT_UNPARSEABLE, `the ${bytes}-byte body is not JSON (sha256 ${sha256}): ${error instanceof Error ? error.message : String(error)}`)
  }

  const verdict = readCensus(document)
  if (verdict.problem !== undefined) refuse(EXIT_CENSUS, verdict.problem)

  /**
   * The network-free digest, over the COMPACT serialisation.
   *
   * Computed from the value that is about to be stored, so the file's own
   * `document` round-trips to exactly these bytes. Written after every refusal has
   * passed, and over the parsed document rather than over the body, because the
   * body is stored re-indented and would never reproduce its own hash.
   */
  const documentSha256 = createHash('sha256').update(JSON.stringify(document), 'utf8').digest('hex')

  const snapshot = {
    source: args.url,
    capturedAt: new Date().toISOString(),
    status: response.status,
    bytes,
    sha256,
    documentSha256,
    document,
  }

  /**
   * Written through a temp file plus `rename`, so an interrupted run cannot leave a
   * half-written snapshot that the node would serve as a whole one.
   */
  const tempPath = `${outPath}.tmp-${process.pid}`
  try {
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(tempPath, outPath)
  } catch (error) {
    await unlink(tempPath).catch(() => undefined)
    refuse(EXIT_WRITE, `could not write ${outPath}: ${error instanceof Error ? error.message : String(error)}`)
  }

  const census = verdict.census
  process.stdout.write(
    [
      `captured ${args.url}`,
      `wrote ${outPath}`,
      `bytes=${bytes}`,
      `sha256=${sha256}`,
      `  subject: the response body as fetched (network-side; NOT recomputable from the file)`,
      `documentSha256=${documentSha256}`,
      `  subject: sha256(JSON.stringify(document), utf8) over the COMPACT document as stored (network-free)`,
      `zones=${census.zones.count}/${census.zones.of}`,
      `inScopePlugins=${census.inScopePlugins.count}/${census.inScopePlugins.of}`,
      `catalogCount=${census.catalogCount}`,
      `model=${census.model ?? 'absent'}`,
      `dim=${census.dim ?? 'absent'}`,
      `vectorCount=${census.vectorCount ?? 'absent'}`,
      `censusAt=${census.censusAt ?? 'absent'}`,
      '',
    ].join('\n'),
  )
  process.exit(EXIT_OK)
}

await main()
