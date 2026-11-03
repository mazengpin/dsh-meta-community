#!/usr/bin/env node
// docker/verify/anonymity.mjs — the anonymity INSTRUMENT, not a promise.
//
// Owner's requirement: "no data of user shall be rpovable saved on the node so sesions are completely
// anonimous and dont verserve any data of the users". A promise is not evidence; a canary sweep is.
//
// WHAT THIS DOES
//   1. mints a unique canary  CANARY-<32 hex>-SECRET
//   2. POSTs it as user data to  http://127.0.0.1:18091/node/session/probe  (canary in several
//      field names), and records the digest, `retained`, `store`, and every response header
//   3. searches that canary on FOUR surfaces of the node container, reporting for each
//        (a) an occurrence count, and (b) whether the surface was ACTUALLY PROBED
//      ("probed" is `true` when the probe ran, `null` when it did not; the count is `null` exactly
//      when the probe did not run, so a count can never be read as a substitute for a probe)
//   4. runs the MANDATORY POSITIVE CONTROL: a fixture container that deliberately writes the SAME
//      canary to /tmp, searched with the SAME code. If the control misses, the zeros are not
//      readings: the run is instrument failure and exits non-zero.
//   5. proves no cookie/token is issued, and that a second identical probe yields a DIFFERENT
//      digest (the payload is not the thing retained)
//
// EXIT CODES (every non-zero code is a distinct failure, none is a pass)
//   0  all checks passed
//   1  the canary was FOUND on at least one node surface
//   2  POSITIVE CONTROL FAILED — instrument failure; every 0 in this run is not evidence
//   3  PRECONDITION FAILED — no live node container / endpoint unreachable; nothing was measured
//   4  a surface was NOT PROBED (this is a FAIL, never a clean surface)
//   5  a set-cookie was issued, or the digest/retained assertions failed
//
// Plain ESM, no dependencies: `node docker/verify/anonymity.mjs`
// Env overrides: NODE_URL (default http://127.0.0.1:18091), NODE_CONTAINER (default: discovered
// from the container publishing host port 18091), DOCKER (default `docker`).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const DOCKER = process.env.DOCKER || 'docker'
const NODE_URL = (process.env.NODE_URL || 'http://127.0.0.1:18091').replace(/\/+$/, '')
const PROBE_PATH = '/node/session/probe'
const ANON_PATH = '/node/anonymity'
const HOST_PORT = '18091'
const FIXTURE_IMAGE = process.env.FIXTURE_IMAGE || 'alpine:latest'

const canary = `CANARY-${crypto.randomBytes(16).toString('hex')}-SECRET`
const canaryShort = canary.slice(7, 15)
const fixtureName = `anon-canary-fixture-${canaryShort}`
const fixtureImageTag = `anon-canary-fixture-image:${canaryShort}`
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anon-sweep-'))

// One physical line per printed record, so a reader can diff two runs.
const log = (...a) => console.log(...a)
const results = { checks: [], surfaces: [], control: {}, probe: {}, exitCode: null }

// ───────────────────────────────────────────────────────────────────────────── helpers
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'buffer',
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeout ?? 180_000,
    windowsHide: true,
  })
  const out = r.stdout ? r.stdout.toString('utf8') : ''
  const err = r.stderr ? r.stderr.toString('utf8') : ''
  const timedOut = r.error && r.error.code === 'ETIMEDOUT'
  return {
    cmd: [cmd, ...args].join(' '),
    status: r.status,
    signal: r.signal,
    ok: r.status === 0,
    out,
    err,
    timedOut,
    spawnError: r.error ? String(r.error.message || r.error) : null,
  }
}

function countOccurrences(buf, needle) {
  const hay = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')
  const n = Buffer.from(needle, 'utf8')
  if (n.length === 0) throw new Error('countOccurrences: empty needle is not a check')
  let count = 0
  let i = hay.indexOf(n, 0)
  while (i !== -1) {
    count += 1
    i = hay.indexOf(n, i + n.length)
  }
  return count
}

