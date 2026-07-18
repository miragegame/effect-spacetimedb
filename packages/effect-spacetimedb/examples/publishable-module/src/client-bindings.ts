import {
  generatedConnection,
  type GeneratedConnectionOf,
} from "effect-spacetimedb/client"
import { DbConnection as GeneratedDbConnection } from "../generated-client/index.js"
import { ExampleModule } from "./module-spec"

export const DbConnection: GeneratedConnectionOf<typeof ExampleModule> =
  generatedConnection(ExampleModule, GeneratedDbConnection)
