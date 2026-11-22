import type { Infer, TypeBuilder } from "spacetimedb"

declare const brand: unique symbol
type UserId = string & { readonly [brand]: "UserId" }
type InferredId = Infer<TypeBuilder<UserId, { tag: "String" }>>

declare const existing: UserId
declare const inferred: InferredId

// Reading alone also succeeds when the SDK has reduced the input type to never.
export const readId: UserId = inferred
export const writeId: InferredId = existing
