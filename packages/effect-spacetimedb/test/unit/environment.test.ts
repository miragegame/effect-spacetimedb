import * as EffectVitest from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Redacted from "effect/Redacted"
import * as Stdb from "effect-spacetimedb"
import {
  StdbEnvironmentHostReadDefect,
  StdbEnvironmentValueDefect,
} from "effect-spacetimedb/server"
import { build } from "effect-spacetimedb/server-compiler"
import * as StdbTesting from "effect-spacetimedb/testing"
import { EnvironmentModule } from "../../examples/environment-fixture/module/src/contract"
import {
  EnvironmentFunctionsLive,
  EnvironmentLifecycleLive,
  EnvironmentRoutesLive,
} from "../../examples/environment-fixture/module/src/live"
import { makeEnvServiceFactory } from "../../src/server/environment.ts"

const { describe, expect, it } = EffectVitest

const Environment = Stdb.Environment

const publishedValues = {
  GREETING: "hello",
  API_KEY: "secret-value-1",
  MODE: "development",
} as const

const describedAs = (values: {
  readonly greeting: string
  readonly apiKey: string
  readonly mode: string
  readonly region?: string
}) =>
  [
    `greeting=${values.greeting}`,
    `apiKey=${values.apiKey}`,
    "shown=<redacted:API_KEY>",
    `mode=${values.mode}`,
    `region=${values.region ?? "<absent>"}`,
  ].join(";")

const published = describedAs({
  greeting: "hello",
  apiKey: "secret-value-1",
  mode: "development",
})

// The build plan carries the lifecycle hook as well as the groups, and its
// spec is re-assembled with the lifecycle, so it also proves the declarations
// survive that step.
const callables = StdbTesting.bindCallables(
  Stdb.StdbBuilder.plan(EnvironmentModule, [
    EnvironmentFunctionsLive,
    EnvironmentRoutesLive,
    EnvironmentLifecycleLive,
  ]),
)

const invoke = (name: string, ctx: unknown, args: unknown): unknown => {
  const callable = callables[name]
  if (callable === undefined) {
    throw new Error(`fixture callable ${name} is not bound`)
  }
  return callable.invoke(ctx, args)
}

const makeHarness = (
  environment: StdbTesting.TestModuleEnvironmentValues<
    typeof EnvironmentModule.spec
  > = publishedValues,
) => StdbTesting.makeTestModuleHarness(EnvironmentModule.spec, { environment })

const routeText = (ctx: unknown): string =>
  (
    invoke(
      "environmentRoute",
      ctx,
      new Stdb.Request("http://module/environment"),
    ) as Stdb.SyncResponse
  ).text()

const countingReader = (
  reader: StdbTesting.TestModuleHarness<
    typeof EnvironmentModule.spec
  >["environment"],
) => {
  const keys: Array<string> = []
  return {
    keys,
    reader: {
      get: (key: string) => {
        keys.push(key)
        return reader.get(key)
      },
    },
  }
}

const defectOf = <A>(exit: Exit.Exit<A>): unknown =>
  Exit.isFailure(exit)
    ? exit.cause.reasons.find(Cause.isDieReason)?.defect
    : undefined

const diagnosticsOf = (
  build: () => unknown,
): ReadonlyArray<Stdb.StdbDiagnostic> => {
  // The contract builder reports invalid declarations by throwing when the
  // spec is assembled; the thrown diagnostics are the observation.
  try {
    build()
  } catch (cause) {
    if (cause instanceof Stdb.StdbValidationError) {
      return cause.diagnostics
    }
    throw cause
  }
  return []
}

const diagnosticCodesOf = (build: () => unknown): ReadonlyArray<string> =>
  diagnosticsOf(build).map((diagnostic) => diagnostic.code)

const specWithEnvironment = (environment: Stdb.Environment.Declarations) =>
  Stdb.StdbModule.make("environment_validation", { environment }).spec

