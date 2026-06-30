import type * as Brand from "effect/Brand"
import * as Schema from "effect/Schema"
import * as Stdb from "effect-spacetimedb"
import type { Assert, IsEqual } from "./helpers"

const UserId = Stdb.string(
  Schema.String.pipe(Schema.brand("SchemaNative/UserId")),
)
type UserId = typeof UserId.Type
type _UserIdBrand = Assert<
  IsEqual<UserId, string & Brand.Brand<"SchemaNative/UserId">>
>

const decodeUserId = Schema.decodeUnknownSync(UserId.schema)
void decodeUserId

const UserName = Stdb.string(
  Schema.String.pipe(
    Schema.brand("SchemaNative/UserName"),
    Schema.check(Schema.isMaxLength(100)),
  ),
)
type _UserNameRemainsBrandOnly = Assert<
  IsEqual<typeof UserName.Type, string & Brand.Brand<"SchemaNative/UserName">>
>

const Count = Stdb.u64(
  Schema.BigInt.check(Schema.isGreaterThanOrEqualToBigInt(0n)),
)
type _CountIsBigInt = Assert<IsEqual<typeof Count.Type, bigint>>

const BrandedCount = Stdb.u64(
  Schema.BigInt.pipe(Schema.brand("SchemaNative/Count")),
)
type _BrandedCount = Assert<
  IsEqual<typeof BrandedCount.Type, bigint & Brand.Brand<"SchemaNative/Count">>
>

const schemaNativeUser = Stdb.table("schema_native_user", {
  columns: {
    id: UserId,
    name: UserName,
    count: Count,
  },
})

const MatrixFunctions = Stdb.StdbGroup.make("SchemaNative")
  .add(
    Stdb.StdbFn.reducer("upsert_user", {
      params: Stdb.struct({
        id: UserId,
        name: UserName,
      }),
    }),
  )
  .add(
    Stdb.StdbFn.procedure("get_user", {
      params: Stdb.struct({
        id: UserId,
      }),
      returns: Stdb.option(schemaNativeUser.row),
    }),
  )
  .add(
    Stdb.StdbFn.view("self_user", {
      returns: Stdb.option(schemaNativeUser.row),
    }),
  )
void MatrixFunctions

void Schema.decodeUnknownSync(UserName.schema)("Ada")

// @ts-expect-error value-types are opaque objects, not Effect schemas
void UserId.pipe(Schema.check(Schema.isMaxLength(100)))
// @ts-expect-error value-types expose refinements only through .schema
void UserId.check(Schema.isMaxLength(100))
// @ts-expect-error value-types do not carry brand helpers
void UserId.brand("PostBrand")

// @ts-expect-error brand-name scalar shorthand was removed
void Stdb.string("x")
// @ts-expect-error checks varargs were removed; refine the passed schema instead
void Stdb.string(Schema.String, Schema.isMaxLength(100))

// @ts-expect-error string constructor requires string-encoded schemas
void Stdb.string(Schema.Finite)
// @ts-expect-error bool constructor requires boolean-encoded schemas
void Stdb.bool(Schema.String)
// @ts-expect-error bytes constructor requires Uint8Array-encoded schemas
void Stdb.bytes(Schema.String)

// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.u8(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.u16(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.u32(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.i8(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.i16(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.i32(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.f32(Schema.BigInt)
// @ts-expect-error number SATS constructors reject bigint-encoded schemas
void Stdb.f64(Schema.BigInt)

// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.u64(Schema.Finite)
// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.u128(Schema.Finite)
// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.u256(Schema.Finite)
// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.i64(Schema.Finite)
// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.i128(Schema.Finite)
// @ts-expect-error bigint SATS constructors reject number-encoded schemas
void Stdb.i256(Schema.Finite)
// @ts-expect-error bigint constructor rejects number-encoded schemas
void Stdb.bigint(Schema.Finite)

// @ts-expect-error raw Schema.String is not an opaque SATS value-type
void Stdb.struct({ raw: Schema.String })

// @ts-expect-error valueType.schema is raw schema and cannot be used in SATS positions
void Stdb.struct({ raw: UserId.schema })

void Stdb.table("bad_raw_column", {
  columns: {
    // @ts-expect-error raw table columns must be Stdb value-types
    raw: Schema.String,
  },
})

void Stdb.table("bad_schema_column", {
  columns: {
    // @ts-expect-error valueType.schema is raw schema and cannot be used as a column
    raw: UserId.schema,
  },
})

void Stdb.StdbFn.reducer("bad_reducer", {
  params: Stdb.struct({
    // @ts-expect-error raw reducer params must be Stdb value-types
    raw: Schema.String,
  }),
})

void Stdb.StdbFn.procedure("bad_procedure_return", {
  params: Stdb.struct({}),
  // @ts-expect-error raw procedure returns must be Stdb value-types
  returns: Schema.String,
})

void Stdb.StdbFn.view("bad_view_return", {
  // @ts-expect-error raw view returns must be Stdb value-types
  returns: Schema.String,
})

const RawErrorUserId = Schema.String.pipe(Schema.brand("SchemaNative/ErrorId"))

void Stdb.StdbHttp.post("raw_http", "/raw-http", {
  request: Schema.Struct({ userId: UserId.schema }),
  response: Schema.Struct({ ok: Schema.Boolean }),
})

void Stdb.errors.namespace("SchemaNative")({
  Missing: Stdb.error({
    // @ts-expect-error raw declared-error fields must be Stdb value-types
    userId: RawErrorUserId,
  }),
})

const LiteralX = Stdb.string(Schema.Literal("x"))
type _LiteralOverload = Assert<IsEqual<typeof LiteralX.Type, "x">>

void schemaNativeUser
void BrandedCount
