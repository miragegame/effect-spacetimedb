
import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { make as makeServer } from "../../src/server/bind.ts"

const { describe, expect, it } = EffectVitest

import * as Stdb from "effect-spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { valueSchemaFromAst } from "../../src/contract/type/schema-from-ast.ts"
import { compileModule } from "../helpers/compile-module"
import { TestSyncRunner } from "../helpers/sync-runner"
import { builderTypeName, typeBuilder } from "../helpers/type-builder"

const T = StdbTesting.ContractType

const expectIdentifierFailure = (run: () => unknown): void => {
  expect(run).toThrow(T.StdbTypeIdentifierError)
  try {
    run()
  } catch (cause) {
    expect(cause).toBeInstanceOf(T.StdbTypeIdentifierError)
    return
  }

  throw new Error("Expected StdbTypeIdentifierError")
}

const expectWrappedIdentifierFailure = (run: () => unknown): void => {
  try {
    run()
  } catch (cause) {
    expect(cause).toBeInstanceOf(Error)
    const wrappedCause = cause instanceof Error ? cause.cause : undefined
    expect(wrappedCause).toBeInstanceOf(T.StdbTypeIdentifierError)
    return
  }

  throw new Error("Expected wrapped StdbTypeIdentifierError")
}

const expectNotNameableFailure = (
  run: () => unknown,
  kind: Stdb.TypeKind,
): void => {
  expect(run).toThrow(T.StdbTypeNotNameableError)
  try {
    run()
  } catch (cause) {
    expect(cause).toBeInstanceOf(T.StdbTypeNotNameableError)
    if (cause instanceof T.StdbTypeNotNameableError) {
      expect(cause.kind).toBe(kind)
    }
    return
  }

  throw new Error("Expected StdbTypeNotNameableError")
}

const expectDuplicateTypeName = (run: () => unknown): void => {
  try {
    run()
  } catch (cause) {
    expect(cause).toBeInstanceOf(Stdb.StdbValidationError)
    if (cause instanceof Stdb.StdbValidationError) {
      expect(cause.diagnostics).toEqual([
        expect.objectContaining({ code: "DuplicateTypeName" }),
      ])
    }
    return
  }

  throw new Error("Expected DuplicateTypeName validation failure")
}

