import * as Effect from "effect/Effect"
import type * as Redacted from "effect/Redacted"
import * as Stdb from "effect-spacetimedb"
import type * as StdbTesting from "effect-spacetimedb/testing"
import { EnvironmentModule } from "../../examples/environment-fixture/module/src/contract"
import type { Assert, IsEqual } from "./helpers"

const { Env } = EnvironmentModule

type EnvironmentValues = Effect.Success<typeof Env>

type _greeting = Assert<
  IsEqual<Effect.Success<EnvironmentValues["GREETING"]>, string>
>
type _secret = Assert<
  IsEqual<
    Effect.Success<EnvironmentValues["API_KEY"]>,
    Redacted.Redacted<string>
  >
>
type _literal = Assert<
  IsEqual<
    Effect.Success<EnvironmentValues["MODE"]>,
    "development" | "production"
  >
>
type _optional = Assert<
  IsEqual<Effect.Success<EnvironmentValues["REGION"]>, string | undefined>
>
// A read is never a typed failure: a host failure on a declared key is a defect.
type _infallible = Assert<
  IsEqual<Effect.Error<EnvironmentValues["GREETING"]>, never>
>
// Exactly the declared keys, in the values and in the spec.
type _environmentKeys = Assert<
  IsEqual<keyof EnvironmentValues, "GREETING" | "API_KEY" | "MODE" | "REGION">
>
type _environmentSpecKeys = Assert<
  IsEqual<
    keyof (typeof EnvironmentModule.spec)["environment"],
    "GREETING" | "API_KEY" | "MODE" | "REGION"
  >
>

const readUndeclared = (env: EnvironmentValues) =>
  // @ts-expect-error a key the module did not declare does not type-check
  env.UNDECLARED
void readUndeclared

const NoEnvironmentModule = Stdb.StdbModule.make("no_environment")
type NoEnvironmentValues = Effect.Success<typeof NoEnvironmentModule.Env>
type _noKeys = Assert<IsEqual<keyof NoEnvironmentValues, never>>
const readFromEmpty = (env: NoEnvironmentValues) =>
  // @ts-expect-error a module without declarations exposes no keys
  env.GREETING
void readFromEmpty

// A module that declares nothing keeps its pre-environment handler types, so
// its handlers cannot require Env.
const EmptyCallables = Stdb.StdbGroup.make("Empty").add(
  Stdb.StdbFn.reducer("touch", {}),
)
const EmptyEnvironmentModule =
  Stdb.StdbModule.make("empty_environment").add(EmptyCallables)
const EmptyLive = Stdb.StdbBuilder.group(
  EmptyEnvironmentModule,
  "Empty",
  // @ts-expect-error a module without declarations does not provide Env.
  { touch: () => Effect.asVoid(EmptyEnvironmentModule.Env) },
)
void EmptyLive

// Env is a module-scoped service: every endpoint kind and transaction body may
// require it, and another module's Env is refused like its Db.
const readGreeting = Effect.gen(function* () {
  const env = yield* Env
  return yield* env.GREETING
})

const Callables = Stdb.StdbGroup.make("Callables")
  .add(Stdb.StdbFn.reducer("reducerRead", {}))
  .add(Stdb.StdbFn.procedure("procedureRead", { returns: Stdb.string() }))
  .add(Stdb.StdbFn.procedure("procedureTxRead", { returns: Stdb.string() }))
  .add(
    Stdb.StdbFn.anonymousView("viewRead", {
      returns: Stdb.array(Stdb.struct({ value: Stdb.string() }), {
        minimum: 0,
        maximum: 1,
      }),
    }),
  )
const Routes = Stdb.StdbHttpGroup.make("Routes").add(
  Stdb.StdbHttp.get("routeRead", "/read"),
)
const ReadingModule = Stdb.StdbModule.make("environment_reading", {
  environment: { GREETING: Stdb.Environment.string() },
})
  .add(Callables)
  .add(Routes)
const ReadingEnv = Effect.gen(function* () {
  const env = yield* ReadingModule.Env
  return yield* env.GREETING
})

const CallablesLive = Stdb.StdbBuilder.group(ReadingModule, "Callables", {
  reducerRead: () => Effect.asVoid(ReadingEnv),
  procedureRead: () => ReadingEnv,
  procedureTxRead: Effect.fn(function* () {
    const tx = yield* ReadingModule.Tx
    return yield* tx.run(ReadingEnv)
  }),
  viewRead: () => Effect.map(ReadingEnv, (value) => [{ value }]),
})
void CallablesLive

const RoutesLive = Stdb.StdbBuilder.group(ReadingModule, "Routes", {
  routeRead: Effect.fn(function* () {
    const tx = yield* ReadingModule.HttpTx
    const value = yield* tx.run(ReadingEnv)
    return new Stdb.SyncResponse(value)
  }),
})
void RoutesLive

const CrossModuleLive = Stdb.StdbBuilder.group(
  ReadingModule,
  "Callables",
  // @ts-expect-error another module's Env carries that module's identity.
  {
    reducerRead: () => Effect.asVoid(readGreeting),
    procedureRead: () => ReadingEnv,
    procedureTxRead: () => ReadingEnv,
    viewRead: () => Effect.succeed([]),
  },
)
void CrossModuleLive

// The harness takes publish-shaped values: literal keys accept only their set.
type HarnessValues = StdbTesting.TestModuleEnvironmentValues<
  typeof EnvironmentModule.spec
