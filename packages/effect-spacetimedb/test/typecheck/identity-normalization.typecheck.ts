import type * as Result from "effect/Result"
import {
  identityEquals,
  type IdentityFormatError,
  type IdentityHex,
  normalizeIdentity,
} from "effect-spacetimedb"

const normalized: Result.Result<IdentityHex, IdentityFormatError> =
  normalizeIdentity(1n)
const equal: boolean = identityEquals(normalized, normalized)

void equal
