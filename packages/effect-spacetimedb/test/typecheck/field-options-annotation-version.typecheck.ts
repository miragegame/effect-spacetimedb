import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import type { Assert, IsEqual } from "./helpers"

// The field-options version boundary is a typed, tagged authoring error on the
// public surface, not a defect: consumers can name it and match its tag.
const versionErrorTag: "StdbFieldOptionsVersionError" =
  new Stdb.StdbFieldOptionsVersionError({
    origin: { _tag: "LegacyPayload" },
  })._tag
void versionErrorTag

type _OriginTags = Assert<
  IsEqual<
    Stdb.FieldOptionsAnnotationOrigin["_tag"],
    "LegacyPayload" | "IncompatiblePayload"
  >
>

const incompatibleOrigin: Stdb.FieldOptionsAnnotationOrigin = {
  _tag: "IncompatiblePayload",
  version: 99,
}
void incompatibleOrigin

// @ts-expect-error an incompatible payload must report the version it claimed
const originWithoutVersion: Stdb.FieldOptionsAnnotationOrigin = {
  _tag: "IncompatiblePayload",
}
void originWithoutVersion

// The authoring options a caller writes are unchanged by the boundary: the
// annotation's `version` member is internal and never appears here.
const authoringOptions: Stdb.FieldOptions<string> = {
  unique: true,
  index: "btree",
  default: "column-default",
  name: "column_name",
}
void authoringOptions

// @ts-expect-error the annotation payload version is not part of the public options
const authoringOptionsWithVersion: Stdb.FieldOptions<string> = { version: 2 }
void authoringOptionsWithVersion

const ColumnName = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(64))),
)
const column = ColumnName.unique().index("btree").name("column_name")
type _IndexAlgorithmIsDerivedFromTheAnnotationSchema = Assert<
  IsEqual<Stdb.IndexAlgorithm, "btree" | "hash" | "direct">
>
void column
