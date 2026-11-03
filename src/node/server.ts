/**
 * ============================================================================
 * THE NODE SERVER — one dispatcher, one path table, and one 404 body
 * ============================================================================
 *
 * Written against `docker/NODE-CONTRACT.md` §`server.ts` / `index.ts`. The dispatch
 * order is the contract's: node paths first, then anything under the host's own
 * `PREFIX` is delegated to `buildHandler().handler` from `../host/routes.ts`, then
 * a 404 that prints the full path table.
 *
 * **THE DISPATCHER AND THE ADVERTISED PATH LIST ARE CHECKED AGAINST EACH OTHER AT
 * CONSTRUCTION TIME.** That is the repair for the market build's doubled-segment
 * defect (`D-0071`): a hand-written list beside a hand-written dispatcher drifts,
 * the drifting entry is unreachable, and the 404 body — the one place whose job is
 * to be authoritative — advertises the dead path. Here `paths.ts` owns the list and
 * this file owns the branches; `assertDispatchMatchesPathTable()` refuses to build a
 * server when the two disagree in EITHER direction, so a path added to the table
 * with no branch is a startup failure rather than a 404 a reader has to notice.
 *
 * **EVERY RESPONSE CARRIES `nodeId`.** Node routes carry it in the body. The
 * delegated host handler owns its own response body and is not rewritten — instead
 * the header `x-node-id` is set BEFORE dispatch, so even a body this file did not
 * compose identifies the node that answered it. That is an interpretation of the
 * contract's sentence and it is recorded as one rather than left implicit.
 *
 * Node 24 strips types rather than compiling them: no `enum`, no `namespace`, no
 * parameter properties, no decorators, and every type-only import is `import type`.
 *
 * @module dsh-meta-community/node/server
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildHandler, PREFIX as COMMUNITY_PREFIX } from '../host/routes.ts'
import { NODE_PATHS, NODE_PREFIX, CONSENSUS_PATHS, allPaths } from './paths.ts'
import { probeSession, anonymityReport } from './session.ts'
import { describeIntent } from './intent.ts'
import { describeConfig } from './config.ts'
import type { NodeConfig } from './config.ts'
import type { SnapshotView as IntentSnapshotView } from './intent.ts'
import type { SnapshotView as MetaPackagesSnapshotView } from './metaPackages.ts'
import type { Consensus } from './consensus.ts'

/** The dependencies `startNode()` assembles and a suite may supply directly. */
export type NodeServerDeps = {
  config: NodeConfig
  intent: IntentSnapshotView
  metaPackages: MetaPackagesSnapshotView
  consensus: Consensus
}

/** What `buildNodeServer` returns: the node handler and the untouched host handler. */
export type NodeServer = {
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
  communityHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void>
}

/** The largest request body this node will parse. A probe payload is small by design. */
const MAX_BODY_BYTES = 1_048_576

type RouteHandler = (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void>

type Route = {
  readonly methods: readonly string[]
  readonly handle: RouteHandler
}

/**
 * Read a request body with a hard cap, without retaining it anywhere but memory.
 *
 * A body that exceeds the cap is refused rather than truncated: a truncated JSON
 * body would parse to something the sender did not send.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      reject(error)
    }
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        fail(new Error(`request body exceeds ${MAX_BODY_BYTES} bytes; refused rather than truncated`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error: Error) => fail(error))
    req.on('aborted', () => fail(new Error('request was aborted before its body arrived')))
  })
}

/** Serialise a payload, keeping `undefined` out of the JSON rather than emitting null. */
function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>, headOnly: boolean): void {
  if (res.writableEnded) return
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(text))
  if (headOnly) {
    res.end()
    return
  }
  res.end(text)
}

