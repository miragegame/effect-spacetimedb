import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import type { Assert, IsEqual } from "./helpers"

class MergeFirst extends Schema.TaggedErrorClass<MergeFirst>()(
  "MergeFirst",
  {},
) {}

class MergeShared extends Schema.TaggedErrorClass<MergeShared>()(
  "MergeShared",
  {},
) {}

class MergeSecond extends Schema.TaggedErrorClass<MergeSecond>()(
  "MergeSecond",
  {},
) {}

class MergeOther extends Schema.TaggedErrorClass<MergeOther>()(
  "MergeOther",
  {},
) {}

const FirstErrors = Stdb.errors(MergeFirst, MergeShared)
const SecondErrors = Stdb.errors(MergeShared, MergeSecond)
const MergedErrors = Stdb.errors.merge(FirstErrors, SecondErrors)
// @ts-expect-error merge requires at least one definition
const EmptyMergeErrors = Stdb.errors.merge()
const EquivalentHandSpreadErrors = Stdb.errors(
  MergeFirst,
  MergeShared,
  MergeSecond,
)

void MergedErrors.pick("MergeFirst")
void MergedErrors.pick("MergeShared", "MergeSecond")
// @ts-expect-error pick only accepts tags from merged definitions
void MergedErrors.pick("MergeOther")

type MergedTags = Stdb.ErrorTags<typeof MergedErrors>
type EquivalentHandSpreadTags = Stdb.ErrorTags<
  typeof EquivalentHandSpreadErrors
>
type _mergedTagsMatchHandSpread = Assert<
  IsEqual<MergedTags, EquivalentHandSpreadTags>
>
type _mergedTagsIncludeEveryInput = Assert<
  IsEqual<MergedTags, "MergeFirst" | "MergeShared" | "MergeSecond">
>

const first: Stdb.ErrorInstances<typeof MergedErrors> = MergeFirst.make({})
const shared: Stdb.ErrorInstances<typeof MergedErrors> = MergeShared.make({})
const second: Stdb.ErrorInstances<typeof MergedErrors> = MergeSecond.make({})
// @ts-expect-error merged instances exclude classes outside the input definitions; @effect-diagnostics-next-line missingEffectError:off
const other: Stdb.ErrorInstances<typeof MergedErrors> = MergeOther.make({})

void first
void shared
void second
void other
void EmptyMergeErrors
