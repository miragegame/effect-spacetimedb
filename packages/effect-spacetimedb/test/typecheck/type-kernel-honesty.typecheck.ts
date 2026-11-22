import * as Schema from "effect/Schema"
import * as StdbInternal from "effect-spacetimedb/testing/internal"
import { typeBuilder } from "../helpers/type-builder"

const UserId = StdbInternal.ContractType.string(
  Schema.String.pipe(Schema.brand("TypeKernelHonesty/UserId")),
)
type UserId = typeof UserId.Type

const PositiveCount = StdbInternal.ContractType.u32(
  Schema.Finite.pipe(
    Schema.brand("TypeKernelHonesty/PositiveCount"),
    Schema.check(Schema.isGreaterThan(0)),
  ),
)
type PositiveCount = typeof PositiveCount.Type

void StdbInternal.ContractType.string()
void StdbInternal.ContractType.u32()

const userIdValueType = UserId
const positiveCountValueType = PositiveCount

type _UserId = StdbInternal.ContractType.TypeOf<typeof userIdValueType>
type _PositiveCount = StdbInternal.ContractType.TypeOf<
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
void StdbInternal.ContractType.struct({
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
void StdbInternal.ContractType.string<UserId>()

// @ts-expect-error refined numeric narrowing now requires an explicit Schema
void StdbInternal.ContractType.u32<PositiveCount>()