/** Build the score table. It is keyed by the contract's exact paths, and asserted below. */
function buildRoutes(deps: NodeServerDeps, startedAt: number): Record<string, Route> {
  const { config, intent, metaPackages, consensus } = deps

  const uptimeMs = (): number => Date.now() - startedAt

  const health: RouteHandler = async (_req, res, _url) => {
    /**
     * Health is a path in its own table because the compose healthcheck must not be
     * confusable with a route that might one day need a body. It reports the term
     * and the uptime so a reader can tell a restarted node from a long-lived one,
     * and it deliberately does NOT report snapshot availability as a status: a
     * node serving `available: false` is a HEALTHY node with a missing artifact,
     * and collapsing those two into one red light is how "absent" becomes "down".
     */
    sendJson(
      res,
      200,
      {
        ok: true,
        nodeId: config.nodeId,
        status: 'ok',
        uptimeMs: uptimeMs(),
        term: consensus.state().term,
        intentAvailable: intent.available,
        metaPackagesAvailable: metaPackages.available,
      },
      false,
    )
  }

  const identity: RouteHandler = async (_req, res, _url) => {
    const consensusState = consensus.state()
    sendJson(
      res,
      200,
      {
        ok: true,
        nodeId: config.nodeId,
        uptimeMs: uptimeMs(),
        term: consensusState.term,
        config: describeConfig(config),
        /**
         * The intent projection is `describeIntent()`'s, NOT a six-field literal
         * re-built here. That projector carries the census and the two-clock
         * `freshness` object, and it names the digests' algorithm and subject; a
         * second projection beside it dropped all of that, so the freshness fix was
         * built and served by nobody (`build-gate` D3, measured 2026-10-19T11:24Z).
         */
        intent: describeIntent(intent),
        metaPackages: snapshotIdentity(metaPackages),
        peer: consensusState.peer,
        quorum: consensusState.quorum,
        notDone: 'This identity is what THIS PROCESS HOLDS. It cannot prove the peer is alive, and a snapshot reported available:false means the artifact was not on disk when the loader read it once at startup — it is not a zero count of anything.',
      },
      false,
    )
  }

  const intentRoute: RouteHandler = async (_req, res, _url) => {
    /**
     * `available: false` is served 200, deliberately. A crash or a 5xx on a missing
     * artifact is indistinguishable from a broken node, and the contract requires
     * such a node to stay healthy while saying why it has nothing.
     */
    sendJson(
      res,
      200,
      {
        ok: true,
        nodeId: config.nodeId,
        available: intent.available,
        /**
         * `describeIntent()` SPREAD rather than replaced, and `document` re-attached.
         *
         * The projection deliberately omits the ~42 KB document; this route is the
         * one that used to serve it, so dropping it would be a silent narrowing of
         * the wire for every existing reader. Spreading keeps all seven previous
         * keys and ADDS `census`, `freshness`, `documentSha256`, `sha256Subject`
         * and `sha256Algorithm` — a superset, so nothing that read this route before
         * loses a field and a reader can now re-check the artifact offline.
         */
        snapshot: { ...describeIntent(intent), document: intent.document },
      },
      false,
    )
  }

  const metaPackagesRoute: RouteHandler = async (_req, res, _url) => {
    sendJson(
      res,
      200,
      { ok: true, nodeId: config.nodeId, available: metaPackages.available, snapshot: metaPackages },
      false,
    )
  }

  const probe: RouteHandler = async (req, res, _url) => {
    let raw: string
    try {
      raw = await readBody(req)
    } catch (err) {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: err instanceof Error ? err.message : String(err) }, false)
      return
    }
    /**
     * A body that is valid JSON is passed as the parsed value; a body that is not is
     * passed as the raw string. Both are `unknown` to the probe, which counts the
     * payload's top-level keys only when the payload HAS top-level keys — so a text
     * payload is seen and dropped rather than being an error, and `droppedFields` is
     * derived from the payload rather than assumed.
     */
    let payload: unknown = raw
    if (raw.length > 0) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = raw
      }
    }
    const result = probeSession(config.nodeId, payload)
    sendJson(res, 200, { ok: true, nodeId: config.nodeId, probe: result }, false)
  }

  const anonymity: RouteHandler = async (_req, res, _url) => {
    sendJson(res, 200, { ok: true, nodeId: config.nodeId, anonymity: anonymityReport(config.nodeId) }, false)
  }

  const consensusState: RouteHandler = async (_req, res, _url) => {
    sendJson(res, 200, { ok: true, nodeId: config.nodeId, state: consensus.state() }, false)
  }

  const consensusPropose: RouteHandler = async (req, res, _url) => {
    const body = await readJsonObject(req, res, config.nodeId)
    if (body === null) return
    const key = body.key
    const value = body.value
    if (typeof key !== 'string' || key.length === 0) {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: 'key must be a non-empty string' }, false)
      return
    }
    if (typeof value !== 'string') {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: 'value must be a string; a proposal of a non-string is refused rather than stringified' }, false)
      return
    }
    const result = await consensus.propose(key, value)
    /**
     * The outcome is one of four strings and is served verbatim. It is never
     * converted to a boolean here: the whole evidence that the code distinguishes
     * "peer answered and refused" from "peer did not answer" is the distinct string.
     */
    sendJson(res, 200, { ok: true, nodeId: config.nodeId, result }, false)
  }

  const consensusEndorse: RouteHandler = async (req, res, _url) => {
    const body = await readJsonObject(req, res, config.nodeId)
    if (body === null) return
    const key = body.key
    const value = body.value
    const term = body.term
    if (typeof key !== 'string' || key.length === 0) {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: 'key must be a non-empty string' }, false)
      return
    }
    if (typeof value !== 'string') {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: 'value must be a string' }, false)
      return
    }
    if (typeof term !== 'number' || !Number.isSafeInteger(term)) {
      sendJson(res, 400, { ok: false, nodeId: config.nodeId, error: 'term must be an integer; a proposal without a term cannot be matched to one' }, false)
      return
    }
    const result = consensus.endorse(key, value, term)
    sendJson(res, 200, { ok: true, nodeId: config.nodeId, result }, false)
  }

  return {
    '/node/health': { methods: ['GET'], handle: health },
    '/node/identity': { methods: ['GET'], handle: identity },
    '/node/intent': { methods: ['GET'], handle: intentRoute },
    '/node/meta-packages': { methods: ['GET'], handle: metaPackagesRoute },
    '/node/session/probe': { methods: ['POST'], handle: probe },
    '/node/anonymity': { methods: ['GET'], handle: anonymity },
    '/node/consensus/state': { methods: ['GET'], handle: consensusState },
    '/node/consensus/propose': { methods: ['POST'], handle: consensusPropose },
    '/node/consensus/endorse': { methods: ['POST'], handle: consensusEndorse },
  }
}

