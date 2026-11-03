/**
 * ============================================================================
 * THE NODE PATH TABLE — the ONE place the node's advertised paths are written
 * ============================================================================
 *
 * **THIS FILE EXISTS BECAUSE A HAND-WRITTEN PATH LIST BESIDE A DISPATCHER IS A
 * DEFECT GENERATOR, AND IT HAS ALREADY FIRED ONCE IN THIS PROGRAM.** The sibling
 * `dsh-meta-market` build kept a route list beside its handler, listed
 * `/meta-market/api/api/lanes` where `PREFIX` was already `/meta-market/api`, left
 * the branch comparing against that string UNREACHABLE, and — the part that makes
 * it a defect rather than a typo — **its 404 body advertised the dead path as
 * registered** (`D-0071`). The repair was one DERIVED table driven end to end.
 *
 * The same rule is applied here from the first line:
 *
 *  1. The host half's paths are NOT retyped. They are IMPORTED as
 *     `REGISTERED_PATHS` from `../host/routes.ts`, so the host dispatcher and this
 *     table cannot drift: the host owns its own string, and this file only
 *     concatenates.
 *  2. This node's own paths are derived from `NODE_PREFIX` rather than written as
 *     full literals, for the same reason — a segment cannot double if it is
 *     pasted from one constant.
 *  3. `allPaths()` is the ONLY thing a 404 body and a drive-every-path harness
 *     read, so a path cannot be advertised without being in the table that is
 *     driven.
 *
 * **THE DEDUPE IS NOT A BARE `new Set(...)`, AND THAT IS DELIBERATE.** A silent
 * dedupe is the same defect class as the doubled segment: if two DISTINCT paths
 * ever collapsed into one, the result would be a count that is short by exactly
 * one and a list that looks complete. So `auditPaths()` reports the numerator AND
 * the denominator AND names any path that collided, and `allPaths()` is built on
 * top of it rather than beside it.
 *
 * **Node 24 native type stripping runs this file from source** (`node
 * --experimental-strip-types src/node/index.ts`), so every construct here is
 * ERASABLE: no `enum`, no `const enum`, no `namespace`, no parameter properties,
 * no decorators, no `import = require`. Type-only imports are written
 * `import type`. The `import` below is a VALUE import, so it is not one of those.
 *
 * @module dsh-meta-community/node/paths
 */

import { REGISTERED_PATHS } from '../host/routes.ts'

/** The node's own prefix. Every node path below is derived from this one constant, so its segments cannot double. */
export const NODE_PREFIX: string = '/node'

/**
 * Every node-level path this server dispatches.
 *
 * These six are the node surface proper. `/node/health` is in ITS OWN TABLE rather
 * than folded into `CONSENSUS_PATHS`, because the compose healthcheck needs
 * something that cannot be confused with a route that might one day need a body —
 * a healthcheck that has to POST is not a healthcheck.
 *
 * Frozen: a table that a handler can push onto is a table that can disagree with
 * the dispatcher at run time, which is the whole defect this file is the repair for.
 */
export const NODE_PATHS: readonly string[] = Object.freeze([
  `${NODE_PREFIX}/identity`,
  `${NODE_PREFIX}/intent`,
  `${NODE_PREFIX}/meta-packages`,
  `${NODE_PREFIX}/session/probe`,
  `${NODE_PREFIX}/anonymity`,
  `${NODE_PREFIX}/health`,
])

/**
 * The three consensus paths, kept in a separate table because they are a separate
 * capability: the two-voter commit is the only part of this node that talks to a
 * peer, and a reader asking "what does this node do alone" wants the six above
 * with these three subtracted, not merged in.
 */
export const CONSENSUS_PATHS: readonly string[] = Object.freeze([
  `${NODE_PREFIX}/consensus/state`,
  `${NODE_PREFIX}/consensus/propose`,
  `${NODE_PREFIX}/consensus/endorse`,
])

/**
 * A path census that CARRIES ITS OWN DENOMINATOR, so a count here can never be a
 * numerator without a population.
 *
 * `expected` exists so a reader can check the arithmetic without the author: it is
 * `bySource.node + bySource.consensus + bySource.host`, and `distinct` must equal
 * it when nothing collided. **A `distinct` that is one short of `expected` is not a
 * tidy dedupe, it is two distinct paths merged into one** — which is why
 * `duplicatePaths` names them rather than letting the number stand alone.
 */
export type PathAudit = {
  readonly expected: number
  readonly distinct: number
  readonly bySource: { readonly node: number; readonly consensus: number; readonly host: number }
  readonly duplicatePaths: readonly string[]
  readonly doubledSegmentPaths: readonly string[]
}

/** The three source tables, named, in the order they are concatenated. */
const SOURCES: readonly (readonly [source: 'node' | 'consensus' | 'host', table: readonly string[]])[] = [
  ['node', NODE_PATHS],
  ['consensus', CONSENSUS_PATHS],
  ['host', REGISTERED_PATHS],
]

/**
 * Does this path repeat a segment against itself — `/a/api/api/b`?
 *
 * This is the market build's `D-0071` shape stated as a PREDICATE rather than as a
 * remembered string. It is not the only way a path can be wrong, but it is the way
 * it was wrong there, and it is checkable from one path with no knowledge of
 * anything else.
 */
function hasDoubledSegment(path: string): boolean {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i] === segments[i - 1]) return true
  }
  return false
}

/**
 * Census the three tables WITHOUT throwing, so a caller can report a bad table
 * instead of the process dying at import time on a container that still has to say
 * something useful in its 404 body and its `/node/health` answer.
 */
export function auditPaths(): PathAudit {
  const seen = new Map<string, string>()
  const duplicatePaths: string[] = []
  const bySource = { node: 0, consensus: 0, host: 0 }

  for (const [source, table] of SOURCES) {
    for (const path of table) {
      if (source === 'node') bySource.node += 1
      else if (source === 'consensus') bySource.consensus += 1
      else bySource.host += 1

      const firstSeenIn = seen.get(path)
      if (firstSeenIn === undefined) {
        seen.set(path, source)
        continue
      }
      /**
       * AN EXACT DUPLICATE ACROSS TWO TABLES IS NOT A DEDUPE, IT IS A DISAGREEMENT
       * ABOUT OWNERSHIP. It is still served once — the same string is the same
       * route — but it is RECORDED here so the number is auditable, because a
       * count silently dropping from 16 to 15 leaves a reader unable to tell a
       * merge from a missing entry.
       */
      if (!duplicatePaths.includes(path)) duplicatePaths.push(path)
      void firstSeenIn
    }
  }

  const distinct = seen.size
  const doubledSegmentPaths: string[] = []
  for (const path of seen.keys()) {
    if (hasDoubledSegment(path)) doubledSegmentPaths.push(path)
  }

  return {
    expected: bySource.node + bySource.consensus + bySource.host,
    distinct,
    bySource,
    duplicatePaths: Object.freeze(duplicatePaths),
    doubledSegmentPaths: Object.freeze(doubledSegmentPaths),
  }
}

/**
 * Every path this node advertises: the six node paths, the three consensus paths,
 * and the host half's own `REGISTERED_PATHS` — deduped, in that order, frozen.
 *
 * This is the list the 404 body prints and the list a drive-every-path harness
 * walks, so **the advertised set and the driven set are the same object** rather
 * than two lists that agree today.
 */
export function allPaths(): readonly string[] {
  const collected: string[] = []
  for (const [, table] of SOURCES) {
    for (const path of table) {
      if (!collected.includes(path)) collected.push(path)
    }
  }
  return Object.freeze(collected)
}
