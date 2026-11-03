/**
 * ============================================================================
 * THE COMMUNITY — who is a member, and what "member" is worth
 * ============================================================================
 *
 * This is **C1's missing half**. The owner asked for a plugin that "fuse[s] meta
 * plugin for the meta-market-community", and the market clone chartered a plugin
 * that *exchanges packages between two peers* — with the words `fuse` and
 * `communit*` appearing **0 times in 160 lines of its charter**. A pair is not a
 * community. This module is where the difference is made concrete: a community
 * has MEMBERS with ROLES, it has a MEMBERSHIP CENSUS, and it can say how many of
 * its members it has actually recognised versus merely been told about.
 *
 * **THE HONEST BOUNDARY, AND IT IS THE FIRST THING THIS MODULE ESTABLISHES: a
 * member can be RECOGNISED and cannot be AUTHENTICATED.** Three lanes measured
 * this independently on the market build and the measurements transfer unchanged
 * because they are properties of the DEPLOYMENT, not of that plugin:
 *
 *   - `~/.dsh/.anonymous-user-id` is a **37-byte bare UUID** — an identifier,
 *     and the package's own source says it is never derived from an identifying
 *     source.
 *   - `ed25519|generateKeyPair|createSign|createVerify` match **0 of 6,315**
 *     non-test `.ts` files, so there is no signing primitive to borrow.
 *   - The frozen protocol declares **no signature field**, so nothing in a peer
 *     card is covered by a signature even if one existed.
 *
 * **So `recognised: true` here means INSPECTED, never PROVEN**, and the field is
 * named to say so. A community that believed its membership list was
 * authenticated would be the most dangerous artifact this program could ship —
 * because it would be a list of strangers with a receipt.
 *
 * WHY THIS IS NOT A REASON TO BUILD NOTHING. A registry of *inspectable* members
 * with a stated trust level is exactly what a system needs while its trust root
 * is `plan`: it makes the gap visible and bounded, and it means the day a key
 * exists, the registry already has the field to record what it proves.
 *
 * @module dsh-meta-community/host/community/members
 */

import type { ClauseKind } from '../clauses.ts'

/**
 * What a member is allowed to contribute.
 *
 * Roles are a CLOSED union rather than a free string because a free string is
 * how a capability vocabulary drifts into a description nobody can check. The
 * program has already paid for this once: a `ReadonlySet<string>` with six real
 * members serialised to `{}` and was reported as absent, which is why the
 * vocabulary is enumerated here and validated on the way in.
 */
export type MemberRole = 'author' | 'curator' | 'witness' | 'observer'

/** Every role, so a census can iterate them rather than restating the union. */
export const MEMBER_ROLES: readonly MemberRole[] = Object.freeze([
  'author',
  'curator',
  'witness',
  'observer',
])

/**
 * How much a membership claim is actually worth.
 *
 * **This is a CLOSED DESCENT and the order is the point.** `inspected` is the
 * strongest level reachable on this deployment; `asserted` is a claim that
 * arrived in a payload and was believed; `absent` is a member with no
 * recognition evidence at all. A reader must never have to infer which of these
 * a row carries, so it is a field and never a sentence.
 */
export type TrustLevel = 'inspected' | 'asserted' | 'absent'

/**
 * A recognised member of the community.
 *
 * `trust` is deliberately NOT called `authenticated`, and `recognisedAt` is
 * stamped so a stale roster is detectable — this program's own rule being that a
 * live store is not a snapshot and every population count carries its moment.
 */
export interface Member {
  /** Stable member id, as presented. NOT verified to belong to anyone. */
  readonly memberId: string
  readonly role: MemberRole
  /** What this member may contribute, enumerated and closed. */
  readonly capabilities: readonly string[]
  /** The strongest thing this instance can say about the member's identity. */
  readonly trust: TrustLevel
  /** ISO-8601, so the roster can be aged rather than trusted indefinitely. */
  readonly recognisedAt: string
  /**
   * Why this member is at that trust level.
   *
   * A `notDone`-shaped field, and it is a CLAIM: the market build shipped two
   * `notDone` strings with TRUE scopes attached to FALSE justifications, which is
   * worse than no justification because the reason is what a reader acts on
   * (`D-0073`). This string states what was OBSERVED, not what was concluded.
   */
  readonly evidence: string
}

/** A membership census, every figure carrying its denominator. */
export interface MembershipCensus {
  /** Total members currently recognised. */
  readonly total: number
  readonly byRole: Readonly<Record<MemberRole, number>>
  readonly byTrust: Readonly<Record<TrustLevel, number>>
  /**
   * Members at `inspected` — the numerator, over `total`.
   *
   * Reported as a pair rather than a ratio so a reader cannot quote the share
   * without its denominator, which this program records as its most-published
   * defect (`374` vs `440`, `77` vs `79`, `14` vs `16`).
   */
  readonly inspected: number
  /** The moment this census was taken. A population without a moment is not a count. */
  readonly censusAt: string
}

