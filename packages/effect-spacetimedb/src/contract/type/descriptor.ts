import type {
  AnyValueType,
  StructFields,
  SumVariants,
  TypeKind,
  ValueTypeInfo,
} from "../type.ts"
import * as Match from "effect/Match"
import { typeInfo } from "../type.ts"

export type StdbPrimitiveDescriptor = {
  readonly _tag: "Primitive"
  readonly kind: Exclude<
    TypeKind,
    | "array"
    | "custom"
    | "lazy"
    | "literal"
    | "option"
    | "result"
    | "struct"
    | "sum"
  >
}

export type StdbStructDescriptor = {
  readonly _tag: "Struct"
  readonly kind: "struct"
  readonly fields: StructFields
}

export type StdbArrayDescriptor = {
  readonly _tag: "Array"
  readonly kind: "array"
  readonly item: AnyValueType
}

export type StdbOptionDescriptor = {
  readonly _tag: "Option"
  readonly kind: "option"
  readonly item: AnyValueType
}

export type StdbResultDescriptor = {
  readonly _tag: "Result"
  readonly kind: "result"
  readonly members: ReadonlyArray<AnyValueType>
}

export type StdbSumDescriptor = {
  readonly _tag: "Sum"
  readonly kind: "sum"
  readonly members: ReadonlyArray<AnyValueType>
  readonly variants: SumVariants
}

export type StdbLazyDescriptor = {
  readonly _tag: "Lazy"
  readonly kind: "lazy"
  readonly lazy: () => AnyValueType
}

export type StdbLiteralDescriptor = {
  readonly _tag: "Literal"
  readonly kind: "literal"
  readonly values: readonly [
    string | number | boolean,
    ...(string | number | boolean)[],
  ]
}

export type StdbCustomDescriptor = {
  readonly _tag: "Custom"
  readonly kind: "custom"
  readonly item?: AnyValueType
}

export type StdbTypeDescriptor =
  | StdbPrimitiveDescriptor
  | StdbStructDescriptor
  | StdbArrayDescriptor
  | StdbOptionDescriptor
  | StdbResultDescriptor
  | StdbSumDescriptor
  | StdbLazyDescriptor
  | StdbLiteralDescriptor
  | StdbCustomDescriptor

const primitiveDescriptor = (info: ValueTypeInfo): StdbPrimitiveDescriptor => ({
  _tag: "Primitive",
  kind: info.kind as StdbPrimitiveDescriptor["kind"],
})

const descriptorFromInfo = (info: ValueTypeInfo): StdbTypeDescriptor => {
  switch (info.kind) {
    case "struct":
      return {
        _tag: "Struct",
        kind: info.kind,
        fields: info.fields ?? {},
      }
    case "array":
      return {
        _tag: "Array",
        kind: info.kind,
        item: info.item!,
      }
    case "option":
      return {
        _tag: "Option",
        kind: info.kind,
        item: info.item!,
      }
    case "result":
      return {
        _tag: "Result",
        kind: info.kind,
        members: info.members ?? [],
      }
    case "sum":
      return {
        _tag: "Sum",
        kind: info.kind,
        members: info.members ?? [],
        variants: info.variants ?? {},
      }
    case "lazy":
      return {
        _tag: "Lazy",
        kind: info.kind,
        lazy: info.lazy!,
      }
    case "literal":
      return {
        _tag: "Literal",
        kind: info.kind,
        values: info.values!,
      }
    case "custom":
      return info.item != null
        ? {
            _tag: "Custom",
            kind: info.kind,
            item: info.item,
          }
        : {
            _tag: "Custom",
            kind: info.kind,
          }
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
      return primitiveDescriptor(info)
    default:
      const _exhaustive: never = info.kind
      return _exhaustive
  }
}

export const descriptor = (
  value: AnyValueType,
): StdbTypeDescriptor | undefined => {
  const info = typeInfo(value)
  return info != null ? descriptorFromInfo(info) : undefined
}

export const kind = (value: AnyValueType): TypeKind | undefined =>
  descriptor(value)?.kind

export const children = (value: AnyValueType): ReadonlyArray<AnyValueType> => {
  const current = descriptor(value)
  if (current == null) {
    return []
  }

  return Match.value(current).pipe(
    Match.tag("Array", (entry) => [entry.item]),
    Match.tag("Option", (entry) => [entry.item]),
    Match.tag("Struct", (entry) => Object.values(entry.fields)),
    Match.tag("Result", (entry) => entry.members),
    Match.tag("Sum", (entry) => Object.values(entry.variants)),
    Match.tag("Lazy", (entry) => [entry.lazy()]),
    Match.tag("Custom", (entry) => (entry.item != null ? [entry.item] : [])),
    Match.tag("Literal", () => []),
    Match.tag("Primitive", () => []),
    Match.exhaustive,
  )
}