describe("database environment declarations", () => {
  it("keeps the declarations on the assembled spec", () => {
    expect(EnvironmentModule.spec.environment).toEqual({
      GREETING: { kind: "string", optional: false },
      API_KEY: { kind: "secret", optional: false },
      MODE: {
        kind: "literal",
        values: ["development", "production"],
        optional: false,
      },
      REGION: { kind: "string", optional: true },
    })
    expect(Stdb.StdbModule.make("no_environment").spec.environment).toEqual({})
  })

  it("refuses key names the host refuses", () => {
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({
          "1_STARTS_WITH_DIGIT": Environment.string(),
          "HAS-DASH": Environment.string(),
          [`K${"x".repeat(256)}`]: Environment.string(),
        }),
      ),
    ).toEqual([
      "InvalidEnvironmentKey",
      "InvalidEnvironmentKey",
      "InvalidEnvironmentKey",
    ])
  })

  it("refuses more declarations than the host accepts", () => {
    const declarations = Object.fromEntries(
      Array.from(
        { length: Environment.declarationCountMax + 1 },
        (_, index) => [`KEY_${index.toString()}`, Environment.string()],
      ),
    )
    expect(diagnosticCodesOf(() => specWithEnvironment(declarations))).toEqual([
      "EnvironmentDeclarationCountExceeded",
    ])
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment(
          Object.fromEntries(
            Object.entries(declarations).slice(
              0,
              Environment.declarationCountMax,
            ),
          ),
        ),
      ),
    ).toEqual([])
  })

  it("refuses literal sets the host refuses", () => {
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({
          DUPLICATED: Environment.literal("on", "on"),
          TOO_LONG: Environment.literal(
            "x".repeat(Environment.valueBytesMax + 1),
          ),
          AT_LIMIT: Environment.literal("x".repeat(Environment.valueBytesMax)),
        }),
      ),
    ).toEqual(["InvalidEnvironmentLiteral", "InvalidEnvironmentLiteral"])
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({
          // Only reachable without the builders, which require a value.
          EMPTY: { kind: "literal", values: [], optional: false } as never,
        }),
      ),
    ).toEqual(["InvalidEnvironmentLiteral"])
  })

  it("refuses a literal set larger than the host's union limit", () => {
    const allowed = (count: number) =>
      Array.from({ length: count }, (_, index) => `value_${index.toString()}`)
    const [first = "", ...rest] = allowed(Environment.unionEntryCountMax + 1)

    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({ MODE: Environment.literal(first, ...rest) }),
      ),
    ).toEqual(["EnvironmentUnionEntriesExceeded"])
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({
          MODE: Environment.literal(first, ...rest.slice(1)),
        }),
      ),
    ).toEqual([])
  })

  it("refuses declarations whose keys and literals exceed the host's schema budget", () => {
    // Two keys of 200 distinct near-limit literals: each set is within every
    // per-key limit, together they pass the 2 MiB schema budget at the second.
    const literals = (prefix: string) =>
      Array.from({ length: 200 }, (_, index) =>
        `${prefix}${index.toString()}`.padEnd(8_000, "x"),
      )
    const [firstA = "", ...restA] = literals("a")
    const [firstB = "", ...restB] = literals("b")
    const oversized = {
      FIRST: Environment.literal(firstA, ...restA),
      SECOND: Environment.literal(firstB, ...restB),
    }

    expect(
      diagnosticsOf(() => specWithEnvironment(oversized)).map((diagnostic) => [
        diagnostic.code,
        diagnostic.path,
      ]),
    ).toEqual([["EnvironmentSchemaBytesExceeded", ["environment", "SECOND"]]])
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({ FIRST: Environment.literal(firstA, ...restA) }),
      ),
    ).toEqual([])
  })

  it("refuses a declaration that no builder produced", () => {
    expect(
      diagnosticCodesOf(() =>
        specWithEnvironment({
          NUMBER: { kind: "number", optional: false } as never,
          LOOSE: "string" as never,
        }),
      ),
    ).toEqual([
      "InvalidEnvironmentDeclaration",
      "InvalidEnvironmentDeclaration",
    ])
  })

  it("compiles declarations, never values, into the SDK schema env setting", () => {
    const compiled = build(
      EnvironmentModule,
      [
        EnvironmentFunctionsLive,
        EnvironmentRoutesLive,
        EnvironmentLifecycleLive,
      ],
      { runtimeMode: "dev-guarded" },
    )
    const settings = (
      compiled.schema as {
        readonly moduleSettings: {
          readonly CASE_CONVERSION_POLICY: unknown
          readonly env: Readonly<
            Record<string, Readonly<Record<string, unknown>>>
          >
        }
      }
    ).moduleSettings

    expect(settings.CASE_CONVERSION_POLICY).toBe("snake_case")
    expect(Object.keys(settings.env)).toEqual([
      "GREETING",
      "API_KEY",
      "MODE",
      "REGION",
    ])
    const unitPayload = { tag: "Product", value: { elements: [] } }
    expect(settings.env.GREETING).toMatchObject({ kind: "string" })
    expect(settings.env.API_KEY).toMatchObject({ kind: "string" })
    // A literal set is a bare payload-free sum type, never a `t.enum` builder
    // whose members its values could collide with.
    expect(settings.env.MODE).toEqual({
      algebraicType: {
        tag: "Sum",
        value: {
          variants: [
            { name: "development", algebraicType: unitPayload },
            { name: "production", algebraicType: unitPayload },
          ],
        },
      },
      variants: {},
    })
    expect(settings.env.REGION).toMatchObject({
      kind: "option",
      item: { kind: "string" },
    })
  })
})

