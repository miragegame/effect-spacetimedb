import * as Match from "effect/Match"

import * as AST from "effect/SchemaAST"

import { stringLiteralSatsVariantTag } from "../literal-tags.ts"

import {
  annotationInEncodedShape,
  encodedAst,
  StdbTypeInfoAnnotationId,
} from "../schema-annotations.ts"
import {
  arrayRestAst,
  literalValuesFromAst,
  literalValueTuple,
  optionMemberAst,
} from "./ast-helpers.ts"
import type {
  AnyTypeBuilder,
  AnyValueType,
  BuilderFactories,
  PrimitiveLiteral,
  TypeKind,
  ValueTypeInfo,
} from "./core.ts"
import { isStringLiteralTuple } from "./literal-utils.ts"
import { typeInfo } from "./metadata.ts"
import {
  arrayFingerprint,
  enumFingerprint,
  makeContentAddressedNameFactory,
  optionFingerprint,
  primitiveFingerprint,
  productFingerprint,
  recursiveFingerprint,
  type SatsTypeNameKind,
  sumFingerprint,
} from "./name.ts"
import { hasOptionalFieldOption, isUnitValueType } from "./predicates.ts"

export const typeBuilderCaches = new WeakMap<
  object,
  WeakMap<object, AnyTypeBuilder>
>()

export const namedTypeBuilderCaches = new WeakMap<
  object,
  Map<string, AnyTypeBuilder>
>()

export const contentAddressedNameFactories = new WeakMap<
  object,
  ReturnType<typeof makeContentAddressedNameFactory>
>()

export type FingerprintState = {
  readonly active: WeakMap<object, string>
  readonly cache: WeakMap<object, string>
  nextId: number
}

export const typeBuilderCacheFor = (factories: BuilderFactories) => {
  const cacheKey = factories as object
  const cached = typeBuilderCaches.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const cache = new WeakMap<object, AnyTypeBuilder>()
  typeBuilderCaches.set(cacheKey, cache)
  return cache
}

export const namedTypeBuilderCacheFor = (
  factories: BuilderFactories,
): Map<string, AnyTypeBuilder> => {
  const cacheKey = factories as object
  const cached = namedTypeBuilderCaches.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const cache = new Map<string, AnyTypeBuilder>()
  namedTypeBuilderCaches.set(cacheKey, cache)
  return cache
}

const contentAddressedNameFactoryFor = (
  factories: BuilderFactories,
): ReturnType<typeof makeContentAddressedNameFactory> => {
  const cacheKey = factories as object
  const cached = contentAddressedNameFactories.get(cacheKey)
  if (cached != null) {
    return cached
  }

  const factory = makeContentAddressedNameFactory()
  contentAddressedNameFactories.set(cacheKey, factory)
  return factory
}

export const resetTypeBuilderCachesFor = (
  factories: BuilderFactories,
): void => {
  const cacheKey = factories as object
  // WeakMap has no clear(); dropping the inner cache resets this factory key
  // while preserving the process-wide outer WeakMap.
  typeBuilderCaches.delete(cacheKey)
  namedTypeBuilderCaches.get(cacheKey)?.clear()
  contentAddressedNameFactories.delete(cacheKey)
}

const namedSatsTypeBuilderCacheKey = (
  kind: SatsTypeNameKind,
  identifier: string | undefined,
  fingerprint: string,
): string => `${kind}\0${identifier ?? ""}\0${fingerprint}`

export const seedNamedSatsTypeBuilder = (
  factories: BuilderFactories,
  kind: SatsTypeNameKind,
  fingerprint: string,
  builder: AnyTypeBuilder,
  identifier?: string,
): void => {
  namedTypeBuilderCacheFor(factories).set(
    namedSatsTypeBuilderCacheKey(kind, identifier, fingerprint),
    builder,
  )
}

export const makeFingerprintState = (): FingerprintState => ({
  active: new WeakMap<object, string>(),
  cache: new WeakMap<object, string>(),
  nextId: 0,
})

export const withRecursiveFingerprint = (
  key: object,
  state: FingerprintState,
  evaluate: () => string,
): string => {
  const cached = state.cache.get(key)
  if (cached !== undefined) {
    return cached
  }

  const active = state.active.get(key)
  if (active !== undefined) {
    return recursiveFingerprint(active)
  }

  const ref = `r${state.nextId}`
  state.nextId += 1
  state.active.set(key, ref)

  try {
    const fingerprint = evaluate()
    state.cache.set(key, fingerprint)
    return fingerprint
  } finally {
    state.active.delete(key)
  }
}

export const forkFingerprintState = (
  state: FingerprintState,
): FingerprintState => ({
  active: state.active,
  cache: new WeakMap<object, string>(),
  nextId: state.nextId,
})