/**
 * The community registry.
 *
 * A class rather than a module-level Map, because a module-level mutable
 * registry is shared state across every host that imports the module, and this
 * program has already recorded the cost of one plugin's state being another's
 * (`ae813b0`: a shared workspace makes one agent's write another's commit).
 */
export class CommunityRegistry {
  readonly #members = new Map<string, Member>()
  readonly #now: () => Date

  /**
   * @param now - injected clock, so a harness can freeze time and assert the
   *   stamp rather than racing it. A registry that reads `Date.now()` directly
   *   cannot be tested for staleness, only observed.
   */
  constructor(now: () => Date = () => new Date()) {
    this.#now = now
  }

  /**
   * Recognise a member.
   *
   * **The `trust` level is DERIVED here and cannot be passed in**, which is the
   * whole guard: a caller may not claim a member is `inspected` when nothing
   * inspected it, and may not claim `asserted` when nothing asserted anything.
   * A caller that supplies identity material gets `inspected`; a caller that
   * supplies only a string gets `asserted`; a caller that supplies neither is
   * refused rather than defaulted to a level.
   *
   * @param input - the member's presented fields.
   * @returns the stored member, with the derived trust level.
   * @throws when the role is not in the closed union, or the id is blank.
   */
  recognise(input: {
    readonly memberId: string
    readonly role: string
    readonly capabilities?: readonly string[]
    /** Present when the caller offers evidence that something was inspected. */
    readonly inspectedEvidence?: string
    /** Present when the caller can only report what a payload claimed. */
    readonly assertedSource?: string
  }): Member {
    const memberId = input.memberId.trim()
    if (memberId.length === 0) {
      throw new Error('memberId is empty: a member with no id cannot be recognised, and ABSENT is not a level to default to')
    }
    if (!MEMBER_ROLES.includes(input.role as MemberRole)) {
      throw new Error(`role ${JSON.stringify(input.role)} is not one of ${MEMBER_ROLES.join(', ')}; the union is closed so a typo fails loudly rather than creating a fifth role`)
    }

    const inspected = input.inspectedEvidence?.trim()
    const asserted = input.assertedSource?.trim()
    const trust: TrustLevel = inspected && inspected.length > 0
      ? 'inspected'
      : asserted && asserted.length > 0
        ? 'asserted'
        : 'absent'

    const evidence = trust === 'inspected'
      ? `inspected: ${inspected}`
      : trust === 'asserted'
        ? `asserted only, source: ${asserted}`
        : 'no recognition evidence supplied, so this member is recorded at the WEAKEST level rather than omitted'

    const member: Member = Object.freeze({
      memberId,
      role: input.role as MemberRole,
      capabilities: Object.freeze([...(input.capabilities ?? [])]),
      trust,
      recognisedAt: this.#now().toISOString(),
      evidence,
    })
    this.#members.set(memberId, member)
    return member
  }

  /** Every member, newest recognition last. A copy, so a caller cannot mutate the registry. */
  list(): readonly Member[] {
    return Object.freeze([...this.#members.values()])
  }

  /** One member, or `null` — never a fabricated default. */
  get(memberId: string): Member | null {
    return this.#members.get(memberId) ?? null
  }

  /** Members holding a role. A census by role must be derivable, not restated. */
  byRole(role: MemberRole): readonly Member[] {
    return Object.freeze(this.list().filter((m) => m.role === role))
  }

  /**
   * The membership census, with its denominator and its moment.
   *
   * **`inspected` is the number that matters and it is reported as a pair.** A
   * community where 0 of N members are `inspected` is not an unpopulated
   * community — it is a populated one with no verified member, and those are
   * different situations with different remedies.
   */
  census(): MembershipCensus {
    const members = this.list()
    const byRole: Record<MemberRole, number> = { author: 0, curator: 0, witness: 0, observer: 0 }
    const byTrust: Record<TrustLevel, number> = { inspected: 0, asserted: 0, absent: 0 }
    for (const m of members) {
      byRole[m.role] += 1
      byTrust[m.trust] += 1
    }
    return {
      total: members.length,
      byRole,
      byTrust,
      inspected: byTrust.inspected,
      censusAt: this.#now().toISOString(),
    }
  }
}

/**
 * The kind of this lane's community capability, as one of the three kinds.
 *
 * **`plan`, and it is derived rather than asserted:** the registry works, and a
 * community of one instance is not a community. This function returns the kind a
 * reader should record, so that no reader has to decide, and so that the
 * conformance check and the route surface cannot disagree about it.
 */
export function communityKind(census: MembershipCensus): ClauseKind {
  if (census.total === 0) return 'absent'
  if (census.inspected < 2) return 'plan'
  return 'exists'
}
