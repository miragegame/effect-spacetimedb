import { make as makeServer } from "../../src/server/bind.ts"
import * as Effect from "effect/Effect"
import * as EffectVitest from "@effect/vitest"
const { expect } = EffectVitest
import { compileModule } from "../helpers/compile-module"
import * as Stdb from "effect-spacetimedb"
import * as SpacetimeServerStub from "../helpers/spacetimedb-server"
import { TestSyncRunner } from "../helpers/sync-runner"
import { TestLayer } from "../helpers/test-layer"

const describe = EffectVitest.layer(TestLayer)

void SpacetimeServerStub.CaseConversionPolicy
void SpacetimeServerStub.Request
void SpacetimeServerStub.SenderError
void SpacetimeServerStub.SyncResponse
void SpacetimeServerStub.isRowTypedQuery
void SpacetimeServerStub.t
void SpacetimeServerStub.table

const ManifestModule = Stdb.StdbModule.make("http_manifest", {}).add(
  Stdb.StdbHttpGroup.make("Http").add(Stdb.StdbHttp.post("ping", "/ping")),
).spec

describe("HTTP handler compiler manifest", (it) => {
  it.effect(
    "registers named handler exports and routes through SDK hooks",
    () =>
      Effect.gen(function* () {
        const server = makeServer({
          module: ManifestModule,
          runtime: TestSyncRunner,
        })
        const exported = server.handlers({
          httpHandlers: {
            ping: server.httpHandler(
              Effect.fn(function* (_req: Stdb.Request) {
                return new Stdb.SyncResponse("pong")
              }),
            ),
          },
        })

        const compiled = compileModule({
          server,
          handlers: exported,
        })

        expect(Object.keys(compiled.exports)).toEqual([
          "ping",
          "__http_router__",
        ])

        const hooks = SpacetimeServerStub.registerCompiledModule(
          compiled.schema,
          compiled.exportGroup(),
        ) as {
          readonly __describe_module__: () => Uint8Array
        }
        expect(hooks.__describe_module__()).toBeInstanceOf(Uint8Array)

        const moduleDef = (
          compiled.schema as {
            readonly moduleDef: {
              readonly httpHandlers: ReadonlyArray<{
                readonly sourceName: string
              }>
              readonly httpRoutes: ReadonlyArray<{
                readonly handlerFunction: string
                readonly path: string
              }>
            }
          }
        ).moduleDef

        expect(moduleDef.httpHandlers).toEqual([{ sourceName: "ping" }])
        expect(moduleDef.httpRoutes).toEqual([
          expect.objectContaining({
            handlerFunction: "ping",
            path: "/ping",
          }),
        ])
      }),
  )
})
