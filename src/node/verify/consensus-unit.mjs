/**
 * consensus-unit.mjs — the unit check for `src/node/consensus.ts` and `src/node/peerClient.ts`.
 *
 * THIS CHECK WAS ONCE GREEN OVER A PROTOCOL NO PEER PRODUCES, and that is why its first case speaks the REAL wire: `server.ts` serves an endorsement as `{ ok, nodeId, result: { accepted, reason, term, key, value } }`, so the checking path here is a real `http` server started inside this test, driven over a real socket by the real `fetch`, with a second `Consensus` instance as the peer. A hand-written object returning `{accepted:true}` flat is not a peer, it is a wish.
 * A fake fetch is used ONLY where a socket cannot produce the condition cheaply (`PEER_URL` unset, the closed-vocabulary refusals that must not dial at all), and each such case says so.
 *
 * Run: `node src/node/verify/consensus-unit.mjs`
 */
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Consensus, META_KEY_VOCABULARY } from '../consensus.ts'
import { requestEndorsement } from '../peerClient.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const NODE_DIR = join(HERE, '..')

const K_INTENT = 'intent-snapshot'
const K_META = 'meta-packages'
const K_ROSTER = 'member-roster'
const V_SHA = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const V_NODE_A = 'node-a'
const V_NODE_B = 'node-b'
const V_M001 = 'm-001'
const V_M999 = 'm-999'

const results = []
const observed = new Set()
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` — ${detail}`}`)
  return Boolean(condition)
}

function committedBytes(state) {
  return JSON.stringify(state.committed)
}

function baseConfig(overrides) {
  return { nodeId: 'node-a', port: 8090, peerUrl: 'http://node-b:8090', snapshotDir: '/app/snapshots', commitTimeoutMs: 1500, ...overrides }
}

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** A real HTTP peer on an ephemeral loopback port. Its handler owns whatever behaviour the case needs. */
async function startPeer(handler) {
  const sockets = new Set()
  const server = createServer((req, res) => {
    handler(req, res).catch((error) => {
      sendJson(res, 500, { ok: false, nodeId: 'node-b', error: String(error) })
    })
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise((resolve) => server.close(resolve))
    },
  }
}

/** The exact envelope `server.ts` emits: `ok`, `nodeId`, and the endorsement nested under `result`. */
function envelope(nodeId, endorsement) {
  return { ok: true, nodeId, result: endorsement }
}

/** The node the peer half is played by: a real `Consensus` whose `endorse()` produces the endorsement. */
function peerNode(nodeId) {
  return new Consensus(baseConfig({ nodeId, peerUrl: 'http://node-a:8090' }), async () => {
    throw new Error('the peer node never dials anything in this check')
  })
}

console.log('=== consensus-unit: real wire first, fake only where a socket cannot help ===\n')

// ---- case 1: REAL HTTP, real peer node -> committed on BOTH nodes -------------
{
  const peer = peerNode('node-b')
  const dials = []
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dials.push(body)
    sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  const raw = await (await fetch(`${server.url}/node/consensus/endorse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: K_INTENT, value: V_SHA, term: 1 }) })).text()
  const result = await consensus.propose(K_INTENT, V_SHA)
  const after = consensus.state()
  const peerState = peer.state()
  console.log(`CASE 1  REAL http peer at ${server.url}: {ok,nodeId,result:{accepted:true,term:1,key,value}}`)
  console.log(`        observed outcome: ${result.outcome}   proposer ${committedBytes(after)}   peer ${committedBytes(peerState)}`)
  observed.add(result.outcome)
  check('1a-POSITIVE-CONTROL the wire body really nests the endorsement under "result"', raw.includes('"result"') && raw.includes('"accepted"'), `${raw.slice(0, 90)}...`)
  check('1a a real peer over a real socket commits', result.outcome === 'committed', result.outcome)
  check('1b votes are 2 of 2', result.votes === 2 && result.of === 2, `${result.votes}/${result.of}`)
  check('1c the PROPOSER holds the committed pair', committedBytes(after) === `{"${K_INTENT}":"${V_SHA}"}`, committedBytes(after))
  check('1d AMENDMENT 1b: the PEER holds the SAME committed pair at the same term', committedBytes(peerState) === committedBytes(after) && peerState.logLength === 1 && peerState.term === 1, `peer ${committedBytes(peerState)}, logLength ${peerState.logLength}, term ${peerState.term}`)
  check('1e the peer was dialled at the endorsement path', dials.length === 2 && dials[1].key === K_INTENT, `${dials.length} request(s)`)
  await server.close()
}

