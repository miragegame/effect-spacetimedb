import * as StdbInternal from "effect-spacetimedb/testing/internal"

export const encodeJson = (value: unknown): string =>
  StdbInternal.ClientHttpJson.encodeHttpInput(value)
