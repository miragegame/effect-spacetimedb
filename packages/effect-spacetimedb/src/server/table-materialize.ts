import { pascalCaseName } from "../contract/canonical-name.ts"
import { type AnyFieldType, fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import { tableRowSource, type AnyTableSpec } from "../contract/table.ts"
import { encodeHostValue } from "../contract/type/host-codec.ts"
import * as Type from "../contract/type.ts"
import {
  applyCompilerAutoInc,
  applyCompilerColumnName,
  applyCompilerDefault,
  applyCompilerPrimaryKey,
  applyOptional,
  defineCompilerRow,
  defineCompilerTable,
  seedCompilerNamedTypeBuilder,
  setCompilerTypeBuilderName,
  toCompilerTypeBuilder,
  withCompilerScheduledTarget,
} from "./compiler-interop.ts"
import { materializeTableOptions } from "./table-options.ts"

type ScheduledResolver = (targetKey: string) => unknown

type MaterializedField = {
  readonly builder: unknown
}

type TableEntry = readonly [string, AnyTableSpec]

export const materializeParamsObject = (
  name: string,
  type: Type.AnyValueType,
  overrides: Readonly<Record<string, unknown>> = {},
  path = name,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(
      Type.structFields(type) ??
        (() => {
          throw new Error(`${name} must be authored with Type.struct(...)`)
        })(),
    ).map(([fieldName, fieldType]) => {
      const wireFieldType = Type.structFieldWireType(fieldType)
      return [
        fieldName,
        fieldName in overrides
          ? overrides[fieldName]
          : materializeTypeBuilder(wireFieldType, `${path}.${fieldName}`),
      ]
    }),
  )

const encodedDefaultValue = (field: AnyFieldType): unknown => {
  const options = fieldOptions(field)
  return encodeHostValue(field, options.defaultValue)
}

const materializeTypeBuilder = (
  field: Type.AnyValueType,
  path: string,
): unknown => toCompilerTypeBuilder(field, path)

const materializeField = (
  path: string,
  field: AnyFieldType,
): MaterializedField => {
  const options = fieldOptions(field)
  let builder: unknown = materializeTypeBuilder(field, path)

  if (options.optional) {
    builder = applyOptional(builder)
  }

  if (options.hasDefault) {
    // Optional columns with no authored value intentionally remain defaultless.
    if (!(options.optional && options.defaultValue === undefined)) {
      const encodedDefault = encodedDefaultValue(field)
      builder = applyCompilerDefault(builder, encodedDefault)
    }
  }

  if (options.primaryKey) {
    builder = applyCompilerPrimaryKey(builder)
  }

  if (options.autoInc) {
    builder = applyCompilerAutoInc(builder)
  }

  if (options.name !== undefined) {
    builder = applyCompilerColumnName(builder, options.name)
  }

  return { builder }
}

const materializeFields = (tableSpec: AnyTableSpec) =>
  Object.entries(tableSpec.columns).map(
    ([columnName, field]) =>
      [
        columnName,
        materializeField(
          `tables.${tableSpec.name}.columns.${columnName}`,
          field,
        ),
      ] as const,
  )

const materializeRow = (
  fields: ReadonlyArray<readonly [string, MaterializedField]>,
): Record<string, unknown> =>
  Object.fromEntries(
    fields.map(([columnName, field]) => [columnName, field.builder]),
  )

const materializeTable = (
  tableSpec: AnyTableSpec,
  policy: AnyModuleSpec["settings"]["caseConversionPolicy"],
  scheduledTargetKey: string | undefined,
  resolveScheduledTarget: ScheduledResolver,
): unknown => {
  const options = materializeTableOptions(tableSpec, policy)
  const fields = materializeFields(tableSpec)
  const row = defineCompilerRow(materializeRow(fields))
  const rowName = pascalCaseName(tableSpec.name)
  setCompilerTypeBuilderName(row, rowName)
  seedCompilerNamedTypeBuilder(
    "Struct",
    rowName,
    Type.satsTypeFingerprint(tableSpec.row),
    row,
  )

  // Upstream TS helper types still narrow explicit scheduled targets and
  // constraint columns more tightly than the raw schema builder accepts.
  const tableOptions =
    scheduledTargetKey === undefined
      ? options
      : withCompilerScheduledTarget(options, () =>
          resolveScheduledTarget(scheduledTargetKey),
        )

  return defineCompilerTable(tableOptions, row)
}

const collectRowDependencies = (
  value: Type.AnyValueType,
  rowSourceKeys: WeakMap<object, string>,
  dependencies: Set<string>,
  seen: WeakSet<object>,
): void => {
  if (seen.has(value as object)) {
    return
  }
  seen.add(value as object)

  const source = tableRowSource(value)
  const dependencyKey =
    source === undefined ? undefined : rowSourceKeys.get(source as object)
  if (dependencyKey !== undefined) {
    dependencies.add(dependencyKey)
  }

  const info = Type.typeInfo(value)
  if (info == null) {
    return
  }

  switch (info.kind) {
    case "array":
    case "custom":
    case "option":
      if (info.item !== undefined) {
        collectRowDependencies(info.item, rowSourceKeys, dependencies, seen)
      }
      return
    case "lazy":
      if (info.lazy !== undefined) {
        collectRowDependencies(info.lazy(), rowSourceKeys, dependencies, seen)
      }
      return
    case "result":
      for (const member of info.members ?? []) {
        collectRowDependencies(member, rowSourceKeys, dependencies, seen)
      }
      return
    case "struct":
      for (const field of Object.values(info.fields ?? {})) {
        collectRowDependencies(field, rowSourceKeys, dependencies, seen)
      }
      return
    case "sum":
      for (const variant of Object.values(info.variants ?? {})) {
        collectRowDependencies(variant, rowSourceKeys, dependencies, seen)
      }
      return
    case "bigint":
    case "bool":
    case "bytes":
    case "connectionId":
    case "f32":
    case "f64":
    case "i128":
    case "i16":
    case "i256":
    case "i32":
    case "i64":
    case "i8":
    case "identity":
    case "literal":
    case "scheduleAt":
    case "string":
    case "timeDuration":
    case "timestamp":
    case "u128":
    case "u16":
    case "u256":
    case "u32":
    case "u64":
    case "u8":
    case "unit":
    case "uuid":
      return
    default: {
      const _exhaustive: never = info.kind
      return _exhaustive
    }
  }
}

const tableRowDependencies = (
  tableSpec: AnyTableSpec,
  rowSourceKeys: WeakMap<object, string>,
): ReadonlySet<string> => {
  const dependencies = new Set<string>()
  for (const column of Object.values(tableSpec.columns)) {
    collectRowDependencies(column, rowSourceKeys, dependencies, new WeakSet())
  }
  return dependencies
}

const tableEntriesInDependencyOrder = (
  tables: Record<string, AnyTableSpec>,
): ReadonlyArray<TableEntry> => {
  const entries = Object.entries(tables) as Array<TableEntry>
  const entriesByKey = new Map(entries.map((entry) => [entry[0], entry]))
  const rowSourceKeys = new WeakMap<object, string>()
  for (const [tableKey, tableSpec] of entries) {
    rowSourceKeys.set(tableSpec.row as object, tableKey)
  }

  const dependenciesByKey = new Map(
    entries.map(([tableKey, tableSpec]) => [
      tableKey,
      [...tableRowDependencies(tableSpec, rowSourceKeys)].filter((key) =>
        entriesByKey.has(key),
      ),
    ]),
  )
  const ordered: Array<TableEntry> = []
  const visited = new Set<string>()
  const visiting = new Set<string>()

  const visit = (tableKey: string, path: ReadonlyArray<string>): void => {
    if (visited.has(tableKey)) {
      return
    }
    if (visiting.has(tableKey)) {
      throw new Error(
        `Cyclic table row column dependency: ${[...path, tableKey].join(" -> ")}`,
      )
    }

    visiting.add(tableKey)
    for (const dependencyKey of dependenciesByKey.get(tableKey) ?? []) {
      visit(dependencyKey, [...path, tableKey])
    }
    visiting.delete(tableKey)
    visited.add(tableKey)

    const entry = entriesByKey.get(tableKey)
    if (entry !== undefined) {
      ordered.push(entry)
    }
  }

  for (const [tableKey] of entries) {
    visit(tableKey, [])
  }

  return ordered
}

export const materializeTables = <Module extends AnyModuleSpec>(options: {
  readonly module: Module
  readonly scheduleBindings: ReadonlyArray<{
    readonly tableKey: string
    readonly targetKey: string
  }>
  readonly resolveScheduledTarget: ScheduledResolver
}): Record<string, unknown> =>
  Object.fromEntries(
    tableEntriesInDependencyOrder(options.module.tables).map(
      ([tableKey, tableSpec]) => {
        const scheduleBinding = options.scheduleBindings.find(
          (binding) => binding.tableKey === tableKey,
        )

        return [
          tableKey,
          materializeTable(
            tableSpec,
            options.module.settings.caseConversionPolicy,
            scheduleBinding?.targetKey,
            options.resolveScheduledTarget,
          ),
        ]
      },
    ),
  )
