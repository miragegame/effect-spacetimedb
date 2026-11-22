import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import type { Assert, IsEqual } from "./helpers"

// The field-options version boundary is a typed, tagged authoring error on the
// public surface, not a defect: consumers can name it and match its tag.
const versionErrorTag: "StdbFieldOptionsVersionDefect" =
  new Stdb.StdbFieldOptionsVersionDefect({
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

const authoringOptionsWithVersion: Stdb.FieldOptions<string> = {
  // @ts-expect-error the annotation payload version is not part of the public options
  version: 2,
}
void authoringOptionsWithVersion

const ColumnName = Stdb.string(
  Schema.String.pipe(Schema.check(Schema.isMaxLength(64))),
)
const column = ColumnName.unique().index("btree").columnName("column_name")
type _IndexAlgorithmIsDerivedFromTheAnnotationSchema = Assert<
  IsEqual<Stdb.IndexAlgorithm, "btree" | "hash" | "direct">
>
void column

// A chain of options keeps each one, so a column is a key only when it says so
// and a value may be absent only when it says so.
const chainedTable = Stdb.table("chained", {
  columns: {
    id: ColumnName.primaryKey(),
    plainSerial: Stdb.u64().autoInc(),
    uniqueSerial: Stdb.u32().unique().autoInc(),
    indexedSerial: Stdb.i64().autoInc().index(),
    renamed: ColumnName.unique().columnName("column_name"),
    absent: ColumnName.optional().columnName("absent_name"),
  },
})
type ChainedRow = Stdb.TableRow<typeof chainedTable>
type _OnlyTheKeyIsAKey = Assert<
  IsEqual<Stdb.PrimaryKeyNames<typeof chainedTable>, "id">
>
type _SerialsAreAlwaysPresent = Assert<
  IsEqual<
    ChainedRow["plainSerial" | "uniqueSerial" | "indexedSerial"],
    bigint | number
  >
>
type _RenamedColumnsKeepTheirOptionality = Assert<
  IsEqual<ChainedRow["absent"], string | undefined>
>
type _OnlyAnIndexedColumnGainsAnAccessor = Assert<
  IsEqual<(typeof chainedTable)["indexes"][number]["name"], "indexedSerial">
>
const keyedSerial = Stdb.table("keyed_serial", {
  columns: {
    id: Stdb.u64().autoInc().primaryKey(),
  },
})
type _SerialKeyIsPresent = Assert<
  IsEqual<Stdb.TableRow<typeof keyedSerial>["id"], bigint>
>