describe("database environment reads", () => {
  it("serves declared values to every callable kind", () => {
    const harness = makeHarness()

    invoke("init", harness.makeMutationCtx(), {})
    invoke("recordEnvironment", harness.makeMutationCtx(), {
      source: "reducer",
    })
    expect(harness.db.observation.source.find("init")?.description).toBe(
      published,
    )
    expect(harness.db.observation.source.find("reducer")?.description).toBe(
      published,
    )
    expect(invoke("readEnvironment", harness.makeProcedureCtx(), {})).toBe(
      published,
    )
    expect(invoke("readEnvironmentInTx", harness.makeProcedureCtx(), {})).toBe(
      published,
    )
    expect(
      invoke("environmentView", harness.makeAnonymousViewCtx(), {}),
    ).toEqual([{ source: "view", description: published }])
    expect(routeText(harness.makeHttpHandlerCtx())).toBe(published)
  })

  it("lets the fixture's init refuse an empty greeting", () => {
    const harness = makeHarness({ ...publishedValues, GREETING: "" })

    expect(() => invoke("init", harness.makeMutationCtx(), {})).toThrow()
    expect(harness.db.observation.source.find("init")).toBeUndefined()
  })

  it("re-reads the host on every call, so an update is seen by the next call", () => {
    const harness = makeHarness()
    const counted = countingReader(harness.environment)
    const ctx = harness.makeProcedureCtx({ env: counted.reader })

    expect(invoke("readEnvironment", ctx, {})).toBe(published)
    harness.updateEnvironment({ GREETING: "updated", REGION: "eu" })
    expect(invoke("readEnvironment", ctx, {})).toBe(
      describedAs({
        greeting: "updated",
        apiKey: "secret-value-1",
        mode: "development",
        region: "eu",
      }),
    )
    expect(counted.keys).toEqual([
      "GREETING",
      "API_KEY",
      "MODE",
      "REGION",
      "GREETING",
      "API_KEY",
      "MODE",
      "REGION",
    ])
    harness.updateEnvironment({ REGION: undefined })
    expect(routeText(harness.makeHttpHandlerCtx())).toBe(
      describedAs({
        greeting: "updated",
        apiKey: "secret-value-1",
        mode: "development",
      }),
    )
  })

  it("reads through the transaction's reader inside a procedure transaction", () => {
    const harness = makeHarness()
    // The host's reader inside a transaction answers from that transaction's
    // snapshot; a distinct reader shows which one each read used.
    const snapshot = {
      get: (key: string) =>
        key === "GREETING"
          ? "from-the-transaction"
          : harness.environment.get(key),
    }
    const ctx = harness.makeProcedureCtx({ transaction: { env: snapshot } })

    expect(invoke("readEnvironment", ctx, {})).toBe(published)
    expect(invoke("readEnvironmentInTx", ctx, {})).toBe(
      describedAs({
        greeting: "from-the-transaction",
        apiKey: "secret-value-1",
        mode: "development",
      }),
    )
  })

  it.effect("reads each yield afresh within one call", () =>
    Effect.gen(function* () {
      const reads: Array<string> = []
      const service = makeEnvServiceFactory({ GREETING: Environment.string() })(
        {
          env: {
            get: (key) => {
              reads.push(key)
              return `read-${reads.length.toString()}`
            },
          },
        },
      )
      expect(yield* service.GREETING!).toBe("read-1")
      expect(yield* service.GREETING!).toBe("read-2")
      expect(reads).toEqual(["GREETING", "GREETING"])
    }),
  )

  it.effect("surfaces secrets as Redacted so printing never shows them", () =>
    Effect.gen(function* () {
      const service = makeEnvServiceFactory({ API_KEY: Environment.secret() })({
        env: { get: () => "secret-value-1" },
      })
      const secret = yield* service.API_KEY!

      expect(Redacted.isRedacted(secret)).toBe(true)
      expect(
        Redacted.isRedacted(secret) ? Redacted.value(secret) : undefined,
      ).toBe("secret-value-1")
      expect(String(secret)).toBe("<redacted:API_KEY>")
      expect(JSON.stringify({ secret })).not.toContain("secret-value-1")
    }),
  )

  it.effect(
    "treats a host read failure as a defect that names only the key",
    () =>
      Effect.gen(function* () {
        const hostCause = new Error("host refused")
        const failing = makeEnvServiceFactory({
          API_KEY: Environment.secret(),
        })({
          env: {
            get: () => {
              throw hostCause
            },
          },
        })
        const absent = makeEnvServiceFactory({
          GREETING: Environment.string(),
        })({
          env: { get: () => null },
        })
        const outside = makeEnvServiceFactory({
          MODE: Environment.literal("development", "production"),
        })({ env: { get: () => "staging-secret-value" } })
        const optional = makeEnvServiceFactory({
          REGION: Environment.optional(Environment.string()),
        })({ env: { get: () => null } })

        const hostFailure = defectOf(yield* Effect.exit(failing.API_KEY!))
        const missing = defectOf(yield* Effect.exit(absent.GREETING!))
        const outsideSet = defectOf(yield* Effect.exit(outside.MODE!))

        expect(hostFailure).toEqual(
          new StdbEnvironmentHostReadDefect({
            key: "API_KEY",
            cause: hostCause,
          }),
        )
        expect(missing).toEqual(
          new StdbEnvironmentValueDefect({
            key: "GREETING",
            reason: "requiredValueAbsent",
          }),
        )
        expect(outsideSet).toEqual(
          new StdbEnvironmentValueDefect({
            key: "MODE",
            reason: "valueOutsideDeclaration",
          }),
        )
        expect(String(outsideSet)).not.toContain("staging-secret-value")
        expect(yield* optional.REGION!).toBeUndefined()
      }),
  )

  it("never touches the host for a module that declares nothing", () => {
    const service = makeEnvServiceFactory({})({
      env: {
        get: () => {
          throw new Error("an empty environment must not read the host")
        },
      },
    })
    expect(Object.keys(service)).toEqual([])
  })
})

