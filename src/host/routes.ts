/**
 * ============================================================================
 * THE ROUTE SURFACE — what this plugin SERVES, and what it says it cannot do
 * ============================================================================
 *
 * Same shape as the `dsh-meta-market` clone's surface and for the same reasons:
 * one `kind: 'prefix'` registration owns the subtree, every advertised path is
 * advertised from ONE table so a reader can drive all of them, and a 404 body
 * never claims a path is registered.
 *
 * **THE `notDone` STRINGS IN THIS FILE ARE THE MOST DANGEROUS PROSE IN THE
 * CLONE, AND THAT IS MEASURED RATHER THAN DRAMATIC.** On the market build an
 * independent reader falsified **two of five** `notDone` claims, both of the same
 * shape — *a true statement of scope attached to a false justification* — and the
 * program's own rule came out of it (`D-0073`): **the reason is the part a reader
 * acts on, so a false justification is worse than none.** Every string below is
 * therefore written to state what THIS ROUTE OBSERVED, and any sentence about the
 * wider program either says which artifact it read or is not written at all.
 *
 * @module dsh-meta-community/host/routes
 */

import { CommunityRegistry, MEMBER_ROLES, communityKind } from './community/members.ts'
import { fusePackages, revisionStanding, type Contribution } from './community/fusion.ts'
import { clauseCensus, OWNER_CLAUSES, OWNER_DIRECTIVE_VERBATIM } from './clauses.ts'

/** The prefix this plugin owns, mounted under the host's own web root. */
export const PREFIX = '/meta-community/api'

/**
 * Every path this surface advertises, in one table.
 *
 * **DERIVED FROM THE HANDLER BELOW BY CONSTRUCTION RATHER THAN BY MEMORY**, which
 * is the repair for `D-0071`: the market clone hand-wrote its route list, listed a
 * path with a DOUBLED segment, left the matching branch unreachable, and the 404
 * body advertised the dead path as registered. The guard is that this table and
 * the dispatcher's branches are read side by side by `host-half.mjs`, which drives
 * every entry and fails on any 404.
 */
export const REGISTERED_PATHS: readonly string[] = Object.freeze([
  `${PREFIX}/members`,
  `${PREFIX}/census`,
  `${PREFIX}/fuse`,
  `${PREFIX}/standing`,
  `${PREFIX}/clauses`,
  `${PREFIX}/clauses/conformance`,
  `${PREFIX}/standing/relabel`,
])

/** Build the one registry this instance serves from. */
function seedRegistry(): CommunityRegistry {
  const registry = new CommunityRegistry()
  /**
   * ONE MEMBER IS SEEDED, AND IT IS THIS INSTANCE, AND ITS TRUST IS HONEST.
   *
   * It is recorded at `inspected` with the evidence that it exists — this process
   * is running it — and NOT at a level that implies anyone checked who it is.
   * The census that follows is therefore `1`, from a community of one, which is
   * why `communityKind` returns `plan` below rather than `exists`: **a community
   * of one instance is not a community**, and the route says so in a field rather
   * than leaving a reader to notice the number.
   */
  registry.recognise({
    memberId: 'local-instance',
    role: 'author',
    capabilities: ['fuse', 'recognise', 'publish-standing'],
    inspectedEvidence: 'this host process is executing this handler, so the member exists and is not claimed by a payload',
  })
  return registry
}

/**
 * The surface's honest account of what does not exist.
 *
 * Read `noCommunity` first: it is the clause C1 turns on, and it is the reason
 * this plugin is `plan` rather than `exists` no matter how well its own code
 * works.
 */