const record = (name, pass, observed, expected, note) => {
  results.checks.push({ name, pass: Boolean(pass), observed, expected, note: note ?? null })
  log(`CHECK ${pass ? 'PASS' : 'FAIL'}  ${name}  observed=${json(observed)} expected=${json(expected)}`)
}
const json = (v) => {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

// ─────────────────────────────────────────────────────────── tar + gzip layer scanning
function tarHeader(buf, off) {
  const cstr = (from, to) => buf.toString('utf8', off + from, off + to).replace(/\0[\s\S]*$/, '')
  const prefix = cstr(345, 500)
  const name = cstr(0, 100)
  const sizeField = buf.toString('ascii', off + 124, off + 136)
  const octal = sizeField.replace(/\0/g, '').trim()
  let size = 0
  if (sizeField.length && buf[off + 124] & 0x80) {
    // base-256 size: not produced by docker save, but never read as zero
    size = Number(buf.readBigUInt64BE(off + 128))
  } else if (octal) {
    size = parseInt(octal, 8)
    if (!Number.isFinite(size)) size = 0
  }
  const typeflag = String.fromCharCode(buf[off + 156] || 0)
  return { name: prefix ? `${prefix}/${name}` : name, size, typeflag }
}

function isZeroBlock(buf, off) {
  for (let i = 0; i < 512; i += 1) if (buf[off + i] !== 0) return false
  return true
}

// Scan every entry of a docker-save outer tar. A layer entry may be a gzip blob (OCI layout) or an
// uncompressed layer.tar (classic layout); the canary can only be seen in DECOMPRESSED layer bytes,
// so a raw byte search over the tar would manufacture a false zero. That is the trap this function
// exists to avoid.
function scanImageTar(tarPath) {
  const fd = fs.openSync(tarPath, 'r')
  const fileSize = fs.fstatSync(fd).size
  const head = Buffer.alloc(512)
  const needle = Buffer.from(canary, 'utf8')
  let off = 0
  let entries = 0
  let layerEntries = 0
  const unreadable = []
  const hits = []
  try {
    while (off + 512 <= fileSize) {
      fs.readSync(fd, head, 0, 512, off)
      if (isZeroBlock(head, 0)) break
      const h = tarHeader(head, 0)
      const dataOff = off + 512
      const size = h.size
      if (size < 0 || dataOff + size > fileSize) {
        unreadable.push({ name: h.name, reason: `entry size ${size} exceeds archive (truncated save?)` })
        break
      }
      entries += 1
      if (size > 0) {
        const raw = Buffer.alloc(size)
        fs.readSync(fd, raw, 0, size, dataOff)
        const gz = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b
        let decoded = raw
        if (gz) {
          try {
            decoded = zlib.gunzipSync(raw, { maxOutputLength: 1024 * 1024 * 1024 })
          } catch (e) {
            unreadable.push({ name: h.name, reason: `gunzip failed: ${e.message}` })
            decoded = null
          }
        }
        if (decoded) {
          if (gz) layerEntries += 1
          const c = countOccurrences(decoded, needle)
          if (c > 0) hits.push({ entry: h.name, gzip: gz, occurrences: c })
        }
      }
      off = dataOff + Math.ceil(size / 512) * 512
    }
  } finally {
    fs.closeSync(fd)
  }
  return { entries, layerEntries, unreadable, hits, tarBytes: fileSize }
}

// ──────────────────────────────────────────────────────────── the four node surfaces
// Each surface returns { surface, probed: true|null, occurrences: number|null, ... }. The
// occurrences field is null exactly when probed is null — enforced again by a check at the end.
// SURFACE a — the writable layer. `docker diff` prints PATHS, not file contents, so a canary can
// only appear in its text when it reached a PATH NAME, and a content search over the diff output is
// structurally always 0 (the positive control found this: it returned 0 while the diff itself showed
// `A /tmp/anonymity-canary.txt`). So the writable layer is scanned on BOTH dimensions:
//   - name dimension: canary occurrences in the diff text (paths docker admits it changed)
//   - content dimension: grep the CONTENT of every added/changed path the diff names
// An empty diff is a COMPLETE census of an empty set — population 0, so its 0 is a reading, not a hole.
function surfaceDiff(container) {
  const r = run(DOCKER, ['diff', container])
  if (!r.ok) {
    return { surface: 'a-writable-layer (docker diff + changed-path content)', probed: null, occurrences: null,
      reason: `docker diff exited ${r.status}: ${(r.err || r.spawnError || '').trim().slice(0, 300)}`, command: r.cmd }
  }
  const lines = r.out.split(/\r?\n/).filter((l) => l.length > 0)
  const changed = lines.map((l) => ({ kind: l[0], path: l.slice(2) })).filter((e) => e.path.startsWith('/'))
  const nameOccurrences = countOccurrences(r.out, canary)
  const scanPaths = changed.filter((e) => e.kind !== 'D').map((e) => e.path)

  let content = { probed: true, occurrences: 0, population: 0, hits: [], note: 'no added/changed path; nothing in the writable layer to scan' }
  if (scanPaths.length > 0) {
    const g = run(DOCKER, ['exec', container, 'grep', '-rlF', '-a', canary, ...scanPaths])
    // de-duplicated: a path argument and its own parent both named in the diff would otherwise
    // report the ONE containing file twice
    const hits = [...new Set(g.out.split(/\r?\n/).filter(Boolean))]
    content = {
      probed: g.status === 0 || g.status === 1,
      // one content occurrence = one FILE whose content matched; the count is of files, because a
      // changed path may itself contain the canary and double-counting it would inflate the number
      occurrences: hits.length,
      population: scanPaths.length,
      hits: hits.slice(0, 20),
      rc: g.status,
      reason: g.status === 2 ? `grep over the changed paths could not complete: ${(g.err || '').trim().slice(0, 300)}` : null,
      command: g.cmd,
    }
  }
  if (content.probed !== true && content.occurrences === 0) {
    return { surface: 'a-writable-layer (docker diff + changed-path content)', probed: null, occurrences: null,
      changedPaths: changed.length, reason: content.reason, content, command: r.cmd }
  }
  return { surface: 'a-writable-layer (docker diff + changed-path content)', probed: true,
    occurrences: nameOccurrences + content.occurrences, nameOccurrences, contentOccurrences: content.occurrences,
    changedPaths: changed.length, sample: lines.slice(0, 20), content, command: r.cmd,
    // STATED IN THE ARTIFACT, not only in a report: a reader must not be able to quote this 0 as
    // evidence about /tmp. Measured by mutation (`--mutate-node-tmp`): a canary planted in /tmp left
    // this surface at 0 while surface c found it.
    blindTo: 'tmpfs — docker diff has no visibility into tmpfs mounts, so a 0 here is NOT a statement about /tmp, /run or /dev/shm; surface c is what searches those' }
}

// The json-file driver is capped (compose: max-size=1m, max-file=1). A log AT the cap has dropped
// its oldest lines, so a payload logged early and rotated away is unsearchable — the surface would
// return 0 for content that genuinely once passed through it. A log at the cap is therefore a
// PARTIAL surface and must report `null`, not 0. Threshold is 90% of the cap, not the cap itself,
// because rotation can leave a file just under its limit.
const LOG_CAP_BYTES = 1024 * 1024
function surfaceLogs(container) {
  const r = run(DOCKER, ['logs', container])
  if (!r.ok) {
    return { surface: 'b-logs (docker logs 2>&1)', probed: null, occurrences: null,
      reason: `docker logs exited ${r.status}: ${(r.err || r.spawnError || '').trim().slice(0, 300)}`, command: r.cmd }
  }
  // 2>&1 semantics: both streams are searched, because a payload can leak to either.
  const both = `${r.out}\n${r.err}`
  const logBytes = Buffer.byteLength(both)
  if (logBytes >= LOG_CAP_BYTES * 0.9) {
    return { surface: 'b-logs (docker logs 2>&1)', probed: null, occurrences: null,
      logBytes, logCapBytes: LOG_CAP_BYTES,
      reason: `the log is at ${logBytes} of a ${LOG_CAP_BYTES} B cap, so its oldest lines have rotated away — earlier content is unsearchable and a 0 here would be partial`,
      command: r.cmd }
  }
  return { surface: 'b-logs (docker logs 2>&1)', probed: true,
    occurrences: countOccurrences(both, canary), logBytes, logCapBytes: LOG_CAP_BYTES, command: r.cmd }
}

// The five roots the task names, PLUS the four other writable-suspect locations the image actually
// has (measured present: /run, /dev/shm, /srv, /opt). /dev/shm and /run are tmpfs, so they share
// surface (a)'s blind spot and would otherwise be searched by NOTHING; a canary written there would
// have produced four clean zeros. The list stays explicit and bounded rather than `grep -r /`,
// because /proc and /sys are pseudo-filesystems that would report a partial sweep as an error and
// tell a reader nothing about the writable filesystem.
const GREP_ROOTS = ['/app', '/tmp', '/home', '/var', '/root', '/run', '/dev/shm', '/srv', '/opt']

// One pass over the fixed roots, run inside the container. `ROOT`/`SKIP` says whether the root
// existed; `RC <root> <code>` is grep's own status for that root: 0 = match, 1 = searched and no
// match, 2 = grep could not complete (an unreadable subtree) — an incomplete root is UNPROBED,
// never clean. `HIT <path>` names a file whose content carried the canary.
// NOTE the `fi;` before `else`: without that semicolon the nested if/else is a shell syntax error,
// which the positive control caught as `probed=null` rather than as a false clean surface.
function grepPass(container, userArgs) {
  const blocks = GREP_ROOTS.map((d) => {
    const q = `'${d}'`
    return `if [ -d ${q} ]; then printf 'ROOT %s\\n' ${q}; `
      + `out=$(grep -rlF -a '${canary}' ${q} 2>/dev/null); rc=$?; `
      + `printf 'RC %s %s\\n' ${q} "$rc"; `
      + `if [ -n "$out" ]; then printf 'HIT %s\\n' "$out"; fi; `
      + `else printf 'SKIP %s\\n' ${q}; fi; `
  }).join('')
  return run(DOCKER, ['exec', ...userArgs, container, 'sh', '-c', blocks])
}

function parseGrepPass(r) {
  const roots = []
  const skips = []
  const hits = []
  const rc = {}
  for (const line of r.out.split(/\r?\n/)) {
    let m = /^ROOT (.+)$/.exec(line)
    if (m) { roots.push(m[1]); continue }
    m = /^SKIP (.+)$/.exec(line)
    if (m) { skips.push(m[1]); continue }
    m = /^RC (\S+) (\d+)$/.exec(line)
    if (m) { rc[m[1]] = Number(m[2]); continue }
    m = /^HIT (.+)$/.exec(line)
    if (m) hits.push(m[1])
  }
  return { roots, skips, hits, rc }
}

function surfaceFilesystem(container) {
  const primary = grepPass(container, [])
  if (!primary.ok && primary.status !== 1) {
    return { surface: 'c-filesystem (docker exec grep -r)', probed: null, occurrences: null,
      reason: `docker exec exited ${primary.status}: ${(primary.err || primary.spawnError || '').trim().slice(0, 300)}`, command: primary.cmd }
  }
  const p1 = parseGrepPass(primary)
  // A second pass as uid 0 covers image-owned files the container user cannot read. The node runs
  // with cap_drop ALL, so this pass is NOT assumed to succeed; it is measured, and a root is probed
  // only if SOME pass returned grep status 0 or 1 for it.
  const root0 = grepPass(container, ['-u', '0'])
  const p0 = root0.ok || root0.status === 1 ? parseGrepPass(root0) : { roots: [], skips: [], hits: [], rc: {} }

  const rootNames = GREP_ROOTS.filter((d) => p1.roots.includes(d) || p0.roots.includes(d))
  if (rootNames.length === 0) {
    return { surface: 'c-filesystem (docker exec grep -r)', probed: null, occurrences: null,
      reason: 'no root existed inside the container; nothing was searched',
      skipped: p1.skips, command: primary.cmd }
  }
  const hits = [...new Set([...p1.hits, ...p0.hits])]
  const unprobedRoots = rootNames.filter((d) => {
    const c = [p1.rc[d], p0.rc[d]].filter((x) => typeof x === 'number')
    return !(c.includes(0) || c.includes(1))
  })
  if (unprobedRoots.length > 0 && hits.length === 0) {
    return { surface: 'c-filesystem (docker exec grep -r)', probed: null, occurrences: null,
      reason: `grep could not complete under ${unprobedRoots.join(',')} in either pass (uid 10001 and uid 0) — a partial sweep cannot report 0`,
      perRoot: { user: p1.rc, root: p0.rc }, rootsProbed: rootNames.length, rootsAttempted: GREP_ROOTS.length,
      skipped: p1.skips, command: primary.cmd }
  }
  return { surface: 'c-filesystem (docker exec grep -r)', probed: true,
    // one occurrence = one file whose CONTENT carried the canary (as reported by grep -l)
    occurrences: hits.length, matchedFiles: hits.slice(0, 20),
    rootsProbed: rootNames.length, rootsAttempted: GREP_ROOTS.length,
    perRoot: { user: p1.rc, root: p0.rc }, skipped: p1.skips,
    command: `${primary.cmd}   (and: ${root0.cmd})` }
}

function imageOf(container) {
  // The TAG can move under a running container (it did: BUILD 2 -> BUILD 3 changed only a comment
  // in .dockerignore, and the tag now names BUILD 3). The artifact that is actually running is the
  // image ID, so that is what is scanned; the tag is recorded beside it so a reader can see if the
  // two disagree.
  const id = run(DOCKER, ['inspect', '-f', '{{.Image}}', container])
  const tag = run(DOCKER, ['inspect', '-f', '{{.Config.Image}}', container])
  const imageId = id.ok && id.out.trim() ? id.out.trim() : null
  const imageTag = tag.ok && tag.out.trim() ? tag.out.trim() : null
  if (imageId) return { image: imageId, tag: imageTag, via: 'running image id (.Image)' }
  if (imageTag) return { image: imageTag, tag: imageTag, via: 'Config.Image tag (.Image absent)' }
  return { image: null, tag: imageTag, via: null, reason: `docker inspect failed: ${(id.err || '').trim().slice(0, 200)}` }
}

function surfaceImage(container) {
  const { image, tag, via, reason } = imageOf(container)
  if (!image) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      reason: reason || 'image reference unresolvable' }
  }
  const tarPath = path.join(workDir, `node-image-${canaryShort}.tar`)
  const save = run(DOCKER, ['save', '-o', tarPath, image], { timeout: 600_000 })
  if (!save.ok) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      image, imageTag: tag, imageVia: via, reason: `docker save exited ${save.status}: ${(save.err || save.spawnError || '').trim().slice(0, 300)}`, command: save.cmd }
  }
  let scan
  try {
    scan = scanImageTar(tarPath)
  } catch (e) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      image, imageTag: tag, imageVia: via, reason: `tar scan threw: ${e.message}`, tarPath }
  }
  if (scan.unreadable.length > 0) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      image, imageTag: tag, imageVia: via, tarPath, tarBytes: scan.tarBytes, entries: scan.entries,
      layerEntries: scan.layerEntries, unreadable: scan.unreadable.slice(0, 10),
      reason: `${scan.unreadable.length} archive entry/entries could not be decoded — an incomplete layer scan cannot report 0` }
  }
  if (scan.layerEntries === 0 && scan.hits.length === 0) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      image, imageTag: tag, imageVia: via, tarPath, tarBytes: scan.tarBytes, entries: scan.entries,
      reason: 'no gzip layer entry was decoded — the scanner did not reach layer data, so a 0 here would be instrument failure' }
  }
  // COMPLETENESS: the archive must contain every layer the image declares, or the scan is partial and
  // its 0 is not a reading. `docker image inspect` needs the IMAGE REF, not the container name.
  const layersRes = run(DOCKER, ['image', 'inspect', '-f', '{{len .RootFS.Layers}}', image])
  const layersExpected = layersRes.ok && /^\d+$/.test(layersRes.out.trim()) ? Number(layersRes.out.trim()) : null
  const tagRef = run(DOCKER, ['image', 'inspect', '-f', '{{.Id}}', tag || image])
  const tagCurrentId = tagRef.ok && tagRef.out.trim() ? tagRef.out.trim() : null
  if (layersExpected !== null && scan.layerEntries !== layersExpected) {
    return { surface: 'd-image-layers (docker save + scan)', probed: null, occurrences: null,
      image, imageTag: tag, imageVia: via, tarPath, tarBytes: scan.tarBytes, entries: scan.entries,
      layerEntries: scan.layerEntries, layersExpected,
      reason: `decoded ${scan.layerEntries} of the ${layersExpected} layers the image declares — a partial layer scan cannot report 0` }
  }
  return { surface: 'd-image-layers (docker save + scan)', probed: true,
    occurrences: scan.hits.reduce((a, h) => a + h.occurrences, 0), image, imageTag: tag, imageVia: via,
    tarPath, tarBytes: scan.tarBytes, entries: scan.entries, layerEntries: scan.layerEntries,
    layersExpected, tagCurrentId, tagMatchesRunningImage: tagCurrentId === null ? null : tagCurrentId === image,
    hits: scan.hits.slice(0, 10) }
}

