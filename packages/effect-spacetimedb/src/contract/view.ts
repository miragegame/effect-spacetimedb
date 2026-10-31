import {
  struct,
  structFieldWireType,
  structFields,
  type AnyValueType,
  type StructLikeValueType,
  type TypeKind,
  typeInfo,
} from "./type.ts"

/**
 * The parameters of a view that takes none. A view with parameters is called
 * from SQL as `SELECT * FROM view_name(arg, ...)`, one materialized answer per
 * distinct argument tuple; see `views.params` in the module validation.
 */
export const EmptyViewParams = struct({})

export type EmptyViewParamsType = typeof EmptyViewParams

/**
 * The value kinds a view parameter may have: those a client can write as a
 * positional SQL literal in `SELECT * FROM view_name(...)`. SpacetimeDB 2.13
 * also takes timestamps and byte arrays; this package does not render those
 * literals yet. Floats SpacetimeDB refuses, and an option, struct, sum or
 * string-literal union has no SQL literal at all.
 */
export const viewParamKinds = [
  "bool",
  "string",
  "identity",
  "connectionId",
  "uuid",
  "i8",
  "i16",
  "i32",
  "i64",
  "i128",
  "i256",
  "u8",
  "u16",
  "u32",
  "u64",
  "u128",
  "u256",
] as const satisfies ReadonlyArray<TypeKind>

export type ViewParamKind = (typeof viewParamKinds)[number]

const viewParamKindSet: ReadonlySet<TypeKind> = new Set(viewParamKinds)

export const isViewParamKind = (kind: TypeKind): kind is ViewParamKind =>
  viewParamKindSet.has(kind)

/** How many wrappers a param's wire type is looked through: custom and lazy. */
const viewParamWrapperDepthMax = 8

/**
 * The kind a view param travels as: the field's wire type (an optional field
 * is an option), looked through `custom` and `lazy` to the type they encode
 * as. `undefined` for a type with no kind or wrapped deeper than the limit.
 */
export const viewParamWireKind = (
  field: AnyValueType,
): TypeKind | undefined => {
  let info = typeInfo(structFieldWireType(field))
  for (let depth = 0; depth < viewParamWrapperDepthMax; depth += 1) {
    if (info?.kind === "custom" && info.item !== undefined) {
      info = typeInfo(info.item)
    } else if (info?.kind === "lazy" && info.lazy !== undefined) {
      info = typeInfo(info.lazy())
    } else {
      return info?.kind
    }
  }
  return undefined
}

/** Whether a client passes arguments to the view: its params have a field. */
export const viewTakesArgs = (params: StructLikeValueType): boolean =>
  Object.keys(structFields(params) ?? {}).length > 0

type BaseViewSpec<
  Context extends "sender" | "anonymous" = "sender" | "anonymous",
  Returns extends AnyValueType = AnyValueType,
  Public extends boolean = boolean,
  Params extends StructLikeValueType = StructLikeValueType,
> = {
  readonly kind: "view"
  readonly context: Context
  readonly public: Public
  readonly params: Params
  readonly returns: Returns
}

export type ViewSpec<
  Context extends "sender" | "anonymous" = "sender" | "anonymous",
  Returns extends AnyValueType = AnyValueType,
  Public extends boolean = boolean,
  Params extends StructLikeValueType = EmptyViewParamsType,
> = BaseViewSpec<Context, Returns, Public, Params>

export type AnyViewSpec = BaseViewSpec<
  "sender" | "anonymous",
  AnyValueType,
  boolean,
  StructLikeValueType
>

type ViewOptions<
  Returns extends AnyValueType,
  Public extends boolean,
  Params extends StructLikeValueType,
> = {
  readonly public: Public
  readonly params: Params
  readonly returns: Returns
}

export function sender<
  Returns extends AnyValueType = AnyValueType,
  const Public extends boolean = boolean,
  Params extends StructLikeValueType = EmptyViewParamsType,
>(
  options: ViewOptions<Returns, Public, Params>,
): ViewSpec<"sender", Returns, Public, Params> {
  return {
    kind: "view" as const,
    context: "sender" as const,
    public: options.public,
    params: options.params,
    returns: options.returns,
  }
}

export function anonymous<
  Returns extends AnyValueType = AnyValueType,
  const Public extends boolean = boolean,
  Params extends StructLikeValueType = EmptyViewParamsType,
>(
  options: ViewOptions<Returns, Public, Params>,
): ViewSpec<"anonymous", Returns, Public, Params> {
  return {
    kind: "view" as const,
    context: "anonymous" as const,
    public: options.public,
    params: options.params,
    returns: options.returns,
  }
}
