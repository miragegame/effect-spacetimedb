import type { AnyModuleSpec } from "./module.ts"

/** Options for the namespace a mount occupies in the parent database. */
export type MountOptions = {
  /** Pin the canonical SQL and wire namespace across accessor renames. Changing it requires migrating the mounted tables and regenerating clients. */
  readonly name?: string
}
/** An Effect module declaration with its accessor key, canonical namespace and reusable child contract. */
export type ModuleMount<Child extends AnyModuleSpec = AnyModuleSpec> = {
  readonly kind: "moduleMount"
  readonly namespace: string
  readonly wireNamespace: string
  readonly module: Child
}

declare const nativeLibrary: unique symbol
/** A native namespace declaration carrying the library type for server callbacks. Supply the actual SDK module in the server build. */
export type NativeMount<Library = unknown> = {
  readonly kind: "nativeMount"
  readonly namespace: string
  readonly wireNamespace: string
  readonly [nativeLibrary]?: Library
}

/** The module's immediate mount declarations, indexed by accessor key. */
export interface MountRecord {
  readonly [namespace: string]: ModuleMount<AnyModuleSpec> | NativeMount
}
/** The mount declarations known to a particular module contract. */
export type MountsOf<Spec extends AnyModuleSpec> = NonNullable<Spec["mounts"]>
/** Extend a contract's mount record with one named declaration while preserving its other keys. */
export type AddMount<
  Mounts extends MountRecord,
  Name extends string,
  Mount,
> = Mounts & Readonly<Record<Name, Mount>>

/** Maximum number of nested mount edges supported by this package. The limit bounds the depth of inferred server and client types. */
export const mountDepthMax = 4

export const mountLabel = (key: string, childName?: string): string =>
  childName === undefined
    ? `Native mount "${key}"`
    : `Mount "${key}" of module "${childName}"`