>
const harnessValues: HarnessValues = {
  GREETING: "hello",
  API_KEY: "secret",
  MODE: "production",
}
void harnessValues
const outsideTheSet: HarnessValues = {
  // @ts-expect-error a literal outside the declared set
  MODE: "staging",
}
void outsideTheSet

// A large module names its spec, environment included, so the checker never
// instantiates through it; the builder keeps such a spec as written. The named
// spec must still be what the module is checked against: the built module is
// assignable to it, the environment reads as declared, and handlers may
// require Env. No type relation can tell the kept spec from the intersection
// the builder would otherwise form (identity is structural here), so the cost
// half of this contract is held by the named-spec arm of the instantiation
// budgets in test/unit/builder-diagnostics.serial.test.ts.
const namedEnvironment = { REGION: Stdb.Environment.string() }
const NamedCallables = Stdb.StdbGroup.make("NamedCallables").add(
  Stdb.StdbFn.reducer("touch", {}),
)
type NamedGroups = typeof NamedCallables
type NamedSpec = Stdb.ModuleSpecFor<
  "named_environment",
  {},
  NamedGroups,
  {},
  never
> & { readonly environment: typeof namedEnvironment }
// Every module below differs only in its spec and declared environment.
type NamedModuleOf<
  Spec extends Stdb.AnyModuleSpec,
  Environment extends Stdb.Environment.Declarations,
> = Stdb.StdbModule<
  "named_environment",
  {},
  NamedGroups,
  Stdb.GroupNameOf<NamedGroups>,
  never,
  {},
  never,
  never,
  Stdb.SchedulePairsOf<NamedGroups>,
  Stdb.GroupEndpointPairsOf<NamedGroups>,
  Spec,
  Environment
>
type NamedStdbModule = NamedModuleOf<NamedSpec, typeof namedEnvironment>
const NamedModule: NamedStdbModule = Stdb.StdbModule.make("named_environment", {
  environment: namedEnvironment,
}).add(NamedCallables)
type NamedEnvironmentValues = Effect.Success<typeof NamedModule.Env>
type _namedRegion = Assert<
  IsEqual<Effect.Success<NamedEnvironmentValues["REGION"]>, string>
>
type _namedKeys = Assert<IsEqual<keyof NamedEnvironmentValues, "REGION">>
type _namedSpecKeys = Assert<
  IsEqual<keyof NamedStdbModule["spec"]["environment"], "REGION">
>
const readNamedRegion = Effect.gen(function* () {
  const environment = yield* NamedModule.Env
  return yield* environment.REGION
})
const NamedLive = Stdb.StdbBuilder.group(NamedModule, "NamedCallables", {
  touch: () => Effect.asVoid(readNamedRegion),
})
void NamedLive

// Only a module that declares the named environment is checked against it.
// @ts-expect-error a module that declares no environment does not provide REGION.
const EnvironmentlessNamed: NamedStdbModule =
  Stdb.StdbModule.make("named_environment").add(NamedCallables)
void EnvironmentlessNamed
const zoneEnvironment = { ZONE: Stdb.Environment.string() }
// @ts-expect-error a module that declares other keys does not provide REGION.
const OtherKeysNamed: NamedStdbModule = Stdb.StdbModule.make(
  "named_environment",
  {
    environment: zoneEnvironment,
  },
).add(NamedCallables)
void OtherKeysNamed
const secretEnvironment = { REGION: Stdb.Environment.secret() }
// @ts-expect-error a secret REGION reads as Redacted, not as the declared string.
const SecretNamed: NamedStdbModule = Stdb.StdbModule.make("named_environment", {
  environment: secretEnvironment,
}).add(NamedCallables)
void SecretNamed

// A named spec whose environment is not the module's is not kept as written:
// the builder intersects the module's declarations into it, so neither side's
// keys are lost. A module declaring more than the spec reads every key it
// declares; a spec declaring more than the module is refused for the module
// that lacks the extra key.
const widerEnvironment = {
  REGION: Stdb.Environment.string(),
  ZONE: Stdb.Environment.string(),
}
type WiderEnvironmentModule = NamedModuleOf<NamedSpec, typeof widerEnvironment>
const WiderEnvironmentNamed: WiderEnvironmentModule = Stdb.StdbModule.make(
  "named_environment",
  { environment: widerEnvironment },
).add(NamedCallables)
type _widerKeys = Assert<
  IsEqual<
    keyof Effect.Success<typeof WiderEnvironmentNamed.Env>,
    "REGION" | "ZONE"
  >
>
type _widerSpecKeys = Assert<
  IsEqual<
    keyof WiderEnvironmentModule["spec"]["environment"],
    "REGION" | "ZONE"
  >
>
type WiderSpec = Stdb.ModuleSpecFor<
  "named_environment",
  {},
  NamedGroups,
  {},
  never
> & { readonly environment: typeof widerEnvironment }
type NarrowerEnvironmentModule = NamedModuleOf<
  WiderSpec,
  typeof namedEnvironment
>
// @ts-expect-error the spec declares ZONE, which this module does not provide.
const NarrowerEnvironmentNamed: NarrowerEnvironmentModule =
  Stdb.StdbModule.make("named_environment", {
    environment: namedEnvironment,
  }).add(NamedCallables)
void NarrowerEnvironmentNamed
