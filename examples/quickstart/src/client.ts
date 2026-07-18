import * as Stdb from "effect-spacetimedb"
import type * as StdbClient from "effect-spacetimedb/client"
import { type MessageId, QuickstartModule } from "./contract.ts"

const Quickstart = Stdb.project(QuickstartModule.spec)

/** Typechecked client calls shown in the package quick start. */
const clientExample = (
  http: StdbClient.ProjectedHttpClient<typeof QuickstartModule.spec>,
  session: StdbClient.WsSession<typeof QuickstartModule.spec>,
  messageId: MessageId,
) => ({
  call: http.procedures.messageList({}),
  subscribe: session.subscribe(
    Quickstart.targets.tables.message.where((row) => row.id.eq(messageId)),
  ),
})

export type QuickstartClientExample = ReturnType<typeof clientExample>
