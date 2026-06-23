import * as Schema from "effect/Schema"

import * as AST from "effect/SchemaAST"

import { typedFromEntries } from "../utils.ts"

import {
  annotationInEncodedShape,
  encodedAst,
  StdbFieldOptionsAnnotationId,
} from "./schema-annotations.ts"

import { productFingerprint, sumFingerprint } from "./type/name.ts"

import {
  appendPath,
  arrayRestAst,
  literalValuesFromAst,
  optionMemberAst,
  typeBuilderWithFactories,
} from "./type-builder-lowering.ts"

import { annotateValueTypeSchema, isValueType } from "./type-core.ts"

import {
  contentAddressedSatsTypeBuilder,
  embeddedValueTypeFingerprint,
  makeFingerprintState,
  valueTypePayloadFingerprint,
} from "./type-fingerprint.ts"

import {
  attachStdbType,
  hasTypeKind,
  typeInfo,
  valueSchemaFromAst,
} from "./type-metadata.ts"

import {
  assertNumericLiteralPrecision,
  isStringLiteralTuple,
  resolveLiteralBuilder,
  stringLiteralSchema,
} from "./type-primitives.ts"

import {
  makeExactResultSchema,
  makeExactSumSchema,
  makeOptionSchema,
  makeStructSchema,
  makeSumVariantConstructors,
  narrowSchema,
} from "./type-wire-schema.ts"

import type {
  AnyNormalizedStructFieldOptions,
  AnyValueType,
  ArrayValueType,
  LazyValueType,
  LiteralValueType,
  OptionValueType,
  PrimitiveLiteral,
  ResultValueType,
  StructFieldOptions,
  StructFields,
  StructFieldType,
  StructValueType,
  SumValueType,
  SumVariants,
  UnitValueType,
  ValueType,
} from "./type-core.ts"

import type {
  FieldOptionsAnnotation,
  ResultType,
  ResultWire,
  SumType,
  SumWire,
} from "./type-wire-schema.ts"

/**
 * Literal value type.
 *
 * String literals lower to a native SATS enum whose DB/host and HTTP/JSON
 * variant tags preserve authored strings verbatim when they are valid
 * SpaceTimeDB identifiers. Other strings use a generated-client-safe schema tag
 * while decoding back to the authored value. Generated clients still expose
 * those enum variants through SpaceTimeDB's PascalCase convention.
 *
 * Numeric literals lower to `f64`; non-finite values and unsafe integers beyond
 * `Number.MAX_SAFE_INTEGER` are rejected because they cannot round-trip safely.
 */
export const literal = <
  const Values extends readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
>(
  ...values: Values
): LiteralValueType<Values> => {
  if (isStringLiteralTuple(values)) {
    return stringLiteralSchema(values) as unknown as LiteralValueType<Values>
  }

  assertNumericLiteralPrecision(values)

  return attachStdbType(
    Schema.Literals(values) as Schema.Codec<
      Values[number],
      Values[number],
      never,
      never
    >,
    (factories) => resolveLiteralBuilder(factories, values),
    { kind: "literal", values },
  ) as unknown as LiteralValueType<Values>
}

export const array = <Inner extends AnyValueType>(
  inner: Inner,
): ArrayValueType<Inner> =>
  attachStdbType(
    inner.schema.pipe(narrowSchema, Schema.Array),
    (factories) => factories.array(typeBuilderWithFactories(inner, factories)),
    { kind: "array", item: inner },
  ) as ArrayValueType<Inner>

export const option = <Inner extends AnyValueType>(
  inner: Inner,
): OptionValueType<Inner> => {
  const schema = makeOptionSchema(inner)

  return attachStdbType(
    schema,
    (factories) => factories.option(typeBuilderWithFactories(inner, factories)),
    { kind: "option", item: inner },
  ) as OptionValueType<Inner>
}

export const structFieldOptions = (
  value: AnyValueType,
): AnyNormalizedStructFieldOptions => ({
  optional:
    annotationInEncodedShape<FieldOptionsAnnotation>(
      StdbFieldOptionsAnnotationId,
      value.schema.ast,
    )?.optional === true,
})