// ---- case 2: REAL HTTP, a peer that answers and REFUSES ------------------------
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    // Constructed, not spread from endorse(): a refusal must have no side effect on the peer's map, which a spread would hide.
    sendJson(res, 200, envelope('node-b', { accepted: false, reason: 'this node will not endorse this pair', term: body.term, key: body.key, value: body.value }))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const peerBefore = committedBytes(peer.state())
  const result = await consensus.propose(K_META, V_NODE_B)
  const after = consensus.state()
  console.log(`\nCASE 2  REAL http peer: dial 1 endorses, dial 2 answers {"accepted":false}`)
  console.log(`        observed outcome: ${result.outcome}   proposer ${before} -> ${committedBytes(after)}   peer ${peerBefore} -> ${committedBytes(peer.state())}`)
  observed.add(result.outcome)
  check('2a outcome is rejected-peer-disagrees', result.outcome === 'rejected-peer-disagrees', result.outcome)
  check('2b votes are 1 of 2', result.votes === 1 && result.of === 2, `${result.votes}/${result.of}`)
  check('2c-pre the map under test is NON-EMPTY, so 2c compares two values and not two absences', before === `{"${K_INTENT}":"${V_SHA}"}`, before)
  check('2c the PROPOSER map is BYTE-IDENTICAL after the refusal', committedBytes(after) === before, `${before} vs ${committedBytes(after)}`)
  check('2d the PEER map is BYTE-IDENTICAL too: a refusal writes nothing on either node', committedBytes(peer.state()) === peerBefore, `${peerBefore} vs ${committedBytes(peer.state())}`)
  check('2e term advanced only on the disagreement', after.term === 2 && result.term === 1, `state term ${after.term}, vote term ${result.term}`)
  await server.close()
}

// ---- case 3: REAL HTTP, a peer that DOES NOT ANSWER within the timeout --------
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    // dial 2 answers nothing at all: the socket stays open and the client's AbortController must fire.
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url, commitTimeoutMs: 250 }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const started = Date.now()
  const result = await consensus.propose(K_META, V_NODE_B)
  const elapsed = Date.now() - started
  const after = consensus.state()
  console.log(`\nCASE 3  REAL http peer: dial 1 endorses, dial 2 never responds (timeout 250ms, observed ${elapsed}ms)`)
  console.log(`        observed outcome: ${result.outcome}   before ${before}   after ${committedBytes(after)}`)
  observed.add(result.outcome)
  check('3a outcome is quorum-lost when the peer does not answer', result.outcome === 'quorum-lost', result.outcome)
  check('3b the timeout fired inside the configured bound', elapsed >= 200 && elapsed < 2000, `${elapsed}ms`)
  check('3c peerReason says timeout', typeof result.peerReason === 'string' && result.peerReason.includes('timeout'), result.peerReason)
  check('3d committed map is BYTE-IDENTICAL and NON-EMPTY before the failure', committedBytes(after) === before && before === `{"${K_INTENT}":"${V_SHA}"}`, `${before} vs ${committedBytes(after)}`)
  check('3e quorum-lost is a DIFFERENT string from rejected-peer-disagrees', result.outcome !== 'rejected-peer-disagrees', result.outcome)
  await server.close()
}

