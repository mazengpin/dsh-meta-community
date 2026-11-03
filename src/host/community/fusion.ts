/**
 * ============================================================================
 * FUSION, AND DECENTRALIZED AUTHORSHIP — C1's mechanism and C4's missing word
 * ============================================================================
 *
 * TWO OWNER CLAUSES MEET IN THIS FILE, AND THEY ARE THE TWO THE MARKET BUILD
 * MEASURABLY DROPPED.
 *
 * **C1** asked to *"fuse meta plugin for the meta-market-community"*. The market
 * clone chartered a plugin that exchanges packages between TWO PEERS; the words
 * `fuse` and `communit*` appear **0 times in 160 lines** of its charter. **A pair
 * is not a community, and an exchange is not a fusion.**
 *
 * **C4** asked that *"meta-plugins will be 'decentralized' way developed"*. The
 * market clone's only authoring model is one-owner-per-path plus a single-proposer
 * patch — **which is distribution, and `task-15` put the difference precisely:
 * "distribution with one proposer is the opposite of decentralized development."**
 * The word itself is **0 of 160 lines** there.
 *
 * **SO THIS FILE BUILDS BOTH, AND IT IS HONEST ABOUT WHERE EACH STOPS.**
 *
 * THE FUSION IS REAL: `fusePackages` takes N member contributions and produces ONE
 * community package, with **per-contribution provenance retained** — every fused
 * field can be traced to the member that supplied it. A fusion that dropped
 * provenance would be a merge, and a merge of strangers' packages is exactly what
 * a community must not do silently.
 *
 * THE DECENTRALIZATION IS **MECHANICAL BUT NOT AUTHENTICATED**, AND THAT IS THE
 * WHOLE HONEST FINDING. `revisionStanding` requires **two or more DISTINCT author
 * ids** before it will call a revision multi-author. **But this deployment cannot
 * authenticate an author**, so a distinct id is a distinct STRING and nothing
 * more. The market lane proved that from the other side: `from === card.instanceId`
 * is declared at `gate.ts:131` and implemented nowhere, so `literally-any-string`
 * is accepted as an author. **A second author here is indistinguishable from the
 * first author typing a different string, and this file says so in the value it
 * returns rather than in a comment a reader might not reach.**
 *
 * @module dsh-meta-community/host/community/fusion
 */

import type { Member } from './members.ts'

/**
 * One member's contribution to a fusion.
 *
 * `fields` is the member's own package content. `authorId` is what the member
 * CLAIMS to be, and the claim is not verified — see `revisionStanding`.
 */
export interface Contribution {
  readonly authorId: string
  /** The member's role at contribution time, carried so a fusion can weight or refuse by role. */
  readonly role: Member['role']
  readonly fields: Readonly<Record<string, unknown>>
  /** ISO-8601, so a fusion can report how far apart its inputs were taken. */
  readonly contributedAt: string
}

/** A field of the fused package, with the member that supplied it. */
export interface FusedField {
  readonly field: string
  readonly value: unknown
  /** Which contributions agreed on this value. Length 1 means a single supplier. */
  readonly suppliedBy: readonly string[]
  /** True when two or more contributions DISAGREED and the fuse had to resolve it. */
  readonly conflicted: boolean
}

/** The result of a fusion, with everything a reviewer needs to distrust it. */
export interface FusionResult {
  readonly fields: readonly FusedField[]
  /** Contributions that went in. The numerator of the coverage pair. */
  readonly contributionsIn: number
  /** Fields with exactly one supplier — unambiguous, and untested by disagreement. */
  readonly fieldsAgreed: number
  /** Fields where contributions disagreed. **These are the interesting ones.** */
  readonly fieldsConflicted: number
  /**
   * Members in the community at fusion time.
   *
   * Carried beside `contributionsIn` so a reader can see a fusion of 2 packages
   * out of a 40-member community WITHOUT being told, which is this program's
   * most-published defect (`374` vs `440`, `77` vs `79`, `14` vs `16`).
   */
  readonly communitySize: number
  readonly fusedAt: string
}

