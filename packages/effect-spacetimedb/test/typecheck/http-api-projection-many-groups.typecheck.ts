// lint-ignore: stdb-string-columns-require-domain - interop typecheck fixture intentionally exercises raw STDB schema constructors
import type * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient"
import * as Stdb from "effect-spacetimedb"
import type { Assert, IsEqual } from "./helpers"

type SuccessOf<T extends Effect.Effect<unknown, unknown, unknown>> =
  T extends Effect.Effect<infer A, unknown, unknown> ? A : never

const ManyGroupRequest = Schema.Struct({
  value: Schema.String,
})

const ManyGroupResponse = Schema.Struct({
  ok: Schema.Boolean,
})

const route = <const Name extends string>(name: Name) =>
  Stdb.StdbHttp.post(name, `/${name}`, {
    request: ManyGroupRequest,
    response: ManyGroupResponse,
  })

const group = <const Id extends string, const Name extends string>(
  id: Id,
  name: Name,
) => Stdb.StdbHttpGroup.make(id).add(route(name))

const ManyHttpGroupsModule = Stdb.StdbModule.make(
  "http_api_projection_many_groups",
  {},
).add(
  group("HttpGroup00", "route00"),
  group("HttpGroup01", "route01"),
  group("HttpGroup02", "route02"),
  group("HttpGroup03", "route03"),
  group("HttpGroup04", "route04"),
  group("HttpGroup05", "route05"),
  group("HttpGroup06", "route06"),
  group("HttpGroup07", "route07"),
  group("HttpGroup08", "route08"),
  group("HttpGroup09", "route09"),
  group("HttpGroup10", "route10"),
  group("HttpGroup11", "route11"),
  group("HttpGroup12", "route12"),
  group("HttpGroup13", "route13"),
  group("HttpGroup14", "route14"),
  group("HttpGroup15", "route15"),
  group("HttpGroup16", "route16"),
  group("HttpGroup17", "route17"),
  group("HttpGroup18", "route18"),
  group("HttpGroup19", "route19"),
  group("HttpGroup20", "route20"),
  group("HttpGroup21", "route21"),
  group("HttpGroup22", "route22"),
  group("HttpGroup23", "route23"),
  group("HttpGroup24", "route24"),
  group("HttpGroup25", "route25"),
  group("HttpGroup26", "route26"),
  group("HttpGroup27", "route27"),
  group("HttpGroup28", "route28"),
  group("HttpGroup29", "route29"),
  group("HttpGroup30", "route30"),
  group("HttpGroup31", "route31"),
  group("HttpGroup32", "route32"),
  group("HttpGroup33", "route33"),
  group("HttpGroup34", "route34"),
  group("HttpGroup35", "route35"),
  group("HttpGroup36", "route36"),
  group("HttpGroup37", "route37"),
  group("HttpGroup38", "route38"),
  group("HttpGroup39", "route39"),
).spec

const manyApi = Stdb.toHttpApi(ManyHttpGroupsModule)
type ManyClient = HttpApiClient.ForApi<typeof manyApi>
declare const manyClient: ManyClient

const firstCall = manyClient.HttpGroup00.route00({
  payload: { value: "first" },
})
const lastCall = manyClient.HttpGroup39.route39({
  payload: { value: "last" },
})

type _FirstSuccess = Assert<
  IsEqual<
    SuccessOf<typeof firstCall>,
    Schema.Schema.Type<typeof ManyGroupResponse>
  >
>
type _LastSuccess = Assert<
  IsEqual<
    SuccessOf<typeof lastCall>,
    Schema.Schema.Type<typeof ManyGroupResponse>
  >
>

// @ts-expect-error groups must retain their distinct route membership
manyClient.HttpGroup00.route39({ payload: { value: "wrong-group" } })

// @ts-expect-error grouped projection has no flat route fallback
manyClient.route00({ payload: { value: "flat" } })