// ---- case 4: REAL HTTP, a peer that answers non-2xx ---------------------------
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    sendJson(res, 503, { ok: false, nodeId: 'node-b', error: 'down for maintenance' })
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const result = await consensus.propose(K_META, V_NODE_B)
  const after = consensus.state()
  console.log(`\nCASE 4  REAL http peer: dial 1 endorses, dial 2 answers 503`)
  console.log(`        observed outcome: ${result.outcome}   before ${before}   after ${committedBytes(after)}`)
  check('4a a non-2xx answer is quorum-lost, not a commit', result.outcome === 'quorum-lost', result.outcome)
  check('4b peerReason states the status', typeof result.peerReason === 'string' && result.peerReason.includes('HTTP 503'), result.peerReason)
  check('4c committed map untouched and NON-EMPTY', committedBytes(after) === before && before === `{"${K_INTENT}":"${V_SHA}"}`, `${before} vs ${committedBytes(after)}`)
  await server.close()
}

// ---- case 5: REAL HTTP, a peer that endorses a DIFFERENT value ----------------
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    sendJson(res, 200, envelope('node-b', { accepted: true, reason: 'trust me', term: body.term, key: body.key, value: V_M999 }))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const result = await consensus.propose(K_META, V_NODE_A)
  const after = consensus.state()
  console.log(`\nCASE 5  REAL http peer: dial 2 answers accepted:true but with value "${V_M999}" for a proposal of "${V_NODE_A}"`)
  console.log(`        observed outcome: ${result.outcome}   before ${before}   after ${committedBytes(after)}`)
  check('5a a mismatched endorsement is rejected, never committed', result.outcome === 'rejected-peer-disagrees', result.outcome)
  check('5b committed map is BYTE-IDENTICAL and NON-EMPTY', committedBytes(after) === before && before === `{"${K_INTENT}":"${V_SHA}"}`, `${before} vs ${committedBytes(after)}`)
  check('5c peerReason names the mismatched value', typeof result.peerReason === 'string' && result.peerReason.includes(V_M999), result.peerReason)
  await server.close()
}

// ---- case 6: REAL HTTP, the LEAD'S PROBE: accepted:true naming NO key or value -
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    // The exact body the Lead measured a `committed` from: an endorsement that names nothing.
    sendJson(res, 200, envelope('node-b', { accepted: true, reason: 'trust me', term: body.term }))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const result = await consensus.propose(K_META, V_NODE_A)
  const after = consensus.state()
  console.log(`\nCASE 6  REAL http peer: dial 2 answers {"accepted":true,"reason":"trust me","term":<echoed>} and names NO key and NO value`)
  console.log(`        observed outcome: ${result.outcome}   before ${before}   after ${committedBytes(after)}`)
  check('6a an endorsement that names NO key FAILS CLOSED', result.outcome === 'rejected-peer-disagrees', result.outcome)
  check('6b committed map is BYTE-IDENTICAL and NON-EMPTY', committedBytes(after) === before && before === `{"${K_INTENT}":"${V_SHA}"}`, `${before} vs ${committedBytes(after)}`)
  check('6c peerReason says the key was missing rather than merely wrong', typeof result.peerReason === 'string' && result.peerReason.includes('NO key'), result.peerReason)
  await server.close()
}

// ---- case 7: REAL HTTP, accepted:true with a key but NO value -----------------
{
  const peer = peerNode('node-b')
  let dial = 0
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dial += 1
    if (dial === 1) {
      sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
      return
    }
    sendJson(res, 200, envelope('node-b', { accepted: true, reason: 'trust me again', term: body.term, key: body.key }))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  await consensus.propose(K_INTENT, V_SHA)
  const before = committedBytes(consensus.state())
  const result = await consensus.propose(K_META, V_NODE_A)
  const after = consensus.state()
  console.log(`\nCASE 7  REAL http peer: dial 2 answers accepted:true with the right key and NO value`)
  console.log(`        observed outcome: ${result.outcome}   before ${before}   after ${committedBytes(after)}`)
  check('7a an endorsement that names NO value FAILS CLOSED', result.outcome === 'rejected-peer-disagrees', result.outcome)
  check('7b committed map is BYTE-IDENTICAL and NON-EMPTY', committedBytes(after) === before && before === `{"${K_INTENT}":"${V_SHA}"}`, `${before} vs ${committedBytes(after)}`)
  check('7c peerReason says the value was missing', typeof result.peerReason === 'string' && result.peerReason.includes('NO value'), result.peerReason)
  await server.close()
}

