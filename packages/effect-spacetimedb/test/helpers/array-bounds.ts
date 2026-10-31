import type * as Stdb from "effect-spacetimedb"

/**
 * Bounds for test arrays whose length is not the subject under test. Every
 * fixture value and property-generated array in this suite stays in single
 * digits, so 64 leaves headroom while remaining a real statement.
 */
export const testArrayLength: Stdb.ArrayLengthBounds = {
  minimum: 0,
  maximum: 64,
}

/**
 * Bounds for view result sets in test modules. Views return every matching
 * row, and the live and integration suites insert at most a few dozen.
 */
export const testViewRowsLength: Stdb.ArrayLengthBounds = {
  minimum: 0,
  maximum: 1_000,
}
