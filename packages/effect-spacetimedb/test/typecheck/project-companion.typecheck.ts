import * as Stdb from "effect-spacetimedb"
import * as StdbServer from "effect-spacetimedb/server"
import type {
  PublicProcedureKeys,
  PublicReducerKeys,
} from "../../src/client/rpc.ts"
import { FullModule } from "../fixtures/full-module"

const Full = Stdb.project(FullModule)

// A typed client offers what a client calls, not what the host alone runs.
const callableReducer: PublicReducerKeys<typeof FullModule> = "userUpsert"
// @ts-expect-error a schedule's target is not offered to clients
const scheduledProcedure: PublicProcedureKeys<typeof FullModule> =
  "reminderFire"
void callableReducer
void scheduledProcedure
void Full.targets.tables.user
void Full.targets.allPublicTables()
void Full.client.ws.Session
void Full.client.http

// @ts-expect-error server projection helpers were removed from the clean-break API
void StdbServer.project
