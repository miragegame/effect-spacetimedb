import * as Match from "effect/Match"
import { canonicalNameForPolicy } from "../contract/canonical-name.ts"
import type { IndexAlgorithm } from "../contract/table-index.ts"
import type { ModuleSettings } from "../contract/settings.ts"
import type { AnyTableSpec } from "../contract/table.ts"

type MaterializedIndexBase = {
  readonly accessor: string
  readonly name: string
}

type MaterializedColumnListIndex = MaterializedIndexBase & {
  readonly algorithm: Exclude<IndexAlgorithm, "direct">
  readonly columns: ReadonlyArray<string>
}

type MaterializedDirectIndex = MaterializedIndexBase & {
  readonly algorithm: "direct"
  readonly column: string
}

export type MaterializedIndex =
  | MaterializedColumnListIndex
  | MaterializedDirectIndex

export type MaterializedUniqueConstraint = {
  readonly name: string
  readonly constraint: "unique"
  readonly columns: readonly [string, ...string[]]
}

export type MaterializedTableOptions = {
  readonly name: string
  readonly public: boolean
  readonly event?: true
  readonly indexes?: ReadonlyArray<MaterializedIndex>
  readonly constraints?: ReadonlyArray<MaterializedUniqueConstraint>
}

export const materializeIndexes = (
  tableSpec: AnyTableSpec,
  policy?: ModuleSettings["caseConversionPolicy"],
): ReadonlyArray<MaterializedIndex> =>
  tableSpec.indexes.map((index) => {
    const base = {
      accessor: index.name,
      name: `${canonicalNameForPolicy(policy, tableSpec.name)}_${canonicalNameForPolicy(policy, index.name)}`,
    }

    return Match.value(index.algorithm).pipe(
      Match.when("btree", () => ({
        ...base,
        algorithm: "btree" as const,
        columns: index.columns,
      })),
      Match.when("hash", () => ({
        ...base,
        algorithm: "hash" as const,
        columns: index.columns,
      })),
      Match.when("direct", () => {
        const [column, ...remainingColumns] = index.columns
        if (column === undefined || remainingColumns.length > 0) {
          throw new Error(
            `Table ${tableSpec.name} direct index ${index.name} must target exactly one column`,
          )
        }

        return {
          ...base,
          algorithm: "direct" as const,
          column,
        }
      }),
      Match.exhaustive,
    )
  })

export const materializeConstraints = (
  tableSpec: AnyTableSpec,
): ReadonlyArray<MaterializedUniqueConstraint> =>
  tableSpec.constraints.map((constraint) => {
    switch (constraint.kind) {
      case "unique": {
        const [firstColumn, ...remainingColumns] = constraint.columns
        if (firstColumn == null) {
          throw new Error(
            `Table ${tableSpec.name} unique constraint ${constraint.name} is missing a target column`,
          )
        }

        return {
          name: constraint.name,
          constraint: "unique" as const,
          columns: [firstColumn, ...remainingColumns],
        }
      }
      default:
        const _exhaustive: never = constraint.kind
        return _exhaustive
    }
  })

export const materializeTableOptions = (
  tableSpec: AnyTableSpec,
  policy?: ModuleSettings["caseConversionPolicy"],
): MaterializedTableOptions => {
  const options: {
    name: string
    public: boolean
    event?: true
    indexes?: Array<MaterializedIndex>
    constraints?: Array<MaterializedUniqueConstraint>
  } = {
    name: tableSpec.name,
    public: tableSpec.public,
  }

  if (tableSpec.event) {
    options.event = true
  }

  if (tableSpec.indexes.length > 0) {
    options.indexes = [...materializeIndexes(tableSpec, policy)]
  }

  if (tableSpec.constraints.length > 0) {
    options.constraints = [...materializeConstraints(tableSpec)]
  }

  return options
}