// ─────────────────────────────────────────────────────────── discovery / preconditions
function dockerServerVersion() {
  const r = run(DOCKER, ['version', '--format', '{{.Server.Version}}'], { timeout: 60_000 })
  return r.ok ? r.out.trim() : null
}

function discoverContainer() {
  if (process.env.NODE_CONTAINER) {
    return { name: process.env.NODE_CONTAINER, via: 'NODE_CONTAINER' }
  }
  const r = run(DOCKER, ['ps', '--filter', `publish=${HOST_PORT}`, '--format', '{{.Names}}'])
  if (r.ok) {
    const names = r.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (names.length === 1) return { name: names[0], via: `docker ps --filter publish=${HOST_PORT}` }
    if (names.length > 1) return { name: names[0], via: `docker ps --filter publish=${HOST_PORT} (first of ${names.join(',')})`, ambiguous: names }
  }
  const n = run(DOCKER, ['ps', '--format', '{{.Names}}'])
  if (n.ok) {
    const names = n.out.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.includes('node-a'))
    if (names.length >= 1) return { name: names[0], via: 'docker ps name~node-a' }
  }
  return { name: null, via: null }
}

function containerRunning(name) {
  const r = run(DOCKER, ['inspect', '-f', '{{.State.Running}}|{{.State.Status}}', name])
  if (!r.ok) return { ok: false, reason: `docker inspect exited ${r.status}: ${(r.err || '').trim().slice(0, 200)}` }
  const [running, status] = r.out.trim().split('|')
  return { ok: running === 'true', running, status }
}

