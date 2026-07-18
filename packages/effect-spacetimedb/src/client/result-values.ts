import type { AnyModuleSpec } from "../contract/module.ts"
import type { TypeOf } from "../contract/type.ts"

/** Decoded success values for every procedure declared by a module spec. */
export type ResultValuesOf<Spec extends AnyModuleSpec> = {
  readonly [Key in keyof Spec["procedures"]]: TypeOf<
    Spec["procedures"][Key]["returns"]
  >
}
