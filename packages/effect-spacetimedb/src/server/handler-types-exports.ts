import type * as Cause from "effect/Cause"

import type { LifecycleName } from "../contract/lifecycle.ts"

import type { AnyModuleSpec } from "../contract/module.ts"

import type { ModulePlan } from "../module-plan.ts"

import type { ConstrainedServerRuntimeMode } from "./runtime-layer.ts"

import type { SyncRunner } from "./sync-runner.ts"

import type {
  HttpHandlerKeys,
  ProcedureKeys,
  ReducerKeys,
  ViewKeys,
} from "./handler-types-core.ts"

import type {
  BoundHttpHandlerExport,
  BoundLifecycleExport,
  BoundProcedureExport,
  BoundReducerExport,
  BoundViewExport,
  HttpHandlerHandlerRecord,
  LifecycleHandlerRecord,
  ProcedureHandlerRecord,
  ReducerHandlerRecord,
  ViewHandlerRecord,
} from "./handler-types-inputs.ts"

export type BoundReducerExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ReducerKeys<Module>
    ? BoundReducerExport<Module, Key>
    : never
}

export type BoundProcedureExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ProcedureKeys<Module>
    ? BoundProcedureExport<Module, Key>
    : never
}

export type BoundHttpHandlerExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends HttpHandlerKeys<Module>
    ? BoundHttpHandlerExport<Module, Key>
    : never
}

export type BoundViewExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends ViewKeys<Module>
    ? BoundViewExport<Module, Key>
    : never
}

export type BoundLifecycleExports<
  Module extends AnyModuleSpec,
  Specs extends Partial<Record<string, unknown>>,
> = {
  readonly [Key in keyof Specs]: Key extends LifecycleName
    ? BoundLifecycleExport<Module, Key>
    : never
}

export type BindOptions<Module extends AnyModuleSpec, RuntimeR = never> = {
  readonly module: Module
  /** See `BuildOptions.onDefect`. */
  readonly onDefect?: ((cause: Cause.Cause<unknown>) => void) | undefined
  readonly runtime?: SyncRunner<RuntimeR>
  readonly runtimeMode?: ConstrainedServerRuntimeMode
}

/**
 * A module's handlers joined to its runtime: what `compileModule` registers
 * with the host, and what the test harness calls directly.
 */
export type BoundModule<Module extends AnyModuleSpec, RuntimeR = never> = {
  readonly plan: ModulePlan<Module>
  readonly module: Module
  readonly scheduleBindings: ModulePlan<Module>["scheduleBindings"]
  readonly reducers: <Specs extends ReducerHandlerRecord<Module, RuntimeR>>(
    handlers: Specs,
  ) => BoundReducerExports<Module, Specs>
  readonly procedures: <Specs extends ProcedureHandlerRecord<Module, RuntimeR>>(
    handlers: Specs,
  ) => BoundProcedureExports<Module, Specs>
  readonly httpHandlers: <
    Specs extends HttpHandlerHandlerRecord<Module, RuntimeR>,
  >(
    handlers: Specs,
  ) => BoundHttpHandlerExports<Module, Specs>
  readonly views: <Specs extends ViewHandlerRecord<Module, RuntimeR>>(
    handlers: Specs,
  ) => BoundViewExports<Module, Specs>
  readonly lifecycle: <Specs extends LifecycleHandlerRecord<Module, RuntimeR>>(
    handlers: Specs,
  ) => BoundLifecycleExports<Module, Specs>
}
