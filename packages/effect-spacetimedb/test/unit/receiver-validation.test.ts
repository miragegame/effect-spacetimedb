import * as EffectVitest from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { IdcFixtureInboxBinding } from "../fixtures/idc/binding"
import { IdcFixtureInbox } from "../fixtures/idc/inbox"
import { IdcFixtureInboxInterface } from "../fixtures/idc/interface"
import idcFixtureInboxBinding from "../fixtures/idc/remote/idc_fixture_inbox/index.js"

const { describe, expect, it } = EffectVitest

type Diagnostic = {
  readonly code: string
  readonly path: ReadonlyArray<string | number>
}

const diagnosticsOf = (run: () => unknown): ReadonlyArray<Diagnostic> => {
  try {
    run()
  } catch (cause) {
    if (cause instanceof Stdb.StdbValidationError) {
      return cause.diagnostics.map(({ code, path }) => ({ code, path }))
    }
    throw cause
  }
  return []
}

const moduleWithReceiver =
  (params: Stdb.StructLikeValueType, settings: Stdb.ModuleSettings = {}) =>
  () =>
    Stdb.StdbModule.make("receiver_rules", { settings }).add(
      Stdb.StdbGroup.make("Inbox").add(
        Stdb.StdbFn.receiver("acceptCall", { params }),
      ),
    ).spec

describe("receivers", () => {
  it("pins the wire name to the snake_case key under every case policy", () => {
    const params = Stdb.struct({ note: Stdb.string() })
    for (const caseConversionPolicy of ["none", "snake_case"] as const) {
      const spec = moduleWithReceiver(params, { caseConversionPolicy })()
      expect(spec.wireNames.functions.acceptCall).toBe("accept_call")
      expect(spec.reducers.acceptCall.public).toBe(true)
    }
    expect(
      Stdb.wireNameOf(
        moduleWithReceiver(params, { caseConversionPolicy: "none" })(),
        "acceptCall",
      ),
    ).toBe("accept_call")
  })

  it("accepts parameter, field and variant names that are one lowercase word", () => {
    expect(
      diagnosticsOf(
        moduleWithReceiver(
          Stdb.struct({
            ticket: Stdb.string(),
            details: Stdb.struct({
              labels: Stdb.array(Stdb.string(), { minimum: 0, maximum: 4 }),
              outcome: Stdb.literal("accepted", "refused"),
              state: Stdb.sum({ ready: Stdb.unit(), retry: Stdb.u32() }),
              note: Stdb.option(Stdb.string()),
            }),
          }),
        ),
      ),
    ).toEqual([])
  })

  it("refuses names a case policy would rewrite, wherever the params reach them", () => {
    expect(
      diagnosticsOf(
        moduleWithReceiver(
          Stdb.struct({
            ticketId: Stdb.string(),
            details: Stdb.struct({
              retryAt: Stdb.u64(),
              outcome: Stdb.literal("player-cancelled"),
              state: Stdb.sum({ retryLater: Stdb.unit() }),
            }),
            items: Stdb.array(Stdb.struct({ itemCount: Stdb.u32() }), {
              minimum: 0,
              maximum: 4,
            }),
          }),
        ),
      ),
    ).toEqual([
      {
        code: "ReceiverNameNotPolicyInvariant",
        path: ["reducers", "acceptCall", "params", "ticketId"],
      },
      {
        code: "ReceiverNameNotPolicyInvariant",
        path: ["reducers", "acceptCall", "params", "details", "retryAt"],
      },
      {
        code: "ReceiverNameNotPolicyInvariant",
        path: [
          "reducers",
          "acceptCall",
          "params",
          "details",
          "outcome",
          "player-cancelled",
        ],
      },
      {
        code: "ReceiverNameNotPolicyInvariant",
        path: [
          "reducers",
          "acceptCall",
          "params",
          "details",
          "state",
          "retryLater",
        ],
      },
      {
        code: "ReceiverNameNotPolicyInvariant",
        path: ["reducers", "acceptCall", "params", "items", "itemCount"],
      },
    ])
  })

  it("refuses a parameter named like outbox metadata", () => {
    expect(
      diagnosticsOf(
        moduleWithReceiver(Stdb.struct({ target: Stdb.identity() })),
      ),
    ).toEqual([
      {
        code: "ReceiverParamReserved",
        path: ["reducers", "acceptCall", "params", "target"],
      },
    ])
  })

  it("refuses a hand-built receiver that is not client-callable", () => {
    const declared = Stdb.StdbFn.receiver("acceptCall", {
      params: Stdb.struct({ note: Stdb.string() }),
    })
    expect(
      diagnosticsOf(
        () =>
          Stdb.StdbModule.make("private_receiver", {}).add(
            Stdb.StdbGroup.make("Inbox").add({
              ...declared,
              spec: { ...declared.spec, public: false },
            } as never),
          ).spec,
      ),
    ).toEqual([
      {
        code: "InvalidReceiver",
        path: ["reducers", "acceptCall", "public"],
      },
    ])
  })

  it("requires every group implementing a receiver to declare a reducer guard", () => {
    const Module = Stdb.StdbModule.make("guarded_inbox", {}).add(
      IdcFixtureInbox,
    )
    const handlers = {
      receivePing: () => Effect.void,
      receiveDetails: () => Effect.void,
    }

    expect(
      diagnosticsOf(() =>
        Stdb.StdbBuilder.group(Module, "IdcFixtureInbox", handlers),
      ),
    ).toEqual([
      {
        code: "ReceiverWithoutGuard",
        path: ["groups", "IdcFixtureInbox", "receivePing"],
      },
    ])
    expect(
      diagnosticsOf(() =>
        Stdb.StdbBuilder.group(Module, "IdcFixtureInbox", handlers, {
          middleware: { procedures: Effect.void },
        }),
      ),
    ).toEqual([
      {
        code: "ReceiverWithoutGuard",
        path: ["groups", "IdcFixtureInbox", "receivePing"],
      },
    ])
    expect(
      diagnosticsOf(() =>
        Stdb.StdbBuilder.group(Module, "IdcFixtureInbox", handlers, {
          middleware: { reducers: Effect.void },
        }),
      ),
    ).toEqual([])
    expect(
      diagnosticsOf(() =>
        Stdb.StdbBuilder.group(Module, "IdcFixtureInbox", handlers, {
          middleware: Effect.void,
        }),
      ),
    ).toEqual([])
  })
})