/**
 * Read a JSON object body, answering 400 itself when it cannot.
 *
 * @returns the parsed object, or `null` when a response has already been sent —
 * the caller must return immediately on `null` rather than treating it as an empty
 * body, because `{}` and "refused" are different values.
 */
async function readJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
  nodeId: string,
): Promise<Record<string, unknown> | null> {
  let raw: string
  try {
    raw = await readBody(req)
  } catch (err) {
    sendJson(res, 400, { ok: false, nodeId, error: err instanceof Error ? err.message : String(err) }, false)
    return null
  }
  if (raw.trim().length === 0) {
    sendJson(res, 400, { ok: false, nodeId, error: 'a JSON object body is required and none was sent' }, false)
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    sendJson(res, 400, { ok: false, nodeId, error: 'body is not valid JSON' }, false)
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    sendJson(res, 400, { ok: false, nodeId, error: 'body must be a JSON object' }, false)
    return null
  }
  return parsed as Record<string, unknown>
}

/**
 * The subset of a snapshot a reader needs to judge it, WITHOUT shipping the
 * document: the document is served by the snapshot's own route.
 *
 * Used for the meta-packages snapshot, which has no projector of its own in
 * `metaPackages.ts`. The intent snapshot goes through `describeIntent()` instead —
 * `describeIntent()` is that lane's own account of what a reader needs, and
 * re-projecting it here is exactly how its freshness fix came to be served by
 * nobody. The digest is named with its algorithm for the reason the program records
 * elsewhere: a bare digest is unappealable, and `sha256` beside no algorithm cannot
 * be re-checked by a reader who used a different function.
 */
