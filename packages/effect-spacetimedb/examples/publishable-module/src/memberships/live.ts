import * as Effect from "effect/Effect"
import * as Stdb from "effect-spacetimedb"
import { Range } from "spacetimedb/server"
import { Db, ExampleModule, Tx } from "../module"

export const MembershipFunctionsLive = Stdb.StdbBuilder.group(
  ExampleModule,
  "Memberships",
  {
    membershipUpsert: Effect.fn(function* ({ tenantId, email, note }) {
      const db = yield* Db
      yield* db.uniqueMembership.uniqueMembershipEmailTenantIdx.delete({
        email,
        tenantId: tenantId,
      })
      yield* db.uniqueMembership.insert({
        tenantId: tenantId,
        email,
        note,
      })
    }),
    membershipInsertStrict: Effect.fn(function* ({ tenantId, email, note }) {
      const db = yield* Db
      yield* db.uniqueMembership.insert({
        tenantId,
        email,
        note,
      })
    }),
    membershipGet: Effect.fn(function* ({ tenantId, email }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const row =
            yield* db.uniqueMembership.uniqueMembershipEmailTenantIdx.find({
              email,
              tenantId: tenantId,
            })

          return row != null
            ? {
                tenantId,
                email: row.email,
                note: row.note,
              }
            : undefined
        }),
      )
    }),
    membershipByTenantEmailRange: Effect.fn(function* ({
      tenantId,
      emailLo,
      emailHi,
    }) {
      const tx = yield* Tx
      return yield* tx.run(
        Effect.gen(function* () {
          const db = yield* Db
          const rows =
            yield* db.uniqueMembership.uniqueMembershipTenantEmailNoteIdx.filterToArray(
              {
                tenantId,
                email: new Range(
                  { tag: "excluded", value: emailLo },
                  { tag: "excluded", value: emailHi },
                ),
              },
            )
          return rows.map((row) => ({
            tenantId: row.tenantId,
            email: row.email,
            note: row.note,
          }))
        }),
      )
    }),
  },
)