describe("semantic SATS type identifiers", () => {
  it("uses explicit identifiers for structs, sums, and string-literal enums", () => {
    const MembershipView = T.struct({
      tenantId: T.string(),
      email: T.string(),
    }).named("MembershipView")
    const MembershipEvent = T.sum({
      joined: T.struct({ email: T.string() }),
      left: T.unit(),
    }).named("MembershipEvent")
    const MembershipKind = T.literal("joined", "left").named("MembershipKind")

    expect(builderTypeName(typeBuilder(MembershipView))).toBe("MembershipView")
    expect(builderTypeName(typeBuilder(MembershipEvent))).toBe(
      "MembershipEvent",
    )
    expect(builderTypeName(typeBuilder(MembershipKind))).toBe("MembershipKind")
  })

  it("auto-names table rows with the canonical PascalCase table name", () => {
    const userID = Stdb.table("userID", {
      columns: {
        id: Stdb.string(),
      },
    })

    expect(builderTypeName(typeBuilder(userID.row))).toBe("UserId")
  })

  it("keeps named and anonymous builders distinct for the same structure", () => {
    const Base = T.struct({
      id: T.string(),
      count: T.u32(),
    })
    const Named = Base.named("NamedPayload")
    const AlsoNamed = Base.named("AlsoNamedPayload")

    expect(builderTypeName(typeBuilder(Base))).toMatch(
      /^EffectSpacetimeDbStruct\d+$/,
    )
    expect(builderTypeName(typeBuilder(Named))).toBe("NamedPayload")
    expect(builderTypeName(typeBuilder(AlsoNamed))).toBe("AlsoNamedPayload")
  })

  it("preserves descriptors, fingerprints, codecs, and extensions when naming", () => {
    const Struct = T.struct({ id: T.string() })
    const NamedStruct = Struct.named("NamedStruct")
    const Sum = T.sum({
      present: Struct,
      missing: T.unit(),
    })
    const NamedSum = Sum.named("NamedSum")
    const Literal = T.literal("active", "away")
    const NamedLiteral = Literal.named("NamedLiteral")

    for (const [original, named] of [
      [Struct, NamedStruct],
      [Sum, NamedSum],
      [Literal, NamedLiteral],
    ] as const) {
      expect(Stdb.describe(named)).toEqual(Stdb.describe(original))
      expect(T.satsTypeFingerprint(named)).toBe(T.satsTypeFingerprint(original))
    }

    const structValue = { id: "user-1" }
    const sumValue = Sum.make.present(structValue)
    for (const [original, named, value] of [
      [Struct, NamedStruct, structValue],
      [Sum, NamedSum, sumValue],
      [Literal, NamedLiteral, "active"],
    ] as const) {
      const originalCodec = T.typeInfo(original)?.codec
      const namedCodec = T.typeInfo(named)?.codec
      expect(namedCodec?.encodeSync(value as never)).toEqual(
        originalCodec?.encodeSync(value as never),
      )
      expect(
        namedCodec?.decodeUnknownSync(
          originalCodec?.encodeSync(value as never),
        ),
      ).toEqual(value)
    }

    expect(NamedSum.make).toBe(Sum.make)
  })

  it("rejects invalid or reserved identifiers with a typed error", () => {
    for (const identifier of [
      "",
      "1x",
      "has-dash",
      "class",
      "default",
      "type",
      "params",
      "returnType",
      "__t",
      "__GeneratedClientHelper",
      "EffectSpacetimeDbStruct123",
    ]) {
      expectIdentifierFailure(() =>
        T.struct({ id: T.string() }).named(identifier),
      )
    }
  })

  it("rejects invalid raw identifier annotations", () => {
    const RawIdentifier = valueSchemaFromAst(
      Schema.Struct({
        id: Schema.String,
      }).annotate({ identifier: "default" }).ast,
    )

    expectWrappedIdentifierFailure(() => typeBuilder(RawIdentifier))
  })

  it("rejects non-nameable value kinds through an allow-list", () => {
    const cases = [
      ["string", () => T.string()],
      ["u64", () => T.u64()],
      ["bool", () => T.bool()],
      ["timestamp", () => T.timestamp()],
      ["option", () => T.option(T.string())],
      ["array", () => T.array(T.string())],
      ["unit", () => T.unit()],
      ["lazy", () => T.lazy(() => T.struct({ id: T.string() }))],
      ["custom", () => T.custom(Schema.String, { type: T.string() })],
      ["result", () => T.result(T.string(), T.unit())],
      ["literal", () => T.literal(1, 2)],
      ["literal", () => T.literal(true, false)],
    ] as const

    for (const [kind, make] of cases) {
      expectNotNameableFailure(() => make().named("Unsupported"), kind)
    }
  })

  it("allows naming inside a lazy thunk without changing the structural fingerprint", () => {
    const Named = T.lazy(() =>
      T.struct({
        value: T.string(),
      }).named("LazyPayload"),
    )
    const Anonymous = T.lazy(() =>
      T.struct({
        value: T.string(),
      }),
    )

    expect(() => typeBuilder(Named)).not.toThrow()
    expect(T.satsTypeFingerprint(Named)).toBe(T.satsTypeFingerprint(Anonymous))
  })

  it("preserves field annotations when rebuilding named value types", () => {
    const OptionalPayload = T.struct({
      value: T.string(),
    })
      .optional()
      .named("OptionalPayload")
    const PrimaryStatus = T.literal("active", "away")
      .primaryKey()
      .named("PrimaryStatus")

    expect(T.structFieldOptions(OptionalPayload).optional).toBe(true)
    expect(T.tableFieldOptions(OptionalPayload).optional).toBe(true)
    expect(T.tableFieldOptions(PrimaryStatus).primaryKey).toBe(true)
  })

  it("keeps named sums stable through the encoded narrowSchema path", () => {
    const Outcome = T.sum({
      ok: T.struct({ message: T.string() }),
      err: T.string(),
    }).named("Outcome")

    expect(builderTypeName(typeBuilder(Outcome))).toBe("Outcome")
  })

  it("reports duplicate explicit type names with different structures in one module", () => {
    const First = Stdb.struct({ id: Stdb.string() }).named("SharedPayload")
    const Second = Stdb.struct({ count: Stdb.u32() }).named("SharedPayload")
    expectDuplicateTypeName(
      () =>
        Stdb.StdbModule.make("duplicate_named_types", {}).add(
          Stdb.StdbGroup.make("Actions")
            .add(
              Stdb.StdbFn.procedure("first", {
                params: Stdb.struct({}),
                returns: First,
              }),
            )
            .add(
              Stdb.StdbFn.procedure("second", {
                params: Stdb.struct({}),
                returns: Second,
              }),
            ),
        ).spec,
    )
  })

  it("allows duplicate explicit type names with identical structures in one module", () => {
    const First = Stdb.struct({ id: Stdb.string() }).named("SharedPayload")
    const Second = Stdb.struct({ id: Stdb.string() }).named("SharedPayload")
    const Module = Stdb.StdbModule.make(
      "duplicate_named_type_identity",
      {},
    ).add(
      Stdb.StdbGroup.make("Actions")
        .add(
          Stdb.StdbFn.procedure("first", {
            params: Stdb.struct({}),
            returns: First,
          }),
        )
        .add(
          Stdb.StdbFn.procedure("second", {
            params: Stdb.struct({}),
            returns: Second,
          }),
        ),
    ).spec
    const server = makeServer({
      module: Module,
      runtime: TestSyncRunner,
    })

    expect(() =>
      compileModule({
        server,
        handlers: server.handlers({
          procedures: {
            first: Effect.fn(function* () {
              return { id: "a" }
            }),
            second: Effect.fn(function* () {
              return { id: "b" }
            }),
          },
        }),
      }),
    ).not.toThrow()
  })

  it("keeps duplicate-name detection scoped to a single module", () => {
    const ModuleA = Stdb.StdbModule.make("named_type_scope_a", {}).add(
      Stdb.StdbGroup.make("Actions").add(
        Stdb.StdbFn.procedure("readA", {
          params: Stdb.struct({}),
          returns: Stdb.struct({ id: Stdb.string() }).named("ScopedPayload"),
        }),
      ),
    ).spec
    const ModuleB = Stdb.StdbModule.make("named_type_scope_b", {}).add(
      Stdb.StdbGroup.make("Actions").add(
        Stdb.StdbFn.procedure("readB", {
          params: Stdb.struct({}),
          returns: Stdb.struct({ count: Stdb.u32() }).named("ScopedPayload"),
        }),
      ),
    ).spec

    const serverA = makeServer({
      module: ModuleA,
      runtime: TestSyncRunner,
    })
    const serverB = makeServer({
      module: ModuleB,
      runtime: TestSyncRunner,
    })

    expect(() =>
      compileModule({
        server: serverA,
        handlers: serverA.handlers({
          procedures: {
            readA: Effect.fn(function* () {
              return { id: "a" }
            }),
          },
        }),
      }),
    ).not.toThrow()
    expect(() =>
      compileModule({
        server: serverB,
        handlers: serverB.handlers({
          procedures: {
            readB: Effect.fn(function* () {
              return { count: 1 }
            }),
          },
        }),
      }),
    ).not.toThrow()
  })

  it("reports a named type that collides with a table row name", () => {
    const presenceEvent = Stdb.table("presenceEvent", {
      columns: {
        id: Stdb.string(),
      },
    })
    const Module = Stdb.StdbModule.make("named_type_table_collision", {})
      .addTables(presenceEvent)
      .add(
        Stdb.StdbGroup.make("Actions").add(
          Stdb.StdbFn.procedure("presenceEventRead", {
            params: Stdb.struct({}),
            returns: Stdb.struct({
              id: Stdb.string(),
              extra: Stdb.string(),
            }).named("PresenceEvent"),
          }),
        ),
      ).spec
    const server = makeServer({
      module: Module,
      runtime: TestSyncRunner,
    })

    expectDuplicateTypeName(() =>
      compileModule({
        server,
        handlers: server.handlers({
          procedures: {
            presenceEventRead: Effect.fn(function* () {
              return { id: "a", extra: "b" }
            }),
          },
        }),
      }),
    )
  })

  it("allows returning a table row without a duplicate type name diagnostic", () => {
    const presenceEvent = Stdb.table("presenceEvent", {
      columns: {
        id: Stdb.string(),
      },
    })
    const Module = Stdb.StdbModule.make("table_row_return_named_once", {})
      .addTables(presenceEvent)
      .add(
        Stdb.StdbGroup.make("Actions").add(
          Stdb.StdbFn.procedure("presenceEventRead", {
            params: Stdb.struct({}),
            returns: Stdb.option(presenceEvent.row),
          }),
        ),
      ).spec
    const server = makeServer({
      module: Module,
      runtime: TestSyncRunner,
    })

    expect(() =>
      compileModule({
        server,
        handlers: server.handlers({
          procedures: {
            presenceEventRead: Effect.fn(function* () {
              return undefined
            }),
          },
        }),
      }),
    ).not.toThrow()
  })

  it("reports named types reached only through callable params", () => {
    const ParamOnly = Stdb.struct({ id: Stdb.string() }).named("ParamOnly")
    const Other = Stdb.struct({ count: Stdb.u32() }).named("ParamOnly")
    expectDuplicateTypeName(
      () =>
        Stdb.StdbModule.make("named_type_param_collision", {}).add(
          Stdb.StdbGroup.make("Actions")
            .add(
              Stdb.StdbFn.reducer("write", {
                params: Stdb.struct({ value: ParamOnly }),
              }),
            )
            .add(
              Stdb.StdbFn.procedure("read", {
                params: Stdb.struct({}),
                returns: Other,
              }),
            ),
        ).spec,
    )
  })
})