// ---- case 8: PEER_URL unset -> refused-lone-node, and nothing is dialled ------
{
  const dials = []
  const fake = async (url) => {
    dials.push(url)
    throw new Error('the lone node dialled a peer that is not configured')
  }
  const consensus = new Consensus(baseConfig({ peerUrl: null }), fake)
  const result = await consensus.propose(K_INTENT, V_SHA)
  const after = consensus.state()
  console.log(`\nCASE 8  FAKE (no socket): PEER_URL is null; the fake would record any dial`)
  console.log(`        observed outcome: ${result.outcome}   after ${committedBytes(after)}`)
  observed.add(result.outcome)
  check('8a outcome is refused-lone-node', result.outcome === 'refused-lone-node', result.outcome)
  check('8b peer is null and votes are 1 of 2', result.peer === null && result.votes === 1 && result.of === 2, `peer ${String(result.peer)}, ${result.votes}/${result.of}`)
  check('8c a lone node NEVER dials the peer', dials.length === 0, `${dials.length} dial(s)`)
  check('8d the map is empty BY RULE while the proposal was counted (not "nothing happened")', committedBytes(after) === '{}' && after.logLength === 0 && after.proposals === 1, `committed ${committedBytes(after)}, logLength ${after.logLength}, proposals ${after.proposals}`)
}

// ---- case 9: AMENDMENT 1a — the closed key space, refused BEFORE any dial -----
{
  const dials = []
  const fake = async (url) => {
    dials.push(url)
    throw new Error('a refused proposal must never be dialled to the peer')
  }
  const consensus = new Consensus(baseConfig({}), fake)
  const before = committedBytes(consensus.state())
  const badKey = await consensus.propose('user-email', 'victim@example.com')
  const badKeyAgain = await consensus.propose('user-email', V_M001)
  const badValue = await consensus.propose(K_META, 'Victim@Example.com')
  const longValue = await consensus.propose(K_META, `${V_M001}${'-'.repeat(300)}`)
  const after = consensus.state()
  console.log(`\nCASE 9  FAKE (no socket): the closed meta vocabulary ${JSON.stringify(META_KEY_VOCABULARY)}`)
  console.log(`        user-email -> ${badKey.outcome} votes ${badKey.votes}/${badKey.of}`)
  console.log(`        value "Victim@Example.com" -> ${badValue.outcome}; 330-byte value -> ${longValue.outcome}`)
  observed.add(badKey.outcome)
  check('9a an out-of-vocabulary key is refused-non-meta-key', badKey.outcome === 'refused-non-meta-key', badKey.outcome)
  check('9b the refusal has votes 0 of 2 and peer null', badKey.votes === 0 && badKey.of === 2 && badKey.peer === null, `votes ${badKey.votes}/${badKey.of}, peer ${String(badKey.peer)}`)
  check('9c the refused key is ECHOED so the refusal is auditable', badKey.key === 'user-email', badKey.key)
  check('9d the refusal names the closed vocabulary', typeof badKey.peerReason === 'string' && badKey.peerReason.includes('closed meta vocabulary'), badKey.peerReason)
  check('9e a refused proposal NEVER reaches the peer', dials.length === 0, `${dials.length} dial(s)`)
  check('9f the committed map is untouched by the refusals', committedBytes(after) === before, `${before} vs ${committedBytes(after)}`)
  check('9g an invalid value shape is refused too', badValue.outcome === 'refused-non-meta-key' && badValue.votes === 0, `${badValue.outcome}, votes ${badValue.votes}`)
  check('9h a value above 256 bytes is refused', longValue.outcome === 'refused-non-meta-key' && typeof longValue.peerReason === 'string' && longValue.peerReason.includes('256-byte bound'), longValue.peerReason)
  check('9i the same bad key is refused every time, not only the first', badKeyAgain.outcome === 'refused-non-meta-key', badKeyAgain.outcome)
}

