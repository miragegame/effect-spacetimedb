import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import type { Assert, IsEqual } from "./helpers"

const ScaleText = Stdb.string(Schema.String)
const ScaleParams = Stdb.struct({ value: ScaleText })

const reducer = <const Name extends string>(name: Name) =>
  Stdb.StdbFn.reducer(name, { params: ScaleParams })

const group10 = <
  const Id extends string,
  const E0 extends string,
  const E1 extends string,
  const E2 extends string,
  const E3 extends string,
  const E4 extends string,
  const E5 extends string,
  const E6 extends string,
  const E7 extends string,
  const E8 extends string,
  const E9 extends string,
>(
  id: Id,
  e0: E0,
  e1: E1,
  e2: E2,
  e3: E3,
  e4: E4,
  e5: E5,
  e6: E6,
  e7: E7,
  e8: E8,
  e9: E9,
) =>
  Stdb.StdbGroup.make(id).add(
    reducer(e0),
    reducer(e1),
    reducer(e2),
    reducer(e3),
    reducer(e4),
    reducer(e5),
    reducer(e6),
    reducer(e7),
    reducer(e8),
    reducer(e9),
  )

const LargeScaleModule = Stdb.StdbModule.make("large_build_scale", {}).add(
  group10(
    "Group00",
    "endpoint00_00",
    "endpoint00_01",
    "endpoint00_02",
    "endpoint00_03",
    "endpoint00_04",
    "endpoint00_05",
    "endpoint00_06",
    "endpoint00_07",
    "endpoint00_08",
    "endpoint00_09",
  ),
  group10(
    "Group01",
    "endpoint01_00",
    "endpoint01_01",
    "endpoint01_02",
    "endpoint01_03",
    "endpoint01_04",
    "endpoint01_05",
    "endpoint01_06",
    "endpoint01_07",
    "endpoint01_08",
    "endpoint01_09",
  ),
  group10(
    "Group02",
    "endpoint02_00",
    "endpoint02_01",
    "endpoint02_02",
    "endpoint02_03",
    "endpoint02_04",
    "endpoint02_05",
    "endpoint02_06",
    "endpoint02_07",
    "endpoint02_08",
    "endpoint02_09",
  ),
  group10(
    "Group03",
    "endpoint03_00",
    "endpoint03_01",
    "endpoint03_02",
    "endpoint03_03",
    "endpoint03_04",
    "endpoint03_05",
    "endpoint03_06",
    "endpoint03_07",
    "endpoint03_08",
    "endpoint03_09",
  ),
  group10(
    "Group04",
    "endpoint04_00",
    "endpoint04_01",
    "endpoint04_02",
    "endpoint04_03",
    "endpoint04_04",
    "endpoint04_05",
    "endpoint04_06",
    "endpoint04_07",
    "endpoint04_08",
    "endpoint04_09",
  ),
  group10(
    "Group05",
    "endpoint05_00",
    "endpoint05_01",
    "endpoint05_02",
    "endpoint05_03",
    "endpoint05_04",
    "endpoint05_05",
    "endpoint05_06",
    "endpoint05_07",
    "endpoint05_08",
    "endpoint05_09",
  ),
  group10(
    "Group06",
    "endpoint06_00",
    "endpoint06_01",
    "endpoint06_02",
    "endpoint06_03",
    "endpoint06_04",
    "endpoint06_05",
    "endpoint06_06",
    "endpoint06_07",
    "endpoint06_08",
    "endpoint06_09",
  ),
  group10(
    "Group07",
    "endpoint07_00",
    "endpoint07_01",
    "endpoint07_02",
    "endpoint07_03",
    "endpoint07_04",
    "endpoint07_05",
    "endpoint07_06",
    "endpoint07_07",
    "endpoint07_08",
    "endpoint07_09",
  ),
  group10(
    "Group08",
    "endpoint08_00",
    "endpoint08_01",
    "endpoint08_02",
    "endpoint08_03",
    "endpoint08_04",
    "endpoint08_05",
    "endpoint08_06",
    "endpoint08_07",
    "endpoint08_08",
    "endpoint08_09",
  ),
  group10(
    "Group09",
    "endpoint09_00",
    "endpoint09_01",
    "endpoint09_02",
    "endpoint09_03",
    "endpoint09_04",
    "endpoint09_05",
    "endpoint09_06",
    "endpoint09_07",
    "endpoint09_08",
    "endpoint09_09",
  ),
  group10(
    "Group10",
    "endpoint10_00",
    "endpoint10_01",
    "endpoint10_02",
    "endpoint10_03",
    "endpoint10_04",
    "endpoint10_05",
    "endpoint10_06",
    "endpoint10_07",
    "endpoint10_08",
    "endpoint10_09",
  ),
  group10(
    "Group11",
    "endpoint11_00",
    "endpoint11_01",
    "endpoint11_02",
    "endpoint11_03",
    "endpoint11_04",
    "endpoint11_05",
    "endpoint11_06",
    "endpoint11_07",
    "endpoint11_08",
    "endpoint11_09",
  ),
  group10(
    "Group12",
    "endpoint12_00",
    "endpoint12_01",
    "endpoint12_02",
    "endpoint12_03",
    "endpoint12_04",
    "endpoint12_05",
    "endpoint12_06",
    "endpoint12_07",
    "endpoint12_08",
    "endpoint12_09",
  ),
  group10(
    "Group13",
    "endpoint13_00",
    "endpoint13_01",
    "endpoint13_02",
    "endpoint13_03",
    "endpoint13_04",
    "endpoint13_05",
    "endpoint13_06",
    "endpoint13_07",
    "endpoint13_08",
    "endpoint13_09",
  ),
  group10(
    "Group14",
    "endpoint14_00",
    "endpoint14_01",
    "endpoint14_02",
    "endpoint14_03",
    "endpoint14_04",
    "endpoint14_05",
    "endpoint14_06",
    "endpoint14_07",
    "endpoint14_08",
    "endpoint14_09",
  ),
  group10(
    "Group15",
    "endpoint15_00",
    "endpoint15_01",
    "endpoint15_02",
    "endpoint15_03",
    "endpoint15_04",
    "endpoint15_05",
    "endpoint15_06",
    "endpoint15_07",
    "endpoint15_08",
    "endpoint15_09",
  ),
  group10(
    "Group16",
    "endpoint16_00",
    "endpoint16_01",
    "endpoint16_02",
    "endpoint16_03",
    "endpoint16_04",
    "endpoint16_05",
    "endpoint16_06",
    "endpoint16_07",
    "endpoint16_08",
    "endpoint16_09",
  ),
  group10(
    "Group17",
    "endpoint17_00",
    "endpoint17_01",
    "endpoint17_02",
    "endpoint17_03",
    "endpoint17_04",
    "endpoint17_05",
    "endpoint17_06",
    "endpoint17_07",
    "endpoint17_08",
    "endpoint17_09",
  ),
  group10(
    "Group18",
    "endpoint18_00",
    "endpoint18_01",
    "endpoint18_02",
    "endpoint18_03",
    "endpoint18_04",
    "endpoint18_05",
    "endpoint18_06",
    "endpoint18_07",
    "endpoint18_08",
    "endpoint18_09",
  ),
  group10(
    "Group19",
    "endpoint19_00",
    "endpoint19_01",
    "endpoint19_02",
    "endpoint19_03",
    "endpoint19_04",
    "endpoint19_05",
    "endpoint19_06",
    "endpoint19_07",
    "endpoint19_08",
    "endpoint19_09",
  ),
  group10(
    "Group20",
    "endpoint20_00",
    "endpoint20_01",
    "endpoint20_02",
    "endpoint20_03",
    "endpoint20_04",
    "endpoint20_05",
    "endpoint20_06",
    "endpoint20_07",
    "endpoint20_08",
    "endpoint20_09",
  ),
  group10(
    "Group21",
    "endpoint21_00",
    "endpoint21_01",
    "endpoint21_02",
    "endpoint21_03",
    "endpoint21_04",
    "endpoint21_05",
    "endpoint21_06",
    "endpoint21_07",
    "endpoint21_08",
    "endpoint21_09",
  ),
  group10(
    "Group22",
    "endpoint22_00",
    "endpoint22_01",
    "endpoint22_02",
    "endpoint22_03",
    "endpoint22_04",
    "endpoint22_05",
    "endpoint22_06",
    "endpoint22_07",
    "endpoint22_08",
    "endpoint22_09",
  ),
  group10(
    "Group23",
    "endpoint23_00",
    "endpoint23_01",
    "endpoint23_02",
    "endpoint23_03",
    "endpoint23_04",
    "endpoint23_05",
    "endpoint23_06",
    "endpoint23_07",
    "endpoint23_08",
    "endpoint23_09",
  ),
  group10(
    "Group24",
    "endpoint24_00",
    "endpoint24_01",
    "endpoint24_02",
    "endpoint24_03",
    "endpoint24_04",
    "endpoint24_05",
    "endpoint24_06",
    "endpoint24_07",
    "endpoint24_08",
    "endpoint24_09",
  ),
  group10(
    "Group25",
    "endpoint25_00",
    "endpoint25_01",
    "endpoint25_02",
    "endpoint25_03",
    "endpoint25_04",
    "endpoint25_05",
    "endpoint25_06",
    "endpoint25_07",
    "endpoint25_08",
    "endpoint25_09",
  ),
  group10(
    "Group26",
    "endpoint26_00",
    "endpoint26_01",
    "endpoint26_02",
    "endpoint26_03",
    "endpoint26_04",
    "endpoint26_05",
    "endpoint26_06",
    "endpoint26_07",
    "endpoint26_08",
    "endpoint26_09",
  ),
  group10(
    "Group27",
    "endpoint27_00",
    "endpoint27_01",
    "endpoint27_02",
    "endpoint27_03",
    "endpoint27_04",
    "endpoint27_05",
    "endpoint27_06",
    "endpoint27_07",
    "endpoint27_08",
    "endpoint27_09",
  ),
  group10(
    "Group28",
    "endpoint28_00",
    "endpoint28_01",
    "endpoint28_02",
    "endpoint28_03",
    "endpoint28_04",
    "endpoint28_05",
    "endpoint28_06",
    "endpoint28_07",
    "endpoint28_08",
    "endpoint28_09",
  ),
  group10(
    "Group29",
    "endpoint29_00",
    "endpoint29_01",
    "endpoint29_02",
    "endpoint29_03",
    "endpoint29_04",
    "endpoint29_05",
    "endpoint29_06",
    "endpoint29_07",
    "endpoint29_08",
    "endpoint29_09",
  ),
)

