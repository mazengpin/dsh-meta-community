/**
 * dsh-meta-community — the community/fusion half of the meta layer.
 *
 * **WHAT THIS IS, IN ONE PARAGRAPH, BECAUSE ITS NAME COULD MISLEAD A READER.**
 * The owner asked to *"fuse meta plugin for the meta-market-community"*, and
 * `dsh-meta-market` already exists beside this clone. **This plugin does not
 * supersede it, does not reimplement it, and reads none of its files.** The market
 * clone is a PACKAGE-EXCHANGE surface between two peers; this one carries the two
 * clauses that surface measured as absent from itself — **C1's community, which a
 * pair cannot be**, and **C4's decentralized authorship, which one-proposer
 * distribution is the opposite of**. Both clones remain authorized and both are
 * separate artifacts: `D-0053` governs the market clone, `D-0080` governs this
 * one, and neither discharge the other.
 *
 * **AND IT REPORTS ITSELF AS `plan` RATHER THAN `exists`, WHICH IS THE MOST
 * USEFUL THING IT DOES.** Its registry works, its fusion works, its harness runs —
 * and a community with one member is not a community. That verdict is a FIELD on
 * the surface, derived by `communityKind` from the census rather than written by
 * hand, so the code and the claim cannot drift apart.
 *
 * @module dsh-meta-community/host
 */

import type { HostContext } from './types.ts'
import { PREFIX, buildHandler, REGISTERED_PATHS } from './routes.ts'

/** The plugin name the host records. */
export const name = 'dsh-meta-community'

/**
 * The host services this plugin requires before `apply` runs.
 *
 * Declared as an injection rather than read off the context defensively, so a
 * host without a web server refuses the plugin at load instead of mounting a
 * surface whose handler would throw on first request.
 */
export const inject = ['webServer'] as const

/**
 * Mount the community surface.
 *
 * One registration owns the whole `PREFIX` subtree, which is what lets the
 * dispatcher in `routes.ts` route several sub-paths without several registrations
 * competing for the same prefix.
 *
 * @param ctx - the slice of the host context this plugin consumes.
 */
export function apply(ctx: HostContext): void {
  ctx.logger.info(`[${name}] mounting community surface at ${PREFIX} (${REGISTERED_PATHS.length} advertised paths)`)

  const { handler, registry } = buildHandler()
  const census = registry.census()

  /**
   * THE REGISTRATION TIME LOG NAMES THE KIND, so a host operator reading boot
   * output is told what they mounted rather than only that something mounted. A
   * single-member community and a populated one print differently, and neither
   * prints a bare `ok`.
   */
  ctx.logger.info(
    `[${name}] community census at mount: ${census.inspected} inspected of ${census.total} total`
      + (census.total < 2 ? ' — a community of one is not a community, so this surface reports `plan`' : ''),
  )

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler }), `${name}:community-surface`)
}
