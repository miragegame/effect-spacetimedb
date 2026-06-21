# Randomness And Determinism

SpaceTimeDB reducers must be deterministic. Every replica needs to reproduce the
same result from the same logged inputs. The host replaces `Math.random` with a
throwing getter, but it leaves `Date` and `Date.now` as live V8 wall-clock APIs.
Raw `Date.now()` or no-argument `new Date()` calls are therefore a determinism
hazard if their values reach committed state. Server code should use the values
provided by the reducer context instead: `ctx.timestamp` for time and
`ctx.random` for deterministic randomness.

## Reducer Randomness

Inside Effect-based reducers, use `Effect.Random.*` rather than global
`Math.random`. The constrained server runtime wires `Effect.Random` to
SpaceTimeDB's `ctx.random` through `makeServerRandom`, so calls such as
`Random.next`, `Random.nextIntBetween`, and `Random.shuffle` consume the same
deterministic stream the host exposes.

Do not call global `Math.random` in server reducer, procedure, or HTTP handler
effects. SpaceTimeDB replaces it in module runtimes, and `dev-guarded` mode also
replaces it with a throwing guard so accidental callers fail loudly in tests and
CI. The runtime still installs a deterministic `mulberry32` fallback as a
non-semantic backstop for stray library paths, but application logic should not
depend on it.

## Reducer Time

Inside Effect-based reducers, use `Effect.Clock` or `Effect.DateTime` rather
than global `Date`. The constrained server runtime wires the Effect clock to
SpaceTimeDB's transaction timestamp through `makeServerClock`, so time reads are
stable for the logged transaction.

Do not call `Date.now()` or no-argument `new Date()` in server reducer,
procedure, or HTTP handler effects. SpaceTimeDB's host does not remove these
APIs, so they remain live wall-clock reads in the module isolate. The
constrained runtime's `dev-guarded` mode replaces both with throwing guards in
tests and CI; explicit conversions such as `new Date(123)`, `new Date(value)`,
`Date.parse`, and `Date.UTC` remain available.

## Strength

`ctx.random` is suitable for gameplay-grade uses such as shuffles, loot rolls,
procedural content, and reproducible simulations. It is not suitable for
secrets, tokens, authentication, anti-cheat, or other security-sensitive uses.

SpaceTimeDB backs `ctx.random` with `xoroshiro128+` seeded from the
transaction timestamp and keeps that deterministic stream on the isolate context.
That is statistically useful, but cryptographically predictable: the algorithm is
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

## Runtime Contract

- Use `Effect.Random.*` inside reducers and server effects.
- Use `Effect.Clock` / `Effect.DateTime` or `ctx.timestamp` for reducer time.
- Use `ctx.random` directly only at low-level interop boundaries.
- Never use `Math.random` for reducer semantics.
- Never use wall-clock `Date.now()` or no-argument `new Date()` for reducer
  semantics.
- Treat server randomness as deterministic and non-cryptographic.
- Generate secrets and unpredictable values outside the reducer.
