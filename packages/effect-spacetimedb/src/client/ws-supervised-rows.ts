import type { Identity } from "spacetimedb"
import { identityEquals } from "../identity.ts"
import type {
  RevokingInvalidation,
  RowLineage,
  WsConnectionState,
} from "./connection-state.ts"

/**
 * All a supervisor keeps of the sessions it has replaced: whose they were, and
 * the lineage that reaches every row they read. A session stays out of it, so
 * replacing sessions for weeks keeps none of them alive, and a parked supervisor
 * holds no cache of an identity it dropped.
 */
export const makeSupervisedRows = () => {
  let owner:
    | { readonly identity: Identity; readonly lineage: RowLineage }
    | undefined

  return {
    /** Whether rows from before this identity are someone else's. */
    belongToAnother: (identity: Identity): boolean =>
      owner !== undefined && !identityEquals(owner.identity, identity),
    /** Whether the latest session's rows are revoked, whoever revoked them. */
    isRevoked: (): boolean => owner?.lineage.revocation() !== undefined,
    /** Takes the rows of every session back to the last revocation. */
    revoke: (invalidation: RevokingInvalidation): void => {
      owner?.lineage.revoke(invalidation)
    },
    /**
     * Records a connection as the latest, which inherits what came before only
     * under the same identity.
     */
    adopt: (identity: Identity, connectionState: WsConnectionState): void => {
      if (owner !== undefined && identityEquals(owner.identity, identity)) {
        connectionState.joinRowLineage(owner.lineage)
      }
      owner = { identity, lineage: connectionState.rowLineage() }
    },
  }
}