export const hasOptionalFieldOption = (value: AnyValueType): boolean =>
  structFieldOptions(value).optional

export const isOptionValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "option")

// Single decision point for the wire shape of a struct field: an `{ optional: true }`
// field-options annotation lowers to the same SATS `option<T>` as `Stdb.option`. Every
// wire-shape consumer (struct SATS builder, struct schema, HTTP-JSON normalization, and
// the content-addressed fingerprints) must route struct fields through this helper so
// optional fields cannot diverge between the type, the codec, and the type name. Table
// columns lower through their own native row-builder path and must not use this.
// Malformed fields (raw schemas) pass through untouched so module validation can report
// them as diagnostics instead of crashing here.
export const structFieldWireType = (value: AnyValueType): AnyValueType =>
  isValueType(value) && hasOptionalFieldOption(value) ? option(value) : value

export const field = <
  Value extends AnyValueType,
  Options extends StructFieldOptions,
>(
  value: Value,
  options?: Options,
): StructFieldType<Value, Options> =>
  annotateValueTypeSchema(value, StdbFieldOptionsAnnotationId, {
    primaryKey: false,
    autoInc: false,
    optional: options?.optional === true,
  }) as StructFieldType<Value, Options>

export const optional = <Value extends AnyValueType>(
  value: Value,
): StructFieldType<Value, { readonly optional: true }> =>
  field(value, { optional: true })

export const custom = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never>,
  options: { readonly type: AnyValueType },
): ValueType<A, Encoded> =>
  attachStdbType(
    schema,
    (factories) => typeBuilderWithFactories(options.type, factories),
    { kind: "custom", item: options.type },
  )

export const struct = <const Fields extends StructFields>(
  fields: Fields,
): StructValueType<Fields> => {
  const valueSchema = makeStructSchema(fields)

  return attachStdbType(
    valueSchema,
    (factories, path) => {
      const fieldBuilders = typedFromEntries(
        Object.entries(fields).map(([key, value]) => [
          key,
          typeBuilderWithFactories(
            structFieldWireType(value),
            factories,
            appendPath(path, key),
          ),
        ]),
      ) as never
      const fingerprintState = makeFingerprintState()
      const fingerprint = productFingerprint(
        Object.entries(fields).map(([key, value]) => [
          key,
          embeddedValueTypeFingerprint(
            structFieldWireType(value),
            fingerprintState,
          ),
        ]),
      )

      return contentAddressedSatsTypeBuilder(
        factories,
        "Struct",
        fingerprint,
        (name) => factories.object(name, fieldBuilders),
      )
    },
    {
      kind: "struct",
      fields,
    },
  ) as StructValueType<Fields>
}

export const lazy = <A, Encoded>(
  evaluate: () => ValueType<A, Encoded>,
): LazyValueType<A, Encoded> => {
  let resolved: ValueType<A, Encoded> | undefined
  const evaluateOnce = (): ValueType<A, Encoded> => (resolved ??= evaluate())
  const schema = Schema.suspend(() => evaluateOnce().schema) as Schema.Codec<
    A,
    Encoded,
    never
  >

  return attachStdbType(
    schema,
    (factories, path) =>
      factories.lazy(() =>
        typeBuilderWithFactories(evaluateOnce(), factories, path),
      ),
    {
      kind: "lazy",
      lazy: evaluateOnce,
    },
  ) as unknown as LazyValueType<A, Encoded>
}

export const unit = (): UnitValueType =>
  attachStdbType(Schema.Void, (factories) => factories.unit(), {
    kind: "unit",
  })

export const result = <Ok extends AnyValueType, Err extends AnyValueType>(
  ok: Ok,
  err: Err,
): ResultValueType<Ok, Err> => {
  const schema = narrowSchema<ResultType<Ok, Err>, ResultWire<Ok, Err>>(
    makeExactResultSchema(ok, err),
  )

  return attachStdbType(
    schema,
    (factories) =>
      factories.result(
        isUnitValueType(ok)
          ? factories.unit()
          : typeBuilderWithFactories(ok, factories),
        isUnitValueType(err)
          ? factories.unit()
          : typeBuilderWithFactories(err, factories),
      ),
    {
      kind: "result",
      members: [ok, err],
    },
  ) as ResultValueType<Ok, Err>
}

