import * as Stdb from "effect-spacetimedb"
import { build } from "effect-spacetimedb/server-compiler"
import { EnvironmentModule } from "../../../examples/environment-fixture/module/src/contract"
import {
  EnvironmentFunctionsLive,
  EnvironmentLifecycleLive,
  EnvironmentRoutesLive,
} from "../../../examples/environment-fixture/module/src/live"

type NativeSchema = {
  readonly moduleDef: { readonly environment: unknown }
}

const environmentOf = (schema: unknown): unknown =>
  (schema as NativeSchema).moduleDef.environment

const PinnedModule = Stdb.StdbModule.make("pinned_environment", {
  environment: { PINNED: Stdb.Environment.literal("only") },
})

// Allowed values named like members of the SDK's type builders and of
// `Object.prototype`, which a builder-property lowering would collide with.
const CollidingModule = Stdb.StdbModule.make("colliding_environment", {
  environment: {
    LIFECYCLE: Stdb.Environment.literal("create", "update"),
    REQUIREDNESS: Stdb.Environment.optional(
      Stdb.Environment.literal("optional", "required"),
    ),
    PROTOTYPE: Stdb.Environment.literal("__proto__"),
    MEMBERS: Stdb.Environment.literal(
      "constructor",
      "toString",
      "default",
      "name",
      "primaryKey",
      "algebraicType",
      "variants",
    ),
  },
})

/**
 * The environment declarations the real SDK's `schema()` derives from our
 * compiled settings — exactly what the host validates publishes against.
 */
export const probe = (): {
  readonly fixture: unknown
  readonly pinned: unknown
  readonly colliding: unknown
} => ({
  fixture: environmentOf(
    build(
      EnvironmentModule,
      [
        EnvironmentFunctionsLive,
        EnvironmentRoutesLive,
        EnvironmentLifecycleLive,
      ],
      { runtimeMode: "dev-guarded" },
    ).schema,
  ),
  pinned: environmentOf(build(PinnedModule, []).schema),
  colliding: environmentOf(build(CollidingModule, []).schema),
})
