import type { Bound } from "./table-index-typing.ts"

export type RangeLike<T> = {
  readonly from: Bound<T>
  readonly to: Bound<T>
}

export const isRangeLike = (value: unknown): value is RangeLike<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "from" in value &&
  "to" in value

export const cloneRangeLike = (
  range: RangeLike<unknown>,
  from: Bound<unknown>,
  to: Bound<unknown>,
  makeRange?: (from: Bound<unknown>, to: Bound<unknown>) => RangeLike<unknown>,
): RangeLike<unknown> => {
  if (makeRange !== undefined) return makeRange(from, to)
  const constructor = (range as { readonly constructor?: unknown }).constructor
  if (typeof constructor === "function" && constructor !== Object) {
    return new (
      constructor as new (
        from?: Bound<unknown>,
        to?: Bound<unknown>,
      ) => RangeLike<unknown>
    )(from, to)
  }
  return { from, to }
}