function snapshotIdentity(view: IntentSnapshotView | MetaPackagesSnapshotView): Record<string, unknown> {
  return {
    available: view.available,
    reason: view.reason,
    source: view.source,
    capturedAt: view.capturedAt,
    bytes: view.bytes,
    sha256: view.sha256,
    sha256Algorithm: 'sha256',
    sha256Subject: 'the response body as fetched (network-side; NOT recomputable from the file)',
  }
}

/**
 * Refuse to build a server whose dispatcher and advertised path table disagree.
 *
 * This runs at construction, not at request time, so the drift is a startup failure
 * with a named list rather than a 404 a reader has to notice. It checks BOTH
 * directions: a path in the table with no branch would be advertised and dead, and a
 * branch with no table entry would be served but undocumented.
 */
function assertDispatchMatchesPathTable(routes: Record<string, Route>): void {
  const advertised: readonly string[] = [...NODE_PATHS, ...CONSENSUS_PATHS]
  const missingBranch = advertised.filter((path) => !Object.hasOwn(routes, path))
  const unadvertisedBranch = Object.keys(routes).filter((path) => !advertised.includes(path))
  const wrongPrefix = advertised.filter((path) => !path.startsWith(NODE_PREFIX))
  if (missingBranch.length === 0 && unadvertisedBranch.length === 0 && wrongPrefix.length === 0) {
    const advertisedCount = advertised.length
    const branchCount = Object.keys(routes).length
    if (advertisedCount === branchCount) return
    throw new Error(
      `node dispatch table mismatch: ${advertisedCount} advertised path(s) against ${branchCount} branch(es); duplicate paths in the table would hide a missing branch`,
    )
  }
  throw new Error(
    `node dispatch table disagrees with paths.ts — advertised with no branch: ${JSON.stringify(missingBranch)}; `
      + `branch with no advertisement: ${JSON.stringify(unadvertisedBranch)}; `
      + `advertised path not under ${NODE_PREFIX}: ${JSON.stringify(wrongPrefix)}`,
  )
}

/** Build the node's request handler around the dependencies `startNode()` assembles. */
export function buildNodeServer(deps: NodeServerDeps): NodeServer {
  const routes = buildRoutes(deps, Date.now())
  assertDispatchMatchesPathTable(routes)

  const community = buildHandler()
  const communityHandler = community.handler
  const nodeId = deps.config.nodeId
  const pathTable = allPaths()

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    /**
     * The header is set before dispatch so that EVERY response this server emits
     * identifies its node — including the delegated host responses, whose body this
     * file does not compose and must not rewrite.
     */
    res.setHeader('x-node-id', nodeId)

    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const receivedMethod = req.method ?? null
    /** HEAD is answered by the GET branch; the body is suppressed rather than sent and dropped. */
    const headOnly = receivedMethod === 'HEAD'
    const method = headOnly ? 'GET' : (receivedMethod ?? 'GET')

    const route = Object.hasOwn(routes, path) ? routes[path] : undefined
    if (route !== undefined) {
      if (!route.methods.includes(method)) {
        res.setHeader('allow', route.methods.join(', '))
        sendJson(
          res,
          405,
          {
            ok: false,
            nodeId,
            error: `${path} is ${route.methods.join('/')}-only`,
            method: receivedMethod,
            allow: route.methods,
            path,
          },
          false,
        )
        return
      }
      try {
        await route.handle(req, res, url)
      } catch (err) {
        sendJson(
          res,
          500,
          { ok: false, nodeId, error: err instanceof Error ? err.message : String(err), path },
          false,
        )
      }
      return
    }

    if (path === COMMUNITY_PREFIX || path.startsWith(`${COMMUNITY_PREFIX}/`)) {
      await communityHandler(req, res)
      return
    }

    /**
     * The 404 body is the one place whose job is to be authoritative, so it prints
     * the WHOLE table `allPaths()` returns — node, consensus and host paths together
     * — with its length, the method received, and the node that answered.
     */
    sendJson(
      res,
      404,
      {
        ok: false,
        nodeId,
        error: 'no such path',
        path,
        method: receivedMethod,
        pathCount: pathTable.length,
        paths: pathTable,
      },
      false,
    )
  }

  return { handler, communityHandler }
}
