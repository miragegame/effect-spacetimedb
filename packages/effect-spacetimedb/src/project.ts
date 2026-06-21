import * as Client from "./client/index.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import type {
  HttpClientOptions,
  ProjectedHttpClient,
  ProjectedHttpClientTag,
} from "./client/http.ts"
import {
  layerFetchFromModulePlan as httpLayerFetchFromModulePlan,
  layerFromModulePlan as httpLayerFromModulePlan,
  tagFromModulePlan as makeHttpTagFromModulePlan,
} from "./client/http.ts"
import type { ProjectedSubscriptionTargets } from "./client/subscription-target.ts"
import type {
  WsBuilderConfig,
  WsGeneratedConfig,
  WsSessionTag,
} from "./client/ws-resource.ts"
import { makeModulePlan } from "./module-plan.ts"

type WsLayerOptions = {
  readonly name?: string
}

type ProjectedClient<Module extends AnyModuleSpec> = {
  readonly http: {
    readonly Tag: ProjectedHttpClientTag<Module>
    readonly make: (
      config: Omit<HttpClientOptions<Module>, "module">,
    ) => ProjectedHttpClient<Module>
    readonly layer: (
      config: Omit<HttpClientOptions<Module>, "module">,
    ) => ReturnType<typeof httpLayerFetchFromModulePlan<Module>>
    readonly layerFetch: (
      config: Omit<HttpClientOptions<Module>, "module">,
    ) => ReturnType<typeof httpLayerFetchFromModulePlan<Module>>
    readonly layerWithHttpClient: (
      config: Omit<HttpClientOptions<Module>, "module">,
    ) => ReturnType<typeof httpLayerFromModulePlan<Module>>
  }
  readonly ws: {
    readonly scoped: <ErrorContext, RelationContext = unknown>(
      config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
    ) => ReturnType<
      typeof Client.wsScoped<Module, ErrorContext, RelationContext>
    >
    readonly scopedGenerated: <ErrorContext, RelationContext = unknown>(
      config: WsGeneratedConfig<Module, ErrorContext, RelationContext>,
    ) => ReturnType<
      typeof Client.wsScopedGenerated<Module, ErrorContext, RelationContext>
    >
    readonly layer: <ErrorContext, RelationContext = unknown>(
      config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
      options?: WsLayerOptions,
    ) => ReturnType<
      typeof Client.wsLayer<Module, ErrorContext, RelationContext>
    >
    readonly layerGenerated: <ErrorContext, RelationContext = unknown>(
      config: WsGeneratedConfig<Module, ErrorContext, RelationContext>,
      options?: WsLayerOptions,
    ) => ReturnType<
      typeof Client.wsLayerGenerated<Module, ErrorContext, RelationContext>
    >
    readonly tag: <ErrorContext, RelationContext = unknown>(
      name?: string,
    ) => WsSessionTag<Module, ErrorContext, RelationContext>
    readonly Session: WsSessionTag<Module, unknown, unknown>
  }
}

export type ModuleProject<Module extends AnyModuleSpec> = {
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

export const project = <const Module extends AnyModuleSpec>(
  module: Module,
): ModuleProject<Module> => {
  const plan = makeModulePlan(module)
  const httpTag = makeHttpTagFromModulePlan(plan)
  const wsTag = <ErrorContext, RelationContext = unknown>(
    name?: string,
  ): WsSessionTag<Module, ErrorContext, RelationContext> =>
    Client.sessionTag<Module, ErrorContext, RelationContext>(module, name)
  const client = {
    http: {
      Tag: httpTag,
      make: (
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ProjectedHttpClient<Module> =>
        Client.httpMake({
          module,
          ...config,
        }),
      layer: (
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ReturnType<typeof httpLayerFetchFromModulePlan<Module>> =>
        httpLayerFetchFromModulePlan({
          plan,
          config,
        }),
      layerFetch: (
        config: Omit<HttpClientOptions<Module>, "module">,
      ): ReturnType<typeof httpLayerFetchFromModulePlan<Module>> =>
        httpLayerFetchFromModulePlan({
          plan,
          config,
        }),
      layerWithHttpClient: (
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
        Client.wsScoped({
          module,
          config,
        }),
      scopedGenerated: <ErrorContext, RelationContext = unknown>(
        config: WsGeneratedConfig<Module, ErrorContext, RelationContext>,
      ): ReturnType<
        typeof Client.wsScopedGenerated<Module, ErrorContext, RelationContext>
      > =>
        Client.wsScopedGenerated({
          module,
          config,
        }),
      layer: <ErrorContext, RelationContext = unknown>(
        config: WsBuilderConfig<Module, ErrorContext, RelationContext>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayer<Module, ErrorContext, RelationContext>
      > =>
        Client.wsLayer({
          module,
          config,
          ...(options?.name === undefined ? {} : { name: options.name }),
        }),
      layerGenerated: <ErrorContext, RelationContext = unknown>(
        config: WsGeneratedConfig<Module, ErrorContext, RelationContext>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayerGenerated<Module, ErrorContext, RelationContext>
      > =>
        Client.wsLayerGenerated({
          module,
          config,
          ...(options?.name === undefined ? {} : { name: options.name }),
        }),
      tag: <ErrorContext, RelationContext = unknown>(
        name?: string,
      ): WsSessionTag<Module, ErrorContext, RelationContext> =>
        wsTag<ErrorContext, RelationContext>(name),
      Session: wsTag<unknown, unknown>(),
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
