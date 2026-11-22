import {
  wsGeneratedConnection,
  type GeneratedConnectionOf,
} from "effect-spacetimedb/client"
import { App } from "./contract.ts"
import { DbConnection as Generated } from "./generated-client/index.js"

export const DbConnection: GeneratedConnectionOf<typeof App.spec> =
  wsGeneratedConnection(App.spec, Generated)
