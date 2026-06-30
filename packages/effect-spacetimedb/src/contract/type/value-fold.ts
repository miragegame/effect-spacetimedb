import * as Match from "effect/Match"
import type { AnyValueType, StructFields, SumVariants } from "../type.ts"
import * as TypeDescriptor from "./descriptor.ts"

export type Recurse<R> = (type: AnyValueType, value: unknown) => R

export type ValueFoldHandlers<R> = {
  readonly array: (
    type: AnyValueType,
    item: AnyValueType,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly option: (
    type: AnyValueType,
    item: AnyValueType,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly struct: (
    type: AnyValueType,
    fields: StructFields,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly sum: (
    type: AnyValueType,
    variants: SumVariants,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly result: (
    type: AnyValueType,
    members: ReadonlyArray<AnyValueType>,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly custom: (
    type: AnyValueType,
    item: AnyValueType | undefined,
    value: unknown,
    recurse: Recurse<R>,
  ) => R
  readonly primitive: (
    type: AnyValueType,
    kind: TypeDescriptor.StdbPrimitiveDescriptor["kind"],
    value: unknown,
  ) => R
  readonly literal: (
    type: AnyValueType,
    values: TypeDescriptor.StdbLiteralDescriptor["values"],
    value: unknown,
  ) => R
  readonly absent: (type: AnyValueType, value: unknown) => R
}

export const foldValue = <R>(handlers: ValueFoldHandlers<R>): Recurse<R> => {
  const recurse: Recurse<R> = (type, value) => {
    const descriptor = TypeDescriptor.descriptor(type)
    if (descriptor === undefined) {
      return handlers.absent(type, value)
    }

    return Match.value(descriptor).pipe(
      Match.tag("Array", (entry) =>
        handlers.array(type, entry.item, value, recurse),
      ),
      Match.tag("Custom", (entry) =>
        handlers.custom(type, entry.item, value, recurse),
      ),
      Match.tag("Lazy", (entry) => recurse(entry.lazy(), value)),
      Match.tag("Literal", (entry) =>
        handlers.literal(type, entry.values, value),
      ),
      Match.tag("Option", (entry) =>
        handlers.option(type, entry.item, value, recurse),
      ),
      Match.tag("Primitive", (entry) =>
        handlers.primitive(type, entry.kind, value),
      ),
      Match.tag("Result", (entry) =>
        handlers.result(type, entry.members, value, recurse),
      ),
      Match.tag("Struct", (entry) =>
        handlers.struct(type, entry.fields, value, recurse),
      ),
      Match.tag("Sum", (entry) =>
        handlers.sum(type, entry.variants, value, recurse),
      ),
      Match.exhaustive,
    ) as R
  }

  return recurse
}
