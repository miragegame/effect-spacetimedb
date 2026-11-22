import * as Stdb from "effect-spacetimedb"

export const MembershipView = Stdb.struct({
  tenantId: Stdb.string(),
  email: Stdb.string(),
  note: Stdb.string(),
}).named("MembershipView")

export const MembershipFunctions = Stdb.Group.make("Memberships")
  .add(
    Stdb.Fn.reducer("membershipUpsert", {
      params: Stdb.struct({
        tenantId: Stdb.string(),
        email: Stdb.string(),
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.reducer("membershipInsertStrict", {
      params: Stdb.struct({
        tenantId: Stdb.string(),
        email: Stdb.string(),
        note: Stdb.string(),
      }),
    }),
  )
  .add(
    Stdb.Fn.procedure("membershipGet", {
      params: Stdb.struct({
        tenantId: Stdb.string(),
        email: Stdb.string(),
      }),
      returns: Stdb.option(MembershipView),
    }),
  )
  .add(
    Stdb.Fn.procedure("membershipByTenantEmailRange", {
      params: Stdb.struct({
        tenantId: Stdb.string(),
        emailLo: Stdb.string(),
        emailHi: Stdb.string(),
      }),
      returns: Stdb.array(MembershipView),
    }),
  )
