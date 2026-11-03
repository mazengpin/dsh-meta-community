/**
 * ============================================================================
 * NODE CONFIG — the four values the container is given, and the refusals
 * ============================================================================
 *
 * Written against `docker/NODE-CONTRACT.md` §`config.ts`. It is deliberately a
 * PURE function of an environment object: nothing here reads `process.env`
 * itself, so a harness can hand it a map and drive every refusal without
 * touching the running process.
 *
 * **A BAD VALUE IS A NAMED REFUSAL, NOT A COERCION.** Every fallback below is
 * reachable only when the variable is ABSENT; a variable that is present and
 * malformed throws `ConfigError` with the variable's name in the message. The
 * program's absent-is-not-zero rule applies here in the config direction: an
 * unset `PEER_URL` is a legal lone node, while `PEER_URL=""` is also treated as
 * unset and said so in one place — but `PEER_URL="not a url"` is refused, because
 * silently falling back to `null` would turn a typo into a node that reports
 * itself lone and never contacts its peer.
 *
 * Node 24 strips types rather than compiling them, so this file uses no `enum`,
 * no `namespace`, no parameter properties and no decorators, and every type-only
 * import would be written `import type`.
 *
 * @module dsh-meta-community/node/config
 */

/** The environment shape this module reads. A subset of `NodeJS.ProcessEnv`. */
export type ConfigEnv = { readonly [name: string]: string | undefined }

/** The four configured values plus the snapshot directory. */
export type NodeConfig = {
  nodeId: string
  port: number
  peerUrl: string | null
  snapshotDir: string
  commitTimeoutMs: number
}

/**
 * The refusal type.
 *
 * `name` is set on the instance rather than through a parameter property, because
 * `constructor(public name: string)` is a non-erasable construct under Node 24's
 * type stripping.
 */
export class ConfigError extends Error {
  readonly variable: string

  constructor(variable: string, message: string) {
    super(message)
    this.name = 'ConfigError'
    this.variable = variable
  }
}

/** `PORT` default. The compose topology publishes 8090 inside the network. */
const DEFAULT_PORT = 8090

/** `SNAPSHOT_DIR` default. The image places baked snapshots at `/app/snapshots`. */
const DEFAULT_SNAPSHOT_DIR = '/app/snapshots'

/** `COMMIT_TIMEOUT_MS` default. One consensus round may not hang the node. */
const DEFAULT_COMMIT_TIMEOUT_MS = 1500

/** An upper bound so a mistyped timeout cannot park a request for an hour. */
const MAX_COMMIT_TIMEOUT_MS = 600_000

/**
 * Parse a decimal integer environment value strictly.
 *
 * `Number('12px')` is `NaN` and `parseInt('12px')` is `12`; neither is acceptable
 * here, because both accept text that is not a number. The pattern test is what
 * makes this a refusal rather than a coercion.
 */
function readInteger(variable: string, raw: string): number {
  const text = raw.trim()
  if (!/^[0-9]+$/.test(text)) {
    throw new ConfigError(variable, `${variable} must be a non-negative decimal integer, received ${JSON.stringify(raw)}`)
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value)) {
    throw new ConfigError(variable, `${variable} is outside the safe integer range: ${JSON.stringify(raw)}`)
  }
  return value
}

/**
 * Read and validate the node's configuration.
 *
 * @throws ConfigError when `NODE_ID` is absent/empty, when a numeric variable is
 * malformed or out of range, or when `PEER_URL` is present but is not an http(s)
 * URL. The process must not start on a bad config: a node with a wrong port is
 * a node the healthcheck will report as absent rather than unhealthy.
 */
export function readConfig(env: ConfigEnv): NodeConfig {
  const rawNodeId = env.NODE_ID
  const nodeId = rawNodeId === undefined ? '' : rawNodeId.trim()
  if (nodeId.length === 0) {
    throw new ConfigError(
      'NODE_ID',
      'NODE_ID is required and must be non-empty: an anonymous node cannot report which node answered, and every response this server sends carries its nodeId',
    )
  }

  const rawPort = env.PORT
  const port = rawPort === undefined ? DEFAULT_PORT : readInteger('PORT', rawPort)
  /**
   * `0` is permitted and means "an ephemeral port", which is what an in-process
   * suite needs; it is NOT the container default. A value above 65535 is refused
   * rather than handed to `listen`, where Node would throw a stack trace.
   */
  if (port > 65535) {
    throw new ConfigError('PORT', `PORT must be 0..65535, received ${rawPort ?? ''}`)
  }

  const rawSnapshotDir = env.SNAPSHOT_DIR
  const snapshotDir = rawSnapshotDir === undefined ? DEFAULT_SNAPSHOT_DIR : rawSnapshotDir.trim()
  if (snapshotDir.length === 0) {
    throw new ConfigError('SNAPSHOT_DIR', 'SNAPSHOT_DIR was set but is empty; leave it unset to take the default')
  }

  const rawTimeout = env.COMMIT_TIMEOUT_MS
  const commitTimeoutMs = rawTimeout === undefined ? DEFAULT_COMMIT_TIMEOUT_MS : readInteger('COMMIT_TIMEOUT_MS', rawTimeout)
  if (commitTimeoutMs === 0) {
    throw new ConfigError('COMMIT_TIMEOUT_MS', 'COMMIT_TIMEOUT_MS must be greater than 0: a zero timeout makes every proposal quorum-lost before the peer can answer')
  }
  if (commitTimeoutMs > MAX_COMMIT_TIMEOUT_MS) {
    throw new ConfigError('COMMIT_TIMEOUT_MS', `COMMIT_TIMEOUT_MS must be at most ${MAX_COMMIT_TIMEOUT_MS}, received ${commitTimeoutMs}`)
  }

  const peerUrl = readPeerUrl(env.PEER_URL)

  return { nodeId, port, peerUrl, snapshotDir, commitTimeoutMs }
}

/**
 * Read `PEER_URL`, where absent and empty both mean "no peer" and anything else
 * must parse.
 *
 * The two accepted spellings of "lone" are stated here rather than inferred at a
 * call site: compose may hand an empty string, and treating it as a URL would make
 * the node attempt a request to the empty path.
 */
function readPeerUrl(raw: string | undefined): string | null {
  if (raw === undefined) return null
  const text = raw.trim()
  if (text.length === 0) return null
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new ConfigError('PEER_URL', `PEER_URL is not a URL: ${JSON.stringify(raw)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ConfigError('PEER_URL', `PEER_URL must be http or https, received ${JSON.stringify(parsed.protocol)}`)
  }
  /** Trailing slashes are stripped once, here, so a caller cannot build `//node/...`. */
  return text.replace(/\/+$/, '')
}

/**
 * The projection that is safe to serve.
 *
 * **No secret is read by this node at all**, so there is nothing to redact; that
 * is a fact about the reader above rather than a filter here, and it is written
 * down so a later addition of a credential cannot pass unnoticed. `peerUrl` is
 * topology, not a secret, and it is served because a reader must be able to tell
 * whether a lone node is lone by configuration or by a dead peer.
 */
export function describeConfig(config: NodeConfig): Record<string, unknown> {
  return {
    nodeId: config.nodeId,
    port: config.port,
    peerUrl: config.peerUrl,
    peerConfigured: config.peerUrl !== null,
    snapshotDir: config.snapshotDir,
    commitTimeoutMs: config.commitTimeoutMs,
    secretsRead: 0,
    notDone: 'This projection reports the configuration THIS PROCESS WAS GIVEN. It is not evidence that the peer at peerUrl is reachable, and a null peerUrl means no peer was configured rather than a peer that was probed and found absent.',
  }
}