export const primitiveLiteralFingerprint = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): string => {
  const first = values[0]
  const expectedType = typeof first

  if (values.some((value) => typeof value !== expectedType)) {
    throw new Error("Type.literal(...) must use a single primitive kind")
  }

  if (typeof first === "string") {
    return primitiveFingerprint("String")
  }

  if (typeof first === "boolean") {
    return primitiveFingerprint("Bool")
  }

  return primitiveFingerprint("F64")
}

export const unitFingerprint = (): string => primitiveFingerprint("Unit")

export const literalEnumFingerprint = (
  variantTags: ReadonlyArray<string>,
): string =>
  enumFingerprint(variantTags.map((tag) => [tag, unitFingerprint()] as const))

export const literalValueTypeFingerprint = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): string =>
  isStringLiteralTuple(values)
    ? literalEnumFingerprint(values.map(stringLiteralSatsVariantTag))
    : primitiveLiteralFingerprint(values)

export const unsupportedPrimitiveFingerprint = (kind: TypeKind): never => {
  throw new Error(`Type kind ${kind} is not a primitive SATS type`)
}

export const primitiveValueTypeFingerprint = (kind: TypeKind): string => {
  const primitiveMatcher = Match.value(kind).pipe(
    Match.when("array", () => unsupportedPrimitiveFingerprint("array")),
    Match.when("bigint", () => primitiveFingerprint("String")),
    Match.when("bool", () => primitiveFingerprint("Bool")),
    Match.when("bytes", () => arrayFingerprint(primitiveFingerprint("U8"))),
    Match.when("connectionId", () => primitiveFingerprint("ConnectionId")),
    Match.when("custom", () => unsupportedPrimitiveFingerprint("custom")),
    Match.when("f32", () => primitiveFingerprint("F32")),
    Match.when("f64", () => primitiveFingerprint("F64")),
    Match.when("i128", () => primitiveFingerprint("I128")),
    Match.when("i16", () => primitiveFingerprint("I16")),
    Match.when("i256", () => primitiveFingerprint("I256")),
    Match.when("i32", () => primitiveFingerprint("I32")),
    Match.when("i64", () => primitiveFingerprint("I64")),
    Match.when("i8", () => primitiveFingerprint("I8")),
    Match.when("identity", () => primitiveFingerprint("Identity")),
    Match.when("lazy", () => unsupportedPrimitiveFingerprint("lazy")),
    Match.when("literal", () => unsupportedPrimitiveFingerprint("literal")),
    Match.when("option", () => unsupportedPrimitiveFingerprint("option")),
    Match.when("result", () => unsupportedPrimitiveFingerprint("result")),
  )

  return primitiveMatcher.pipe(
    Match.when("scheduleAt", () => primitiveFingerprint("ScheduleAt")),
    Match.when("string", () => primitiveFingerprint("String")),
    Match.when("struct", () => unsupportedPrimitiveFingerprint("struct")),
    Match.when("sum", () => unsupportedPrimitiveFingerprint("sum")),
    Match.when("timeDuration", () => primitiveFingerprint("TimeDuration")),
    Match.when("timestamp", () => primitiveFingerprint("Timestamp")),
    Match.when("u128", () => primitiveFingerprint("U128")),
    Match.when("u16", () => primitiveFingerprint("U16")),
    Match.when("u256", () => primitiveFingerprint("U256")),
    Match.when("u32", () => primitiveFingerprint("U32")),
    Match.when("u64", () => primitiveFingerprint("U64")),
    Match.when("u8", () => primitiveFingerprint("U8")),
    Match.when("unit", () => unitFingerprint()),
    Match.when("uuid", () => primitiveFingerprint("Uuid")),
    Match.exhaustive,
  )
}

export const structFieldValueTypeFingerprint = (
  field: AnyValueType,
  state: FingerprintState,
): string =>
  hasOptionalFieldOption(field)
    ? optionFingerprint(embeddedValueTypeFingerprint(field, state))
    : embeddedValueTypeFingerprint(field, state)