type LargeScaleGroupNames = Stdb.GroupNames<typeof LargeScaleModule>
type _LargeScaleBoundaryNames = Assert<
  IsEqual<
    Extract<LargeScaleGroupNames, "Group00" | "Group29">,
    "Group00" | "Group29"
  >
>

class ScaleRuntimeService extends Context.Service<
  ScaleRuntimeService,
  {
    readonly value: string
  }
>()(
  "effect-spacetimedb/test/typecheck/large-module-build-scale.typecheck/ScaleRuntimeService",
) {}

const runtimeHandler = Effect.fn(function* (_params: unknown) {
  const service = yield* ScaleRuntimeService
  void service.value
})

const handler = () => Effect.void

const Group09Handlers: Stdb.GroupCheckedHandlers<
  typeof LargeScaleModule,
  "Group09"
> = {
  endpoint09_00: handler,
  endpoint09_01: handler,
  endpoint09_02: handler,
  endpoint09_03: handler,
  endpoint09_04: handler,
  endpoint09_05: handler,
  endpoint09_06: handler,
  endpoint09_07: handler,
  endpoint09_08: handler,
  endpoint09_09: handler,
}

const Group10Handlers: Stdb.GroupCheckedHandlers<
  typeof LargeScaleModule,
  "Group10"
