# Research — forming a community around meta plugins

**Gate.** This package is outside the public pre-release; its repository is private and nothing here is published. The decision record behind the gate is withheld.

## 1. What a member must publish to be recognisable

A member of a community is recognisable by an artifact, not by an account: a package name, a version, a capability table with citations, a disclosure of what it does not do, and a **stable route prefix**. Identity beyond that is a name string — and the honest statement is that **author authentication does not exist yet**, so a name is a claim and not a credential.

## 2. The two channels that actually exist

| Channel | The unit | What it is good for | What it is not |
|---|---|---|---|
| a git remote | a commit | the artifact and its history, reviewable line by line | not an announcement |
| a chat or document channel | a message | the decision and the announcement, with a link to the commit | not a release |

**A chat message is not a release and a release is not an announcement.** Keeping the two apart is what stops a community's history from living in a channel that scrolls.

## 3. The review loop

1. An intent is stated: one sentence about what the package should do.
2. A candidate is built and its own harness is run.
3. The capability census is published beside the artifact.
4. A peer comments on the artifact, not on the summary of it.
5. The candidate merges, or its author withdraws it.

A reviewer must be able to check every claim **without trusting the author** — that is the property the citations and the disclosure exist to provide.

## 4. Curation: how a plugin becomes a selected stable candidate

The criteria are published, mechanical, and each carries the command that decides it: own harness green, no weakened assertion, a falsifier proven to go RED, the complete reader set, a clean sanitized tree and a pinned publish tag. A candidate with a disclosed gap can be selected; a candidate with a hidden one cannot. One worked definition lives in the intent package's `research-stable-candidate.md`.

## 5. What is gated, and why the gate is stated rather than hidden

- No Web3 layer is published; that material is gated and its repositories private.
- No peer fleet beyond one machine has been exercised.
- No token economics, no incentive design, no valuation.

A community that hides what it gates teaches its members that absence is indistinguishable from success — the exact failure this family of packages exists to prevent.

## 6. Next measurement

Two members publish one package each through the loop in §3, in one run, and the run records: which step each reached, what each harness printed, and whether a peer could reproduce the census without the author's machine. The falsifier: if the census cannot be reproduced from the artifact alone, the community is trusting authors rather than artifacts.
