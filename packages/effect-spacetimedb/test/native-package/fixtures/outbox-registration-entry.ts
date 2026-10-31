import { AlgebraicType, BinaryWriter, Identity } from "spacetimedb"
import * as StdbTesting from "effect-spacetimedb/testing"
import { build } from "effect-spacetimedb/server-compiler"
import { hostValueBsatnBytes } from "../../../src/server/outbox.ts"
import { IdcFixtureInboxBinding } from "../../fixtures/idc/binding.ts"
import { IdcReceiverModule } from "../../fixtures/idc/receiver/contract.ts"
import { IdcFixtureInboxLive } from "../../fixtures/idc/receiver/live.ts"
import {
  detailsOutbox,
  IdcSenderModule,
  pingOutbox,
} from "../../fixtures/idc/sender/contract.ts"
import {
  IdcSenderSendsLive,
  IdcSenderSettlesLive,
} from "../../fixtures/idc/sender/live.ts"

const moduleHooksKey = Symbol.for("spacetime:sys/moduleHooks")

type NativeOutboxDef = {
  readonly tableName: string
  readonly remoteReducer: string
  readonly signatureHash: bigint
  readonly targetColumn: number
  readonly argColumns: ReadonlyArray<number>
  readonly onResultReducer: string | undefined
}

type NativeModuleDef = {
  readonly tables: ReadonlyArray<{
    readonly sourceName: string
    readonly productTypeRef: number
  }>
  readonly reducers: ReadonlyArray<{ readonly sourceName: string }>
  readonly outboxes: ReadonlyArray<NativeOutboxDef>
  readonly explicitNames: {
    readonly entries: ReadonlyArray<{
      readonly tag: string
      readonly value: {
        readonly sourceName: string
        readonly canonicalName: string
      }
    }>
  }
}

type NativeSchema = {
  readonly moduleDef: NativeModuleDef
  readonly typespace: NonNullable<
    Parameters<typeof AlgebraicType.makeSerializer>[1]
  >
} & Record<symbol, (exports: object) => unknown>

export type OutboxRegistrationProbe = {
  readonly outboxes: ReadonlyArray<NativeOutboxDef>
  /** The binding's receivers: wire name and signature hash, by key. */
  readonly bindingReducers: Readonly<
    Record<string, { readonly name: string; readonly signatureHash: bigint }>
  >
  readonly senderReducerNames: ReadonlyArray<string>
  readonly receiverReducerNames: ReadonlyArray<string>
  readonly receiverFunctionNames: ReadonlyArray<{
    readonly sourceName: string
    readonly canonicalName: string
  }>
  /** Native BSATN length and our computed size of each outbox row sent. */
  readonly rowSizes: ReadonlyArray<{
    readonly table: string
    readonly nativeBytes: number
    readonly computedBytes: number
  }>
}

// Registers every export as the host's module loader does, so upstream runs
// its outbox and `onResult` checks against our compiled tables and reducers.
const register = (compiled: {
  readonly schema: unknown
  readonly exportGroup: () => unknown
}): NativeSchema => {
  const schema = compiled.schema as NativeSchema
  schema[moduleHooksKey]?.call(schema, {
    default: schema,
    ModuleExports: compiled.exportGroup(),
  })
  return schema
}

const receiverIdentity = new Identity(0xbeefn)

export const probe = (): OutboxRegistrationProbe => {
  const sender = register(
    build(IdcSenderModule, [IdcSenderSendsLive, IdcSenderSettlesLive], {
      runtimeMode: "dev-guarded",
      receiverBindings: [IdcFixtureInboxBinding],
    }),
  )
  const receiver = register(
    build(IdcReceiverModule, [IdcFixtureInboxLive], {
      runtimeMode: "dev-guarded",
    }),
  )

  // Rows exactly as our insert handle hands them to the host, serialized by
  // the SDK with the row type upstream registered for each outbox.
  const harness = StdbTesting.makeTestModuleHarness(IdcSenderModule.spec, {
    environment: { IDC_FIXTURE_PEER: receiverIdentity.toHexString() },
  })
  const callables = StdbTesting.bindCallables(IdcSenderModule, [
    IdcSenderSendsLive,
    IdcSenderSettlesLive,
  ])
  callables.sendPing?.invoke(harness.makeMutationCtx(), {
    note: "héllo",
    requestId: "request-1",
  })
  callables.sendDetails?.invoke(harness.makeMutationCtx(), {
    body: "with details",
    labels: ["a", "bc"],
  })

  const rowSizes = [
    { key: "pingOutbox", table: pingOutbox },
    { key: "detailsOutbox", table: detailsOutbox },
  ].flatMap(({ key, table }) => {
    const tableDef = sender.moduleDef.tables.find(
      (candidate) => candidate.sourceName === key,
    )
    const rowType =
      tableDef === undefined
        ? undefined
        : sender.typespace.types[tableDef.productTypeRef]
    if (rowType === undefined) {
      return []
    }
    const serialize = AlgebraicType.makeSerializer(rowType, sender.typespace)
    const rawTable = (
      harness.db as unknown as Record<
        string,
        { readonly iter: () => Iterable<unknown> }
      >
    )[key]
    return [...(rawTable?.iter() ?? [])].map((row) => {
      const writer = new BinaryWriter(256)
      serialize(writer, row)
      return {
        table: key,
        nativeBytes: writer.getBuffer().length,
        computedBytes: hostValueBsatnBytes(table.row, row),
      }
    })
  })

  return {
    outboxes: sender.moduleDef.outboxes.map((outbox) => ({ ...outbox })),
    bindingReducers: Object.fromEntries(
      Object.entries(IdcFixtureInboxBinding.binding.reducers).map(
        ([key, reducer]) => [
          key,
          { name: reducer.name, signatureHash: reducer.signatureHash },
        ],
      ),
    ),
    senderReducerNames: sender.moduleDef.reducers.map(
      (reducer) => reducer.sourceName,
    ),
    receiverReducerNames: receiver.moduleDef.reducers.map(
      (reducer) => reducer.sourceName,
    ),
    receiverFunctionNames: receiver.moduleDef.explicitNames.entries
      .filter((entry) => entry.tag === "Function")
      .map((entry) => ({ ...entry.value })),
    rowSizes,
  }
}
