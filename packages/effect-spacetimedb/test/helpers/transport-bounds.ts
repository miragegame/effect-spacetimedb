import * as Duration from "effect/Duration"

/**
 * The call bound for fixture HTTP clients. Their transports answer at once
 * (mock clients) or from a local server within milliseconds, and TestClock
 * suites only move time on purpose, so no test reaches 30 seconds by
 * accident. A test that exercises the bound itself sets its own.
 */
export const fixtureCallDurationMax = Duration.seconds(30)

/**
 * The connect bound for fixture WebSocket connections. Fixture builders
 * connect synchronously or on an explicit callback, and live suites connect to
 * an already published local server in well under a second; like
 * `fixtureCallDurationMax`, it only needs to stay out of reach of tests that
 * do not exercise the timeout, which set their own.
 */
export const fixtureConnectTimeoutMillis = 30_000
