/**
 * ============================================================================
 * THE NODE ENTRYPOINT — bind, say where you bound, and die by name
 * ============================================================================
 *
 * `node src/node/index.ts` runs this file from source under Node 24's type
 * stripping. That is the design and not a workaround: `lib/index.js` exports only
 * the Cordis plugin (`apply`/`inject`/`name`) because `tsdown` builds
 * `src/host/index.ts` alone, so the node half is never in the host bundle and the
 * container has no build step at all.
 *
 * **A STARTUP FAILURE IS A NAMED REFUSAL, NOT A STACK TRACE.** A wrong `NODE_ID`, a
 * malformed port, or a port already in use each produce one line naming the
 * condition and a non-zero exit. A stack trace makes a container that cannot start
 * look like a container that crashed, which is a different diagnosis.
 *
 * @module dsh-meta-community/node/index
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { Socket } from 'node:net'
import { pathToFileURL } from 'node:url'
import { readConfig } from './config.ts'
import type { NodeConfig } from './config.ts'
import { loadIntentSnapshot } from './intent.ts'
import { loadMetaPackagesSnapshot } from './metaPackages.ts'
import { Consensus } from './consensus.ts'
import { buildNodeServer } from './server.ts'

/** A bind failure, named so the entrypoint can say which condition failed. */
export class ListenError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ListenError'
    this.code = code
  }
}

/**
 * Sockets this module opened, keyed by server.
 *
 * `server.close()` stops accepting new connections and waits for existing ones to
 * end, so a keep-alive client or an idle peer can hold shutdown open indefinitely.
 * Tracking the sockets is what lets SIGTERM finish in bounded time instead of being
 * escalated to SIGKILL by the runtime's stop grace period.
 */
const openSockets = new WeakMap<Server, Set<Socket>>()

/**
 * Start the node: read the config, load the two snapshots once, build the consensus
 * object, and bind `0.0.0.0:config.port`.
 *
 * @param env the environment to read. Defaults to `process.env`; it is a parameter so
 * a suite can drive every refusal in-process without mutating the real environment.
 * @throws ConfigError from `readConfig` when a value is absent or malformed.
 * @throws ListenError on `EADDRINUSE` or any other bind failure.
 */
export async function startNode(env?: NodeJS.ProcessEnv): Promise<{ server: Server; config: NodeConfig }> {
  const config = readConfig(env ?? process.env)

  /**
   * Both snapshots are read ONCE here, at startup, and cached by their loaders. A
   * missing or malformed artifact does not throw: it yields `available: false` with a
   * reason, and the node stays healthy, because a crash on a missing artifact is
   * indistinguishable from a broken node.
   */
  const intent = loadIntentSnapshot(config.snapshotDir)
  const metaPackages = loadMetaPackagesSnapshot(config.snapshotDir)
  const consensus = new Consensus(config)

  const { handler } = buildNodeServer({ config, intent, metaPackages, consensus })
  const server = createServer((req, res) => {
    void handler(req, res).catch((err: unknown) => {
      /**
       * The handler already answers its own failures; this is the floor beneath it,
       * so an escape becomes a 500 rather than an unhandled rejection that would
       * leave the request hanging.
       */
      if (!res.writableEnded) {
        res.statusCode = 500
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ ok: false, nodeId: config.nodeId, error: err instanceof Error ? err.message : String(err) }))
      }
    })
  })

  const sockets = new Set<Socket>()
  openSockets.set(server, sockets)
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.removeListener('listening', onListening)
      if (error.code === 'EADDRINUSE') {
        reject(
          new ListenError(
            'EADDRINUSE',
            `port ${config.port} on 0.0.0.0 is already in use (EADDRINUSE): another process is bound there, so this node did not start`,
          ),
        )
        return
      }
      reject(new ListenError(error.code ?? 'EUNKNOWN', `failed to bind 0.0.0.0:${config.port}: ${error.message}`))
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(config.port, '0.0.0.0')
  })

  const address = server.address()
  const boundPort = address !== null && typeof address === 'object' ? address.port : config.port
  /**
   * The BOUND port is logged, not the configured one, because they differ when
   * `PORT=0`; a caller that logs the configured port would print a port nothing is
   * listening on.
   */
  console.log(
    `[node] listening nodeId=${config.nodeId} port=${boundPort} address=0.0.0.0 `
      + `peerUrl=${config.peerUrl ?? 'none'} snapshotDir=${config.snapshotDir} `
      + `intentAvailable=${intent.available} metaPackagesAvailable=${metaPackages.available}`,
  )

  return { server, config }
}

/**
 * Close the server gracefully: stop accepting, then end the connections it still
 * holds, and destroy any that outlive the timeout.
 *
 * The timeout is stated as a number of milliseconds so SIGTERM cannot be held open
 * by an idle keep-alive socket.
 */
export function closeNode(server: Server, timeoutMs = 5000): Promise<void> {
  const sockets = openSockets.get(server)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (sockets !== undefined) {
        for (const socket of sockets) socket.destroy()
      }
    }, timeoutMs)

    server.close((error?: Error) => {
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })

    /** Existing idle connections would otherwise hold `close()` open until the timer. */
    if (sockets !== undefined) {
      for (const socket of sockets) socket.end()
    }
  })
}

/**
 * Whether this module is the process's entrypoint.
 *
 * `node src/node/index.ts` and a suite importing `startNode` must behave
 * differently: only the entrypoint may install signal handlers and exit the
 * process. On Windows the comparison is case-insensitive because the same path can
 * arrive with different casing and would otherwise silently not match.
 */
function isEntrypoint(): boolean {
  const arg = process.argv[1]
  if (arg === undefined) return false
  const self = import.meta.url
  const candidate = pathToFileURL(arg).href
  return process.platform === 'win32' ? self.toLowerCase() === candidate.toLowerCase() : self === candidate
}

/** The entrypoint: start, install signal handling, and refuse by name. */
async function main(): Promise<void> {
  let started: { server: Server; config: NodeConfig }
  try {
    started = await startNode()
  } catch (err) {
    const named = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error(`[node] refused to start — ${named}`)
    process.exitCode = 1
    return
  }

  const { server, config } = started
  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    console.log(`[node] ${signal} received — nodeId=${config.nodeId} closing gracefully`)
    closeNode(server).then(
      () => {
        console.log(`[node] closed nodeId=${config.nodeId}`)
        process.exitCode = 0
      },
      (err: unknown) => {
        console.error(`[node] close failed — ${err instanceof Error ? err.message : String(err)}`)
        process.exitCode = 1
      },
    )
  }

  process.once('SIGTERM', () => {
    shutdown('SIGTERM')
  })
  process.once('SIGINT', () => {
    shutdown('SIGINT')
  })
}

if (isEntrypoint()) {
  void main()
}
