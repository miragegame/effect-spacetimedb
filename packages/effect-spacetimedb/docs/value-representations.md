# Value Representations

`effect-spacetimedb` intentionally works with three related value shapes:

- **Authored Type values** are the values application handlers and typed clients
  work with. These are the `Type` side of an `Stdb.*` schema, such as
  `{ tag: "Active", value: payload }` for sums and `{ ok: value }` /
  `{ err: value }` for results.
- **Schema encoded values** are the wire side of the Effect schema codecs. HTTP
  uses this representation for typed request and response bodies.
- **Host JS values** are the shapes accepted by the SpacetimeDB JavaScript host
  for reducer arguments, table rows, lookup keys, and handler returns. They are
  close to authored values, but not identical to schema encoded values.
  WebSocket reducer/procedure arguments and DB table rows use this native host
  representation, then normalize back to schema encoded values before schema
  decoding.

The host representation has deliberate compatibility rules:

- Absent optional struct fields and absent `Stdb.option` fields are omitted from
  host structs. Present fields whose value is `undefined` remain present and
  encode as `undefined`.
- Result host input is lenient. Handlers may return either `{ ok: value }` /
  `{ err: value }` or tagged `{ tag: "ok", value }` /
  `{ tag: "err", value }`; host encoding emits the `{ ok }` / `{ err }`
  envelope.
- Sum host input is the authored tagged shape: `{ tag }` for unit variants and
  `{ tag, value }` for variants with payloads.
- String `Stdb.literal(...)` host input/output is also the authored tagged
  shape. The SATS enum variant tag preserves the authored literal verbatim on
  DB/host and HTTP/JSON paths when the authored value is a valid SpaceTimeDB
  identifier. Non-identifier literals such as `edit-action` use the
  generated-client-safe PascalCase tag in the SATS schema while decoding to the
  authored value. The generated-client WS input profile applies SpaceTimeDB's
  PascalCase convention to the schema tag.
- Result is the known host/schema asymmetry: host values use `{ ok }` /
  `{ err }`, while the Effect schema decoder expects tagged
  `{ tag, value }` result envelopes. The WS/DB host decoder normalizes the
  host envelope before schema decoding.
- Primitive, literal, custom, and no-descriptor values still delegate to their
  schema encoder at the leaves.

Client HTTP JSON has its own representation profile over the same descriptor
walk. Input preparation only rewrites exact `{ some: value }` option envelopes,
drops unknown struct fields, canonicalizes declared field names to snake case,
and prepares literal/sum payloads for SATS JSON. Output normalization accepts
the SpacetimeDB HTTP JSON shapes, falls back to schema-AST normalization where
the value is not in a descriptor-specific shape, recurses into bare options,
and rebinds canonical snake-case struct fields back to declared field names.
String literal SATS enum objects use the schema variant as the JSON object key
or `{ tag }` value. For identifier-safe values this is the authored literal; for
non-identifiers it is the generated-client-safe PascalCase fallback. PascalCase
generated-client tags and authored values are accepted during decode
normalization, but HTTP/JSON payloads emitted by this package use schema tags.
The old camelCase literal keys are not accepted as compatibility aliases; raw
SATS-JSON callers must emit schema tags and deploy in the same rollout as any
module republish that changes persisted enum schemas.

Per-kind traversal logic lives only in `src/contract/type/value-fold.ts`.
Representation-specific modules define profiles over that fold; they should not
reintroduce independent descriptor dispatches.
