const defineHidden = <Key extends symbol, Value>(
  target: object,
  key: Key,
  value: Value,
) => {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: false,
    writable: false,
    value,
  })
}

export const ServerOwnerSymbol = Symbol("effect-spacetimedb/ServerOwner")

export const HandlerOwnerSymbol = Symbol("effect-spacetimedb/HandlerOwner")

export const HandlerBundleOwnerSymbol = Symbol(
  "effect-spacetimedb/HandlerBundleOwner",
)

export type ServerOwner = {
  readonly [ServerOwnerSymbol]: symbol
}

export type OwnedHandler = {
  readonly [HandlerOwnerSymbol]: symbol
}

export type OwnedHandlerBundle = {
  readonly [HandlerBundleOwnerSymbol]: symbol
}

export const withServerOwner = <Value extends object>(
  owner: symbol,
  value: Value,
): Value & ServerOwner => {
  defineHidden(value, ServerOwnerSymbol, owner)
  return value as Value & ServerOwner
}

export const withHandlerOwner = <Value extends object>(
  owner: symbol,
  value: Value,
): Value & OwnedHandler => {
  defineHidden(value, HandlerOwnerSymbol, owner)
  return value as Value & OwnedHandler
}

export const withHandlerBundleOwner = <Value extends object>(
  owner: symbol,
  value: Value,
): Value & OwnedHandlerBundle => {
  defineHidden(value, HandlerBundleOwnerSymbol, owner)
  return value as Value & OwnedHandlerBundle
}

export const assertOwnedHandler = (
  owner: symbol,
  handler: OwnedHandler,
  location: string,
) => {
  if (handler[HandlerOwnerSymbol] !== owner) {
    throw new Error(
      `${location} must be created by the same internal server instance that assembles it`,
    )
  }
}

export const assertOwnedHandlerBundle = (
  owner: symbol,
  bundle: OwnedHandlerBundle,
) => {
  if (bundle[HandlerBundleOwnerSymbol] !== owner) {
    throw new Error(
      "Server handlers must be assembled by the same internal server instance as the compiled module",
    )
  }
}
