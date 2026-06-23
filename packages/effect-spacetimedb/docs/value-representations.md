# Value Representations Implementation Notes

> **Implementation notes.** The user-facing version of this topic lives at
> <https://effect-spacetimedb.dev/the-effect-layer/value-representations>.
> This file documents implementation detail, rationale, and
> native behavior not covered on the public docs site. Keep user-facing
> conceptual prose on the website to avoid drift between the two surfaces.

The public docs define the authored, schema-encoded, and host value shapes. This
file pins the implementation-sensitive details that are easy to break when
changing codecs.

## Result Envelope Asymmetry

Result host input is lenient. Handlers may return either `{ ok: value }` /
`{ err: value }` or tagged `{ tag: "ok", value }` /
`{ tag: "err", value }`; host encoding emits the `{ ok }` / `{ err }` envelope.

Result is the known host/schema asymmetry: host values use `{ ok }` / `{ err }`,
while the Effect schema decoder expects tagged `{ tag, value }` result
envelopes. The WS/DB host decoder normalizes the host envelope before schema
decoding.

## Literal And Sum Wire Rules

Sum host input is the authored tagged shape: `{ tag }` for unit variants and
`{ tag, value }` for variants with payloads.

String `Stdb.literal(...)` host input/output is also the authored tagged shape.
The SATS enum variant tag preserves the authored literal verbatim on DB/host and
HTTP/JSON paths when the authored value is a valid SpaceTimeDB identifier.
Non-identifier literals such as `edit-action` use the generated-client-safe
PascalCase tag in the SATS schema while decoding to the authored value. The
generated-client WS input profile applies SpaceTimeDB's PascalCase convention to
the schema tag.

## HTTP JSON Profile

Client HTTP JSON has its own representation profile over the same descriptor
walk. Input preparation only rewrites exact `{ some: value }` option envelopes,
drops unknown struct fields, canonicalizes declared field names to snake case,
and prepares literal/sum payloads for SATS JSON.

Output normalization accepts the SpacetimeDB HTTP JSON shapes, falls back to
schema-AST normalization where the value is not in a descriptor-specific shape,
recurses into bare options, and rebinds canonical snake-case struct fields back
to declared field names.

String literal SATS enum objects use the schema variant as the JSON object key
or `{ tag }` value. For identifier-safe values this is the authored literal; for
non-identifiers it is the generated-client-safe PascalCase fallback. PascalCase
generated-client tags and authored values are accepted during decode
normalization, but HTTP/JSON payloads emitted by this package use schema tags.
The old camelCase literal keys are not accepted as compatibility aliases; raw
SATS-JSON callers must emit schema tags and deploy in the same rollout as any
module republish that changes persisted enum schemas.

## Single Traversal Rule

Per-kind traversal logic lives only in `src/contract/type/value-fold.ts`.
Representation-specific modules define profiles over that fold; they should not
reintroduce independent descriptor dispatches.