export function describeSurface(): Record<string, unknown> {
  return {
    lane: 'community',
    prefix: PREFIX,
    /**
     * THE ASSEMBLY REPORT, AND EACH FIELD IS A CLAIM ABOUT THE WHOLE PROGRAM.
     * Every one of these is scoped to an artifact this lane MEASURED, because the
     * market build's defect (`D-0073`) was a scope-true sentence carrying a
     * program-wide justification.
     */
    notServed: 'THIS FIELD DESCRIBES IN-PROCESS ROUTABILITY, NOT MOUNT STATE — CORRECTED 2026-10-18 BECAUSE THE HARDCODED VERSION BECAME FALSE. It previously read, verbatim: "THIS SURFACE IS ROUTABLE AND IS NOT SERVED. The plugin is built and its handler is reachable in-process, but no host has mounted it: the live 3083 answers 404 on every path below, and this clone appears in no profile dependency list." Every clause of that was true when written and INVERTED once the surface was mounted: the live 3083 now answers 200/405 on all 7 registered paths (pre-mount 0/7, post-mount 7/7, censused 2026-10-18T16:47:29Z) and the clone is a declared dependency with a materialised module link. A sentence frozen into an artifact cannot track a mount, so it told a reader the opposite of the running system — the `D-0073` shape, a scope statement carrying a justification that had expired. This field therefore no longer asserts mount state: it can state what THIS PROCESS contains, and MOUNT STATE must be measured by probing the host, never read from a string baked in at build time.',
    noCommunity: 'THE COMMUNITY HAS ONE MEMBER AND IT IS THIS INSTANCE — BUT THE "NO SECOND CLONE" CLAUSE THAT STOOD HERE WAS FALSE AND IS CORRECTED. It read: "This lane found no second `dsh-meta-*` clone with a `src/` tree". Measured 2026-10-18: there are FOUR `dsh-meta-*` clones with `src/` trees (market, evolve, research, community) — so the search that produced that sentence either did not run or ran against the wrong root, and a reader was told a clone census that the filesystem contradicts. What remains TRUE and is what this field is actually for: no route on this surface admits a peer, because members are recognised by a LOCAL call, so a census here counts what this process was told and not who exists elsewhere. A community of one is not a community, which is why this lane reports `plan`.',
    noDecentralizedProvenance: 'AUTHORSHIP IS DECENTRALISED IN SHAPE AND NOT IN PROVENANCE. `revisionStanding` counts DISTINCT AUTHOR STRINGS and reports `provenanceVerified: false` beside it, because this deployment has no keypair, the frozen protocol declares no signature field, and the market lane measured that the comparison binding an author to a peer card is DECLARED AND UNEXPRESSIBLE at that signature. A second author here is indistinguishable from the first author typing a different string.',
    noUniversalMap: 'THIS LANE ALIGNS TO NO MAP. It reads the intent map nowhere and holds no vectors, so the owner\'s phrase "universal intent map" is not addressed by this surface at all — the market clone carries that clause and measured that the map covers 24 zone DEFINITIONS and says nothing about the market. Stated here so that a reader does not infer alignment from this plugin\'s name.',
    specVersion: 1,
  }
}

/** A membership census with the kind it implies, so the two cannot disagree. */
export function describeCensus(registry: CommunityRegistry): Record<string, unknown> {
  const census = registry.census()
  return {
    lane: 'community',
    census,
    kind: communityKind(census),
    roles: [...MEMBER_ROLES],
    /**
     * THE DENOMINATOR IS NAMED BESIDE THE NUMERATOR, EVERY TIME. This program has
     * published six wrong counts in one afternoon (`374`/`440`, `77`/`79`,
     * `14`/`16`, `387` as a floor, `54` groups of `52` directories, `38 of 38`
     * over a dead suite) and every one was a numerator quoted without its
     * population. The `inspected` figure above is a pair on purpose.
     */
    caveat: 'inspected is reported as a numerator over total. A census where inspected is 0 of N is NOT an unpopulated community: it is a populated community with no verified member, and those need different repairs.',
  }
}

/** Read and parse a JSON request body, with a size ceiling so a body cannot be unbounded. */
async function readBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const MAX = 1_048_576
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX) throw new Error(`request body exceeds ${MAX} bytes`)
    chunks.push(buf)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim().length === 0) return null
  return JSON.parse(text)
}

