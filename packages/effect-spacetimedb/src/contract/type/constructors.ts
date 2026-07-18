import * as Schema from "effect/Schema"

import * as AST from "effect/SchemaAST"

import { typedFromEntries } from "../../utils.ts"

import {
  encodedAst,
  StdbFieldOptionsAnnotationId,
} from "../schema-annotations.ts"
import {
  arrayRestAst,
  literalValuesFromAst,
  optionMemberAst,
} from "./ast-helpers.ts"

import { appendPath, typeBuilderWithFactories } from "./builder-lowering.ts"
import type {
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
} from "./core.ts"
import {
  annotateValueTypeSchema,
  isValueType,
  satsIdentifierOf,
} from "./core.ts"
import {
  contentAddressedSatsTypeBuilder,
  embeddedValueTypeFingerprint,
  makeFingerprintState,
  valueTypePayloadFingerprint,
} from "./fingerprint.ts"

import {
  assertNumericLiteralPrecision,
  isStringLiteralTuple,
  resolveLiteralBuilder,
} from "./literal-utils.ts"
import { attachStdbType, hasTypeKind, typeInfo } from "./metadata.ts"
import { productFingerprint, sumFingerprint } from "./name.ts"
import {
  hasOptionalFieldOption,
  isOptionValueType,
  isUnitValueType,
} from "./predicates.ts"
import { stringLiteralSchema } from "./primitives.ts"
import { valueSchemaFromAst } from "./schema-from-ast.ts"
import type { ResultType, ResultWire, SumType, SumWire } from "./wire-schema.ts"
import {
  makeExactResultSchema,
  makeExactSumSchema,
  makeOptionSchema,
  makeStructSchema,
  makeSumVariantConstructors,
  narrowSchema,
} from "./wire-schema.ts"

export {
  astIsAuthoredVoid,
  hasOptionalFieldOption,
  isAuthoredUnitValueType,
  isOptionValueType,
  isUnitValueType,
  structFieldOptions,
} from "./predicates.ts"

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
  const firstKind = typeof values[0]
  if (values.some((value) => typeof value !== firstKind)) {
    throw new TypeError(
      "Stdb.literal(...) values must all have the same primitive kind",
    )
  }
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

/**
 * Nullable value type usable anywhere a value type is accepted, including
 * arrays, custom lowerings, params, return values, and struct fields. Nested
 * options are rejected because the host wire format cannot distinguish their
 * two absent states.
 *
 * Struct-field optionality is a positional annotation: use `Stdb.optional(T)`
 * or `T.optional()` when the field key itself may be absent. The wire lowering
 * is intentionally identical to `Stdb.option(T)`; see
 * `test/unit/optional-lowering.test.ts`.
 */
export const option = <Inner extends AnyValueType>(
  inner: Inner,
): OptionValueType<Inner> => {
  if (isOptionValueType(inner)) {
    throw new TypeError(
      "Nested SpaceTimeDB options are not representable; wrap the inner option in a struct or sum type",
    )
  }
  const schema = makeOptionSchema(inner)

  return attachStdbType(
    schema,
    (factories) => factories.option(typeBuilderWithFactories(inner, factories)),
    { kind: "option", item: inner },
  ) as OptionValueType<Inner>
}

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
): StructFieldType<Value, Options> => {
  if (options?.optional === true && isOptionValueType(value)) {
    throw new TypeError(
      "Nested SpaceTimeDB options are not representable; wrap the inner option in a struct or sum type",
    )
  }
  return annotateValueTypeSchema(value, StdbFieldOptionsAnnotationId, {
    primaryKey: false,
    autoInc: false,
    optional: options?.optional === true,
  }) as StructFieldType<Value, Options>
}

/**
 * Struct-field annotation for an absent-or-undefined property inside
 * `Stdb.struct({ ... })`.
 *
 * Use `Stdb.option(T)` for a nullable value type that must be reusable outside a
 * struct field position. The wire lowering is intentionally identical to
 * `Stdb.option(T)`; see `test/unit/optional-lowering.test.ts`.
 */
export const optional = <Value extends AnyValueType>(
  value: Value,
): StructFieldType<Value, { readonly optional: true }> => {
  if (isOptionValueType(value)) {
    throw new TypeError(
      "Nested SpaceTimeDB options are not representable; wrap the inner option in a struct or sum type",
    )
  }
  return field(value, { optional: true })
}

/**
 * Define a custom codec backed by an existing SATS value type.
 *
 * The schema's encoded shape must match `options.type`'s wire shape. A
 * mismatch cannot be inferred mechanically and produces undecodable rows.
 */
export const custom = <A, Encoded>(
  schema: Schema.Codec<A, Encoded, never>,
  options: { readonly type: AnyValueType },
): ValueType<A, Encoded> =>
  attachStdbType(
    schema,
    (factories) => typeBuilderWithFactories(options.type, factories),
    { kind: "custom", item: options.type },
  )

export const makeStructValueType = <const Fields extends StructFields>(
  fields: Fields,
  identifier?: string,
): StructValueType<Fields> => {
  const valueSchema = makeStructSchema(fields)

  return attachStdbType(
    valueSchema,
    (factories, path, current) => {
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
        satsIdentifierOf(current, identifier),
      )
    },
    {
      kind: "struct",
      fields,
    },
  ) as StructValueType<Fields>
}

export const struct = <const Fields extends StructFields>(
  fields: Fields,
): StructValueType<Fields> => makeStructValueType(fields)

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

export const makeSumValueType = <const Variants extends SumVariants>(
  variants: Variants,
  identifier?: string,
): SumValueType<Variants> => {
  if (Object.keys(variants).length === 0) {
    throw new TypeError("Stdb.sum(...) requires at least one variant")
  }
  const schema = narrowSchema<SumType<Variants>, SumWire<Variants>>(
    makeExactSumSchema(variants),
  )

  const valueType = attachStdbType(
    schema,
    (factories, _path, current) => {
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
        satsIdentifierOf(current, identifier),
      )
    },
    {
      kind: "sum",
      members: Object.values(variants),
      variants,
    },
  ) as SumValueType<Variants>

  return valueType
}

export const sum = <const Variants extends SumVariants>(
  variants: Variants,
): SumValueType<Variants> => {
  const valueType = makeSumValueType(variants)
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

export { literalValuesFromAst as authoredLiteralValuesFromAst } from "./ast-helpers.ts"

export const literalValues = (
  value: AnyValueType,
):
  | readonly [string | number | boolean, ...(string | number | boolean)[]]
  | undefined =>
  typeInfo(value)?.values ?? literalValuesFromAst(value.schema.ast)
