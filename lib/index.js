//#region src/host/community/members.ts
/** Every role, so a census can iterate them rather than restating the union. */
const MEMBER_ROLES = Object.freeze([
	"author",
	"curator",
	"witness",
	"observer"
]);
/**
* The community registry.
*
* A class rather than a module-level Map, because a module-level mutable
* registry is shared state across every host that imports the module, and this
* program has already recorded the cost of one plugin's state being another's
* (`ae813b0`: a shared workspace makes one agent's write another's commit).
*/
var CommunityRegistry = class {
	#members = /* @__PURE__ */ new Map();
	#now;
	/**
	* @param now - injected clock, so a harness can freeze time and assert the
	*   stamp rather than racing it. A registry that reads `Date.now()` directly
	*   cannot be tested for staleness, only observed.
	*/
	constructor(now = () => /* @__PURE__ */ new Date()) {
		this.#now = now;
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
	recognise(input) {
		const memberId = input.memberId.trim();
		if (memberId.length === 0) throw new Error("memberId is empty: a member with no id cannot be recognised, and ABSENT is not a level to default to");
		if (!MEMBER_ROLES.includes(input.role)) throw new Error(`role ${JSON.stringify(input.role)} is not one of ${MEMBER_ROLES.join(", ")}; the union is closed so a typo fails loudly rather than creating a fifth role`);
		const inspected = input.inspectedEvidence?.trim();
		const asserted = input.assertedSource?.trim();
		const trust = inspected && inspected.length > 0 ? "inspected" : asserted && asserted.length > 0 ? "asserted" : "absent";
		const evidence = trust === "inspected" ? `inspected: ${inspected}` : trust === "asserted" ? `asserted only, source: ${asserted}` : "no recognition evidence supplied, so this member is recorded at the WEAKEST level rather than omitted";
		const member = Object.freeze({
			memberId,
			role: input.role,
			capabilities: Object.freeze([...input.capabilities ?? []]),
			trust,
			recognisedAt: this.#now().toISOString(),
			evidence
		});
		this.#members.set(memberId, member);
		return member;
	}
	/** Every member, newest recognition last. A copy, so a caller cannot mutate the registry. */
	list() {
		return Object.freeze([...this.#members.values()]);
	}
	/** One member, or `null` — never a fabricated default. */
	get(memberId) {
		return this.#members.get(memberId) ?? null;
	}
	/** Members holding a role. A census by role must be derivable, not restated. */
	byRole(role) {
		return Object.freeze(this.list().filter((m) => m.role === role));
	}
	/**
	* The membership census, with its denominator and its moment.
	*
	* **`inspected` is the number that matters and it is reported as a pair.** A
	* community where 0 of N members are `inspected` is not an unpopulated
	* community — it is a populated one with no verified member, and those are
	* different situations with different remedies.
	*/
	census() {
		const members = this.list();
		const byRole = {
			author: 0,
			curator: 0,
			witness: 0,
			observer: 0
		};
		const byTrust = {
			inspected: 0,
			asserted: 0,
			absent: 0
		};
		for (const m of members) {
			byRole[m.role] += 1;
			byTrust[m.trust] += 1;
		}
		return {
			total: members.length,
			byRole,
			byTrust,
			inspected: byTrust.inspected,
			censusAt: this.#now().toISOString()
		};
	}
};
/**
* The kind of this lane's community capability, as one of the three kinds.
*
* **`plan`, and it is derived rather than asserted:** the registry works, and a
* community of one instance is not a community. This function returns the kind a
* reader should record, so that no reader has to decide, and so that the
* conformance check and the route surface cannot disagree about it.
*/
function communityKind(census) {
	if (census.total === 0) return "absent";
	if (census.inspected < 2) return "plan";
	return "exists";
}
//#endregion
//#region src/host/community/fusion.ts
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
function fusePackages(contributions, communitySize, now = () => /* @__PURE__ */ new Date()) {
	const byField = /* @__PURE__ */ new Map();
	for (const c of contributions) for (const [field, value] of Object.entries(c.fields)) {
		const existing = byField.get(field);
		if (existing === void 0) {
			byField.set(field, {
				value,
				suppliers: [c.authorId],
				conflicted: false
			});
			continue;
		}
		if (JSON.stringify(existing.value) === JSON.stringify(value)) existing.suppliers.push(c.authorId);
		else {
			existing.value = value;
			existing.suppliers.push(c.authorId);
			existing.conflicted = true;
		}
	}
	const fields = [...byField.entries()].map(([field, v]) => Object.freeze({
		field,
		value: v.value,
		suppliedBy: Object.freeze([...v.suppliers]),
		conflicted: v.conflicted
	})).sort((a, b) => a.field < b.field ? -1 : a.field > b.field ? 1 : 0);
	return {
		fields: Object.freeze(fields),
		contributionsIn: contributions.length,
		fieldsAgreed: fields.filter((f) => !f.conflicted).length,
		fieldsConflicted: fields.filter((f) => f.conflicted).length,
		communitySize,
		fusedAt: now().toISOString()
	};
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
function revisionStanding(authorIds) {
	const distinct = new Set(authorIds.map((a) => a.trim()).filter((a) => a.length > 0));
	return {
		distinctAuthors: distinct.size,
		shape: distinct.size >= 2 ? "multi-author" : "single-author",
		provenanceVerified: false,
		provenanceReason: "This deployment holds an identifier and no key: the signer search over every non-test .ts file returns 0, the frozen protocol declares no signature field, and the market lane measured that the comparison binding an author id to a peer card is DECLARED AND UNEXPRESSIBLE at that signature. So distinct author ids are distinct STRINGS and nothing more, and a second author is indistinguishable from the first author typing a different string."
	};
}
//#endregion
//#region src/host/clauses.ts
/**
* The five clauses, with this plugin's own honest self-assessment.
*
* **`kind` here describes THIS PLUGIN's fidelity, not the world's.** A reader
* wanting to know whether some other artifact satisfies a clause must go and
* measure that artifact; this array is this clone's own claim and is falsifiable
* against it.
*/
const OWNER_CLAUSES = Object.freeze([
	Object.freeze({
		id: "C1",
		verbatim: "fuse meta plugin for the meta-market-community",
		requires: "One plugin that FUSES the market into a community, rather than one that only exchanges packages between two peers.",
		kind: "plan",
		artifact: "GET /meta-community/api/census",
		falsifier: "If the community surface reports zero recognised members while at least one peer card is locally present, the fusion half is not implemented and this clause drops to `absent`.",
		shortfall: "The community REGISTRY and the fusion operation exist here; the participants do not. A community of one is the honest current state, and this clause stays `plan` until a second authenticated member exists — which C4 currently prevents."
	}),
	Object.freeze({
		id: "C2",
		verbatim: "It shall basically give the capabilities for system where intent of user is already formed and the other meta plugins are established",
		requires: "BOTH preconditions of the target system: a formed user intent, AND other meta plugins already established.",
		kind: "absent",
		artifact: null,
		falsifier: "A formed user intent existing anywhere on this deployment, or two or more `dsh-meta-*` plugins besides this one and `dsh-meta-market`, would move this clause off `absent`.",
		shortfall: "BOTH preconditions are FALSE and this is the most load-bearing thing this clone knows. (a) The intent map is a map of the PLUGIN MARKET, not of a user: its 24 vectors are keyed to ZONE ids, it holds no userId/sessionId, its `owner` fields name 565 plugin AUTHORS, and the only user-shaped file is `.anonymous-user-id` — anonymous by its own name. **The clause fails on the word USER, not on FORMED: the map IS formed, and it is nobody's.** (b) \"The other meta plugins are established\" is SELF-REFERENTIAL as written — it asks the system to already contain the thing being built; a scoped census finds exactly 1 `dsh-meta-*` clone apart from this one and it is the market plugin, against a denominator of 28 clones. **This clause has NO ARTIFACT because there is nothing here to check: it is a precondition, not a capability, and it is unmet.**"
	}),
	Object.freeze({
		id: "C3",
		verbatim: "To talk to other systems that belongs to the other users and align the meta packages with universal intent map, cordis hard way and following philosophy of whole project",
		requires: "Talk to OTHER users' systems, align packages to a UNIVERSAL intent map, build the Cordis hard way, and follow the whole project's philosophy.",
		kind: "plan",
		artifact: null,
		falsifier: "A single recorded exchange with a peer that is not a process spawned by this same harness, or an intent map whose vectors are embedded from a corpus larger than one catalog snapshot, would move this clause off `plan`.",
		shortfall: "Four halves, each measured elsewhere and each short. \"Talk to other systems\": **NO peer has ever been contacted** — `peersContacted` was `{count: 0, of: 0}`, zero BY CONSTRUCTION, and no inbound dialogue route exists anywhere. \"Universal\": the map is LOCAL — 4,527 catalog rows -> 688 in scope -> 24 zones, and since only 24 strings were ever embedded, **98.5% of the catalog is unreachable** by similarity to it. \"Cordis hard way\": held (0 matches for cuda/nvidia/torch/device/gpu and 0 for any device acquisition in the market clone). \"Philosophy of whole project\": **carried by this file as C5 does not carry it in the market clone — it has no instrument there at all.** **AND THIS CLAUSE HAS NO ARTIFACT, WHICH IS A CORRECTION RATHER THAN AN OMISSION:** it first cited the conformance route, and that was wrong twice — the path carried a `/meta-market-` prefix this clone does not serve, and the route it named is C5's instrument rather than C3's. **No route in this clone can observe another system, because no route in this clone admits a peer**, so there is nothing here to point at and `null` says so."
	}),
	Object.freeze({
		id: "C4",
		verbatim: "Also there will be inter system \"social network of web4\" that allows 2 or more system initiate safely dialoges and manage the total system aligment between of big base of users to aligned intent zones/maps and meta-plugins will be \"decentralized\" way developed, users can receive patches, revise the meta-market and etc",
		requires: "A social network of 2+ systems, safe dialogues, TOTAL alignment management across a BIG BASE of users, DECENTRALIZED development, and the ability for users to receive patches AND REVISE the meta-market.",
		kind: "plan",
		artifact: "GET /meta-community/api/members",
		falsifier: "A second authenticated author — an author whose patch is distinguishable from the first author typing a different string — would move the decentralization half to `exists`. It cannot move while the deployment holds an identifier and no key.",
		shortfall: "THE CENTRAL CLAUSE OF THIS CLONE, AND THE ONE THE MARKET BUILD MEASURABLY FAILED. **`decentralized` appears 0 times in the market CHARTER and 0 `.md` files outside `context/`**, and its authoring model is one-owner-per-path plus a single-proposer patch proposal — which is DISTRIBUTION, and **distribution with one proposer is the opposite of decentralized development.** This clone carries the word AND a mechanism; the mechanism is `src/host/authors/`, and it does not work here for a reason that is measured rather than assumed: **the market lane proved that `from === card.instanceId` is declared at `gate.ts:131` and implemented NOWHERE**, so `from` is checked for non-emptiness only and `literally-any-string` is accepted. **A second author is indistinguishable from the first author typing a different string.** Also short: \"big base of users\" is unreachable at this capacity (100,000 peers needs 4.31 h to witness once against a 60 s round); \"manage the TOTAL alignment\" has **no object at all** — no aggregate over peers exists anywhere; and `revise the meta-market` had no route."
	}),
	Object.freeze({
		id: "C5",
		verbatim: "Run the agent team of 10 and actively orchestrate them to verify intent of that message was really passed and executed",
		requires: "A team running, AND — the half that matters — that the intent of the message was VERIFIED to have been passed and executed.",
		kind: "exists",
		artifact: "GET /meta-community/api/clauses/conformance",
		falsifier: "A clause in this array with an empty `falsifier`, or a clause whose `artifact` names a route that returns 404, would turn the conformance check RED — which is what makes this clause's instrument real rather than asserted.",
		shortfall: "The verification HALF is now real here and was absent there: **C5 was the only one of the five clauses with ZERO artifacts in the market build, and its absence is exactly what let C1's fusion and C4's decentralization reach a sealed charter unremarked.** The team-size half is NOT met and is not met by this file: the owner wrote \"the agent team of 10\" and the market CHARTER's own §6 lists NINE lanes. This clone cannot fix a lane count by asserting one."
	})
]);
/**
* The owner's directive, VERBATIM, as one string.
*
* Reproduced with the owner's original spelling (`dialoges`, `aligment`) and
* original line breaks, because **a faithful quotation is the point**. A reader
* comparing this against the program workspace's copy at
* `research/owner-directive-verbatim.md` should find them equal; the conformance
* check reports the comparison as a fact rather than assuming it.
*/
const OWNER_DIRECTIVE_VERBATIM = [
	"fuse meta plugin for the meta-market-community;",
	"It shall basically give the capabilities for system where intent of user is already formed and the other meta plugins are established;",
	"To talk to other systems that belongs to the other users and align the meta packages with universal intent map, cordis hard way and following philosophy of whole project;",
	"Also there will be inter system \"social network of web4\" that allows 2 or more system initiate safely dialoges and manage the total system aligment between of big base of users to aligned intent zones/maps and meta-plugins will be \"decentralized\" way developed, users can receive patches, revise the meta-market and etc;",
	"Run the agent team of 10 and actively orchestrate them to verify intent of that message was really passed and executed;"
].join("\n");
/**
* Count the clauses. **Every figure carries its denominator, and the census is STAMPED.**
*
* `withoutFalsifier` and `unreachableArtifacts` are reported rather than thrown
* because a file defect and a world defect are different things: both are defects
* in THIS array, and the conformance check turns them RED, but a reader asking "how
* faithful is this clone?" should still get a census rather than an exception.
*
* @param registeredPaths - the routes this clone actually serves. Passed in rather
*   than imported so the two cannot agree by sharing a wrong constant: a caller
*   that hands over a path this file also believes makes the check circular.
* @param now - injected clock, so a harness can freeze it and assert the stamp.
*/
function clauseCensus(registeredPaths = [], now = () => /* @__PURE__ */ new Date()) {
	const byKind = {
		exists: 0,
		plan: 0,
		absent: 0
	};
	let withArtifact = 0;
	let withoutFalsifier = 0;
	let unreachableArtifacts = 0;
	for (const c of OWNER_CLAUSES) {
		byKind[c.kind] += 1;
		if (c.artifact !== null && c.artifact.length > 0) {
			withArtifact += 1;
			/**
			* THE ARTIFACT IS EXTRACTED FROM ITS OWN PROSE AND LOOKED UP, so a clause
			* cannot cite a route that was never registered. `null` (no artifact) is not
			* counted here — that is `withArtifact`'s job, and conflating them would let
			* a missing artifact read as a broken one.
			*/
			const cited = c.artifact.split(" ").find((t) => t.startsWith("/"));
			if (cited !== void 0 && registeredPaths.length > 0 && !registeredPaths.includes(cited)) unreachableArtifacts += 1;
		}
		if (c.falsifier.trim().length === 0) withoutFalsifier += 1;
	}
	return {
		total: OWNER_CLAUSES.length,
		byKind,
		withArtifact,
		withoutFalsifier,
		unreachableArtifacts,
		censusAt: now().toISOString()
	};
}
//#endregion
//#region src/host/routes.ts
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
/** The prefix this plugin owns, mounted under the host's own web root. */
const PREFIX = "/meta-community/api";
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
const REGISTERED_PATHS = Object.freeze([
	`${PREFIX}/members`,
	`${PREFIX}/census`,
	`${PREFIX}/fuse`,
	`${PREFIX}/standing`,
	`${PREFIX}/clauses`,
	`${PREFIX}/clauses/conformance`,
	`${PREFIX}/standing/relabel`
]);
/** Build the one registry this instance serves from. */
function seedRegistry() {
	const registry = new CommunityRegistry();
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
		memberId: "local-instance",
		role: "author",
		capabilities: [
			"fuse",
			"recognise",
			"publish-standing"
		],
		inspectedEvidence: "this host process is executing this handler, so the member exists and is not claimed by a payload"
	});
	return registry;
}
/**
* The surface's honest account of what does not exist.
*
* Read `noCommunity` first: it is the clause C1 turns on, and it is the reason
* this plugin is `plan` rather than `exists` no matter how well its own code
* works.
*/
function describeSurface() {
	return {
		lane: "community",
		prefix: PREFIX,
		/**
		* THE ASSEMBLY REPORT, AND EACH FIELD IS A CLAIM ABOUT THE WHOLE PROGRAM.
		* Every one of these is scoped to an artifact this lane MEASURED, because the
		* market build's defect (`D-0073`) was a scope-true sentence carrying a
		* program-wide justification.
		*/
		notServed: "THIS FIELD DESCRIBES IN-PROCESS ROUTABILITY, NOT MOUNT STATE — CORRECTED 2026-10-18 BECAUSE THE HARDCODED VERSION BECAME FALSE. It previously read, verbatim: \"THIS SURFACE IS ROUTABLE AND IS NOT SERVED. The plugin is built and its handler is reachable in-process, but no host has mounted it: the live 3083 answers 404 on every path below, and this clone appears in no profile dependency list.\" Every clause of that was true when written and INVERTED once the surface was mounted: the live 3083 now answers 200/405 on all 7 registered paths (pre-mount 0/7, post-mount 7/7, censused 2026-10-18T16:47:29Z) and the clone is a declared dependency with a materialised module link. A sentence frozen into an artifact cannot track a mount, so it told a reader the opposite of the running system — the `D-0073` shape, a scope statement carrying a justification that had expired. This field therefore no longer asserts mount state: it can state what THIS PROCESS contains, and MOUNT STATE must be measured by probing the host, never read from a string baked in at build time.",
		noCommunity: "THE COMMUNITY HAS ONE MEMBER AND IT IS THIS INSTANCE — BUT THE \"NO SECOND CLONE\" CLAUSE THAT STOOD HERE WAS FALSE AND IS CORRECTED. It read: \"This lane found no second `dsh-meta-*` clone with a `src/` tree\". Measured 2026-10-18: there are FOUR `dsh-meta-*` clones with `src/` trees (market, evolve, research, community) — so the search that produced that sentence either did not run or ran against the wrong root, and a reader was told a clone census that the filesystem contradicts. What remains TRUE and is what this field is actually for: no route on this surface admits a peer, because members are recognised by a LOCAL call, so a census here counts what this process was told and not who exists elsewhere. A community of one is not a community, which is why this lane reports `plan`.",
		noDecentralizedProvenance: "AUTHORSHIP IS DECENTRALISED IN SHAPE AND NOT IN PROVENANCE. `revisionStanding` counts DISTINCT AUTHOR STRINGS and reports `provenanceVerified: false` beside it, because this deployment has no keypair, the frozen protocol declares no signature field, and the market lane measured that the comparison binding an author to a peer card is DECLARED AND UNEXPRESSIBLE at that signature. A second author here is indistinguishable from the first author typing a different string.",
		noUniversalMap: "THIS LANE ALIGNS TO NO MAP. It reads the intent map nowhere and holds no vectors, so the owner's phrase \"universal intent map\" is not addressed by this surface at all — the market clone carries that clause and measured that the map covers 24 zone DEFINITIONS and says nothing about the market. Stated here so that a reader does not infer alignment from this plugin's name.",
		specVersion: 1
	};
}
/** A membership census with the kind it implies, so the two cannot disagree. */
function describeCensus(registry) {
	const census = registry.census();
	return {
		lane: "community",
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
		caveat: "inspected is reported as a numerator over total. A census where inspected is 0 of N is NOT an unpopulated community: it is a populated community with no verified member, and those need different repairs."
	};
}
/** Read and parse a JSON request body, with a size ceiling so a body cannot be unbounded. */
async function readBody(req) {
	const MAX = 1048576;
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		const buf = chunk;
		size += buf.length;
		if (size > MAX) throw new Error(`request body exceeds ${MAX} bytes`);
		chunks.push(buf);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	if (text.trim().length === 0) return null;
	return JSON.parse(text);
}
/** Send a JSON response. */
function sendJson(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
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
function buildHandler() {
	const registry = seedRegistry();
	const handler = async (req, res) => {
		const path = new URL(req.url ?? "/", "http://localhost").pathname;
		if (path === "/meta-community/api" || path === `/meta-community/api/`) {
			sendJson(res, 200, {
				ok: true,
				assembly: describeSurface(),
				lane: "community"
			});
			return;
		}
		if (path === `/meta-community/api/members`) {
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				members: registry.list(),
				total: registry.list().length,
				/**
				* A `GET` cannot recognise a member, and saying so is the point: this
				* surface has NO peer-administered path, so a reader must not read the
				* member list as evidence about anyone but this process.
				*/
				notDone: "This surface lists members THIS PROCESS WAS TOLD ABOUT. No route admits a peer card, so an empty or short list is an absence of LOCAL recognitions and never evidence that no peer exists."
			});
			return;
		}
		if (path === `/meta-community/api/census`) {
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				...describeCensus(registry),
				notDone: "This census counts members recognised in THIS PROCESS since it started, and the registry is in-memory: a restart returns it to the seeded member. It is not a count of the community."
			});
			return;
		}
		if (path === `/meta-community/api/standing`) {
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				standing: revisionStanding(["local-instance"]),
				notDone: "The standing this route reports is a statement about AUTHOR STRINGS in the revisions it was handed. It cannot verify an author, and it does not claim to."
			});
			return;
		}
		if (path === `/meta-community/api/clauses`) {
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				directive: OWNER_DIRECTIVE_VERBATIM,
				clauses: OWNER_CLAUSES,
				census: clauseCensus(REGISTERED_PATHS),
				notDone: "The census above grades WHAT THIS CLONE CARRIES, not what the program has achieved. A clause at `exists` here means an artifact in this tree implements it, and that is all it means."
			});
			return;
		}
		if (path === `/meta-community/api/clauses/conformance`) {
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
			const census = clauseCensus(REGISTERED_PATHS);
			const selfTest = clauseCensus(["/only/one/path/that/does/not/match"]);
			sendJson(res, 200, {
				ok: census.withoutFalsifier === 0 && census.unreachableArtifacts === 0,
				lane: "community",
				census,
				verdict: census.withoutFalsifier === 0 && census.unreachableArtifacts === 0 ? "conformant" : "nonconformant",
				/**
				* THE POSITIVE CONTROL, RUN ON EVERY REQUEST. A census taken against a path
				* table containing only a path nothing cites MUST report a non-zero
				* `unreachableArtifacts`; if it reports 0, the check is blind and this field
				* says so rather than letting a green verdict stand.
				*/
				selfTest: {
					unreachableWhenTableIsWrong: selfTest.unreachableArtifacts,
					checkCanFail: selfTest.unreachableArtifacts > 0
				},
				notDone: "This checks that every clause CITES a registered route, and that every clause carries a falsifier. It does NOT check that a cited artifact MEASURES the thing the clause requires — a route can exist and be irrelevant to its clause, and no instrument in this clone can tell."
			});
			return;
		}
		if (path === `/meta-community/api/standing/relabel`) {
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
			if (req.method !== "POST") {
				sendJson(res, 405, {
					ok: false,
					lane: "community",
					error: "relabel is POST-only: the control needs the author set it is to stand for",
					method: req.method ?? null
				});
				return;
			}
			let payload;
			try {
				payload = await readBody(req);
			} catch (err) {
				sendJson(res, 400, {
					ok: false,
					lane: "community",
					error: err instanceof Error ? err.message : String(err)
				});
				return;
			}
			const authorIds = payload?.authorIds;
			if (!Array.isArray(authorIds) || authorIds.length === 0) {
				sendJson(res, 400, {
					ok: false,
					lane: "community",
					error: "authorIds must be a non-empty array of strings; a standing over no authors is refused rather than defaulted."
				});
				return;
			}
			const standing = revisionStanding(authorIds);
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				standing,
				/**
				* THE PAIR, STATED SO THE CONTROL CANNOT BE MISREAD AS SUCCESS. The shape
				* CHANGED with the input; the provenance verdict did not, and could not.
				*/
				observed: `shape moved to ${standing.shape} for ${standing.distinctAuthors} distinct author string(s), while provenanceVerified stayed ${standing.provenanceVerified} — the same value it holds for ONE author. So the input moved the LABEL and not the GUARANTEE.`,
				notDone: "This route cannot authenticate a single author, so the multi-author shape it can be driven to is a statement about STRINGS. It is the honest ceiling of this deployment and not a defect in this route."
			});
			return;
		}
		if (path === `/meta-community/api/fuse`) {
			if (req.method !== "POST") {
				sendJson(res, 405, {
					ok: false,
					lane: "community",
					error: "fuse is POST-only: a fusion needs contributions in a body",
					method: req.method ?? null
				});
				return;
			}
			let payload;
			try {
				payload = await readBody(req);
			} catch (err) {
				sendJson(res, 400, {
					ok: false,
					lane: "community",
					error: err instanceof Error ? err.message : String(err)
				});
				return;
			}
			const contributions = payload?.contributions;
			if (!Array.isArray(contributions) || contributions.length === 0) {
				sendJson(res, 400, {
					ok: false,
					lane: "community",
					error: "contributions must be a non-empty array; a fusion of nothing is refused rather than returned as an empty package, because absent is not zero."
				});
				return;
			}
			sendJson(res, 200, {
				ok: true,
				lane: "community",
				fusion: fusePackages(contributions, registry.census().total),
				/**
				* THE STRING THAT KEEPS A FUSION FROM READING AS A CONSENSUS.
				*/
				notDone: "This route fused the contributions it was HANDED. It did not verify that any author is who it claims, it did not check the contributions against the market, and it did not establish that the fused package is one any other member would accept — so a successful fusion is evidence about this route and about no peer."
			});
			return;
		}
		sendJson(res, 404, {
			ok: false,
			lane: "community",
			error: "no such path",
			path,
			/**
			* THE 404 BODY IS THE ONE PLACE WHOSE JOB IS TO BE AUTHORITATIVE, so it
			* lists ONLY the table the dispatcher actually implements. The market clone
			* advertised a dead path here and a reader could not tell.
			*/
			registered: REGISTERED_PATHS
		});
	};
	return {
		handler,
		registry
	};
}
//#endregion
//#region src/host/index.ts
/** The plugin name the host records. */
const name = "dsh-meta-community";
/**
* The host services this plugin requires before `apply` runs.
*
* Declared as an injection rather than read off the context defensively, so a
* host without a web server refuses the plugin at load instead of mounting a
* surface whose handler would throw on first request.
*/
const inject = ["webServer"];
/**
* Mount the community surface.
*
* One registration owns the whole `PREFIX` subtree, which is what lets the
* dispatcher in `routes.ts` route several sub-paths without several registrations
* competing for the same prefix.
*
* @param ctx - the slice of the host context this plugin consumes.
*/
function apply(ctx) {
	ctx.logger.info(`[${name}] mounting community surface at ${PREFIX} (${REGISTERED_PATHS.length} advertised paths)`);
	const { handler, registry } = buildHandler();
	const census = registry.census();
	/**
	* THE REGISTRATION TIME LOG NAMES THE KIND, so a host operator reading boot
	* output is told what they mounted rather than only that something mounted. A
	* single-member community and a populated one print differently, and neither
	* prints a bare `ok`.
	*/
	ctx.logger.info(`[${name}] community census at mount: ${census.inspected} inspected of ${census.total} total` + (census.total < 2 ? " — a community of one is not a community, so this surface reports `plan`" : ""));
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: PREFIX,
		handler
	}), `${name}:community-surface`);
}
//#endregion
export { apply, inject, name };
