# Contract DSL Notes

This package intentionally adds a small TypeScript DSL on top of native
SpaceTimeDB declarations. The notes below document behavior that is local to the
DSL and should not be confused with native module syntax.

## Scheduled Tables

`Stdb.scheduledTable(name, options)` auto-injects two columns before user
columns:

- `scheduledId`: a `u64().primaryKey().autoInc()` column with native column name
  `scheduled_id`.
- `scheduledAt`: a `ScheduleAt` column with native column name `scheduled_at`.

Authors cannot also declare `scheduledId`, `scheduledAt`, `scheduled_id`, or
`scheduled_at`; the constructor rejects those reserved names. A custom
`scheduledId` value type may be supplied through `options.scheduledId`, but it
must still be a `u64` value type and is still marked primary-key and auto-inc.

Scheduled tables default to `public: false`, the same local default as
`Stdb.table(...)`, and they honor an explicit `public: true`. User columns are
spread directly into the table shape after the injected scheduler columns; there
is no `{ data }` wrapper or payload reshape.

## Compile-Time vs Runtime Validation

The DSL rejects raw schemas in SATS positions at compile time by requiring
opaque value types. Cross-object module invariants are still validated at module
validation time by `validateModule` / `Stdb.validate`:

| Invariant | Compile-time | Runtime validation diagnostic |
|---|---:|---|
| Raw Effect schema in a SATS position | Yes | `UnsupportedTypeDescriptor` remains as a malformed-spec fallback |
| Duplicate table/view relation names | No | `DuplicateRelationName` |
| Duplicate reducer/procedure/HTTP/view/lifecycle export names | No | `DuplicateCallableName` |
| Reserved `__http_router__` export name | No | `DuplicateCallableName` |
| Non-canonical declared names under canonical naming policy | No | `NonCanonicalDeclaredName` |
| Reserved declared error tags | No | `ReservedDeclaredErrorTag` |
| Duplicate declared error tags | No | `DuplicateDeclaredErrorTag` |
| String literal authored/generated-client tag collisions | No | `LiteralTagCollision` |

Additional type-level lifts for cross-group uniqueness are deferred because the
same shape of O(n^2) comparisons caused the TypeScript instantiation-depth
issues tracked as F-206. Bounded checks such as reserved names and casing policy
are better future candidates for compile-time feedback.