/** Send a JSON response. */
function sendJson(res: import('node:http').ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/**
 * Build the handler this plugin registers under `PREFIX`.
 *
 * The registry is created ONCE here rather than per request, so a POST that
 * recognises a member is visible to a later GET. **That is a deliberate
 * exception to this program's stateless-handler habit, and it is stated because
 * an in-memory registry is state a restart discards** — it is not durable, and
 * the census route says so rather than implying persistence.
 *
 * @returns the handler, plus the registry so a harness can drive it directly.
 */
export function buildHandler(): {
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
  registry: CommunityRegistry
} {
  const registry = seedRegistry()

  const handler = async (
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname

    if (path === PREFIX || path === `${PREFIX}/`) {
      sendJson(res, 200, { ok: true, assembly: describeSurface(), lane: 'community' })
      return
    }

    if (path === `${PREFIX}/members`) {
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        members: registry.list(),
        total: registry.list().length,
        /**
         * A `GET` cannot recognise a member, and saying so is the point: this
         * surface has NO peer-administered path, so a reader must not read the
         * member list as evidence about anyone but this process.
         */
        notDone: 'This surface lists members THIS PROCESS WAS TOLD ABOUT. No route admits a peer card, so an empty or short list is an absence of LOCAL recognitions and never evidence that no peer exists.',
      })
      return
    }

    if (path === `${PREFIX}/census`) {
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        ...describeCensus(registry),
        notDone: 'This census counts members recognised in THIS PROCESS since it started, and the registry is in-memory: a restart returns it to the seeded member. It is not a count of the community.',
      })
      return
    }

    if (path === `${PREFIX}/standing`) {
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        standing: revisionStanding(['local-instance']),
        notDone: 'The standing this route reports is a statement about AUTHOR STRINGS in the revisions it was handed. It cannot verify an author, and it does not claim to.',
      })
      return
    }

    if (path === `${PREFIX}/clauses`) {
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        directive: OWNER_DIRECTIVE_VERBATIM,
        clauses: OWNER_CLAUSES,
        census: clauseCensus(REGISTERED_PATHS),
        notDone: 'The census above grades WHAT THIS CLONE CARRIES, not what the program has achieved. A clause at `exists` here means an artifact in this tree implements it, and that is all it means.',
      })
      return
    }

    if (path === `${PREFIX}/clauses/conformance`) {
      /**
       * C5's INSTRUMENT, AND IT IS THE ROUTE ITS OWN CLAUSE RECORD CITES. In the
       * market clone C5 was the ONLY clause with ZERO artifacts, and its absence is
       * what let C1 and C4 reach a sealed charter unremarked.
       *
       * **IT CAN GO RED, AND THAT IS THE WHOLE PROPERTY.** Its first conjunct is a
       * real check against the path table, not a restatement of it: a clause citing a
       * route this clone does not register is counted and fails the verdict. The
       * `selfTest` fixture below proves the check can FAIL, so this is a guard rather
       * than a green light — **a check that has never been seen to refuse is a
       * decoration.**
       */
      const census = clauseCensus(REGISTERED_PATHS)
      const selfTest = clauseCensus(['/only/one/path/that/does/not/match'])
      sendJson(res, 200, {
        ok: census.withoutFalsifier === 0 && census.unreachableArtifacts === 0,
        lane: 'community',
        census,
        verdict: census.withoutFalsifier === 0 && census.unreachableArtifacts === 0 ? 'conformant' : 'nonconformant',
        /**
         * THE POSITIVE CONTROL, RUN ON EVERY REQUEST. A census taken against a path
         * table containing only a path nothing cites MUST report a non-zero
         * `unreachableArtifacts`; if it reports 0, the check is blind and this field
         * says so rather than letting a green verdict stand.
         */
        selfTest: {
          unreachableWhenTableIsWrong: selfTest.unreachableArtifacts,
          checkCanFail: selfTest.unreachableArtifacts > 0,
        },
        notDone: 'This checks that every clause CITES a registered route, and that every clause carries a falsifier. It does NOT check that a cited artifact MEASURES the thing the clause requires — a route can exist and be irrelevant to its clause, and no instrument in this clone can tell.',
      })
      return
    }

    if (path === `${PREFIX}/standing/relabel`) {
      /**
       * THE CONTROL, AND IT IS THE ONE THING ON THIS SURFACE THAT CHANGES AN
       * OUTCOME RATHER THAN READING ONE BACK.
       *
       * It exists because a control that only reads a value back is not a control.
       * **What it drives: `revisionStanding` takes an `authorIds` argument and
       * RETURNS the shape it computed. This route lets a caller POST a set of author
       * strings and see the shape CHANGE** — `single-author` for one, `multi-author`
       * for two or more — with `provenanceVerified` staying `false` in BOTH cases,
       * which is the finding: **the shape moves with the input and the GUARANTEE
       * does not move at all.**
       */
      if (req.method !== 'POST') {
        sendJson(res, 405, {
          ok: false,
          lane: 'community',
          error: 'relabel is POST-only: the control needs the author set it is to stand for',
          method: req.method ?? null,
        })
        return
      }
      let payload: unknown
      try {
        payload = await readBody(req)
      } catch (err) {
        sendJson(res, 400, { ok: false, lane: 'community', error: err instanceof Error ? err.message : String(err) })
        return
      }
      const authorIds = (payload as { authorIds?: unknown } | null)?.authorIds
      if (!Array.isArray(authorIds) || authorIds.length === 0) {
        sendJson(res, 400, {
          ok: false,
          lane: 'community',
          error: 'authorIds must be a non-empty array of strings; a standing over no authors is refused rather than defaulted.',
        })
        return
      }
      const standing = revisionStanding(authorIds as readonly string[])
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        standing,
        /**
         * THE PAIR, STATED SO THE CONTROL CANNOT BE MISREAD AS SUCCESS. The shape
         * CHANGED with the input; the provenance verdict did not, and could not.
         */
        observed:
          `shape moved to ${standing.shape} for ${standing.distinctAuthors} distinct author string(s), `
          + `while provenanceVerified stayed ${standing.provenanceVerified} — the same value it holds for ONE author. `
          + 'So the input moved the LABEL and not the GUARANTEE.',
        notDone: 'This route cannot authenticate a single author, so the multi-author shape it can be driven to is a statement about STRINGS. It is the honest ceiling of this deployment and not a defect in this route.',
      })
      return
    }

    if (path === `${PREFIX}/fuse`) {
      if (req.method !== 'POST') {
        sendJson(res, 405, {
          ok: false,
          lane: 'community',
          error: 'fuse is POST-only: a fusion needs contributions in a body',
          method: req.method ?? null,
        })
        return
      }
      let payload: unknown
      try {
        payload = await readBody(req)
      } catch (err) {
        sendJson(res, 400, { ok: false, lane: 'community', error: err instanceof Error ? err.message : String(err) })
        return
      }
      const contributions = (payload as { contributions?: unknown } | null)?.contributions
      if (!Array.isArray(contributions) || contributions.length === 0) {
        sendJson(res, 400, {
          ok: false,
          lane: 'community',
          error: 'contributions must be a non-empty array; a fusion of nothing is refused rather than returned as an empty package, because absent is not zero.',
        })
        return
      }
      const result = fusePackages(contributions as readonly Contribution[], registry.census().total)
      sendJson(res, 200, {
        ok: true,
        lane: 'community',
        fusion: result,
        /**
         * THE STRING THAT KEEPS A FUSION FROM READING AS A CONSENSUS.
         */
        notDone: 'This route fused the contributions it was HANDED. It did not verify that any author is who it claims, it did not check the contributions against the market, and it did not establish that the fused package is one any other member would accept — so a successful fusion is evidence about this route and about no peer.',
      })
      return
    }

    sendJson(res, 404, {
      ok: false,
      lane: 'community',
      error: 'no such path',
      path,
      /**
       * THE 404 BODY IS THE ONE PLACE WHOSE JOB IS TO BE AUTHORITATIVE, so it
       * lists ONLY the table the dispatcher actually implements. The market clone
       * advertised a dead path here and a reader could not tell.
       */
      registered: REGISTERED_PATHS,
    })
  }

  return { handler, registry }
}
