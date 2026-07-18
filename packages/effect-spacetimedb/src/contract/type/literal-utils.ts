import { makeStdbDiagnostic, StdbValidationError } from "../diagnostic.ts"
import type {
  BuilderFactories,
  PrimitiveLiteral,
  StringLiteralTuple,
} from "./core.ts"

export const isStringLiteralTuple = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): values is StringLiteralTuple =>
  values.every((value) => typeof value === "string")

export const NumericLiteralPrecisionMessage =
  "numeric literals lower to f64; non-finite values and unsafe integers cannot be represented safely - use a string literal or a bigint-backed column."

export const assertNumericLiteralPrecision = (
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
): void => {
  for (const value of values) {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        (Number.isInteger(value) && Math.abs(value) > Number.MAX_SAFE_INTEGER))
    ) {
      throw new StdbValidationError({
        diagnostics: [
          makeStdbDiagnostic(
            "NumericLiteralPrecision",
            ["literal"],
            NumericLiteralPrecisionMessage,
          ),
        ],
      })
    }
  }
}

export const resolveLiteralBuilder = (
  factories: BuilderFactories,
  values: readonly [PrimitiveLiteral, ...PrimitiveLiteral[]],
):
  | ReturnType<BuilderFactories["string"]>
  | ReturnType<BuilderFactories["bool"]>
  | ReturnType<BuilderFactories["f64"]> => {
  // Keep this guard at the builder boundary as a fallback for literal metadata
  // reconstructed from annotated schemas instead of the public constructor.
  assertNumericLiteralPrecision(values)
  const first = values[0]
  const expectedType = typeof first

  if (values.some((value) => typeof value !== expectedType)) {
    throw new Error("Type.literal(...) must use a single primitive kind")
  }

  if (typeof first === "string") {
    return factories.string()
  }

  if (typeof first === "boolean") {
    return factories.bool()
  }

  return factories.f64()
}