export const sum = <const Variants extends SumVariants>(
  variants: Variants,
): SumValueType<Variants> => {
  const schema = narrowSchema<SumType<Variants>, SumWire<Variants>>(
    makeExactSumSchema(variants),
  )

  const valueType = attachStdbType(
    schema,
    (factories) => {
      const variantEntries = Object.entries(variants)
      const fingerprintState = makeFingerprintState()
      const fingerprint = sumFingerprint(
        variantEntries.map(([tag, variant]) => [
          tag,
          valueTypePayloadFingerprint(variant, fingerprintState),
        ]),
      )
      const allUnitVariants = variantEntries.every(([, variant]) =>
        isUnitValueType(variant),
      )

      return contentAddressedSatsTypeBuilder(
        factories,
        "Sum",
        fingerprint,
        (name) =>
          allUnitVariants
            ? factories.enum(name, variantEntries.map(([tag]) => tag) as never)
            : factories.enum(
                name,
                typedFromEntries(
                  variantEntries.map(([tag, variant]) => [
                    tag,
                    isUnitValueType(variant)
                      ? factories.unit()
                      : typeBuilderWithFactories(variant, factories),
                  ]),
                ) as never,
              ),
      )
    },
    {
      kind: "sum",
      members: Object.values(variants),
      variants,
    },
  ) as SumValueType<Variants>
  Object.defineProperty(valueType, "make", {
    value: makeSumVariantConstructors(variants),
    enumerable: false,
    writable: false,
  })

  return valueType
}

export const enum_ = <const Tags extends readonly [string, ...string[]]>(
  ...tags: Tags
): SumValueType<{ readonly [K in Tags[number]]: UnitValueType }> =>
  sum(
    typedFromEntries(tags.map((tag) => [tag, unit()] as const)) as {
      readonly [K in Tags[number]]: UnitValueType
    },
  )

export const structFields = (value: AnyValueType): StructFields | undefined => {
  const info = typeInfo(value)
  if (info?.fields != null) {
    return info.fields
  }

  const ast = encodedAst(value.schema.ast)
  if (!AST.isObjects(ast)) {
    return undefined
  }

  return typedFromEntries(
    ast.propertySignatures.map((property) => {
      if (typeof property.name !== "string") {
        throw new Error(
          "SpacetimeDB struct lowering requires string property names",
        )
      }

      return [property.name, valueSchemaFromAst(property.type)] as const
    }),
  )
}

export const arrayItem = (value: AnyValueType): AnyValueType | undefined => {
  const info = typeInfo(value)
  if (hasTypeKind(info, "array")) {
    return info.item
  }

  const item = arrayRestAst(value.schema.ast)
  return item != null ? valueSchemaFromAst(item) : undefined
}

export const optionItem = (value: AnyValueType): AnyValueType | undefined => {
  const info = typeInfo(value)
  if (hasTypeKind(info, "option")) {
    return info.item
  }

  const item = optionMemberAst(value.schema.ast)
  return item != null ? valueSchemaFromAst(item) : undefined
}

export { literalValuesFromAst as authoredLiteralValuesFromAst } from "./type-builder-lowering.ts"

export const literalValues = (
  value: AnyValueType,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined =>
  typeInfo(value)?.values ?? literalValuesFromAst(value.schema.ast)

export const isUnitValueType = (value: AnyValueType): boolean => {
  if (hasTypeKind(typeInfo(value), "unit")) {
    return true
  }

  const ast = encodedAst(value.schema.ast)
  return AST.isVoid(ast)
}

export const astIsAuthoredVoid = (ast: AST.AST): boolean => {
  if (AST.isVoid(ast) || AST.isUndefined(ast)) {
    return true
  }

  return AST.isSuspend(ast) && astIsAuthoredVoid(ast.thunk())
}

export const isAuthoredUnitValueType = (value: AnyValueType): boolean =>
  hasTypeKind(typeInfo(value), "unit") || astIsAuthoredVoid(value.schema.ast)