describe("remote interfaces", () => {
  it("names a receiver group without its binding", () => {
    expect(IdcFixtureInboxInterface.name).toBe("idc_fixture_inbox")
    expect(Object.keys(IdcFixtureInboxInterface.receivers).sort()).toEqual([
      "receiveDetails",
      "receivePing",
    ])
    // A contract imports the interface, and a binding loads only in a host.
    expect(Object.keys(IdcFixtureInboxInterface).sort()).toEqual([
      "groupId",
      "kind",
      "name",
      "receivers",
    ])
  })

  it("pairs an interface with the binding generated for it", () => {
    expect(IdcFixtureInboxBinding.interface).toBe(IdcFixtureInboxInterface)
    expect(IdcFixtureInboxBinding.binding).toBe(idcFixtureInboxBinding)
  })

  it("refuses a binding generated from another version of the group", () => {
    const Inbox = Stdb.RemoteInterface.make({
      name: "inbox",
      group: IdcFixtureInbox,
    })
    const binding = idcFixtureInboxBinding
    const receivePing = binding.reducers.receivePing
    const bindWith = (reducers: Record<string, unknown>) => () =>
      Stdb.RemoteInterface.bind(Inbox, { ...binding, reducers } as never)

    expect(
      diagnosticsOf(bindWith({ receivePing: binding.reducers.receivePing })),
    ).toEqual([
      {
        code: "RemoteInterfaceBindingMismatch",
        path: ["remoteInterfaces", "inbox", "receiveDetails"],
      },
    ])
    expect(
      diagnosticsOf(
        bindWith({
          ...binding.reducers,
          receivePing: { ...receivePing, name: "Receive_Ping" },
        }),
      ),
    ).toEqual([
      {
        code: "RemoteInterfaceBindingMismatch",
        path: ["remoteInterfaces", "inbox", "receivePing", "name"],
      },
    ])
    expect(
      diagnosticsOf(
        bindWith({
          ...binding.reducers,
          receivePing: { ...receivePing, params: { text: receivePing.params } },
        }),
      ),
    ).toEqual([
      {
        code: "RemoteInterfaceBindingMismatch",
        path: ["remoteInterfaces", "inbox", "receivePing", "params"],
      },
    ])
    expect(diagnosticsOf(bindWith({ ...binding.reducers }))).toEqual([])
  })

  it("refuses an interface name that is not a SpacetimeDB identifier", () => {
    expect(
      diagnosticsOf(() =>
        Stdb.RemoteInterface.make({ name: "inbox.v1", group: IdcFixtureInbox }),
      ),
    ).toEqual([
      {
        code: "InvalidRemoteInterface",
        path: ["remoteInterfaces", "inbox.v1"],
      },
    ])
  })

  it("refuses a group endpoint that is not a receiver", () => {
    const Mixed = Stdb.StdbGroup.make("Mixed").add(
      Stdb.StdbFn.reducer("plainCall", {}),
    )
    expect(
      diagnosticsOf(() =>
        Stdb.RemoteInterface.make({ name: "mixed", group: Mixed }),
      ),
    ).toEqual([
      {
        code: "InvalidRemoteInterface",
        path: ["remoteInterfaces", "mixed", "plainCall"],
      },
    ])
  })
})
