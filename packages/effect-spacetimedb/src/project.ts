import type {
  HttpClientOptions,
  GroupIdsOf,
  ProjectedHttpClient,
  ProjectedHttpGroupClient,
  ProjectedHttpClientTag,
} from "./client/http.ts"
import {
  groupFromModulePlan as httpGroupFromModulePlan,
  layerFromModulePlan as httpLayerFromModulePlan,
  makeFromModulePlan as httpMakeFromModulePlan,
  tagFromModulePlan as makeHttpTagFromModulePlan,
} from "./client/http.ts"
import * as Client from "./client/index.ts"
import {
  type GeneratedConnectionClassLike,
  makeScopedFromModulePlan,
  makeScopedGeneratedFromModulePlan,
  type MismatchedGeneratedModuleDiagnostic,
  type WsBuilderConfig,
  type WsGeneratedConfig,
} from "./client/ws-resource.ts"
import {
  layerFromModulePlan as wsLayerFromModulePlan,
  layerGeneratedFromModulePlan as wsLayerGeneratedFromModulePlan,
} from "./client/ws-session-layer.ts"
import type { WsSessionTag } from "./client/ws-session-tag.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import {
  moduleSpecOf,
  type ModuleSpecInput,
  type SpecOf,
} from "./module-input.ts"
import { makeModulePlan } from "./module-plan.ts"
import type { ProjectedSubscriptionTargets } from "./subscription-target.ts"

export type WsLayerOptions = {
  readonly name?: string | undefined
}

export type ProjectedHttpClientAccess<Module extends AnyModuleSpec> = {
  readonly Tag: ProjectedHttpClientTag<Module>
  readonly make: (
    config: Omit<HttpClientOptions<Module>, "module">,
  ) => ProjectedHttpClient<Module>
  readonly group: <Group extends GroupIdsOf<Module>>(
    group: Group,
    config: Omit<HttpClientOptions<Module>, "module">,
  ) => ProjectedHttpGroupClient<Module, Group>
  readonly layer: (
    config: Omit<HttpClientOptions<Module>, "module">,
  ) => ReturnType<typeof httpLayerFromModulePlan<Module>>
}

export type ProjectedWsClientAccess<Module extends AnyModuleSpec> = {
  readonly scoped: <ErrorContext, RelationContext = unknown>(
    config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
  ) => ReturnType<typeof Client.wsScoped<Module, ErrorContext, RelationContext>>
  readonly scopedGenerated: <
    ConnectionClass extends GeneratedConnectionClassLike,
    RelationContext = unknown,
  >(
    config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
      MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>,
  ) => ReturnType<
    typeof Client.wsScopedGenerated<Module, ConnectionClass, RelationContext>
  >
  readonly layer: <ErrorContext, RelationContext = unknown>(
    config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
    options?: WsLayerOptions,
  ) => ReturnType<typeof Client.wsLayer<Module, ErrorContext, RelationContext>>
  readonly layerGenerated: <
    ConnectionClass extends GeneratedConnectionClassLike,
    RelationContext = unknown,
  >(
    config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
      MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>,
    options?: WsLayerOptions,
  ) => ReturnType<
    typeof Client.wsLayerGenerated<Module, ConnectionClass, RelationContext>
  >
  readonly tag: <ErrorContext, RelationContext = unknown>(
    name?: string,
  ) => WsSessionTag<Module, ErrorContext, RelationContext>
  readonly Session: WsSessionTag<Module, unknown, unknown>
}

export type ProjectedClient<Module extends AnyModuleSpec> = {
  readonly http: ProjectedHttpClientAccess<Module>
  readonly ws: ProjectedWsClientAccess<Module>
}

export type ModuleProject<Input extends ModuleSpecInput> = ProjectedModule<
  SpecOf<Input>
>

export type ProjectedModule<Module extends AnyModuleSpec> = {
  readonly module: Module
  readonly tables: Module["tables"]
  readonly views: Module["views"]
  readonly reducers: Module["reducers"]
  readonly procedures: Module["procedures"]
  readonly httpHandlers: Module["httpHandlers"]
  readonly lifecycle: Module["lifecycle"]
  readonly targets: ProjectedSubscriptionTargets<Module>
  readonly client: ProjectedClient<Module>
}

export const project = <const Input extends ModuleSpecInput>(
  input: Input,
): ModuleProject<Input> => projectModule(moduleSpecOf(input))

const projectModule = <Module extends AnyModuleSpec>(
  module: Module,
): ProjectedModule<Module> => {
  const plan = makeModulePlan(module)
  const httpTag = makeHttpTagFromModulePlan(plan)
  const wsTag = <ErrorContext, RelationContext = unknown>(
    name?: string,
  ): WsSessionTag<Module, ErrorContext, RelationContext> =>
    Client.wsSessionTag<Module, ErrorContext, RelationContext>(module, name)
  const client = {
    http: {
      Tag: httpTag,
      make: (
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ProjectedHttpClient<Module> =>
        httpMakeFromModulePlan({
          plan,
          config,
        }),
      group: <Group extends GroupIdsOf<Module>>(
        group: Group,
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ProjectedHttpGroupClient<Module, Group> =>
        httpGroupFromModulePlan({
          plan,
          group,
          config,
        }),
      layer: (
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ReturnType<typeof httpLayerFromModulePlan<Module>> =>
        httpLayerFromModulePlan({
          plan,
          config,
        }),
    },
    ws: {
      scoped: <ErrorContext, RelationContext = unknown>(
        config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
      ): ReturnType<
        typeof Client.wsScoped<Module, ErrorContext, RelationContext>
      > =>
        makeScopedFromModulePlan<Module, ErrorContext, RelationContext>({
          plan,
          config,
        }),
      scopedGenerated: <
        ConnectionClass extends GeneratedConnectionClassLike,
        RelationContext = unknown,
      >(
        config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
          MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>,
      ): ReturnType<
        typeof Client.wsScopedGenerated<
          Module,
          ConnectionClass,
          RelationContext
        >
      > =>
        makeScopedGeneratedFromModulePlan<
          Module,
          ConnectionClass,
          RelationContext
        >({
          plan,
          config,
        }),
      layer: <ErrorContext, RelationContext = unknown>(
        config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayer<Module, ErrorContext, RelationContext>
      > =>
        wsLayerFromModulePlan({
          plan,
          config,
          name: options?.name,
        }),
      layerGenerated: <
        ConnectionClass extends GeneratedConnectionClassLike,
        RelationContext = unknown,
      >(
        config: WsGeneratedConfig<Module, ConnectionClass, RelationContext> &
          MismatchedGeneratedModuleDiagnostic<Module, ConnectionClass>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayerGenerated<Module, ConnectionClass, RelationContext>
      > =>
        wsLayerGeneratedFromModulePlan({
          plan,
          config,
          name: options?.name,
        }),
      tag: <ErrorContext, RelationContext = unknown>(
        name?: string,
      ): WsSessionTag<Module, ErrorContext, RelationContext> =>
        wsTag<ErrorContext, RelationContext>(name),
      Session: Client.wsSessionTag<Module, unknown, unknown>(module),
    },
  }

  return {
    module,
    tables: module.tables,
    views: module.views,
    reducers: module.reducers,
    procedures: module.procedures,
    httpHandlers: module.httpHandlers,
    lifecycle: module.lifecycle,
    targets: plan.targets,
    client,
  }
}