> = {
  endpoint10_00: handler,
  endpoint10_01: handler,
  endpoint10_02: handler,
  endpoint10_03: handler,
  endpoint10_04: handler,
  endpoint10_05: handler,
  endpoint10_06: handler,
  endpoint10_07: handler,
  endpoint10_08: handler,
  endpoint10_09: handler,
}

const Group11Handlers: Stdb.GroupCheckedHandlers<
  typeof LargeScaleModule,
  "Group11"
> = {
  endpoint11_00: handler,
  endpoint11_01: handler,
  endpoint11_02: handler,
  endpoint11_03: handler,
  endpoint11_04: handler,
  endpoint11_05: handler,
  endpoint11_06: handler,
  endpoint11_07: handler,
  endpoint11_08: handler,
  endpoint11_09: handler,
}

const Group00Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group00", {
  endpoint00_00: runtimeHandler,
  endpoint00_01: runtimeHandler,
  endpoint00_02: runtimeHandler,
  endpoint00_03: runtimeHandler,
  endpoint00_04: runtimeHandler,
  endpoint00_05: runtimeHandler,
  endpoint00_06: runtimeHandler,
  endpoint00_07: runtimeHandler,
  endpoint00_08: runtimeHandler,
  endpoint00_09: runtimeHandler,
})

