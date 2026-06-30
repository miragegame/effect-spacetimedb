import * as Stdb from "effect-spacetimedb"

export const ExampleLifecycle = {
  init: Stdb.StdbFn.init().spec,
  clientConnected: Stdb.StdbFn.clientConnected().spec,
  clientDisconnected: Stdb.StdbFn.clientDisconnected().spec,
}
