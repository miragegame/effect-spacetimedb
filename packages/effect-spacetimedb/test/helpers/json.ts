import * as StdbTesting from "effect-spacetimedb/testing"

export const encodeJson = (value: unknown): string =>
  StdbTesting.ClientHttpJson.encodeHttpInput(value)
