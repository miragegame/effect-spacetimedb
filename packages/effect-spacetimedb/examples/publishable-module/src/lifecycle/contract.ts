import * as Stdb from "effect-spacetimedb"

export const ExampleLifecycle = {
  init: Stdb.StdbFn.init(),
  clientConnected: Stdb.StdbFn.clientConnected(),
  clientDisconnected: Stdb.StdbFn.clientDisconnected(),
}
