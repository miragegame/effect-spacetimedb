export { packageRoot } from "./standalone-helpers.mjs"

export function assertPackageScratchDestination(destination: string): string
export function packPublishArchive(tempRoot: string): Promise<string>
export const sharedPackDirectoryVariable: "EFFECT_SPACETIMEDB_SHARED_PACK_DIR"
export function resolvePublishArchive(tempRoot: string): Promise<string>