describe("test harness environments", () => {
  it("refuses an environment the host would refuse at publish", () => {
    const { MODE: _mode, ...withoutMode } = publishedValues
    expect(() => makeHarness(withoutMode)).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "MODE",
        reason: "requiredValueMissing",
      }),
    )
    expect(() =>
      makeHarness({ ...publishedValues, MODE: "staging" as never }),
    ).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "MODE",
        reason: "valueOutsideDeclaration",
      }),
    )
    expect(() =>
      makeHarness({
        ...publishedValues,
        GREETING: "x".repeat(Environment.valueBytesMax + 1),
      }),
    ).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "GREETING",
        reason: "valueTooLong",
      }),
    )
  })

  it("applies updates atomically and refuses undeclared reads", () => {
    const harness = makeHarness()

    expect(() =>
      harness.updateEnvironment({
        GREETING: "partial",
        MODE: "staging" as never,
      }),
    ).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "MODE",
        reason: "valueOutsideDeclaration",
      }),
    )
    expect(() => harness.updateEnvironment({ GREETING: undefined })).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "GREETING",
        reason: "requiredValueMissing",
      }),
    )
    expect(harness.environment.get("GREETING")).toBe("hello")
    expect(harness.environment.get("REGION")).toBeNull()
    expect(() => harness.environment.get("UNDECLARED")).toThrow(
      new StdbTesting.TestModuleEnvironmentError({
        key: "UNDECLARED",
        reason: "undeclaredKey",
      }),
    )
  })

  it("backs the off-host stub's env_get only while a scope is active", () => {
    const harness = makeHarness()
    const override = { get: () => "override" }

    expect(() => StdbTesting.SpacetimeSysStub.env_get("GREETING")).toThrow(
      /only available inside SpaceTimeDB/u,
    )
    StdbTesting.SpacetimeSysStub.withEnvironment(harness.environment, () => {
      expect(StdbTesting.SpacetimeSysStub.env_get("GREETING")).toBe("hello")
      StdbTesting.SpacetimeSysStub.withEnvironment(override, () => {
        expect(StdbTesting.SpacetimeSysStub.env_get("GREETING")).toBe(
          "override",
        )
      })
      expect(StdbTesting.SpacetimeSysStub.env_get("GREETING")).toBe("hello")
      expect(() => StdbTesting.SpacetimeSysStub.env_get("UNDECLARED")).toThrow(
        StdbTesting.TestModuleEnvironmentError,
      )
    })
    expect(() => StdbTesting.SpacetimeSysStub.env_get("GREETING")).toThrow(
      /only available inside SpaceTimeDB/u,
    )
  })

  it.effect("keeps the stub backed across an async body's awaits", () =>
    Effect.gen(function* () {
      const harness = makeHarness()
      const read = yield* Effect.promise(() =>
        StdbTesting.SpacetimeSysStub.withEnvironmentAsync(
          harness.environment,
          async () => {
            // A microtask boundary: a synchronous scope would already have
            // been released by the time the body resumes here.
            await Promise.resolve()
            return StdbTesting.SpacetimeSysStub.env_get("GREETING")
          },
        ),
      )

      expect(read).toBe("hello")
      expect(() => StdbTesting.SpacetimeSysStub.env_get("GREETING")).toThrow(
        /only available inside SpaceTimeDB/u,
      )
    }),
  )
})
