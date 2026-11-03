/**
 * peerClient.ts — the transport half of the DETERMINISTIC TWO-VOTER COMMIT described in `consensus.ts`. This is NOT Raft: there is no leader election, no log replication, and no second voter beyond the one peer named by PEER_URL.
 *
 * This module decides NOTHING about the vote. It reports what happened on the wire in three kinds that are kept distinct, because this program's recorded trap is that an absence is not a zero:
 *   answered    — an HTTP 2xx arrived; `answer` is the parsed endorsement, or `null` when the body carried no endorsement.
 *   refused     — a response ARRIVED with a non-2xx status. The peer answered; the answer was not a vote.
 *   unreachable — no response arrived at all: timeout, connection refused, DNS failure, socket error.
 * `refused` is not collapsed into `unreachable` here even though `consensus.ts` maps both to `quorum-lost`, because the reason string must still say WHICH of the two happened.
 *
 * `requestEndorsement` NEVER throws and NEVER rejects: every failure path returns a value, so a caller cannot mistake a transport exception for a peer that disagreed.
 * Latency is measured with `performance.now()` and is INSTRUMENTATION ONLY — no verdict in this build reads it, so two containers started in either order reach the same verdict for the same input.
 */
export type EndorsementAnswer = {
  accepted: boolean
  reason: string
  term: number
  nodeId: string | null
  key: string | null
  value: string | null
}

export type PeerReply =
  | { kind: 'answered'; url: string; status: number; latencyMs: number; rawBytes: number; answer: EndorsementAnswer | null }
  | { kind: 'refused'; url: string; status: number; latencyMs: number; rawBytes: number; reason: string }
  | { kind: 'unreachable'; url: string; status: null; latencyMs: number; rawBytes: number; reason: string }

export type PeerRequest = {
  peerUrl: string
  key: string
  value: string
  term: number
  nodeId: string
  index: number
  timeoutMs: number
  fetchImpl?: typeof fetch
}

type FetchResponse = Awaited<ReturnType<typeof fetch>>

/** The peer route a proposal is sent to. One trailing slash on PEER_URL is tolerated, because a doubled segment is this program's recorded way of advertising a path that 404s. */
export function endorsementUrl(peerUrl: string): string {
  return `${peerUrl.replace(/\/+$/, '')}/node/consensus/endorse`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function parseAnswer(raw: string): EndorsementAnswer | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const top = asRecord(parsed)
  if (top === null) {
    return null
  }
  /**
   * TWO ENVELOPES, ONE ENDORSEMENT, and the client reads both rather than picking one: `server.ts` serves the endorsement as `{ ok, nodeId, result: { accepted, reason, term } }` because the contract requires every response to carry `nodeId`, while a bare endorsement is also accepted because this client must not be the reason two nodes disagree about a SHAPE.
   * This is recorded rather than silent: a client that read only the top level would see `accepted: undefined` on the real wire, call it "answered without an endorsement", and report `rejected-peer-disagrees` for a peer that had in fact agreed — a false disagreement produced by the reader, which is the most expensive kind here.
   */
  let record = top
  if (typeof top.accepted !== 'boolean') {
    const nested = asRecord(top.result)
    if (nested === null) {
      return null
    }
    record = nested
  }
  if (typeof record.accepted !== 'boolean') {
    return null
  }
  if (typeof record.term !== 'number' || !Number.isInteger(record.term)) {
    return null
  }
  return {
    accepted: record.accepted,
    reason: typeof record.reason === 'string' ? record.reason : '(the peer sent no reason string)',
    term: record.term,
    nodeId: typeof record.nodeId === 'string' ? record.nodeId : typeof top.nodeId === 'string' ? top.nodeId : null,
    key: typeof record.key === 'string' ? record.key : null,
    value: typeof record.value === 'string' ? record.value : null,
  }
}

/** The transport code, found on the error OR on its `cause` chain: undici's fetch reports a refused connection as `TypeError: fetch failed` with the real code one level down, and reading only the top level would publish "fetch failed" where the honest answer is ECONNREFUSED. */
function transportCode(error: unknown): string | null {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    const candidate = (current as { code?: unknown }).code
    if (typeof candidate === 'string') {
      return candidate
    }
    current = (current as { cause?: unknown }).cause
  }
  return null
}

function describeTransportFailure(error: unknown, timeoutMs: number, aborted: boolean): string {
  if (aborted) {
    return `timeout: no answer within ${timeoutMs}ms; the AbortController fired and the request was aborted`
  }
  const code = transportCode(error)
  const message = error instanceof Error ? error.message : String(error)
  const causeMessage = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : ''
  if (code === 'ECONNREFUSED') {
    return `connection refused by the peer (ECONNREFUSED): ${message}${causeMessage}`
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `the peer host did not resolve (${code}): ${message}${causeMessage}`
  }
  if (code !== null) {
    return `transport failed (${code}): ${message}${causeMessage}`
  }
  return `transport failed: ${message}${causeMessage}`
}

async function readBody(response: FetchResponse): Promise<{ raw: string; rawBytes: number; failure: string | null }> {
  try {
    const raw = await response.text()
    return { raw, rawBytes: new TextEncoder().encode(raw).length, failure: null }
  } catch (error) {
    return { raw: '', rawBytes: 0, failure: error instanceof Error ? error.message : String(error) }
  }
}

/** Ask the peer for its one vote. Returns a discriminated reply with latency; never throws, never rejects. */
export async function requestEndorsement(request: PeerRequest): Promise<PeerReply> {
  const url = endorsementUrl(request.peerUrl)
  const controller = new AbortController()
  const startedAt = performance.now()
  const timer = setTimeout(() => {
    controller.abort()
  }, request.timeoutMs)
  let response: FetchResponse | null = null
  let failure: string | null = null
  try {
    const doFetch = request.fetchImpl ?? fetch
    response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        nodeId: request.nodeId,
        key: request.key,
        value: request.value,
        term: request.term,
        index: request.index,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    failure = describeTransportFailure(error, request.timeoutMs, controller.signal.aborted)
  } finally {
    clearTimeout(timer)
  }
  const latencyMs = Math.round(performance.now() - startedAt)
  if (response === null) {
    return { kind: 'unreachable', url, status: null, latencyMs, rawBytes: 0, reason: failure ?? 'transport failed for an unreported reason' }
  }
  const body = await readBody(response)
  if (!response.ok) {
    return {
      kind: 'refused',
      url,
      status: response.status,
      latencyMs,
      rawBytes: body.rawBytes,
      reason: `peer answered HTTP ${response.status}; a non-2xx answer is not a vote (${body.rawBytes} body bytes, not read as an endorsement)`,
    }
  }
  if (body.failure !== null) {
    return {
      kind: 'refused',
      url,
      status: response.status,
      latencyMs,
      rawBytes: 0,
      reason: `peer answered HTTP ${response.status} but the body could not be read (${body.failure}); an unreadable 2xx cannot establish a vote`,
    }
  }
  return { kind: 'answered', url, status: response.status, latencyMs, rawBytes: body.rawBytes, answer: parseAnswer(body.raw) }
}
