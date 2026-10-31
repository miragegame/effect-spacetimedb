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
    // Effect selects setImmediate/setTimeout once when Scheduler is evaluated.
    // The synchronous module host has neither a task queue nor delayed timers,
    // so these fallbacks synchronously drain Effect's scheduler. User timer
    // calls therefore differ from dev-guarded mode, where they throw; this is
    // intentional and documented in the determinism section of the README.
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

  const ensureTextDecoderIgnoreBom = () => {
    // SpacetimeDB's module host implements TextDecoder without the WHATWG
    // `ignoreBOM` option and throws when it is passed. Effect 4.1 constructs
    // `new TextDecoder("utf-8", { ignoreBOM: true })` while its HTTP and
    // encoding modules load, so without this a module whose import graph
    // reaches them fails before it registers anything. The host decodes bytes
    // straight to a string and never strips a BOM, which is what the option
    // asks for, so it only has to stop reaching the host's constructor. Hosts
    // that accept the option keep their own decoder.
    const Native = globalThis.TextDecoder
    if (typeof Native !== "function") {
      return
    }
    try {
      new Native("utf-8", { ignoreBOM: true })
      return
    } catch {
      // The host rejects the option.
    }

    class TextDecoderAcceptingIgnoreBom extends Native {
      readonly #ignoreBOM: boolean

      constructor(label?: string, options?: TextDecoderOptions) {
        super(label, { fatal: options?.fatal === true })
        this.#ignoreBOM = options?.ignoreBOM === true
      }

      override get ignoreBOM(): boolean {
        return this.#ignoreBOM
      }
    }

    Object.defineProperty(globalThis, "TextDecoder", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: TextDecoderAcceptingIgnoreBom,
    })
  }

  ensureMathRandom()
  ensureSchedulerTimers()
  ensureTextDecoderIgnoreBom()
}

export const ensureServerPolyfills = installServerPolyfills