// ---- case 10: requestEndorsement itself, against a real server and a dead port -
{
  const peer = peerNode('node-b')
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
  })
  const answered = await requestEndorsement({ peerUrl: server.url, key: K_INTENT, value: V_SHA, term: 1, nodeId: 'node-a', index: 1, timeoutMs: 1500 })
  const url = `${server.url}/node/consensus/endorse`
  console.log(`\nCASE 10 REAL http: requestEndorsement against ${url}`)
  console.log(`        kind ${answered.kind}, status ${String(answered.status)}, latency ${answered.latencyMs}ms`)
  check('10a a live peer yields kind "answered"', answered.kind === 'answered', answered.kind)
  check('10b the nested endorsement is parsed out of the envelope and echoes key/value', answered.kind === 'answered' && answered.answer !== null && answered.answer.accepted === true && answered.answer.key === K_INTENT && answered.answer.value === V_SHA, answered.kind === 'answered' ? JSON.stringify(answered.answer) : answered.kind)
  check('10c latency is a real measurement above zero', answered.latencyMs > 0, `${answered.latencyMs}ms`)
  const deadPort = server.port
  await server.close()
  const unreachable = await requestEndorsement({ peerUrl: `http://127.0.0.1:${deadPort}`, key: K_INTENT, value: V_SHA, term: 1, nodeId: 'node-a', index: 1, timeoutMs: 1500 })
  console.log(`        after closing the server: kind ${unreachable.kind}; ${unreachable.kind === 'unreachable' ? unreachable.reason : ''}`)
  check('10d a closed port yields kind "unreachable" and never throws', unreachable.kind === 'unreachable', unreachable.kind)
  check('10e the reason names the connection refusal', unreachable.kind === 'unreachable' && unreachable.reason.includes('connection refused'), unreachable.kind === 'unreachable' ? unreachable.reason : unreachable.kind)
}

// ---- case 11: endorse() echoes, writes on accept, refuses on contradiction ----
{
  const consensus = new Consensus(baseConfig({ peerUrl: null }), async () => {
    throw new Error('no network in this case')
  })
  const before = committedBytes(consensus.state())
  const ok = consensus.endorse(K_INTENT, V_SHA, 1)
  const firstMap = committedBytes(consensus.state())
  const again = consensus.endorse(K_INTENT, V_SHA, 1)
  const contradiction = consensus.endorse(K_INTENT, V_M999, 1)
  const wrongTerm = consensus.endorse(K_META, V_NODE_A, 9)
  const nonMeta = consensus.endorse('user-email', V_NODE_A, 1)
  const after = consensus.state()
  console.log(`\nCASE 11 endorse(): accept, idempotent re-endorse, contradicting value, bad term, out-of-vocabulary key`)
  console.log(`        accepted: ${ok.accepted} / ${again.accepted} / ${contradiction.accepted} / ${wrongTerm.accepted} / ${nonMeta.accepted}; map ${before} -> ${firstMap} -> ${committedBytes(after)}`)
  check('11a a matching term is accepted', ok.accepted === true, ok.reason)
  check('11b AMENDMENT 1b: an accepted endorsement WRITES the pair on this node', firstMap === `{"${K_INTENT}":"${V_SHA}"}`, firstMap)
  check('11c the endorsement ECHOES the key and the value it accepted', ok.key === K_INTENT && ok.value === V_SHA, `${JSON.stringify(ok.key)}/${JSON.stringify(ok.value)}`)
  check('11d re-endorsing the same pair is idempotent and adds no log entry', again.accepted === true && after.logLength === 1, `logLength ${after.logLength}`)
  check('11e a CONTRADICTING value for a committed key is REFUSED (no split brain)', contradiction.accepted === false && contradiction.reason.includes('already committed'), contradiction.reason)
  check('11f the refused contradiction wrote nothing', committedBytes(after) === `{"${K_INTENT}":"${V_SHA}"}`, committedBytes(after))
  check('11g a mismatched term is refused and the refusal echoes', wrongTerm.accepted === false && wrongTerm.reason.includes('term mismatch') && wrongTerm.key === K_META, wrongTerm.reason)
  check('11h an out-of-vocabulary key is refused at the PEER too, not only at the proposer', nonMeta.accepted === false && nonMeta.reason.includes('closed meta vocabulary'), nonMeta.reason)
}

