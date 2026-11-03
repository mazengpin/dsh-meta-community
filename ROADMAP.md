# ROADMAP — dsh-meta-community

**Version `0.9.1-next.2` is a PRE-RELEASE.** It is built locally for the `next` dist-tag and it is **NOT published to npm yet**; it is under active development: the surface below is what `1.0.0` still requires, not a wish list appended after the fact.

## What this package is

The community half: a recognised set of independently operated instances that fuse their meta-packages under multiple authenticated authors and hold a standing conformance check.

## What is measured today

`pnpm test` green: host-half 42 of 42, node-half 37 of 37, consensus-unit 72 of 72; `npm pack --dry-run` 38 files / 718.3 kB; built export resolves to `{name, apply, inject:["webServer"]}`. Server-only by design: 0 client halves.

## What 1.0.0 still requires

1. A live two-container fleet, which the three docker verifiers need: today they fail honestly at exits 3 / 2 / 2 with "fleet was not reachable, so NOTHING about the consensus was measured".
2. Authentication of an author, not just a count of authors: multiple authenticated authors is the claim that carries the whole layer.
3. A clause with no artifact behind it must go RED in the deliverable, not only in the harness.
4. `NODE_ID` today is a required environment variable for a bare node start; a one-shot node must derive or refuse with the same named ConfigError the harness asserts.

## Limits, stated rather than implied

Consensus is a local algorithm over records this node holds; it is not a proof about another host. Anonymity and sharing are verified against a fixture, and no network of strangers has been exercised.

## Compatibility seam

Ships its own `docker/` node image and verifiers; a compose change is a breaking change to how a node joins.

## How this roadmap is graded

An item is DONE only when a command proves it and the command is named here. An item that is only described is not done, and a roadmap whose items all read as prose is a plan, not a state.
