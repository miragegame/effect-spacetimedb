import * as Layer from "effect/Layer"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { ModulePlan } from "../module-plan.ts"
import { makeModulePlan } from "../module-plan.ts"
import type { GeneratedArtifactShapeError } from "./generated-artifact-shape.ts"
import type {
  GeneratedConnectionClassLike,
  GeneratedErrorContextOf,
  MismatchedGeneratedModuleDiagnostic,
} from "./generated-ws-adapter.ts"
import {
  GeneratedArtifactValidation,
  generated,
  type InternalWsBuilderConfig,
  makeScopedFromModulePlan,
  type WsGeneratedConfig,
} from "./ws-resource.ts"
import { sessionTagFromModulePlan } from "./ws-session-tag.ts"

/**
 * Layers that provide a scoped WebSocket session under its module's session
 * tag (one per module name and session name).
 */

export const layerFromModulePlan = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError = never,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
  readonly name?: string | undefined
}) =>
  Layer.effect(
    sessionTagFromModulePlan<Module, ErrorContext, RelationContext>(
      options.plan,
      options.name,
    ),
    makeScopedFromModulePlan<
      Module,
      ErrorContext,
      RelationContext,
      ValidationError
    >(options),
  )

export const layer = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
  ValidationError = never,
>(options: {
  readonly module: Module
  readonly config: InternalWsBuilderConfig<
    Module,
    ErrorContext,
    RelationContext,
    ValidationError
  >
  readonly name?: string | undefined
}) =>
  layerFromModulePlan<Module, ErrorContext, RelationContext, ValidationError>({
    plan: makeModulePlan(options.module),
    config: options.config,
    name: options.name,
  })

export const layerGenerated = <
  Module extends AnyModuleSpec,
  ConnectionClass extends GeneratedConnectionClassLike,
  RelationContext,
>(options: {
  readonly module: Module
  readonly config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
    MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>
  readonly name?: string | undefined
}) => {
  const config: InternalWsBuilderConfig<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  > = {
    ...generated(options.config),
    [GeneratedArtifactValidation]: true,
  }

  return layer<
    Module,
    GeneratedErrorContextOf<ConnectionClass>,
    RelationContext,
    GeneratedArtifactShapeError
  >({
    module: options.module,
    config,
    name: options.name,
  })
}