// ---- case 11b: the PROPOSER must refuse to overwrite its OWN committed value --
{
  const peer = peerNode('node-b')
  const dials = []
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    dials.push(body)
    sendJson(res, 200, envelope('node-b', peer.endorse(body.key, body.value, body.term)))
  })
  const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
  // The local node decides the key in its ACCEPTING role, so its map holds a value the peer has never seen — exactly the state a peer restart produces.
  consensus.endorse(K_META, V_M001, 1)
  const before = committedBytes(consensus.state())
  const result = await consensus.propose(K_META, V_M999)
  const after = consensus.state()
  console.log(`\nCASE 11b LOCAL contradiction: this node already holds ${K_META}=${V_M001} from an endorsement and the peer holds NOTHING for that key. Propose a different value.`)
  console.log(`        observed outcome: ${result.outcome}   proposer ${before} -> ${committedBytes(after)}   peer dials: ${dials.length}`)
  check('11b-i the proposal is REFUSED rather than overwriting the local decision', result.outcome === 'rejected-peer-disagrees', result.outcome)
  check('11b-ii the map still holds the ORIGINAL value (no re-commit path)', committedBytes(after) === before && after.committed[K_META] === V_M001, committedBytes(after))
  check('11b-iii the refusal happened BEFORE any dial, so the peer never saw it', dials.length === 0, `${dials.length} dial(s)`)
  check('11b-iv the reason says it was local and names the value and term it defends', typeof result.peerReason === 'string' && result.peerReason.includes('refused LOCALLY') && result.peerReason.includes(V_M001) && result.peerReason.includes('term 1'), result.peerReason)
  check('11b-v votes are 1 of 2 and the local vote is the one cast against it', result.votes === 1 && result.of === 2, `${result.votes}/${result.of}`)
  const again = await consensus.propose(K_META, V_M001)
  const afterAgain = consensus.state()
  console.log(`        re-proposing the SAME value -> ${again.outcome}; logLength ${after.logLength} -> ${afterAgain.logLength}`)
  check('11b-vi the same value re-proposes and commits', again.outcome === 'committed', again.outcome)
  check('11b-vii a re-affirmation does not append a second log entry', afterAgain.logLength === after.logLength, `${after.logLength} -> ${afterAgain.logLength}`)
  check('11b-viii the re-affirmation did dial, so it is agreement and not a local shortcut', dials.length === 1, `${dials.length} dial(s)`)
  await server.close()
}