export const valueTypeInfoFingerprint = (
  info: ValueTypeInfo,
  state: FingerprintState,
): string => {
  switch (info.kind) {
    case "array":
      return arrayFingerprint(
        embeddedValueTypeFingerprint(
          info.item ??
            (() => {
              throw new Error("Array value type is missing item metadata")
            })(),
          state,
        ),
      )
    case "custom":
      return info.item != null
        ? embeddedValueTypeFingerprint(info.item, state)
        : primitiveFingerprint("Custom")
    case "lazy": {
      const lazyValue = info.lazy
      if (lazyValue == null) {
        throw new Error("Lazy value type is missing lazy metadata")
      }

      return embeddedValueTypeFingerprint(lazyValue(), state)
    }
    case "literal":
      return literalValueTypeFingerprint(
        info.values ??
          (() => {
            throw new Error("Literal value type is missing values metadata")
          })(),
      )
    case "option":
      return optionFingerprint(
        embeddedValueTypeFingerprint(
          info.item ??
            (() => {
              throw new Error("Option value type is missing item metadata")
            })(),
          state,
        ),
      )
    case "result": {
      const [ok, err] = info.members ?? []
      if (ok == null || err == null) {
        throw new Error("Result value type is missing member metadata")
      }

      return sumFingerprint([
        ["ok", valueTypePayloadFingerprint(ok, state)],
        ["err", valueTypePayloadFingerprint(err, state)],
      ])
    }
    case "struct":
      return productFingerprint(
        Object.entries(info.fields ?? {}).map(([fieldName, field]) => [
          fieldName,
          structFieldValueTypeFingerprint(field, state),
        ]),
      )
    case "sum":
      return sumFingerprint(
        Object.entries(info.variants ?? {}).map(([tag, variant]) => [
          tag,
          valueTypePayloadFingerprint(variant, state),
        ]),
      )
    case "bigint":
    case "bool":
    case "bytes":
    case "connectionId":
    case "f32":
    case "f64":
    case "identity":
    case "i8":
    case "i16":
    case "i32":
    case "i64":
    case "i128":
    case "i256":
    case "scheduleAt":
    case "string":
    case "timeDuration":
    case "timestamp":
    case "u8":
    case "u16":
    case "u32":
    case "u64":
    case "u128":
    case "u256":
    case "unit":
    case "uuid":
      return primitiveValueTypeFingerprint(info.kind)
    default:
      const _exhaustive: never = info.kind
      return _exhaustive
  }
}

export const valueTypeFingerprint = (
  value: AnyValueType,
  state: FingerprintState = makeFingerprintState(),
): string =>
  withRecursiveFingerprint(value as object, state, () => {
    const info = typeInfo(value)
    return info != null
      ? valueTypeInfoFingerprint(info, state)
      : astFingerprint(value.schema.ast, state)
  })

export const embeddedValueTypeFingerprint = (
  value: AnyValueType,
  state: FingerprintState,
): string => valueTypeFingerprint(value, forkFingerprintState(state))

export const valueTypePayloadFingerprint = (
  value: AnyValueType,
  state: FingerprintState,
): string =>
  isUnitValueType(value)
    ? unitFingerprint()
    : embeddedValueTypeFingerprint(value, state)

export const astLiteralFingerprint = (ast: AST.Literal): string => {
  const values = literalValueTuple([ast.literal])
  if (values == null) {
    throw new Error(
      `Cannot fingerprint unsupported literal ${String(ast.literal)}`,
    )
  }

  return primitiveLiteralFingerprint(values)
}

export const astFingerprint = (ast: AST.AST, state: FingerprintState): string =>
  withRecursiveFingerprint(ast as object, state, () => {
    const normalized = encodedAst(ast)
    if (normalized !== ast) {
      return astFingerprint(normalized, state)
    }

    const info = annotationInEncodedShape<ValueTypeInfo>(
      StdbTypeInfoAnnotationId,
      ast,
    )
    if (info != null) {
      return valueTypeInfoFingerprint(info, state)
    }

    if (AST.isSuspend(ast)) {
      return embeddedAstFingerprint(ast.thunk(), state)
    }

    if (AST.isVoid(ast)) {
      return unitFingerprint()
    }

    if (AST.isLiteral(ast)) {
      return astLiteralFingerprint(ast)
    }

    if (AST.isUnion(ast)) {
      const optionValue = optionMemberAst(ast)
      if (optionValue != null) {
        return optionFingerprint(embeddedAstFingerprint(optionValue, state))
      }

      const values = literalValuesFromAst(ast)
      if (values != null) {
        return primitiveLiteralFingerprint(values)
      }
    }

    if (AST.isArrays(ast)) {
      const rest = arrayRestAst(ast)
      if (rest != null) {
        return arrayFingerprint(embeddedAstFingerprint(rest, state))
      }
    }

    if (AST.isObjects(ast)) {
      return productFingerprint(
        ast.propertySignatures.map((property) => {
          if (typeof property.name !== "string") {
            throw new Error(
              "SpacetimeDB struct lowering requires string property names",
            )
          }

          return [property.name, embeddedAstFingerprint(property.type, state)]
        }),
      )
    }

    throw new Error(
      `Cannot fingerprint unsupported Effect Schema AST ${ast._tag}`,
    )
  })

export const embeddedAstFingerprint = (
  ast: AST.AST,
  state: FingerprintState,
): string => astFingerprint(ast, forkFingerprintState(state))

export const satsTypeFingerprint = (value: AnyValueType): string =>
  valueTypeFingerprint(value)

export const contentAddressedSatsTypeBuilder = (
  factories: BuilderFactories,
  kind: SatsTypeNameKind,
  fingerprint: string,
  build: (name: string) => AnyTypeBuilder,
  identifier?: string,
): AnyTypeBuilder => {
  const name =
    identifier ?? contentAddressedNameFactoryFor(factories)(kind, fingerprint)
  const cacheKey = namedSatsTypeBuilderCacheKey(kind, identifier, fingerprint)
  const cache = namedTypeBuilderCacheFor(factories)
  const cached = cache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const builder = build(name)
  cache.set(cacheKey, builder)
  return builder
}