const Group01Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group01", {
  endpoint01_00: runtimeHandler,
  endpoint01_01: runtimeHandler,
  endpoint01_02: runtimeHandler,
  endpoint01_03: runtimeHandler,
  endpoint01_04: runtimeHandler,
  endpoint01_05: runtimeHandler,
  endpoint01_06: runtimeHandler,
  endpoint01_07: runtimeHandler,
  endpoint01_08: runtimeHandler,
  endpoint01_09: runtimeHandler,
})

const Group02Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group02", {
  endpoint02_00: runtimeHandler,
  endpoint02_01: runtimeHandler,
  endpoint02_02: runtimeHandler,
  endpoint02_03: runtimeHandler,
  endpoint02_04: runtimeHandler,
  endpoint02_05: runtimeHandler,
  endpoint02_06: runtimeHandler,
  endpoint02_07: runtimeHandler,
  endpoint02_08: runtimeHandler,
  endpoint02_09: runtimeHandler,
})

const Group03Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group03", {
  endpoint03_00: runtimeHandler,
  endpoint03_01: runtimeHandler,
  endpoint03_02: runtimeHandler,
  endpoint03_03: runtimeHandler,
  endpoint03_04: runtimeHandler,
  endpoint03_05: runtimeHandler,
  endpoint03_06: runtimeHandler,
  endpoint03_07: runtimeHandler,
  endpoint03_08: runtimeHandler,
  endpoint03_09: runtimeHandler,
})

const Group04Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group04", {
  endpoint04_00: runtimeHandler,
  endpoint04_01: runtimeHandler,
  endpoint04_02: runtimeHandler,
  endpoint04_03: runtimeHandler,
  endpoint04_04: runtimeHandler,
  endpoint04_05: runtimeHandler,
  endpoint04_06: runtimeHandler,
  endpoint04_07: runtimeHandler,
  endpoint04_08: runtimeHandler,
  endpoint04_09: runtimeHandler,
})

const Group05Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group05", {
  endpoint05_00: runtimeHandler,
  endpoint05_01: runtimeHandler,
  endpoint05_02: runtimeHandler,
  endpoint05_03: runtimeHandler,
  endpoint05_04: runtimeHandler,
  endpoint05_05: runtimeHandler,
  endpoint05_06: runtimeHandler,
  endpoint05_07: runtimeHandler,
  endpoint05_08: runtimeHandler,
  endpoint05_09: runtimeHandler,
})

const Group06Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group06", {
  endpoint06_00: runtimeHandler,
  endpoint06_01: runtimeHandler,
  endpoint06_02: runtimeHandler,
  endpoint06_03: runtimeHandler,
  endpoint06_04: runtimeHandler,
  endpoint06_05: runtimeHandler,
  endpoint06_06: runtimeHandler,
  endpoint06_07: runtimeHandler,
  endpoint06_08: runtimeHandler,
  endpoint06_09: runtimeHandler,
})

const Group07Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group07", {
  endpoint07_00: runtimeHandler,
  endpoint07_01: runtimeHandler,
  endpoint07_02: runtimeHandler,
  endpoint07_03: runtimeHandler,
  endpoint07_04: runtimeHandler,
  endpoint07_05: runtimeHandler,
  endpoint07_06: runtimeHandler,
  endpoint07_07: runtimeHandler,
  endpoint07_08: runtimeHandler,
  endpoint07_09: runtimeHandler,
})

