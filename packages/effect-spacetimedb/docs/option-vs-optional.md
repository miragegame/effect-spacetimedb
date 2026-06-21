# Stdb.option vs Stdb.optional

`Stdb.option(X)` is a nullable value type. Its decoded TypeScript value is
`X | undefined`, and its SATS wire type is `option<X>`. Use it anywhere a value
type is allowed: standalone arguments, array elements, table columns, nested
types, and struct fields. In a struct field, the key is still required; the
field value may be `undefined`.

`Stdb.optional(X)` and `.optional()` are field or column optionality
annotations. They mean "this struct field or table column may be omitted". In a
struct or callable param field they lower to the same SATS `option<X>` wire type
as `Stdb.option(X)`. On table columns, `.optional()` marks the native row
builder column nullable.

Rule of thumb: use `Stdb.option` for standalone nullable values, array
elements, and fields that are always present but maybe none. Use
`Stdb.optional` or `.optional()` when the struct field or table column itself may
be omitted.

For struct fields the two forms are wire-identical. The difference is the
TypeScript shape: `Stdb.optional(X)` gives an omittable key (`x?: X`), while
`Stdb.option(X)` gives a required key whose value may be undefined
(`x: X | undefined`). Only `Stdb.option` can be used as a standalone value type.
