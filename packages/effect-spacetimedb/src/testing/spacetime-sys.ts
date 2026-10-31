let nextConsoleSpanId = 1

export type UnavailableMathRandomScope = {
  readonly release: () => void
}

const hostOnly = (name: string) => {
  throw new Error(
    `spacetime:sys host syscall ${name} is only available inside SpaceTimeDB`,
  )
}

const restoreMathRandomDescriptor = (
  descriptor: PropertyDescriptor | undefined,
) => {
  if (descriptor !== undefined) {
    Object.defineProperty(Math, "random", descriptor)
    return
  }

  Reflect.deleteProperty(Math, "random")
}

export const acquireUnavailableMathRandom = (): UnavailableMathRandomScope => {
  const original = Object.getOwnPropertyDescriptor(Math, "random")

  Reflect.deleteProperty(Math, "random")
  Object.defineProperty(Math, "random", {
    configurable: true,
    enumerable: false,
    get: () => {
      throw new TypeError("Math.random is not available")
    },
  })

  let released = false
  return {
    release: () => {
      if (released) {
        return
      }
      released = true
      restoreMathRandomDescriptor(original)
    },
  }
}

export const withUnavailableMathRandom = <A>(body: () => A): A => {
  const scope = acquireUnavailableMathRandom()
  try {
    return body()
  } finally {
    scope.release()
  }
}

export const withUnavailableMathRandomAsync = async <A>(
  body: () => Promise<A>,
): Promise<A> => {
  const scope = acquireUnavailableMathRandom()
  try {
    return await body()
  } finally {
    scope.release()
  }
}

/**
 * What backs the stub's `env_get`: a host-semantics reader such as a module
 * test harness's `environment` (declared key → value or `null`, undeclared key
 * → throws).
 */
export type EnvironmentSource = {
  readonly get: (key: string) => string | null
}

export type EnvironmentScope = {
  readonly release: () => void
}

// A global slot, not module state: a packed `testing` entrypoint and the
// source stub that `spacetimeSysAlias` resolves to can be distinct module
// instances, and both must see the same active environment.
const environmentSlot = Symbol.for(
  "effect-spacetimedb/testing/spacetime-sys/environment",
)

// Each acquisition is its own entry, so nesting the same source twice and
// releasing the inner scope leaves the outer one active.
type EnvironmentEntry = {
  readonly source: EnvironmentSource
}

const activeEnvironmentEntries = (): ReadonlyArray<EnvironmentEntry> => {
  const entries: unknown = Reflect.get(globalThis, environmentSlot)
  return Array.isArray(entries) ? entries : []
}

/**
 * Backs `env_get` with `source` until the returned scope is released. Scopes
 * nest; the most recently acquired one answers. Without an active scope
 * `env_get` refuses like every other host call.
 */
export const acquireEnvironment = (
  source: EnvironmentSource,
): EnvironmentScope => {
  const entry: EnvironmentEntry = { source }
  Reflect.set(globalThis, environmentSlot, [
    ...activeEnvironmentEntries(),
    entry,
  ])

  let released = false
  return {
    release: () => {
      if (released) {
        return
      }
      released = true
      const remaining = activeEnvironmentEntries().filter(
        (active) => active !== entry,
      )
      if (remaining.length === 0) {
        Reflect.deleteProperty(globalThis, environmentSlot)
        return
      }
      Reflect.set(globalThis, environmentSlot, remaining)
    },
  }
}

/**
 * Backs `env_get` with `source` while `body` runs. The scope ends when `body`
 * returns, so use it for synchronous bodies (an async body would lose the scope
 * at its first `await`); `withEnvironmentAsync` covers async bodies.
 */
export const withEnvironment = <A>(
  source: EnvironmentSource,
  body: () => A,
): A => {
  const scope = acquireEnvironment(source)
  try {
    return body()
  } finally {
    scope.release()
  }
}

/**
 * Backs `env_get` with `source` until the promise `body` returns settles. The
 * scope is process-global, so do not overlap it with another test's scope.
 */
export const withEnvironmentAsync = async <A>(
  source: EnvironmentSource,
  body: () => Promise<A>,
): Promise<A> => {
  const scope = acquireEnvironment(source)
  try {
    return await body()
  } finally {
    scope.release()
  }
}

export const moduleHooks = Symbol.for("spacetime:sys/moduleHooks")

export const register_hooks = () => hostOnly("register_hooks")
export const table_id_from_name = () => hostOnly("table_id_from_name")
export const index_id_from_name = () => hostOnly("index_id_from_name")
export const datastore_table_row_count = () =>
  hostOnly("datastore_table_row_count")
export const datastore_table_scan_bsatn = () =>
  hostOnly("datastore_table_scan_bsatn")
export const datastore_index_scan_range_bsatn = () =>
  hostOnly("datastore_index_scan_range_bsatn")
export const row_iter_bsatn_advance = () => hostOnly("row_iter_bsatn_advance")
export const row_iter_bsatn_close = (_iter?: unknown) => undefined
export const datastore_insert_bsatn = () => hostOnly("datastore_insert_bsatn")
export const datastore_update_bsatn = () => hostOnly("datastore_update_bsatn")
export const datastore_delete_by_index_scan_range_bsatn = () =>
  hostOnly("datastore_delete_by_index_scan_range_bsatn")
export const datastore_delete_all_by_eq_bsatn = () =>
  hostOnly("datastore_delete_all_by_eq_bsatn")
export const volatile_nonatomic_schedule_immediate = () =>
  hostOnly("volatile_nonatomic_schedule_immediate")
export const console_log = (level: number, message: string) => {
  switch (level) {
    case 0:
      globalThis.console.error(message)
      return
    case 1:
      globalThis.console.warn(message)
      return
    case 2:
      globalThis.console.info(message)
      return
    case 3:
      globalThis.console.debug(message)
      return
    case 4:
      globalThis.console.trace(message)
      return
    default:
      globalThis.console.log(message)
  }
}
export const console_timer_start = (_name: string) => nextConsoleSpanId++
export const console_timer_end = (_spanId: number) => undefined
export const identity = () => hostOnly("identity")
export const get_jwt_payload = () => hostOnly("get_jwt_payload")
export const procedure_http_request = () => hostOnly("procedure_http_request")
export const procedure_start_mut_tx = () => hostOnly("procedure_start_mut_tx")
export const procedure_commit_mut_tx = () => hostOnly("procedure_commit_mut_tx")
export const procedure_abort_mut_tx = () => hostOnly("procedure_abort_mut_tx")
export const datastore_index_scan_point_bsatn = () =>
  hostOnly("datastore_index_scan_point_bsatn")
export const datastore_delete_by_index_scan_point_bsatn = () =>
  hostOnly("datastore_delete_by_index_scan_point_bsatn")
export const datastore_clear = () => hostOnly("datastore_clear")
export const env_get = (key: string): string | null => {
  const entry = activeEnvironmentEntries().at(-1)
  return entry === undefined ? hostOnly("env_get") : entry.source.get(key)
}