const Group08Live = Stdb.StdbBuilder.group(LargeScaleModule, "Group08", {
  endpoint08_00: runtimeHandler,
  endpoint08_01: runtimeHandler,
  endpoint08_02: runtimeHandler,
  endpoint08_03: runtimeHandler,
  endpoint08_04: runtimeHandler,
  endpoint08_05: runtimeHandler,
  endpoint08_06: runtimeHandler,
  endpoint08_07: runtimeHandler,
  endpoint08_08: runtimeHandler,
  endpoint08_09: runtimeHandler,
})

const Group09Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group09",
  {
    ...Group09Handlers,
  },
)

const Group10Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group10",
  {
    ...Group10Handlers,
  },
)

const Group11Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group11",
  {
    ...Group11Handlers,
  },
)

const Group12Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group12",
  {
    endpoint12_00: handler,
    endpoint12_01: handler,
    endpoint12_02: handler,
    endpoint12_03: handler,
    endpoint12_04: handler,
    endpoint12_05: handler,
    endpoint12_06: handler,
    endpoint12_07: handler,
    endpoint12_08: handler,
    endpoint12_09: handler,
  },
)

const Group13Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group13",
  {
    endpoint13_00: handler,
    endpoint13_01: handler,
    endpoint13_02: handler,
    endpoint13_03: handler,
    endpoint13_04: handler,
    endpoint13_05: handler,
    endpoint13_06: handler,
    endpoint13_07: handler,
    endpoint13_08: handler,
    endpoint13_09: handler,
  },
)

const Group14Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group14",
  {
    endpoint14_00: handler,
    endpoint14_01: handler,
    endpoint14_02: handler,
    endpoint14_03: handler,
    endpoint14_04: handler,
    endpoint14_05: handler,
    endpoint14_06: handler,
    endpoint14_07: handler,
    endpoint14_08: handler,
    endpoint14_09: handler,
  },
)

const Group15Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group15",
  {
    endpoint15_00: handler,
    endpoint15_01: handler,
    endpoint15_02: handler,
    endpoint15_03: handler,
    endpoint15_04: handler,
    endpoint15_05: handler,
    endpoint15_06: handler,
    endpoint15_07: handler,
    endpoint15_08: handler,
    endpoint15_09: handler,
  },
)

const Group16Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group16",
  {
    endpoint16_00: handler,
    endpoint16_01: handler,
    endpoint16_02: handler,
    endpoint16_03: handler,
    endpoint16_04: handler,
    endpoint16_05: handler,
    endpoint16_06: handler,
    endpoint16_07: handler,
    endpoint16_08: handler,
    endpoint16_09: handler,
  },
)

const Group17Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group17",
  {
    endpoint17_00: handler,
    endpoint17_01: handler,
    endpoint17_02: handler,
    endpoint17_03: handler,
    endpoint17_04: handler,
    endpoint17_05: handler,
    endpoint17_06: handler,
    endpoint17_07: handler,
    endpoint17_08: handler,
    endpoint17_09: handler,
  },
)

const Group18Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group18",
  {
    endpoint18_00: handler,
    endpoint18_01: handler,
    endpoint18_02: handler,
    endpoint18_03: handler,
    endpoint18_04: handler,
    endpoint18_05: handler,
    endpoint18_06: handler,
    endpoint18_07: handler,
    endpoint18_08: handler,
    endpoint18_09: handler,
  },
)

const Group19Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group19",
  {
    endpoint19_00: handler,
    endpoint19_01: handler,
    endpoint19_02: handler,
    endpoint19_03: handler,
    endpoint19_04: handler,
    endpoint19_05: handler,
    endpoint19_06: handler,
    endpoint19_07: handler,
    endpoint19_08: handler,
    endpoint19_09: handler,
  },
)

const Group20Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group20",
  {
    endpoint20_00: handler,
    endpoint20_01: handler,
    endpoint20_02: handler,
    endpoint20_03: handler,
    endpoint20_04: handler,
    endpoint20_05: handler,
    endpoint20_06: handler,
    endpoint20_07: handler,
    endpoint20_08: handler,
    endpoint20_09: handler,
  },
)

const Group21Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group21",
  {
    endpoint21_00: handler,
    endpoint21_01: handler,
    endpoint21_02: handler,
    endpoint21_03: handler,
    endpoint21_04: handler,
    endpoint21_05: handler,
    endpoint21_06: handler,
    endpoint21_07: handler,
    endpoint21_08: handler,
    endpoint21_09: handler,
  },
)

