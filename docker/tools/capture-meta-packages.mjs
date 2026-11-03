#!/usr/bin/env node
/**
 * `capture-meta-packages.mjs` — capture ONE live meta-market read route into the
 * snapshot the node serves.
 *
 * WHY A TOOL AND NOT A HAND-COPIED FILE
 *
 * The node must be able to answer "which meta-packages does the meta-market infra
 * carry, what is its assembly identity, how many paths does it advertise against
 * how many it serves, and when was this measured" WITHOUT a network. So a
 * precalculated artifact is captured here, once, with its byte count and its
 * digest beside it, and `src/node/metaPackages.ts` serves that artifact and
 * nothing else.
 *
 * THE SEVEN KEYS ARE THE CONTRACT (`docker/NODE-CONTRACT.md`, "Snapshot capture",
 * AMENDED by the Lead 2026-10-19): `{ source, capturedAt, status, bytes, sha256,
 * documentSha256, document }` — exactly these, no more and no fewer, because
 * `metaPackages.ts` reads them by name and a snapshot with a different shape is a
 * snapshot the node cannot serve.
 *
 * TWO DIGESTS, TWO SUBJECTS, AND BOTH NAMED IN THEIR OWN FIELD
 *
 *   - `sha256` is over THE RESPONSE BODY AS FETCHED, and `bytes` is its
 *     `Buffer.byteLength`. It commits this file to what the SOURCE sent.
 *   - `documentSha256` is over THE DOCUMENT EXACTLY AS STORED IN THIS FILE —
 *     `sha256(JSON.stringify(document), 'utf8')`, the same compact serialisation
 *     the file's own `document` value round-trips to.
 *
 * **WHY THE SECOND DIGEST EXISTS: THE FIRST ONE IS NOT RECOMPUTABLE OFFLINE.** The
 * body is hashed as fetched and then stored re-serialised at two-space indent, so
 * hashing the committed file reproduces NEITHER number — a reader who "verified"
 * `sha256` from disk would be verifying nothing, which is the shape of a check
 * that cannot fail. `documentSha256` closes that gap: it is checkable with no
 * network, and `sha256` remains the network-side check. **The algorithm is in the
 * FIELD NAME for both**, because a bare digest is unappealable: an md5 quoted
 * beside a sha256 is a confident, meaningless mismatch (the recorded trap in
 * `AGENTS.md`).
 *
 * WHAT THIS TOOL REFUSES, AND WHY EACH REFUSAL IS A REAL STATE
 *
 * The contract requires a non-zero exit on a non-200, on an unparseable body, and
 * on an empty `document`, "because a snapshot of nothing must never be committed
 * as a snapshot — the node would then serve `0 zones` as a fact". An empty
 * document is checked as TWO separate facts, because they fail differently:
 *
 *   - no ASSEMBLY ID: the body does not say whose surface it is, so nothing in it
 *     can be attributed to a package;
 *   - a PATH LIST OF LENGTH ZERO: the body is a surface that advertises no route,
 *     which is the "0" this program refuses to publish as a reading (a `0` on both
 *     sides is instrument failure, never a pass).
 *
 * Exit codes are distinct per refusal so a caller can tell them apart in a shell
 * `$?` without reading the message:
 *
 *   0  captured, file written
 *   1  usage error (no `--url`, no `--out`, unknown flag)
 *   2  non-200 status
 *   3  body was not parseable JSON
 *   4  empty document (no assembly id, or a path list of length 0)
 *   5  transport failure or timeout — the surface did not answer at all
 *   6  the snapshot file could not be written
 *
 * A REFUSAL WRITES NOTHING. The output path is only touched after every check has
 * passed, and then through a temp file plus `rename`, so an interrupted run cannot
 * leave a half-written snapshot that the node would serve as a whole one.
 *
 * Usage: node docker/tools/capture-meta-packages.mjs --url <url> --out <path> [--timeout-ms N]
 */

import { renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 120_000

const EXIT = Object.freeze({
  ok: 0,
  usage: 1,
  non200: 2,
  unparseable: 3,
  emptyDocument: 4,
  transport: 5,
  unwritable: 6,
})

function fail(code, message) {
  process.stderr.write(`${message}\n`)
  process.exit(code)
}

/** Parse `--flag value` pairs. Unknown flags are refused rather than ignored. */
function parseArgs(argv) {
  const parsed = { url: null, out: null, timeoutMs: DEFAULT_TIMEOUT_MS }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--url' || flag === '--out' || flag === '--timeout-ms') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) fail(EXIT.usage, `refused: ${flag} needs a value`)
      index += 1
      if (flag === '--url') parsed.url = value
      else if (flag === '--out') parsed.out = value
      else {
        const n = Number(value)
        if (!Number.isFinite(n) || n <= 0) fail(EXIT.usage, `refused: --timeout-ms must be a positive number, got '${value}'`)
        parsed.timeoutMs = n
      }
    } else if (flag === '--help' || flag === '-h') {
      process.stdout.write('usage: node docker/tools/capture-meta-packages.mjs --url <url> --out <path> [--timeout-ms N]\n')
      process.exit(EXIT.ok)
    } else {
      fail(EXIT.usage, `refused: unknown argument '${flag}'; this tool takes --url, --out and --timeout-ms only`)
    }
  }
  if (parsed.url === null) fail(EXIT.usage, 'refused: --url is required')
  if (parsed.out === null) fail(EXIT.usage, 'refused: --out is required')
  return parsed
}

function asRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringOrNull(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The assembly id, from wherever the served body puts it.
 *
 * Three shapes are accepted because the two live routes differ and BOTH are real
 * readings of one assembly: `/meta-market/api` nests it as `{ assembly: { id } }`,
 * `/meta-market/api/gui/health` states it as `{ identity: { id } }`, and a future
 * flattening would put it at the top. Accepting all three is a reading of the
 * surface rather than a tolerance that hides a missing id: if none of the three
 * carries a non-empty string, there is no id and the tool refuses.
 */
function assemblyIdOf(document) {
  const record = asRecord(document)
  if (record === null) return null
  const assembly = asRecord(record.assembly)
  const identity = asRecord(record.identity)
  return stringOrNull(record.id)
    ?? (identity === null ? null : stringOrNull(identity.id))
    ?? (assembly === null ? null : stringOrNull(assembly.id))
}

/**
 * The registered-path list, from either place the clone publishes it.
 *
 * `gui/health` publishes `{ routes: { advertised, paths } }`; the 404 body
 * publishes `{ registered }`. Both are the SAME array (`REGISTERED_PATHS`) in the
 * clone being captured, so this is two spellings of one fact rather than two
 * sources. Anything else — a missing key, a non-array, an array of non-strings —
 * is `null`, and `null` is refused rather than coerced to `[]`, because `[]` would
 * pass a `.length === 0` check written by accident and report "empty" as "absent".
 */
function pathListOf(document) {
  const record = asRecord(document)
  if (record === null) return null
  const routes = asRecord(record.routes)
  const candidate = routes !== null && Array.isArray(routes.paths) ? routes.paths : Array.isArray(record.registered) ? record.registered : null
  if (candidate === null) return null
  const strings = candidate.filter((entry) => typeof entry === 'string' && entry.length > 0)
  return strings.length === candidate.length ? Object.freeze(strings) : null
}

async function main() {
  const { url, out, timeoutMs } = parseArgs(process.argv.slice(2))

  let response
  let buffer
  try {
    response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    buffer = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    fail(EXIT.transport, `refused: GET ${url} did not answer within ${timeoutMs}ms — ${error instanceof Error ? error.message : String(error)}`)
  }

  if (response.status !== 200) {
    const preview = buffer.subarray(0, 400).toString('utf8').replaceAll('\n', ' ')
    fail(EXIT.non200, `refused: GET ${url} answered ${response.status}, not 200; body preview: ${preview}`)
  }

  const text = buffer.toString('utf8')
  let document
  try {
    document = JSON.parse(text)
  } catch (error) {
    fail(EXIT.unparseable, `refused: GET ${url} answered 200 with a body that is not JSON — ${error instanceof Error ? error.message : String(error)}; first 200 chars: ${text.slice(0, 200).replaceAll('\n', ' ')}`)
  }

  const assemblyId = assemblyIdOf(document)
  if (assemblyId === null) {
    fail(EXIT.emptyDocument, `refused: GET ${url} answered 200 with no assembly id at document.id, document.identity.id or document.assembly.id — a body that does not name its own assembly cannot be served as a package census`)
  }

  const paths = pathListOf(document)
  if (paths === null) {
    fail(EXIT.emptyDocument, `refused: GET ${url} answered 200 with no registered path list at document.routes.paths or document.registered — the path table is what a reader checks this artifact against, and its absence is not a zero`)
  }
  if (paths.length === 0) {
    fail(EXIT.emptyDocument, `refused: GET ${url} answered 200 with a path list of length 0 — "advertises 0 paths" is the kind of empty census this program refuses to commit as a snapshot`)
  }

  const snapshot = {
    source: url,
    capturedAt: new Date().toISOString(),
    status: response.status,
    bytes: buffer.byteLength,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    documentSha256: createHash('sha256').update(JSON.stringify(document), 'utf8').digest('hex'),
    document,
  }

  const target = resolve(out)
  const temp = `${target}.tmp-${process.pid}`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    renameSync(temp, target)
  } catch (error) {
    try {
      unlinkSync(temp)
    } catch {
      // The temp file may not exist; the write failure is the one to report.
    }
    fail(EXIT.unwritable, `refused: the snapshot could not be written to ${target} — ${error instanceof Error ? error.message : String(error)}`)
  }

  process.stdout.write(`${JSON.stringify({
    wrote: pathToFileURL(target).href,
    source: snapshot.source,
    capturedAt: snapshot.capturedAt,
    status: snapshot.status,
    bytes: snapshot.bytes,
    sha256: snapshot.sha256,
    sha256Subject: 'the response body as fetched (network-side check; NOT recomputable from the file)',
    documentSha256: snapshot.documentSha256,
    documentSha256Subject: 'sha256(JSON.stringify(document), utf8) — the document exactly as stored (network-free check)',
    assemblyId,
    pathsAdvertised: paths.length,
    pathSample: paths.slice(0, 3),
  }, null, 2)}\n`)
  process.exit(EXIT.ok)
}

main()
