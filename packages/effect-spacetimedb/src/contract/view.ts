import type { AnyValueType } from "./type.ts"

type BaseViewSpec<
  Context extends "sender" | "anonymous" = "sender" | "anonymous",
  Returns extends AnyValueType = AnyValueType,
  Public extends boolean = boolean,
> = {
  readonly kind: "view"
  readonly context: Context
  readonly public: Public
  readonly returns: Returns
}

type ViewSpecImpl<
  Context extends "sender" | "anonymous" = "sender" | "anonymous",
  Returns extends AnyValueType = AnyValueType,
  Public extends boolean = boolean,
> = BaseViewSpec<Context, Returns, Public>

export type ViewSpec<
  Context extends "sender" | "anonymous" = "sender" | "anonymous",
  Returns extends AnyValueType = AnyValueType,
  Public extends boolean = boolean,
> = ViewSpecImpl<Context, Returns, Public>

export type AnyViewSpec = ViewSpecImpl<"sender" | "anonymous", AnyValueType>

type ViewOptions<Returns extends AnyValueType, Public extends boolean> = {
  readonly public: Public
  readonly returns: Returns
}

export function sender<
  Returns extends AnyValueType = AnyValueType,
  const Public extends boolean = boolean,
>(options: ViewOptions<Returns, Public>): ViewSpec<"sender", Returns, Public> {
  return {
    kind: "view" as const,
    context: "sender" as const,
    public: options.public,
    returns: options.returns,
  }
}

export function anonymous<
  Returns extends AnyValueType = AnyValueType,
  const Public extends boolean = boolean,
>(
  options: ViewOptions<Returns, Public>,
): ViewSpec<"anonymous", Returns, Public> {
  return {
    kind: "view" as const,
    context: "anonymous" as const,
    public: options.public,
    returns: options.returns,
  }
}
