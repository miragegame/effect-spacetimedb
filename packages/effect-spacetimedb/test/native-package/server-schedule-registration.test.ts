import * as path from "node:path"
import { fileURLToPath } from "node:url"
import * as EffectVitest from "@effect/vitest"
import type { ScheduleRegistrationProbe } from "./fixtures/schedule-registration-entry"
import { withHostModule } from "./fixtures/host-module-bundle"

const { describe, expect, it } = EffectVitest

const entrypoint = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "schedule-registration-entry.ts",
)

const spacetimeSysStub = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "testing",
  "spacetime-sys.ts",
)

describe("scheduled target registration", () => {
  it("registers scheduled reducers and procedures against their tables", async () => {
    const observed = await withHostModule(
      {
        label: "schedule-registration",
        entrypoint,
        sysModulePath: spacetimeSysStub,
      },
      (loaded) => (loaded.probe as () => ScheduleRegistrationProbe)(),
    )

    expect(observed.reducerNames).toContain("sweep_pools")
    expect(observed.procedureNames).toContain("send_digest")

    expect(observed.schedules).toEqual([
      {
        sourceName: undefined,
        tableName: "sweepSchedule",
        scheduleAtCol: observed.scheduleAtColumnIndexes.sweepSchedule,
        functionName: "sweep_pools",
      },
      {
        sourceName: undefined,
        tableName: "digestSchedule",
        scheduleAtCol: observed.scheduleAtColumnIndexes.digestSchedule,
        functionName: "send_digest",
      },
    ])

    // A scheduled table exposes its `ScheduleAt` column to the schedule
    // definition; it is the second column a scheduled table declares.
    expect(observed.scheduleAtColumnIndexes).toEqual({
      sweepSchedule: 1,
      digestSchedule: 1,
    })

    // Two schedules on one table are our typed validation failure, not the
    // SDK's bare TypeError.
    expect(observed.duplicateScheduleFailure.tag).toBe("StdbValidationError")
    expect(observed.duplicateScheduleFailure.diagnosticCodes).toContain(
      "DuplicateScheduleTarget",
    )
  })
})
