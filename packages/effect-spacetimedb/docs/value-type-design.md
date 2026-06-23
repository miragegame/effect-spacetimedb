# Value-type design: why opaque, not a plain effect schema

> **Implementation notes.** The user-facing version of this topic lives at
> <https://effect-spacetimedb.dev/the-effect-layer/value-type-design>.
> This file documents implementation detail, rationale, and
> native behavior not covered on the public docs site. Keep user-facing
> conceptual prose on the website to avoid drift between the two surfaces.

This ADR records why an effect-spacetimedb value-type (`Stdb.string(...)`,
`Stdb.u64(...)`, `Stdb.struct({...})`, ...) is an opaque wrapper around an effect
schema instead of being the schema itself. Read this before "simplifying"
value-types back into plain schemas.

## Two facts about effect that constrain the design
- **Annotations are runtime-only at the type level.** We *do* store the real SATS info as
  effect annotations on the schema (`StdbTypeAnnotationId` / `StdbTypeInfoAnnotationId`), and
  those survive transforms. But a schema *with* an annotation and one *without* have the
  **identical TypeScript type** — the type system cannot see annotations. So annotations alone
  cannot make "raw schema in a SATS position" a *compile* error.
- **effect erases phantom type-properties on every transform (intended, not a bug).**
  `.pipe`/`.check`/`.brand`/`.annotate` return `this["Rebuild"]` — the canonical schema type —
  which drops any extra property you intersected onto a schema's type via a cast. This is
  *sound*: a transform builds a brand-new schema object that genuinely doesn't carry your
  cast-on property at runtime, so keeping it in the type would be a lie. effect's supported
  channel for metadata is annotations (which it preserves); cast-on phantom props are not.

## The trilemma (you can pick two)
Enforcing (2) at compile time, keeping value-types plain schemas, and being robust are
mutually exclusive:

| Approach | Compile-time rejection of raw schemas | Value-type is a plain effect schema | Robust (survives composition) |
|---|---|---|---|
| **#1 — phantom marker on the schema type** | ✅ | ✅ | ❌ effect's transforms strip the marker (`.check`, `.brand`, `.pipe` all drop it) → "tag must be last", surprising |
| **#2 — opaque wrapper (CHOSEN)** | ✅ | ❌ use `.schema`; no `.pipe`/`.check`/`.brand` on the value-type | ✅ nothing to strip |
| **#3 — annotations only** | ❌ → caught at **module-build/validation time** instead | ✅ | ✅ (needs a robust annotation reader) |

#1 is what we had; the marker was a cast-on phantom and effect (correctly) erased it on any
chained op, so branding/refining a value-type "one way worked, another way silently broke."
That fragility is what drove this redesign.

## Why we chose #2
We treat **compile-time rejection of raw schemas in SATS positions as a first-class guarantee**
of this library. For library users, a red squiggle at the call site beats a runtime/build error
later, and it makes the SATS surface self-documenting. #2 is the only option that keeps that
guarantee *and* is robust. Making the value-type opaque also removes the entire class of
"chained the tag the wrong way" bugs: there is no `.pipe`/`.check`/`.brand` on a value-type to
misuse — the methods simply don't exist.

## The tradeoffs we accept (by design)
- **`.schema` unwraps a value-type to its effect schema** for decode/encode, `Schema.*`
  combinators, and HTTP request/response bodies. It is mainly for composites/rows; `Stdb.error`
  fields now take the opaque value-type directly and unwrap internally.
- **All refinement happens inside the constructor.** Each scalar takes either nothing (base
  default) or one effect schema (`Stdb.u64(Schema.BigInt.pipe(Schema.brand("X")))`); there is no
  post-construction chaining. Branding is just `Schema.brand` in the passed schema — not a
  privileged argument.
- **Numeric width is owned by the constructor** (`Stdb.u16` always applies `[0, 65535]`),
  because effect's range checks don't narrow `Type`, so the bound can't be verified on a passed
  schema at compile time — the constructor enforcing it is both necessary and foolproof.
- **Consumer pattern (B): brand a raw schema, wrap inline at the boundary.** A branded *domain*
  type is a plain effect schema — the single source of truth, used directly in app code
  (decode/encode, HTTP bodies) — and is wrapped with `Stdb.string(X)` / `Stdb.u64(X)` *inline*
  only at STDB declaration sites (struct fields, params, returns, error fields). Do not keep a
  separate value-type variable for the same domain id (no `UserId` raw + `UserIdT` wrapper pair).
  Generic, non-branded SATS scalars reused across many fields may instead be value-type aliases
  (`const ShortString = Stdb.string(...)`) used directly. Composites/rows (`Stdb.struct`/
  `Stdb.table`) are the value-types you keep — a row's `.schema` decodes the whole row. See the
  canonical example (`examples/publishable-module`).
- **Literal unions:** if the union exists *for STDB use* (no shared core schema), declare it
  with `Stdb.literal(...)` — a SATS *enum* on the wire (unit-variant sum), with the literal
  union as the decoded TS type. String literal enum tags preserve authored strings verbatim on
  the DB/host and HTTP/JSON paths when the authored value is a valid SpaceTimeDB identifier,
  matching `Stdb.sum({...})` authored variant keys. Non-identifier values such as
  `edit-action` use the generated-client-safe PascalCase tag in the SATS schema while still
  decoding to the authored value. Official generated clients expose schema variants through
  SpaceTimeDB's PascalCase convention, so `Stdb.literal("pending_review")` encodes as
  `{ tag: "pending_review" }` for DB/HTTP and as `{ tag: "PendingReview" }` for
  generated-client WS calls. HTTP/JSON tools should send the schema SATS tag. The casing
  helpers are ASCII-only and do not model Unicode case boundaries. Existing modules with
  persisted enum columns may need a reset or hand-written migration when republished because
  changing SATS variant names changes the column type identity; consumers that hand-build raw
  SATS-JSON enum payloads must update those payload keys in the same rollout window. Numeric
  `Stdb.literal(...)` values lower to
  `f64`; non-finite numbers and unsafe integers beyond `Number.MAX_SAFE_INTEGER` are
  rejected. If the union is a *core-shared domain schema* also consumed by HTTP DTOs, keep
  `Stdb.custom(CoreSchema, { type: <string scalar> })` (string wire) so the values have one
  source of truth. Enforced by a lint rule.
- **Optional struct fields lower to SATS option, uniformly.** `{ optional: true }` field
  options (`Stdb.optional`, table-column `.optional()`) and `Stdb.option` fields produce the
  identical `option<T>` wire shape everywhere a struct is materialized (tables, plain structs,
  `table.row` reused as a callable return, HTTP-JSON decode, content-addressed type names) —
  they differ only in TS key-optionality (`key?: T` vs required `key: T | undefined`). This is
  a library guarantee implemented via `structFieldWireType`; consumer style prefers
  `Stdb.option` for fields constructed with computed possibly-undefined values. See
  [Stdb.option vs Stdb.optional](./option-vs-optional.md) for the standalone value-type vs
  field/column annotation distinction.

## When #3 (annotations only) would be the better choice
If compile-time rejection were *not* a required feature, #3 is simpler and strictly more
effect-native: the value-type would *be* a plain schema (full interop, free chaining, no
`.schema`), with "raw schema in a SATS position" caught at module-build/validation time instead
of at typecheck. We chose the compile-time guarantee over that simplicity; if that priority ever
changes, #3 is the documented alternative.
