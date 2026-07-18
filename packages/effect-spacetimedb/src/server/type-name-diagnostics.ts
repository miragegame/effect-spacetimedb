import { pascalCaseName } from "../contract/canonical-name.ts"
import {
  makeStdbDiagnostic,
  type StdbDiagnostic,
} from "../contract/diagnostic.ts"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { AnyTypeBuilder, BuilderFactories } from "../contract/type/core.ts"
import {
  arrayFingerprint,
  enumFingerprint,
  optionFingerprint,
  primitiveFingerprint,
  productFingerprint,
  recursiveFingerprint,
  sumFingerprint,
} from "../contract/type/name.ts"
import * as Type from "../contract/type.ts"

type RecordedBuilder = AnyTypeBuilder & {
  readonly fingerprint: string
  readonly kind: string
  readonly typeName?: string
}

type MaterializedTypeName = {
  readonly name: string
  readonly fingerprint: string
  readonly path: ReadonlyArray<string | number>
}

type Recorder = {
  readonly entries: ReadonlyArray<MaterializedTypeName>
  readonly factories: BuilderFactories
  readonly addNamedType: (
    name: string,
    fingerprint: string,
    path: ReadonlyArray<string | number>,
  ) => void
}

const builderFingerprint = (builder: AnyTypeBuilder): string =>
  typeof (builder as Partial<RecordedBuilder>).fingerprint === "string"
    ? (builder as RecordedBuilder).fingerprint
    : recursiveFingerprint("unresolved")

const makeRecorder = (): Recorder => {
  const entries: Array<MaterializedTypeName> = []

  const addNamedType = (
    name: string,
    fingerprint: string,
    path: ReadonlyArray<string | number>,
  ): void => {
    entries.push({ name, fingerprint, path })
  }

  const makeBuilder = (options: {
    readonly kind: string
    readonly fingerprint: string
    readonly algebraicType: AnyTypeBuilder["algebraicType"]
    readonly typeName?: string
  }): RecordedBuilder => {
    const builder: RecordedBuilder = {
      kind: options.kind,
      fingerprint: options.fingerprint,
      ...(options.typeName === undefined ? {} : { typeName: options.typeName }),
      algebraicType: options.algebraicType,
      type: undefined,
      optional: (): AnyTypeBuilder => factories.option(builder),
      serialize: (value: unknown) => value,
      deserialize: (value: unknown) => value,
    }

    return builder
  }

  const primitive = (kind: string): RecordedBuilder =>
    makeBuilder({
      kind,
      fingerprint: primitiveFingerprint(kind),
      algebraicType: { tag: kind },
    })

  const unit = (): RecordedBuilder =>
    makeBuilder({
      kind: "unit",
      fingerprint: primitiveFingerprint("Unit"),
      algebraicType: { tag: "Unit" },
    })

  const factories: BuilderFactories = {
    lazy: (build) => {
      const resolved = build()
      return makeBuilder({
        kind: "lazy",
        fingerprint: builderFingerprint(resolved),
        algebraicType: {
          tag: "Lazy",
          value: resolved.algebraicType,
        },
      })
    },
    string: () => primitive("String"),
    bool: () => primitive("Bool"),
    i8: () => primitive("I8"),
    u8: () => primitive("U8"),
    i16: () => primitive("I16"),
    u16: () => primitive("U16"),
    i32: () => primitive("I32"),
    f64: () => primitive("F64"),
    f32: () => primitive("F32"),
    u32: () => primitive("U32"),
    i64: () => primitive("I64"),
    u64: () => primitive("U64"),
    i128: () => primitive("I128"),
    u128: () => primitive("U128"),
    i256: () => primitive("I256"),
    u256: () => primitive("U256"),
    byteArray: () =>
      makeBuilder({
        kind: "bytes",
        fingerprint: arrayFingerprint(primitiveFingerprint("U8")),
        algebraicType: { tag: "Array" },
      }),
    uuid: () => primitive("Uuid"),
    identity: () => primitive("Identity"),
    connectionId: () => primitive("ConnectionId"),
    timestamp: () => primitive("Timestamp"),
    scheduleAt: () => primitive("ScheduleAt"),
    timeDuration: () => primitive("TimeDuration"),
    unit,
    option: (builder) =>
      makeBuilder({
        kind: "option",
        fingerprint: optionFingerprint(builderFingerprint(builder)),
        algebraicType: {
          tag: "Option",
          value: builder.algebraicType,
        },
      }),
    result: (ok, err) =>
      makeBuilder({
        kind: "result",
        fingerprint: sumFingerprint([
          ["ok", builderFingerprint(ok)],
          ["err", builderFingerprint(err)],
        ]),
        algebraicType: {
          tag: "Sum",
          value: {
            variants: [
              { name: "ok", algebraicType: ok.algebraicType },
              { name: "err", algebraicType: err.algebraicType },
            ],
          },
        },
      }),
    array: (builder) =>
      makeBuilder({
        kind: "array",
        fingerprint: arrayFingerprint(builderFingerprint(builder)),
        algebraicType: {
          tag: "Array",
          value: builder.algebraicType,
        },
      }),
    object: (name, fields) => {
      const fingerprint = productFingerprint(
        Object.entries(fields).map(([fieldName, builder]) => [
          fieldName,
          builderFingerprint(builder),
        ]),
      )
      addNamedType(name, fingerprint, ["types", name])

      return makeBuilder({
        kind: "object",
        typeName: name,
        fingerprint,
        algebraicType: {
          tag: "Product",
          value: {
            elements: Object.entries(fields).map(([fieldName, builder]) => ({
              name: fieldName,
              algebraicType: builder.algebraicType,
            })),
          },
        },
      })
    },
    enum: (name, variants) => {
      const variantEntries = Array.isArray(variants)
        ? variants.map((tag) => [tag, unit()] as const)
        : Object.entries(variants)
      const allUnitVariants = variantEntries.every(
        ([, builder]) =>
          builderFingerprint(builder) === primitiveFingerprint("Unit"),
      )
      const fingerprint = allUnitVariants
        ? enumFingerprint(
            variantEntries.map(([tag]) => [tag, primitiveFingerprint("Unit")]),
          )
        : sumFingerprint(
            variantEntries.map(([tag, builder]) => [
              tag,
              builderFingerprint(builder),
            ]),
          )
      addNamedType(name, fingerprint, ["types", name])

      return makeBuilder({
        kind: "enum",
        typeName: name,
        fingerprint,
        algebraicType: {
          tag: "Sum",
          value: {
            variants: variantEntries.map(([tag, builder]) => ({
              name: tag,
              algebraicType: builder.algebraicType,
            })),
          },
        },
      })
    },
  }

  return { entries, factories, addNamedType }
}