const Group22Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group22",
  {
    endpoint22_00: handler,
    endpoint22_01: handler,
    endpoint22_02: handler,
    endpoint22_03: handler,
    endpoint22_04: handler,
    endpoint22_05: handler,
    endpoint22_06: handler,
    endpoint22_07: handler,
    endpoint22_08: handler,
    endpoint22_09: handler,
  },
)

const Group23Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group23",
  {
    endpoint23_00: handler,
    endpoint23_01: handler,
    endpoint23_02: handler,
    endpoint23_03: handler,
    endpoint23_04: handler,
    endpoint23_05: handler,
    endpoint23_06: handler,
    endpoint23_07: handler,
    endpoint23_08: handler,
    endpoint23_09: handler,
  },
)

const Group24Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group24",
  {
    endpoint24_00: handler,
    endpoint24_01: handler,
    endpoint24_02: handler,
    endpoint24_03: handler,
    endpoint24_04: handler,
    endpoint24_05: handler,
    endpoint24_06: handler,
    endpoint24_07: handler,
    endpoint24_08: handler,
    endpoint24_09: handler,
  },
)

const Group25Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group25",
  {
    endpoint25_00: handler,
    endpoint25_01: handler,
    endpoint25_02: handler,
    endpoint25_03: handler,
    endpoint25_04: handler,
    endpoint25_05: handler,
    endpoint25_06: handler,
    endpoint25_07: handler,
    endpoint25_08: handler,
    endpoint25_09: handler,
  },
)

const Group26Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group26",
  {
    endpoint26_00: handler,
    endpoint26_01: handler,
    endpoint26_02: handler,
    endpoint26_03: handler,
    endpoint26_04: handler,
    endpoint26_05: handler,
    endpoint26_06: handler,
    endpoint26_07: handler,
    endpoint26_08: handler,
    endpoint26_09: handler,
  },
)

const Group27Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group27",
  {
    endpoint27_00: handler,
    endpoint27_01: handler,
    endpoint27_02: handler,
    endpoint27_03: handler,
    endpoint27_04: handler,
    endpoint27_05: handler,
    endpoint27_06: handler,
    endpoint27_07: handler,
    endpoint27_08: handler,
    endpoint27_09: handler,
  },
)

const Group28Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group28",
  {
    endpoint28_00: handler,
    endpoint28_01: handler,
    endpoint28_02: handler,
    endpoint28_03: handler,
    endpoint28_04: handler,
    endpoint28_05: handler,
    endpoint28_06: handler,
    endpoint28_07: handler,
    endpoint28_08: handler,
    endpoint28_09: handler,
  },
)

const Group29Live = Stdb.StdbBuilder.groupPrechecked(
  LargeScaleModule,
  "Group29",
  {
    endpoint29_00: handler,
    endpoint29_01: handler,
    endpoint29_02: handler,
    endpoint29_03: handler,
    endpoint29_04: handler,
    endpoint29_05: handler,
    endpoint29_06: handler,
    endpoint29_07: handler,
    endpoint29_08: handler,
    endpoint29_09: handler,
  },
)

const LargeScaleLifecycleLive = Stdb.StdbBuilder.lifecycle(LargeScaleModule, {
  init: handler,
})

const LargeScaleLiveGroups = [
  Group00Live,
  Group01Live,
  Group02Live,
  Group03Live,
  Group04Live,
  Group05Live,
  Group06Live,
  Group07Live,
  Group08Live,
  Group09Live,
  Group10Live,
  Group11Live,
  Group12Live,
  Group13Live,
  Group14Live,
  Group15Live,
  Group16Live,
  Group17Live,
  Group18Live,
  Group19Live,
  Group20Live,
  Group21Live,
  Group22Live,
  Group23Live,
  Group24Live,
  Group25Live,
  Group26Live,
  Group27Live,
  Group28Live,
  Group29Live,
  LargeScaleLifecycleLive,
] as const

// @ts-expect-error build requires a runtime when group-authored handlers require custom services.
void build(LargeScaleModule, LargeScaleLiveGroups)

const LargeScalePlan = build(LargeScaleModule, LargeScaleLiveGroups, {
  runtime: Layer.succeed(ScaleRuntimeService, { value: "ok" }),
})
void LargeScalePlan
