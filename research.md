# Research — dsh-meta-community

**Gate.** This repository is private and outside the public pre-release. The gate is stated rather than hidden, because a community that hides what it gates teaches its members that absence is indistinguishable from success.

## 1. The question

Can independent authors share meta plugins **without a central authority deciding what is true** — that is, can a stranger reproduce another author's census from the artifact alone?

## 2. What is measured today

- The package's own verification chain runs its harnesses and prints each verdict with a numerator and a denominator; the chain stops at the first red one.
- A conformance check stands as the package's own statement of what a member must satisfy, and it reports what it could not measure rather than counting it as satisfied.
- The capability table and the disclosure are part of what a member publishes, so a reviewer has something to check that is not the author's word.

## 3. What is NOT measured

- **Author authentication does not exist.** A name is a claim, not a credential; the disclosure says so.
- A live peer fleet beyond one machine has never been exercised; the docker verifiers report the reason they could not run.
- Any rendered surface: no GUI is claimed.

## 4. The companion study

`research-community-model.md` in this repository covers membership, the two real channels (a git commit and a chat message, and why neither is a release), the review loop, and curation into a selected stable candidate.

## 5. Next measurement

Two members publish one package each through that loop in one run, recording which step each reached, what each harness printed, and whether a peer could reproduce the census without the author's machine. The falsifier: if the census cannot be reproduced from the artifact alone, the community is trusting authors rather than artifacts.