const materializeValue = (
  recorder: Recorder,
  value: Type.AnyValueType,
  path: ReadonlyArray<string | number>,
): void => {
  Type.typeBuilderWithFactories(value, recorder.factories, path.join("."))
}

const materializeStructFields = (
  recorder: Recorder,
  fields: Type.StructFields,
  path: ReadonlyArray<string | number>,
): void => {
  for (const [fieldName, field] of Object.entries(fields)) {
    materializeValue(recorder, Type.structFieldWireType(field), [
      ...path,
      fieldName,
    ])
  }
}

const validateDuplicateEntries = (
  entries: ReadonlyArray<MaterializedTypeName>,
): ReadonlyArray<StdbDiagnostic> => {
  const diagnostics: Array<StdbDiagnostic> = []
  const seen = new Map<string, MaterializedTypeName>()

  for (const entry of entries) {
    const previous = seen.get(entry.name)
    if (previous === undefined) {
      seen.set(entry.name, entry)
      continue
    }

    if (previous.fingerprint === entry.fingerprint) {
      continue
    }

    diagnostics.push(
      makeStdbDiagnostic(
        "DuplicateTypeName",
        entry.path,
        `SATS type name ${entry.name} is used for multiple different structures`,
      ),
    )
  }

  return diagnostics
}

export const validateMaterializedTypeNames = (
  module: AnyModuleSpec,
): ReadonlyArray<StdbDiagnostic> => {
  const recorder = makeRecorder()

  for (const [tableKey, table] of Object.entries(module.tables)) {
    recorder.addNamedType(
      pascalCaseName(table.name),
      Type.satsTypeFingerprint(table.row),
      ["tables", tableKey],
    )
    materializeStructFields(recorder, table.columns, ["tables", tableKey])
  }

  for (const [key, reducer] of Object.entries(module.reducers)) {
    materializeStructFields(recorder, Type.structFields(reducer.params) ?? {}, [
      "reducers",
      key,
      "params",
    ])
  }

  for (const [key, procedure] of Object.entries(module.procedures)) {
    materializeStructFields(
      recorder,
      Type.structFields(procedure.params) ?? {},
      ["procedures", key, "params"],
    )
    materializeValue(recorder, procedure.returns, [
      "procedures",
      key,
      "returns",
    ])
  }

  for (const [key, view] of Object.entries(module.views)) {
    materializeValue(recorder, view.returns, ["views", key, "returns"])
  }

  return validateDuplicateEntries(recorder.entries)
}
