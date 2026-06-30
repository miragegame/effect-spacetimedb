import { type AnyFieldType, fieldOptions } from "../contract/field.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTableSpec } from "../contract/table.ts"
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
  toCompilerTypeBuilder,
  withCompilerScheduledTarget,
} from "./compiler-interop.ts"
import { materializeTableOptions } from "./table-options.ts"

type ScheduledResolver = (targetKey: string) => unknown

type MaterializedField = {
  readonly builder: unknown
}

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

export const materializeTables = <Module extends AnyModuleSpec>(options: {
  readonly module: Module
  readonly scheduleBindings: ReadonlyArray<{
    readonly tableKey: string
    readonly targetKey: string
  }>
  readonly resolveScheduledTarget: ScheduledResolver
}): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(options.module.tables).map(([tableKey, tableSpec]) => {
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
    }),
  )
