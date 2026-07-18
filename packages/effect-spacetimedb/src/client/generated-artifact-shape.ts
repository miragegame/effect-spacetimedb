import * as Data from "effect/Data"
import * as Match from "effect/Match"
import type { AnyModuleSpec } from "../contract/module.ts"
import { errorTypeId, hasErrorTypeId } from "../error-identity.ts"
import type { ModulePlan } from "../module-plan.ts"
import { typedEntries } from "../utils.ts"
import type { ManagedWsConnection } from "./generated-ws-adapter.ts"
import { type ClientIndexPlan, clientIndexPlansOf } from "./client-index.ts"

type UnsupportedClientIndexPlan = Extract<
  ClientIndexPlan,
  { readonly kind: "unsupported-algorithm" }
>
type SupportedClientIndexPlan = Extract<
  ClientIndexPlan,
  { readonly kind: "range" | "unique" }
>

const GeneratedArtifactShapeErrorTypeId = errorTypeId(
  "GeneratedArtifactShapeError",
)

export class GeneratedArtifactShapeError extends Data.TaggedError(
  "GeneratedArtifactShapeError",
)<{
  readonly missingKeys: ReadonlyArray<string>
  readonly unsupportedIndexes: ReadonlyArray<string>
  readonly moduleName: string
  readonly regenerateHint: "Regenerate the generated client artifact for this module"
}> {
  readonly [GeneratedArtifactShapeErrorTypeId] =
    GeneratedArtifactShapeErrorTypeId
  static is = hasErrorTypeId<GeneratedArtifactShapeError>(
    GeneratedArtifactShapeErrorTypeId,
  )
}

export const generatedArtifactShapeError = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(
  plan: ModulePlan<Module>,
  connection: ManagedWsConnection<Module, ErrorContext, RelationContext>,
): GeneratedArtifactShapeError | undefined => {
  const db: unknown = (connection as { readonly db?: unknown }).db
  const expectedKeys = [
    ...Object.keys(plan.publicTables),
    ...Object.keys(plan.publicEventTables),
  ]
  if (typeof db !== "object" || db === null) {
    return new GeneratedArtifactShapeError({
      missingKeys: expectedKeys,
      unsupportedIndexes: [],
      moduleName: plan.module.name,
      regenerateHint:
        "Regenerate the generated client artifact for this module",
    })
  }

  const missingKeys = expectedKeys.filter((key) => !Object.hasOwn(db, key))
  const unsupportedIndexes: Array<string> = []
  for (const [key, table] of typedEntries(plan.publicTables)) {
    if (!Object.hasOwn(db, key)) continue
    const indexPlans = clientIndexPlansOf(table)
    const unsupported: Array<UnsupportedClientIndexPlan> = []
    const supported: Array<SupportedClientIndexPlan> = []
    for (const index of indexPlans) {
      Match.value(index).pipe(
        Match.discriminatorsExhaustive("kind")({
          "unsupported-algorithm": (unsupportedIndex) => {
            unsupported.push(unsupportedIndex)
          },
          range: (rangeIndex) => {
            supported.push(rangeIndex)
          },
          unique: (uniqueIndex) => {
            supported.push(uniqueIndex)
          },
        }),
      )
    }
    for (const index of unsupported) {
      unsupportedIndexes.push(`${key}.${index.key} (${index.algorithm})`)
    }
    if (unsupported.length > 0) continue

    const relation = (db as Record<string, unknown>)[key]
    if (typeof relation !== "object" || relation === null) {
      missingKeys.push(key)
      continue
    }
    if (
      typeof (relation as { readonly count?: unknown }).count !== "function"
    ) {
      missingKeys.push(`${key}.count`)
    }
    for (const index of supported) {
      const accessor = (relation as Record<string, unknown>)[index.key]
      const method = Match.value(index.kind).pipe(
        Match.when("unique", () => "find" as const),
        Match.when("range", () => "filter" as const),
        Match.exhaustive,
      )
      if (
        typeof accessor !== "object" ||
        accessor === null ||
        typeof (accessor as Record<string, unknown>)[method] !== "function"
      ) {
        missingKeys.push(`${key}.${index.key}.${method}`)
      }
    }
  }

  return missingKeys.length === 0 && unsupportedIndexes.length === 0
    ? undefined
    : new GeneratedArtifactShapeError({
        missingKeys,
        unsupportedIndexes,
        moduleName: plan.module.name,
        regenerateHint:
          "Regenerate the generated client artifact for this module",
      })
}
