export const TestHarnessTransaction = Symbol.for(
  "effect-spacetimedb/testing/TestHarnessTransaction",
)

export const runInTestHarnessTransaction = <A>(
  context: unknown,
  body: () => A,
): A => {
  if (typeof context !== "object" || context === null) return body()
  const transaction = Reflect.get(context, TestHarnessTransaction)
  return typeof transaction === "function" ? transaction(body) : body()
}
