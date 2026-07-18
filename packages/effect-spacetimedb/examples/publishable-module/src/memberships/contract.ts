import * as Stdb from "effect-spacetimedb"
import { String255 } from "../schema"

export const MembershipView = Stdb.struct({
  tenantId: String255,
  email: String255,
  note: String255,
}).named("MembershipView")

export const MembershipFunctions = Stdb.StdbGroup.make("Memberships")
  .add(
    Stdb.StdbFn.reducer("membershipUpsert", {
      params: Stdb.struct({
        tenantId: String255,
        email: String255,
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.reducer("membershipInsertStrict", {
      params: Stdb.struct({
        tenantId: String255,
        email: String255,
        note: String255,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("membershipGet", {
      params: Stdb.struct({
        tenantId: String255,
        email: String255,
      }),
      returns: Stdb.option(MembershipView),
    }),
  )
