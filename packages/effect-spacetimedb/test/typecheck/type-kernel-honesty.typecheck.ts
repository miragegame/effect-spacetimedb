import * as Schema from "effect/Schema"
import * as StdbTesting from "effect-spacetimedb/testing"
import { typeBuilder } from "../helpers/type-builder"

const UserId = StdbTesting.ContractType.string(
  Schema.String.pipe(Schema.brand("TypeKernelHonesty/UserId")),
)
type UserId = typeof UserId.Type

const PositiveCount = StdbTesting.ContractType.u32(
  Schema.Finite.pipe(
    Schema.brand("TypeKernelHonesty/PositiveCount"),
    Schema.check(Schema.isGreaterThan(0)),
  ),
)
type PositiveCount = typeof PositiveCount.Type

void StdbTesting.ContractType.string()
void StdbTesting.ContractType.u32()

const userIdValueType = UserId
const positiveCountValueType = PositiveCount

type _UserId = StdbTesting.ContractType.TypeOf<typeof userIdValueType>
type _PositiveCount = StdbTesting.ContractType.TypeOf<
  typeof positiveCountValueType
>

declare const userId: _UserId
declare const positiveCount: _PositiveCount

const _userId: UserId = userId
const _positiveCount: PositiveCount = positiveCount

void Schema.decodeUnknownEffect(userIdValueType.schema)
void Schema.encodeEffect(userIdValueType.schema)
void Schema.Struct({
  id: userIdValueType.schema,
})
void StdbTesting.ContractType.struct({
  id: userIdValueType,
})
void typeBuilder(userIdValueType)

// @ts-expect-error stamped metadata is not part of opaque value-types
void userIdValueType.stdbType

// @ts-expect-error value-types are not Effect schemas
void userIdValueType.pipe

void _userId
void _positiveCount

// @ts-expect-error branded string narrowing now requires an explicit Schema
void StdbTesting.ContractType.string<UserId>()

// @ts-expect-error refined numeric narrowing now requires an explicit Schema
void StdbTesting.ContractType.u32<PositiveCount>()
