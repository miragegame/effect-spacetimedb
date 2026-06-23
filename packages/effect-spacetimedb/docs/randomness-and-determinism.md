# Randomness And Determinism Implementation Notes

> **Implementation notes.** The user-facing version of this topic lives at
> <https://effect-spacetimedb.dev/the-effect-layer/randomness-and-determinism>.
> This file documents implementation detail, rationale, and
> native behavior not covered on the public docs site. Keep user-facing
> conceptual prose on the website to avoid drift between the two surfaces.

The public docs own reducer randomness, wall-clock, UUID-helper, and security
guidance. This file keeps only the runtime wiring and advanced deterministic
protocol notes that are useful while maintaining the package.

## Runtime Wiring

The constrained server runtime wires `Random.*` from `effect/Random` to
SpaceTimeDB's `ctx.random` through `makeServerRandom`, so calls such as
`Random.next`, `Random.nextIntBetween`, and `Random.shuffle` consume the same
deterministic stream the host exposes.

SpaceTimeDB replaces `Math.random` in module runtimes, and `dev-guarded` mode
also replaces it with a throwing guard so accidental callers fail loudly in
tests and CI. The runtime still installs a deterministic `mulberry32` fallback
as a non-semantic backstop for stray library paths, but application logic should
not depend on it.

SpaceTimeDB backs `ctx.random` with `xoroshiro128+` seeded from the transaction
timestamp and keeps that deterministic stream on the isolate context. That is
statistically useful, but cryptographically predictable: the algorithm is
deterministic, the seed is low entropy and observable, and replicas must be able
to reproduce the result. Supplying a developer-chosen seed makes results more
reproducible, not more secret.

## Unpredictable Values

Cryptographically unpredictable randomness cannot be generated inside a
deterministic reducer. If a value can be reproduced by every replica from logged
inputs, it is predictable to anyone who can reconstruct those inputs.

For unpredictable values, generate entropy outside the reducer with a real CSPRNG
on a trusted host, client, edge worker, or service, then pass the result into the
reducer as an argument. For adversarial workflows, use a protocol designed for
deterministic systems, such as commit-reveal or a verifiable random function.
