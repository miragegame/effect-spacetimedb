import * as Effect from "effect/Effect"
import * as Match from "effect/Match"
import type { AnyModuleSpec } from "../contract/module.ts"
import type { TableRow } from "../contract/table.ts"
import type { AnyValueType } from "../contract/type.ts"
import { addDecodeContext, StdbDecodeError } from "../decode-error.ts"
import { indexValueCodecOf } from "../index-value-codec.ts"
import type { ModulePlan } from "../module-plan.ts"
import { typedEntries, typedFromEntries } from "../utils.ts"
import { clientIndexPlansOf } from "./client-index.ts"
import * as ValueCodec from "./value-codec.ts"
import type {
  PublicTableCache,
  WsConnectionLike,
  WsTableRow,
} from "./ws-client.ts"

export const makePublicTableCache = <
  Module extends AnyModuleSpec,
  ErrorContext,
  RelationContext,
>(options: {
  readonly plan: ModulePlan<Module>
  readonly connection: WsConnectionLike<Module, ErrorContext, RelationContext>
  readonly tableRowTypes: Record<string, AnyValueType>
  readonly decodeTableRow: <Key extends keyof Module["tables"] & string>(
    key: Key,
    row: WsTableRow<Module["tables"][Key]>,
  ) => TableRow<Module["tables"][Key]>
}): PublicTableCache<Module> =>
  typedFromEntries(
    typedEntries(options.plan.publicTables).map(([key, table]) => {
      const relation = options.connection.db[key]
      const indexCodec = indexValueCodecOf(table, `cache.tables.${key}`)
      const decodeRows = (): ReadonlyArray<
        TableRow<Module["tables"][typeof key]>
      > =>
        Array.from(relation.iter(), (row) => options.decodeTableRow(key, row))
      const decodeNativeRows = (
        rows: Effect.Effect<ReadonlyArray<unknown>, StdbDecodeError>,
      ) =>
        rows.pipe(
          Effect.flatMap((rows) =>
            Effect.forEach(rows, (row) =>
              ValueCodec.db
                .decode<TableRow<Module["tables"][typeof key]>>(
                  options.tableRowTypes[key]!,
                  row,
                )
                .pipe(
                  Effect.mapError((error) =>
                    addDecodeContext(error, { table: key }),
                  ),
                ),
            ),
          ),
        )
      const decodeRowsEffect = () =>
        decodeNativeRows(
          Effect.try({
            try: () => Array.from(relation.iter()),
            catch: (cause) =>
              StdbDecodeError.is(cause)
                ? cause
                : new StdbDecodeError({
                    phase: "row",
                    cause,
                    table: key,
                  }),
          }),
        )
      const indexes = Object.fromEntries(
        clientIndexPlansOf(table).flatMap<readonly [string, unknown]>((plan) =>
          Match.value(plan).pipe(
            Match.discriminatorsExhaustive("kind")({
              "unsupported-algorithm": () => [],
              unique: (uniquePlan) => {
                const nativeIndex = relation[uniquePlan.key]
                const op = `cache.tables.${key}.${uniquePlan.key}`
                return [
                  [
                    uniquePlan.key,
                    {
                      find: (value: unknown) =>
                        Effect.try({
                          try: () =>
                            (
                              nativeIndex as {
                                readonly find: (input: unknown) => unknown
                              }
                            ).find(
                              indexCodec.encodePoint(uniquePlan.columns, value),
                            ),
                          catch: (cause) =>
                            new StdbDecodeError({
                              phase: "args",
                              cause,
                              table: key,
                              op,
                            }),
                        }).pipe(
                          Effect.flatMap((row) =>
                            row === null || row === undefined
                              ? Effect.void
                              : ValueCodec.db
                                  .decode<
                                    TableRow<Module["tables"][typeof key]>
                                  >(options.tableRowTypes[key]!, row)
                                  .pipe(
                                    Effect.mapError((error) =>
                                      addDecodeContext(error, {
                                        table: key,
                                        op,
                                      }),
                                    ),
                                  ),
                          ),
                        ),
                    },
                  ] as const,
                ]
              },
              range: (rangePlan) => {
                const nativeIndex = relation[rangePlan.key]
                const op = `cache.tables.${key}.${rangePlan.key}`
                return [
                  [
                    rangePlan.key,
                    {
                      filter: (value: unknown) =>
                        decodeNativeRows(
                          Effect.try({
                            try: () =>
                              Array.from(
                                (
                                  nativeIndex as {
                                    readonly filter: (
                                      input: unknown,
                                    ) => Iterable<unknown>
                                  }
                                ).filter(
                                  indexCodec.encodeRange(
                                    rangePlan.columns,
                                    value,
                                  ),
                                ),
                              ),
                            catch: (cause) =>
                              new StdbDecodeError({
                                phase: "args",
                                cause,
                                table: key,
                                op,
                              }),
                          }),
                        ),
                    },
                  ] as const,
                ]
              },
            }),
          ),
        ),
      )
      return [
        key,
        {
          count: () => relation.count(),
          ...indexes,
          toArray: decodeRowsEffect,
          unsafe: Object.freeze({ rows: decodeRows }),
        },
      ] as const
    }),
  ) as unknown as PublicTableCache<Module>