async function postProbe(body) {
  const res = await fetch(`${NODE_URL}${PROBE_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = null
  }
  const headers = {}
  for (const [k, v] of res.headers.entries()) headers[k] = v
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  if (setCookie.length === 0) {
    const single = res.headers.get('set-cookie')
    if (single) setCookie.push(single)
  }
  return { status: res.status, headers, setCookie, text, body: parsed }
}

async function getJson(p) {
  try {
    const res = await fetch(`${NODE_URL}${p}`, { signal: AbortSignal.timeout(10_000) })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { status: res.status, body, text: text.slice(0, 4000) }
  } catch (e) {
    return { status: null, body: null, text: String(e.message || e) }
  }
}

// ─────────────────────────────────────────────────────────── positive control fixtures
function startFixture() {
  // The canary goes into BOTH the file NAME and the file CONTENT, and onto stdout, because the three
  // container surfaces read different things: `docker diff` prints paths only (so a content-only
  // write is invisible to it, which is a real limit of that surface and is stated rather than
  // papered over), `docker logs` reads the stream, and `docker exec grep` reads content.
  const r = run(DOCKER, ['run', '-d', '--name', fixtureName, '--network', 'none', '-e', `CANARY=${canary}`,
    FIXTURE_IMAGE, 'sh', '-c',
    'printf "%s\\n" "$CANARY" > "/tmp/$CANARY.txt"; printf "%s\\n" "$CANARY"; sleep 900'])
  if (!r.ok) return { ok: false, reason: `docker run exited ${r.status}: ${(r.err || r.spawnError || '').trim().slice(0, 400)}`, command: r.cmd }
  // wait for the write to land and the log line to flush
  for (let i = 0; i < 40; i += 1) {
    const st = containerRunning(fixtureName)
    if (st.ok) {
      const l = run(DOCKER, ['logs', fixtureName])
      if (l.ok && l.out.includes(canary)) return { ok: true, command: r.cmd }
    }
    const t = Date.now() + 250
    while (Date.now() < t) {
      /* short settle; the fixture must actually run before it can be searched */
    }
  }
  return { ok: false, reason: 'fixture container did not come up with the canary in its log within 10s', command: r.cmd }
}

function commitFixture() {
  const r = run(DOCKER, ['commit', fixtureName, fixtureImageTag], { timeout: 300_000 })
  if (!r.ok) return { ok: false, reason: `docker commit exited ${r.status}: ${(r.err || r.spawnError || '').trim().slice(0, 400)}`, command: r.cmd }
  return { ok: true, image: fixtureImageTag, command: r.cmd }
}

function scanFixtureImage() {
  const tarPath = path.join(workDir, `fixture-image-${canaryShort}.tar`)
  const save = run(DOCKER, ['save', '-o', tarPath, fixtureImageTag], { timeout: 600_000 })
  if (!save.ok) return { probed: null, occurrences: null, reason: `docker save exited ${save.status}: ${(save.err || '').trim().slice(0, 300)}`, command: save.cmd }
  let scan
  try {
    scan = scanImageTar(tarPath)
  } catch (e) {
    return { probed: null, occurrences: null, reason: `tar scan threw: ${e.message}`, tarPath }
  }
  if (scan.unreadable.length > 0) {
    return { probed: null, occurrences: null, reason: `${scan.unreadable.length} unreadable entries`, tarPath,
      unreadable: scan.unreadable.slice(0, 5) }
  }
  return { probed: true, occurrences: scan.hits.reduce((a, h) => a + h.occurrences, 0),
    layerEntries: scan.layerEntries, entries: scan.entries, hits: scan.hits.slice(0, 5), tarPath, tarBytes: scan.tarBytes }
}

// ─────────────────────────────────────────────────────────── main
async function main() {
  log(`CANARY ${canary}`)
  log(`WORKDIR ${workDir}`)
  results.canary = canary
  results.nodeUrl = NODE_URL
  results.at = new Date().toISOString()

  // ---- precondition: docker present
  const dv = dockerServerVersion()
  results.docker = { serverVersion: dv, client: DOCKER }
  if (!dv) {
    log('PRECONDITION FAILED: docker server unreachable — NOTHING was measured')
    results.exitCode = 3
    return finish()
  }

  // `--control-only` runs the POSITIVE CONTROL ALONE, against no node. It exists because an
  // instrument that has never been shown to find a canary is not yet an instrument: this mode can
  // be run before the node stack exists, and it must exit 0 only if all four control surfaces hit.
  if (process.argv.includes('--control-only') || process.env.ANON_CONTROL_ONLY === '1') {
    const fx = startFixture()
    const control = { surfaces: [] }
    results.control.fixture = { name: fixtureName, started: fx, image: FIXTURE_IMAGE }
    if (fx.ok) {
      control.surfaces.push(surfaceDiff(fixtureName))
      control.surfaces.push(surfaceLogs(fixtureName))
      control.surfaces.push(surfaceFilesystem(fixtureName))
      const commit = commitFixture()
      control.commit = commit
      control.image = commit.ok ? scanFixtureImage() : { probed: null, occurrences: null, reason: commit.reason }
    } else {
      control.surfaces = ['a-', 'b-', 'c-'].map((p) => ({ surface: `${p} (fixture)`, probed: null, occurrences: null, reason: 'fixture did not start' }))
      control.image = { probed: null, occurrences: null, reason: 'fixture did not start' }
    }
    results.control.searches = control
    for (const s of control.surfaces) log(`CONTROL ${s.surface} probed=${s.probed === true ? 'true' : 'null'} occurrences=${s.occurrences === null ? 'null' : s.occurrences}${s.reason ? ` reason=${s.reason}` : ''}`)
    log(`CONTROL d-image-layers probed=${control.image.probed === true ? 'true' : 'null'} occurrences=${control.image.occurrences === null ? 'null' : control.image.occurrences}${control.image.reason ? ` reason=${control.image.reason}` : ''}`)
    const ctlA = control.surfaces.find((s) => s.surface.startsWith('a-'))
    const ctlB = control.surfaces.find((s) => s.surface.startsWith('b-'))
    const ctlC = control.surfaces.find((s) => s.surface.startsWith('c-'))
    record('CONTROL a: canary FOUND in fixture writable layer', (ctlA.occurrences ?? 0) > 0, ctlA.occurrences, '> 0')
    record('CONTROL b: canary FOUND in fixture logs', (ctlB.occurrences ?? 0) > 0, ctlB.occurrences, '> 0')
    record('CONTROL c: canary FOUND on fixture filesystem', (ctlC.occurrences ?? 0) > 0, ctlC.occurrences, '> 0')
    record('CONTROL d: canary FOUND in fixture committed image layer', (control.image.occurrences ?? 0) > 0, control.image.occurrences, '> 0')
    const allHit = results.checks.every((c) => c.pass)
    results.exitCode = allHit ? 0 : 2
    log(allHit
      ? 'CONTROL-ONLY: PASS — the search finds a canary on all four surfaces; the node zeros, when they come, are readings.'
      : 'CONTROL-ONLY: INSTRUMENT FAILURE — the search did NOT find a canary it deliberately stored. Fix the instrument.')
    return finish()
  }

  // ---- precondition: the node container is running
  const disc = discoverContainer()
  results.container = disc
  if (!disc.name) {
    log(`PRECONDITION FAILED: no node container found (no container publishes host port ${HOST_PORT}). NOTHING was measured.`)
    results.exitCode = 3
    return finish()
  }
  const running = containerRunning(disc.name)
  results.container.running = running
  // A container NAME survives recreation, so a name is not an artifact identity: `meta-community-node-a`
  // named a different container before and after each `docker compose up --force-recreate`. Record the
  // id and the start time, so a printed result is reproducible against the instance it measured.
  const cid = run(DOCKER, ['inspect', '-f', '{{.Id}}|{{.State.StartedAt}}', disc.name])
  if (cid.ok && cid.out.trim()) {
    const [containerId, startedAt] = cid.out.trim().split('|')
    results.container.id = containerId
    results.container.startedAt = startedAt
    log(`CONTAINER-ID ${containerId} startedAt=${startedAt}`)
  }
  log(`CONTAINER ${disc.name} via ${disc.via} running=${running.running ?? '?'}`)
  if (!running.ok) {
    log(`PRECONDITION FAILED: node container ${disc.name} is not running (${running.reason || running.status}). NOTHING was measured.`)
    results.exitCode = 3
    return finish()
  }

  // `--mutate-node-tmp` MUTATES THE MEASURED ARTIFACT: it plants this run's canary INSIDE the node's
  // own /tmp and then runs the SAME surface functions. It exists because a predicate nobody has ever
  // driven false is a caption. It asserts three things at once: surface c FINDS the planted canary
  // (its `occurrences === 0` check can therefore go RED), surface a stays 0 (docker diff cannot see
  // tmpfs — stated as measured blindness, not luck), and after removal surface c returns to 0. The
  // planted file is removed in a finally block, so a throw cannot leave it behind.
  if (process.argv.includes('--mutate-node-tmp')) {
    const planted = `/tmp/${canary}.txt`
    let cleaned = false
    try {
      const plant = run(DOCKER, ['exec', disc.name, 'sh', '-c', `printf '%s\\n' '${canary}' > '${planted}'`])
      log(`MUTATION: planted ${planted} in ${disc.name} exit=${plant.status}`)
      const a = surfaceDiff(disc.name)
      const b = surfaceLogs(disc.name)
      const c = surfaceFilesystem(disc.name)
      results.surfaces = [a, b, c]
      log(`MUTATION surface a occurrences=${a.occurrences} changedPaths=${a.changedPaths}`)
      log(`MUTATION surface b occurrences=${b.occurrences}`)
      log(`MUTATION surface c occurrences=${c.occurrences} probed=${c.probed} files=${json(c.matchedFiles)}`)
      record('MUTATION: surface c FINDS a canary planted in the node /tmp (so its 0 is falsifiable)',
        (c.occurrences ?? 0) > 0, c.occurrences, '> 0')
      record('MUTATION: surface c reports the planted path it matched',
        Array.isArray(c.matchedFiles) && c.matchedFiles.some((p) => p === planted),
        c.matchedFiles ?? null, [planted])
      record('MUTATION: surface a is BLIND to that tmpfs write (0 occurrences while the string is present)',
        a.occurrences === 0, a.occurrences, 0, 'docker diff has no visibility into tmpfs; surface c is the guard for /tmp')
      record('MUTATION: surface b does not see it either (nothing was written to stdout)',
        b.occurrences === 0, b.occurrences, 0)
    } finally {
      const rm = run(DOCKER, ['exec', disc.name, 'rm', '-f', planted])
      cleaned = rm.status === 0
      const after = surfaceFilesystem(disc.name)
      log(`MUTATION cleanup exit=${rm.status} surface c after removal occurrences=${after.occurrences}`)
      record('MUTATION: after removal surface c returns to 0 (the hit was the planted file)',
        after.occurrences === 0, after.occurrences, 0)
    }
    results.workDir = workDir
    results.plantedPath = planted
    const allPass = results.checks.every((x) => x.pass)
    results.exitCode = allPass ? 0 : 2
    log(allPass
      ? 'MUTATION-TEST: PASS — surface c can go RED on the live node, surface a is measurably blind to tmpfs.'
      : 'MUTATION-TEST: FAIL — a surface predicate did NOT respond to a canary that is actually present.')
    if (!cleaned) log(`MUTATION-TEST: WARNING the planted file could not be removed: ${planted}`)
    return finish()
  }

  // ---- 2. submit the canary as user data (several field names)
  // Several field names, and a record-shaped body, because `observedFields`/`droppedFields` are a
  // real census only for an object payload (anon-session, 2026-10-19). Every top-level value
  // carries the canary, so a retained field of ANY of these names would be a hit.
  const payload = {
    canary,
    ownerNote: `note ${canary} note`,
    message: canary,
    prompt: `the user typed: ${canary}`,
    text: canary,
    user: canary,
    email: `${canary.toLowerCase()}@example.invalid`,
    content: canary,
    nested: { deep: [canary, { deeper: canary }] },
    consent: `consent ${canary}`,
  }
  const payloadText = JSON.stringify(payload)
  const payloadBytes = Buffer.byteLength(payloadText)
  results.payload = { keys: Object.keys(payload), bytes: payloadBytes, canaryFieldNames: Object.keys(payload) }

  let first
  try {
    first = await postProbe(payloadText)
  } catch (e) {
    log(`PRECONDITION FAILED: probe POST ${NODE_URL}${PROBE_PATH} threw: ${e.message} — NOTHING was measured`)
    results.probe = { reachable: false, error: String(e.message || e) }
    results.exitCode = 3
    return finish()
  }
  results.probe.first = {
    status: first.status,
    headers: first.headers,
    setCookie: first.setCookie,
    body: first.body,
    rawFirst200: first.text.slice(0, 800),
  }
  log(`PROBE1 status=${first.status} setCookieCount=${first.setCookie.length}`)
  log(`PROBE1 headers ${json(first.headers)}`)
  log(`PROBE1 body ${json(first.body)}`)
  if (first.status !== 200 || !first.body) {
    log('PRECONDITION FAILED: the probe did not answer 200 with a JSON body — NOTHING was measured')
    results.exitCode = 3
    return finish()
  }

  // The SECOND probe sends the byte-identical payload: if the digest is the same, the payload (or a
  // nonce derived from it) is the retained key; if it differs, the digest is over a per-call nonce.
  const second = await postProbe(payloadText)
  results.probe.second = { status: second.status, headers: second.headers, setCookie: second.setCookie, body: second.body }
  log(`PROBE2 status=${second.status} setCookieCount=${second.setCookie.length}`)
  log(`PROBE2 body ${json(second.body)}`)

  // MEASURED SHAPE (2026-10-19, live node-a): the SessionProbe is nested under `probe` in an
  // envelope that also carries `ok` and `nodeId`
  //   {"ok":true,"nodeId":"node-a","probe":{"observedFields":10,...,"sessionDigest":"<64 hex>"}}
  // and the anonymity report under `anonymity`. Read the envelope by MEASUREMENT, not by guess, and
  // record which shape was seen so a later change cannot silently turn every assertion into a null.
  const probeObj = (b) => (b && b.probe && typeof b.probe === 'object' ? b.probe : b)
  const p1 = probeObj(first.body)
  const p2 = probeObj(second.body)
  results.probe.firstEnvelope = { ok: first.body.ok ?? null, nodeId: first.body.nodeId ?? null, nested: Boolean(first.body.probe) }
  results.probe.firstProbe = p1
  results.probe.secondProbe = p2
  const digestOf = (b) => (b && (b.sessionDigest ?? b.digest)) ?? null
  const digest1 = digestOf(p1)
  const digest2 = digestOf(p2)
  log(`DIGEST1 ${digest1}`)
  log(`DIGEST2 ${digest2}`)

  // an honest anonymity report, for the record (not evidence of absence by itself)
  const anon = await getJson(ANON_PATH)
  const anonReport = anon.body && anon.body.anonymity && typeof anon.body.anonymity === 'object'
    ? anon.body.anonymity
    : anon.body
  results.anonymityReport = { status: anon.status, envelopeNested: Boolean(anon.body && anon.body.anonymity), report: anonReport }

  // ---- 3. the four node surfaces
  const surfaces = [surfaceDiff(disc.name), surfaceLogs(disc.name), surfaceFilesystem(disc.name), surfaceImage(disc.name)]
  results.surfaces = surfaces
  for (const s of surfaces) {
    log(`SURFACE ${s.surface} probed=${s.probed === true ? 'true' : 'null'} occurrences=${s.occurrences === null ? 'null' : s.occurrences}${s.reason ? ` reason=${s.reason}` : ''}`)
  }

  // ---- 4. POSITIVE CONTROL — the same code, on a container that deliberately stores the canary
  const fx = startFixture()
  results.control.fixture = { name: fixtureName, started: fx, image: FIXTURE_IMAGE }
  const control = { surfaces: [] }
  if (fx.ok) {
    control.surfaces.push(surfaceDiff(fixtureName))
    control.surfaces.push(surfaceLogs(fixtureName))
    control.surfaces.push(surfaceFilesystem(fixtureName))
    const commit = commitFixture()
    control.commit = commit
    control.image = commit.ok ? scanFixtureImage() : { probed: null, occurrences: null, reason: commit.reason }
    if (!commit.ok) control.image = { probed: null, occurrences: null, reason: commit.reason }
  } else {
    control.surfaces = [
      { surface: 'a-writable-layer (docker diff)', probed: null, occurrences: null, reason: 'fixture did not start' },
      { surface: 'b-logs (docker logs 2>&1)', probed: null, occurrences: null, reason: 'fixture did not start' },
      { surface: 'c-filesystem (docker exec grep -r)', probed: null, occurrences: null, reason: 'fixture did not start' },
    ]
    control.image = { probed: null, occurrences: null, reason: 'fixture did not start' }
  }
  results.control.searches = control
  for (const s of control.surfaces) {
    log(`CONTROL ${s.surface} probed=${s.probed === true ? 'true' : 'null'} occurrences=${s.occurrences === null ? 'null' : s.occurrences}${s.reason ? ` reason=${s.reason}` : ''}`)
  }
  log(`CONTROL d-image-layers probed=${control.image.probed === true ? 'true' : 'null'} occurrences=${control.image.occurrences === null ? 'null' : control.image.occurrences}${control.image.reason ? ` reason=${control.image.reason}` : ''}`)

  // ---- 5. checks
  const payloadKeys = Object.keys(payload).length
  record('probe answers 200 with a JSON body', first.status === 200 && first.body !== null, first.status, 200)
  record('probe 2 answers 200 with a JSON body', second.status === 200 && second.body !== null, second.status, 200)
  record('sessionDigest is 64 hex chars', typeof digest1 === 'string' && /^[0-9a-f]{64}$/.test(digest1), digest1, '64 hex')
  record("digestAlgorithm === 'sha256'", p1.digestAlgorithm === 'sha256', p1.digestAlgorithm ?? null, 'sha256')
  record('retained === 0', p1.retained === 0, p1.retained ?? null, 0)
  record("store === 'none'", p1.store === 'none', p1.store ?? null, 'none')
  record('observedFields === the payload top-level key count', p1.observedFields === payloadKeys,
    { observedFields: p1.observedFields ?? null, payloadKeys }, payloadKeys)
  record('droppedFields === observedFields (nothing retained means every field counts as dropped)',
    p1.droppedFields === p1.observedFields,
    { droppedFields: p1.droppedFields ?? null, observedFields: p1.observedFields ?? null }, 'equal')
  record('droppedFields is the SAME on both probes (the census is a property of the payload)',
    p1.droppedFields === p2.droppedFields,
    { first: p1.droppedFields ?? null, second: p2.droppedFields ?? null }, 'equal')
  record('no set-cookie on probe 1', first.setCookie.length === 0, first.setCookie, [])
  record('no set-cookie on probe 2', second.setCookie.length === 0, second.setCookie, [])
  record('two identical probes yield DIFFERENT digests (payload is not the retained key)',
    typeof digest1 === 'string' && typeof digest2 === 'string' && digest1 !== digest2,
    { digest1, digest2, equal: digest1 === digest2 }, { different: true })
  record('the canary is NOT echoed in either probe response',
    !first.text.includes(canary) && !second.text.includes(canary),
    { probe1EchoesCanary: first.text.includes(canary), probe2EchoesCanary: second.text.includes(canary) }, { echoes: false })

  // The module's own counters are a FLOOR, not this harness's proof (anon-session, verbatim rule).
  // They are checked because a salt that is exported/logged/served would falsify the design; they
  // are NEVER counted as evidence of absence on the container, which only the sweep can reach.
  const ar = anonReport
  record('anonymityReport: salt is not exported/logged/served/written to disk',
    ar !== null && ar.saltExported === false && ar.saltLogged === false && ar.saltServed === false && ar.saltWrittenToDisk === false,
    ar === null ? null : { exported: ar.saltExported, logged: ar.saltLogged, served: ar.saltServed, onDisk: ar.saltWrittenToDisk },
    'all false')
  record('anonymityReport: names this file as the proof, and says its zeros are a floor',
    ar !== null && ar.proofFile === 'docker/verify/anonymity.mjs' && ar.zeroIsFloor === true && ar.proofIsCanarySweep === true,
    ar === null ? null : { proofFile: ar.proofFile, zeroIsFloor: ar.zeroIsFloor, proofIsCanarySweep: ar.proofIsCanarySweep },
    { proofFile: 'docker/verify/anonymity.mjs', zeroIsFloor: true, proofIsCanarySweep: true })

  const bySurface = (name) => surfaces.find((s) => s.surface.startsWith(name))
  const sa = bySurface('a-')
  const sb = bySurface('b-')
  const sc = bySurface('c-')
  const sd = bySurface('d-')
  record('surface a probed', sa.probed === true, sa.probed, true, sa.reason)
  record('surface b probed', sb.probed === true, sb.probed, true, sb.reason)
  record('surface c probed', sc.probed === true, sc.probed, true, sc.reason)
  record('surface d probed', sd.probed === true, sd.probed, true, sd.reason)
  record('surface d: every layer the image declares was decoded',
    sd.layersExpected !== undefined && sd.layersExpected !== null && sd.layerEntries === sd.layersExpected,
    { decoded: sd.layerEntries ?? null, declared: sd.layersExpected ?? null }, { decoded: 'declared' })
  record('read-only rootfs: the node writable layer reports 0 changed paths (docker diff)',
    sa.changedPaths === 0, sa.changedPaths ?? null, 0,
    'tmpfs /tmp is NOT in the writable layer, so surface a cannot see it — surface c is the one that searches /tmp')
  record('surface a: canary count 0', sa.occurrences === 0, sa.occurrences, 0)
  record('surface b: canary count 0', sb.occurrences === 0, sb.occurrences, 0)
  record('surface c: canary count 0', sc.occurrences === 0, sc.occurrences, 0)
  record('surface d: canary count 0', sd.occurrences === 0, sd.occurrences, 0)

  // structural guard: a count without a probe is instrument failure, not a clean surface
  const structural = [...surfaces, ...control.surfaces, control.image].every(
    (s) => (s.occurrences === null) === (s.probed !== true))
  record('structural: every null count is accompanied by a null probe (and vice versa)', structural,
    [...surfaces, ...control.surfaces, control.image].map((s) => ({ s: s.surface, p: s.probed, n: s.occurrences })), 'null <=> unprobed')

  const ctlA = control.surfaces.find((s) => s.surface.startsWith('a-'))
  const ctlB = control.surfaces.find((s) => s.surface.startsWith('b-'))
  const ctlC = control.surfaces.find((s) => s.surface.startsWith('c-'))
  const ctlD = control.image
  record('CONTROL a: canary FOUND in fixture writable layer', (ctlA.occurrences ?? 0) > 0, ctlA.occurrences, '> 0')
  record('CONTROL b: canary FOUND in fixture logs', (ctlB.occurrences ?? 0) > 0, ctlB.occurrences, '> 0')
  record('CONTROL c: canary FOUND on fixture filesystem', (ctlC.occurrences ?? 0) > 0, ctlC.occurrences, '> 0')
  record('CONTROL d: canary FOUND in fixture committed image layer', (ctlD.occurrences ?? 0) > 0, ctlD.occurrences, '> 0')

  // ---- exit code: distinct failure classes, none of which is a pass
  const checks = results.checks
  const failedNames = new Set(checks.filter((c) => !c.pass).map((c) => c.name))
  const controlFailed = ['CONTROL a: canary FOUND in fixture writable layer',
    'CONTROL b: canary FOUND in fixture logs',
    'CONTROL c: canary FOUND on fixture filesystem',
    'CONTROL d: canary FOUND in fixture committed image layer'].some((n) => failedNames.has(n))
  const foundOnNode = [sa, sb, sc, sd].some((s) => (s.occurrences ?? 0) > 0)
  const unprobed = [sa, sb, sc, sd].some((s) => s.probed !== true)
  const structuralFail = [...failedNames].some((n) => n.startsWith('structural'))
  const probeAssertionFailed = [...failedNames].some((n) => !n.startsWith('surface ') && !n.startsWith('CONTROL ') && !n.startsWith('structural ') && n !== 'probe answers 200 with a JSON body')

  if (controlFailed) {
    results.exitCode = 2
    log('VERDICT: INSTRUMENT FAILURE — the positive control did not find the canary it deliberately stored.')
    log('VERDICT: every 0 reported above is NOT evidence. Fix the instrument before believing any surface.')
  } else if (foundOnNode) {
    results.exitCode = 1
    log('VERDICT: FAIL — the canary was FOUND on a node surface. User data IS on the node.')
  } else if (unprobed || structuralFail) {
    results.exitCode = 4
    log('VERDICT: FAIL — at least one surface was NOT PROBED, or a count appeared without a probe. An unprobed surface is not a clean one.')
  } else if (probeAssertionFailed) {
    results.exitCode = 5
    log('VERDICT: FAIL — a probe assertion failed (digest, retained, store, cookie, census or the anonymity report floor).')
  } else {
    results.exitCode = 0
    log('VERDICT: PASS — canary absent on all four surfaces, every surface probed, positive control found the canary on all four.')
  }
  return finish()
}

function finish() {
  const passed = results.checks.filter((c) => c.pass).length
  const defined = results.checks.length
  const summary = {
    canary,
    nodeUrl: NODE_URL,
    container: results.container,
    docker: results.docker,
    payload: results.payload,
    digests: {
      first: results.probe.firstProbe?.sessionDigest ?? null,
      second: results.probe.secondProbe?.sessionDigest ?? null,
    },
    probe: {
      status: results.probe.first?.status ?? null,
      headers: results.probe.first?.headers ?? null,
      setCookie: results.probe.first?.setCookie ?? null,
      retained: results.probe.firstProbe?.retained ?? null,
      store: results.probe.firstProbe?.store ?? null,
      observedFields: results.probe.firstProbe?.observedFields ?? null,
      droppedFields: results.probe.firstProbe?.droppedFields ?? null,
      envelope: results.probe.firstEnvelope ?? null,
    },
    anonymityReport: results.anonymityReport,
    surfaces: results.surfaces,
    control: results.control,
    checks: results.checks,
    checksPassed: passed,
    checksDefined: defined,
    exitCode: results.exitCode,
    workDir,
    at: results.at,
    limits: 'What this proves: the canary is absent from four surfaces that were each shown able to find one (the positive control), over 9 search roots including the image\'s tmpfs paths /run and /dev/shm, with every layer the image declares decoded. What it does NOT prove: that the payload was never held in process memory (a RAM-held payload is not a disk write), that no in-memory registry exists, that a peer node received nothing, or anything about kernel/swap/crash dumps or docker-daemon metadata. LIMIT OF SURFACE a, MEASURED: docker diff cannot see tmpfs, so its 0 is not a statement about /tmp, /run or /dev/shm — proven by planting a canary in /tmp and watching surface a stay at 0 while surface c found it. Surface c carries the anonymous claim for every writable path.',
  }
  log('')
  log('TABLE')
  for (const s of results.surfaces) {
    log(`  ${s.surface} | occurrences=${s.occurrences === null ? 'null' : s.occurrences} | probed=${s.probed === true ? 'yes' : 'NO (null)'}`)
    if (s.blindTo) log(`    BLIND TO: ${s.blindTo}`)
    if (s.probed !== true && s.reason) log(`    NOT PROBED BECAUSE: ${s.reason}`)
  }
  log(`CHECKS ${passed}/${defined}`)
  log(`EXIT ${results.exitCode}`)
  log(`REPORT_JSON ${JSON.stringify(summary)}`)
  process.exitCode = results.exitCode ?? 3
}

main().catch((e) => {
  log(`HARNESS THREW: ${e && e.stack ? e.stack : e}`)
  log('EXIT 3')
  process.exitCode = 3
})
