import type * as Schema from "effect/Schema"

import {
  annotateSchema,
  StdbTypeAnnotationId,
  StdbTypeInfoAnnotationId,
} from "../schema-annotations.ts"
import type {
  AnyTypeBuilder,
  StdbTypeFactory,
  TypeInfoOptions,
  TypeKind,
  ValueType,
  ValueTypeInfo,
} from "./core.ts"
import { makeValueCodec, makeValueType } from "./core.ts"

export {
  AutoIncColumnKinds,
  hasTypeKind,
  literalSupportsPrimaryKey,
  PrimaryKeyColumnKinds,
  supportsAutoInc,
  supportsColumnDefault,
  supportsColumnName,
  supportsNativeColumnMetadata,
  supportsPrimaryKey,
  typeInfo,
} from "./core.ts"

export const constantFactory =
  <Builder extends AnyTypeBuilder>(
    builder: Builder,
  ): StdbTypeFactory<Builder> =>
  () =>
    builder

export const attachStdbType = <
  A,
  Encoded,
  Builder extends AnyTypeBuilder,
  Kind extends TypeKind,
>(
  schema: Schema.Codec<A, Encoded, never>,
  stdbType: Builder | StdbTypeFactory<Builder>,
  options: TypeInfoOptions & { readonly kind: Kind },
): ValueType<A, Encoded, Kind> =>
  (() => {
    const sats =
      typeof stdbType === "function" ? stdbType : constantFactory(stdbType)
    const typeAnnotatedSchema = annotateSchema(
      schema,
      StdbTypeAnnotationId,
      sats,
    )
    const codec = makeValueCodec(typeAnnotatedSchema)
    const info: ValueTypeInfo<A, Encoded> = {
      schema: typeAnnotatedSchema,
      kind: options.kind,
      sats,
      codec,
      ...(options.fields != null ? { fields: options.fields } : {}),
      ...(options.item != null ? { item: options.item } : {}),
      ...(options.members != null ? { members: options.members } : {}),
      ...(options.variants != null ? { variants: options.variants } : {}),
      ...(options.lazy != null ? { lazy: options.lazy } : {}),
      ...(options.values != null ? { values: options.values } : {}),
    }

    return makeValueType(
      annotateSchema(typeAnnotatedSchema, StdbTypeInfoAnnotationId, info),
      options.kind,
    )
  })()
