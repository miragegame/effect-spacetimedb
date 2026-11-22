import * as Stdb from "effect-spacetimedb"

export const ExampleLifecycle = {
  init: Stdb.Fn.init(),
  clientConnected: Stdb.Fn.clientConnected(),
  clientDisconnected: Stdb.Fn.clientDisconnected(),
}