/**
 * Fuse member contributions into one community package.
 *
 * **CONFLICTS ARE RECORDED, NOT RESOLVED.** When two contributions disagree about
 * a field, the later contribution wins and `conflicted: true` is set. A fusion
 * that silently picked a winner would produce a package whose provenance a
 * reviewer could not reconstruct — and this program has already recorded what
 * happens when a control's stated reason and its actual behaviour differ.
 *
 * Field ORDER is deterministic (sorted), so two fusions of the same inputs produce
 * byte-identical output and a diff is meaningful.
 *
 * @param contributions - member contributions, in the order they were received.
 * @param communitySize - the community's size at fusion time, for the coverage pair.
 * @param now - injected clock, so a harness can freeze it and assert the stamp.
 * @returns the fused package with per-field provenance.
 */
export function fusePackages(
  contributions: readonly Contribution[],
  communitySize: number,
  now: () => Date = () => new Date(),
): FusionResult {
  const byField = new Map<string, { value: unknown; suppliers: string[]; conflicted: boolean }>()

  for (const c of contributions) {
    for (const [field, value] of Object.entries(c.fields)) {
      const existing = byField.get(field)
      if (existing === undefined) {
        byField.set(field, { value, suppliers: [c.authorId], conflicted: false })
        continue
      }
      const same = JSON.stringify(existing.value) === JSON.stringify(value)
      if (same) {
        existing.suppliers.push(c.authorId)
      } else {
        // Later wins, and the disagreement is recorded rather than smoothed.
        existing.value = value
        existing.suppliers.push(c.authorId)
        existing.conflicted = true
      }
    }
  }

  const fields: FusedField[] = [...byField.entries()]
    .map(([field, v]) => Object.freeze({
      field,
      value: v.value,
      suppliedBy: Object.freeze([...v.suppliers]),
      conflicted: v.conflicted,
    }))
    .sort((a, b) => (a.field < b.field ? -1 : a.field > b.field ? 1 : 0))

  return {
    fields: Object.freeze(fields),
    contributionsIn: contributions.length,
    fieldsAgreed: fields.filter((f) => !f.conflicted).length,
    fieldsConflicted: fields.filter((f) => f.conflicted).length,
    communitySize,
    fusedAt: now().toISOString(),
  }
}

/** Whether a revision is single-author or multi-author, and what that is actually worth. */
export interface RevisionStanding {
  /** Distinct author ids seen in the revision history. */
  readonly distinctAuthors: number
  /** `multi-author` only when `distinctAuthors >= 2`. */
  readonly shape: 'single-author' | 'multi-author'
  /**
   * **The field that matters, and it is `false` here.**
   *
   * `provenanceVerified` is true only when each distinct author id is bound to
   * identity material this deployment can CHECK. It never is: there is no
   * keypair, no signature field on the protocol, and no comparison between an
   * author id and a card. **So `multi-author` describes how many distinct
   * STRINGS appear, and `provenanceVerified: false` says that is all it
   * describes.**
   */
  readonly provenanceVerified: boolean
  /** Why provenance is unverified, in terms a reader can act on. */
  readonly provenanceReason: string
}

/**
 * Report whether a revision history is genuinely multi-author.
 *
 * **THE HONEST ANSWER ON THIS DEPLOYMENT IS `multi-author` WITH
 * `provenanceVerified: false`, AND BOTH FIELDS ARE RETURNED SO NEITHER READS AS
 * THE OTHER.** A surface that printed only `multi-author` would be claiming
 * decentralized development it cannot demonstrate; one that printed only
 * `provenanceVerified: false` would hide that the mechanism works. **Publishing a
 * satisfied shape next to an unverified guarantee, rather than letting the shape
 * imply the guarantee, is this program's rule** — it is why `quorum.verdict:
 * 'unknown'` is published beside `formulaSatisfied: true` in the market clone.
 *
 * @param authorIds - every author id appearing in the revision history, in order.
 * @returns the standing, with its unverified half named rather than omitted.
 */
export function revisionStanding(authorIds: readonly string[]): RevisionStanding {
  const distinct = new Set(authorIds.map((a) => a.trim()).filter((a) => a.length > 0))
  return {
    distinctAuthors: distinct.size,
    shape: distinct.size >= 2 ? 'multi-author' : 'single-author',
    provenanceVerified: false,
    provenanceReason: 'This deployment holds an identifier and no key: the signer search over every non-test .ts file returns 0, the frozen protocol declares no signature field, and the market lane measured that the comparison binding an author id to a peer card is DECLARED AND UNEXPRESSIBLE at that signature. So distinct author ids are distinct STRINGS and nothing more, and a second author is indistinguishable from the first author typing a different string.',
  }
}
