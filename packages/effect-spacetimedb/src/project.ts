import type {
  HttpClientOptions,
  GroupIdsOf,
  ProjectedHttpClient,
  ProjectedHttpGroupClient,
  ProjectedHttpClientTag,
} from "./client/http.ts"
import {
  layerFromModulePlan as httpLayerFromModulePlan,
  tagFromModulePlan as makeHttpTagFromModulePlan,
} from "./client/http.ts"
import * as Client from "./client/index.ts"
import type {
  GeneratedConnectionClassLike,
  MismatchedGeneratedModuleDiagnostic,
  WsBuilderConfig,
  WsGeneratedConfig,
  WsSessionTag,
} from "./client/ws-resource.ts"
import type { AnyModuleSpec } from "./contract/module.ts"
import {
  moduleSpecOf,
  type ModuleSpecInput,
  type SpecOf,
} from "./module-input.ts"
import { makeModulePlan } from "./module-plan.ts"
import type { ProjectedSubscriptionTargets } from "./subscription-target.ts"

type WsLayerOptions = {
  readonly name?: string | undefined
}

type ProjectedHttpClientAccess<Module extends AnyModuleSpec> = {
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

type ProjectedWsClientAccess<Module extends AnyModuleSpec> = {
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

type ProjectedClient<Module extends AnyModuleSpec> = {
  readonly http: ProjectedHttpClientAccess<Module>
  readonly ws: ProjectedWsClientAccess<Module>
}

export type ModuleProject<Input extends ModuleSpecInput> = {
  readonly module: SpecOf<Input>
  readonly tables: SpecOf<Input>["tables"]
  readonly views: SpecOf<Input>["views"]
  readonly reducers: SpecOf<Input>["reducers"]
  readonly procedures: SpecOf<Input>["procedures"]
  readonly httpHandlers: SpecOf<Input>["httpHandlers"]
  readonly lifecycle: SpecOf<Input>["lifecycle"]
  readonly targets: ProjectedSubscriptionTargets<SpecOf<Input>>
  readonly client: ProjectedClient<SpecOf<Input>>
}

export const project = <const Input extends ModuleSpecInput>(
  input: Input,
): ModuleProject<Input> => {
  const module = moduleSpecOf(input)
  const plan = makeModulePlan(module)
  const httpTag = makeHttpTagFromModulePlan(plan)
  const wsTag = <ErrorContext, RelationContext = unknown>(
    name?: string,
  ): WsSessionTag<SpecOf<Input>, ErrorContext, RelationContext> =>
    Client.sessionTag<SpecOf<Input>, ErrorContext, RelationContext>(
      module,
      name,
    )
  const client = {
    http: {
      Tag: httpTag,
      make: (
        config: Omit<HttpClientOptions<SpecOf<Input>>, "module">,
      ): ProjectedHttpClient<SpecOf<Input>> =>
        Client.httpMake({
          module,
          ...config,
        }),
      group: <Group extends GroupIdsOf<SpecOf<Input>>>(
        group: Group,
        config: Omit<HttpClientOptions<SpecOf<Input>>, "module">,
      ): ProjectedHttpGroupClient<SpecOf<Input>, Group> =>
        Client.httpGroupFromModulePlan({
          plan,
          group,
          config,
        }),
      layer: (
        config: Omit<HttpClientOptions<SpecOf<Input>>, "module">,
      ): ReturnType<typeof httpLayerFromModulePlan<SpecOf<Input>>> =>
        httpLayerFromModulePlan({
          plan,
          config,
        }),
    },
    ws: {
      scoped: <ErrorContext, RelationContext = unknown>(
        config: WsBuilderConfig<SpecOf<Input>, ErrorContext, RelationContext>,
      ): ReturnType<
        typeof Client.wsScoped<SpecOf<Input>, ErrorContext, RelationContext>
      > =>
        Client.wsScoped({
          module,
          config,
        }),
      scopedGenerated: <
        ConnectionClass extends GeneratedConnectionClassLike,
        RelationContext = unknown,
      >(
        config: WsGeneratedConfig<
          SpecOf<Input>,
          ConnectionClass,
          RelationContext
        > &
          MismatchedGeneratedModuleDiagnostic<SpecOf<Input>, ConnectionClass>,
      ): ReturnType<
        typeof Client.wsScopedGenerated<
          SpecOf<Input>,
          ConnectionClass,
          RelationContext
        >
      > =>
        Client.wsScopedGenerated({
          module,
          config,
        }),
      layer: <ErrorContext, RelationContext = unknown>(
        config: WsBuilderConfig<SpecOf<Input>, ErrorContext, RelationContext>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayer<SpecOf<Input>, ErrorContext, RelationContext>
      > =>
        Client.wsLayer({
          module,
          config,
          name: options?.name,
        }),
      layerGenerated: <
        ConnectionClass extends GeneratedConnectionClassLike,
        RelationContext = unknown,
      >(
        config: WsGeneratedConfig<
          SpecOf<Input>,
          ConnectionClass,
          RelationContext
        > &
          MismatchedGeneratedModuleDiagnostic<SpecOf<Input>, ConnectionClass>,
        options?: WsLayerOptions,
      ): ReturnType<
        typeof Client.wsLayerGenerated<
          SpecOf<Input>,
          ConnectionClass,
          RelationContext
        >
      > =>
        Client.wsLayerGenerated({
          module,
          config,
          name: options?.name,
        }),
      tag: <ErrorContext, RelationContext = unknown>(
        name?: string,
      ): WsSessionTag<SpecOf<Input>, ErrorContext, RelationContext> =>
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