// ---- case 12: determinism — the same answer twice gives the same verdict ------
{
  const fakePeer = peerNode('node-b')
  const server = await startPeer(async (req, res) => {
    const body = await readJson(req)
    sendJson(res, 200, envelope('node-b', fakePeer.endorse(body.key, body.value, body.term)))
  })
  const runOnce = async () => {
    const consensus = new Consensus(baseConfig({ peerUrl: server.url }))
    const first = await consensus.propose(K_INTENT, V_SHA)
    const second = await consensus.propose(K_META, V_NODE_B)
    return { verdicts: JSON.stringify({ first, second }), state: consensus.state() }
  }
  const withoutLatency = (state) => JSON.stringify({ ...state, peer: { ...state.peer, lastLatencyMs: state.peer.lastLatencyMs === null ? null : 'measured' } })
  const a = await runOnce()
  const b = await runOnce()
  const rawA = JSON.stringify(a.state)
  const rawB = JSON.stringify(b.state)
  console.log(`\nCASE 12 two fresh Consensus instances against the same real peer, identical input`)
  console.log(`        verdicts byte-identical: ${a.verdicts === b.verdicts}; states identical once the MEASURED latency is normalised: ${withoutLatency(a.state) === withoutLatency(b.state)}; raw states differed: ${rawA !== rawB}`)
  check('12a two instances reach the same verdict', a.verdicts === b.verdicts, a.verdicts === b.verdicts ? 'identical' : 'DIVERGED')
  check('12b the states agree once the measured latency is normalised — latency is instrumentation and never a verdict input', withoutLatency(a.state) === withoutLatency(b.state), withoutLatency(a.state) === withoutLatency(b.state) ? 'identical modulo latency' : 'DIVERGED beyond latency')
  check('12c both runs really did measure a latency, so 12b is not comparing two absences', typeof a.state.peer.lastLatencyMs === 'number' && a.state.peer.lastLatencyMs > 0 && typeof b.state.peer.lastLatencyMs === 'number' && b.state.peer.lastLatencyMs > 0, `${String(a.state.peer.lastLatencyMs)}ms / ${String(b.state.peer.lastLatencyMs)}ms`)
  await server.close()
}

// ---- case 13: no clock and no randomness in the vote module -------------------
{
  const voteSource = readFileSync(join(NODE_DIR, 'consensus.ts'), 'utf8')
  // The scan runs over CODE only: the header of consensus.ts NAMES `performance.now()` while stating that only peerClient.ts uses it, so scanning raw text would flag the sentence that documents the rule.
  const codeOnly = voteSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n')
  console.log(`\nCASE 13 source scan of consensus.ts: ${voteSource.length} chars raw, ${codeOnly.length} after comment stripping`)
  check('13a consensus.ts CODE contains no Math.random', !codeOnly.includes('Math.random'), codeOnly.includes('Math.random') ? 'FOUND' : 'absent')
  check('13b consensus.ts CODE contains no Date.now / new Date', !codeOnly.includes('Date.now') && !codeOnly.includes('new Date'), codeOnly.includes('Date.now') || codeOnly.includes('new Date') ? 'FOUND' : 'absent')
  check('13c consensus.ts CODE contains no performance.now', !codeOnly.includes('performance.now'), codeOnly.includes('performance.now') ? 'FOUND' : 'absent')
  check('13d the comment stripper can still SEE a real occurrence (positive control)', voteSource.includes('performance.now'), voteSource.includes('performance.now') ? 'raw text does contain it, so the filter filters rather than blindfolds' : 'raw text does NOT contain it, so 13c proves nothing')
}

const FIVE = ['committed', 'rejected-peer-disagrees', 'quorum-lost', 'refused-lone-node', 'refused-non-meta-key']
console.log(`\nCENSUS  required outcomes observed: ${FIVE.filter((o) => observed.has(o)).length}/${FIVE.length} — ${[...observed].join(', ')}`)
check('C1 all five required outcomes are reachable', FIVE.every((o) => observed.has(o)), `${FIVE.filter((o) => observed.has(o)).length} of ${FIVE.length}: ${[...observed].join(', ')}`)
check('C2 the five outcomes are five DISTINCT strings', new Set(FIVE).size === 5, `${new Set(FIVE).size} distinct of ${FIVE.length}`)

const passed = results.filter((r) => r.pass).length
const total = results.length
console.log(`\nCHECKS ${passed}/${total} passed`)
if (passed !== total) {
  console.log('VERDICT: RED — at least one expectation was not met')
  process.exit(1)
}
console.log('VERDICT: GREEN — every expectation above was met')
