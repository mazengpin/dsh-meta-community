/**
 * The Host surfaces this plugin uses, declared STRUCTURALLY.
 *
 * Same reasoning as the `dsh-meta-market` clone and for the same reason: a
 * cross-package value import is a load-order dependency in somebody else's boot,
 * and this plugin needs four members of `webServer` and nothing else. The
 * interface is the SLICE of the host context this clone consumes, so a host that
 * grows a member does not require an edit here and a host that removes one this
 * clone uses fails to typecheck rather than at runtime.
 *
 * @module dsh-meta-community/host/types
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** The unregister function a successful registration returns. */
export type RouteRegistrar = () => void

/** The slice of the Host context this plugin reads. */
export interface HostContext {
  readonly webServer: {
    /** `kind: 'prefix'` matches the whole subtree, which is what lets one registration own several sub-routes. */
    register(route: {
      readonly kind: 'prefix'
      readonly path: string
      readonly handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    }): RouteRegistrar
  }
  /**
   * Scoped cleanup, so a disposed plugin leaves no route behind.
   *
   * The callback returns the disposer rather than being the disposer, which is
   * why this plugin cannot register and clean up in two separate statements.
   */
  effect(callback: () => RouteRegistrar | void, label?: string): void
  readonly logger: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
  }
}
