const installServerPolyfills = () => {
  const ensureMathRandom = () => {
    const isThrowingUnavailableRandom = (value: unknown): boolean => {
      if (typeof value !== "function") {
        return false
      }

      try {
        const source = Function.prototype.toString.call(value)

        return (
          source.includes("throw") &&
          source.includes("Math.random") &&
          source.includes("not available")
        )
      } catch {
        return false
      }
    }

    const descriptor = Object.getOwnPropertyDescriptor(Math, "random")
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      typeof descriptor.value === "function" &&
      !isThrowingUnavailableRandom(descriptor.value)
    ) {
      return
    }

    let seed = 0x5eed_cafe

    const mulberry32 = (): number => {
      seed |= 0
      seed = (seed + 0x6d2b_79f5) | 0
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }

    Object.defineProperty(Math, "random", {
      value: mulberry32,
      writable: true,
      configurable: true,
      enumerable: false,
    })
  }

  const ensureSchedulerTimers = () => {
    const globals = globalThis as typeof globalThis & {
      clearImmediate?: (id: unknown) => void
      setImmediate?: (handler: (...args: ReadonlyArray<unknown>) => void) => 0
    }

    if (typeof globalThis.setTimeout !== "function") {
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (
          handler: (...args: ReadonlyArray<unknown>) => void,
          _timeout?: number,
          ...args: ReadonlyArray<unknown>
        ) => {
          handler(...args)
          return 0
        },
      })
    }

    if (typeof globalThis.clearTimeout !== "function") {
      Object.defineProperty(globalThis, "clearTimeout", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => undefined,
      })
    }

    if (typeof globals.setImmediate !== "function") {
      Object.defineProperty(globalThis, "setImmediate", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: (handler: (...args: ReadonlyArray<unknown>) => void) => {
          handler()
          return 0
        },
      })
    }

    if (typeof globals.clearImmediate !== "function") {
      Object.defineProperty(globalThis, "clearImmediate", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: () => undefined,
      })
    }
  }

  ensureMathRandom()
  ensureSchedulerTimers()
}

export const ensureServerPolyfills = installServerPolyfills
