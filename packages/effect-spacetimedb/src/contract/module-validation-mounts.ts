import { camelCaseName, isCamelCaseCanonical } from "./canonical-name.ts"
import { Diagnostic } from "./diagnostic.ts"
import type { AnyModuleSpec } from "./module.ts"
import { mountDepthMax, mountLabel } from "./mount.ts"
import { pushDiagnostic } from "./module-validation-common.ts"
import { groupClientKeysReserved } from "./module-validation-http-handlers.ts"
import { isReceiverSpec } from "./remote-interface.ts"

import { SatsTypeIdentifierPattern } from "./sats-identifier-validation.ts"

const namespaceLengthMax = 63
const valid = (name: string) =>
  name.length <= namespaceLengthMax &&
  SatsTypeIdentifierPattern.test(name) &&
  !["st", "spacetimedb", "public"].includes(name) &&
  !name.startsWith("pg_")

export const validateMountTree = (
  root: AnyModuleSpec,
  validateLocal: (spec: AnyModuleSpec) => ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> => {
  const diagnostics = [...validateLocal(root)]
  const ancestors = new Set<AnyModuleSpec>([root])
  const visit = (
    parent: AnyModuleSpec,
    path: readonly string[],
    depth: number,
  ): void => {
    const wireNames = new Set<string>()
    const children = new Set<AnyModuleSpec>()
    for (const [key, mount] of Object.entries(parent.mounts ?? {})) {
      const here = [...path, "mounts", key]
      const label = mountLabel(
        key,
        mount.kind === "moduleMount" ? mount.module.name : undefined,
      )
      if (
        mount.namespace !== key ||
        !valid(key) ||
        !isCamelCaseCanonical(key) ||
        !valid(mount.wireNamespace)
      ) {
        pushDiagnostic(
          diagnostics,
          "InvalidMountNamespace",
          here,
          `${label} has an invalid namespace (wire name "${mount.wireNamespace}"). Use a matching camelCase accessor and a valid SQL identifier of at most ${namespaceLengthMax} bytes. Avoid st, spacetimedb, public and the pg_ prefix for both names.`,
        )
      }
      if (wireNames.has(mount.wireNamespace)) {
        pushDiagnostic(
          diagnostics,
          "DuplicateMountNamespace",
          here,
          `${label} repeats the canonical namespace "${mount.wireNamespace}". Choose a unique namespace or pin a different name.`,
        )
      }
      wireNames.add(mount.wireNamespace)
      if (
        [
          parent.tables,
          parent.views,
          parent.reducers,
          parent.procedures,
          parent.httpHandlers,
          parent.lifecycle,
        ].some((section) =>
          Object.keys(section).some((name) => camelCaseName(name) === key),
        ) ||
        groupClientKeysReserved.includes(key)
      ) {
        pushDiagnostic(
          diagnostics,
          "MountNamespaceCollision",
          here,
          `${label} collides with a local member or JavaScript prototype property. Choose an unused mount accessor.`,
        )
      }
      if (depth > mountDepthMax) {
        pushDiagnostic(
          diagnostics,
          "MountDepthExceeded",
          here,
          `${label} exceeds this package's limit of ${mountDepthMax} mount levels. The host accepts deeper mounts. Move this mount closer to the root to keep inferred types within the supported depth.`,
        )
        continue
      }
      if (mount.kind === "nativeMount") continue
      const child = mount.module
      if (ancestors.has(child)) {
        pushDiagnostic(
          diagnostics,
          "MountCycle",
          here,
          `${label} would mount an ancestor inside itself. Remove the circular declaration.`,
        )
        continue
      }
      if (children.has(child))
        pushDiagnostic(
          diagnostics,
          "DuplicateMountedModule",
          here,
          `${label} repeats a child of "${parent.name}". The host accepts multiple aliases, but this package requires one compiled instance per mount and one mount per child in a parent. Reuse the existing accessor.`,
        )
      children.add(child)
      if (Object.keys(child.environment ?? {}).length > 0)
        pushDiagnostic(
          diagnostics,
          "MountedEnvironment",
          here,
          `${label} declares environment variables. Declare them on the root module and pass any required values into the library.`,
        )
      if (Object.keys(child.lifecycle).length > 0)
        pushDiagnostic(
          diagnostics,
          "MountedLifecycle",
          here,
          `${label} declares lifecycle hooks. Declare the hooks on the root module and run the library logic through mounts.${key}.run.`,
        )
      if (
        (child.httpGroupNames?.length ?? 0) > 0 ||
        Object.keys(child.httpHandlers).length > 0 ||
        Object.keys(child.httpGroups).length > 0
      )
        pushDiagnostic(
          diagnostics,
          "MountedHttpHandler",
          here,
          `${label} declares HTTP handlers. A mounted module's routes are never served. Declare the route on the root module and run the library logic through mounts.${key}.run.`,
        )
      if (Object.values(child.reducers).some(isReceiverSpec))
        pushDiagnostic(
          diagnostics,
          "MountedReceiver",
          here,
          `${label} declares an IDC receiver. Declare the receiver on the root module so codegen can emit its binding.`,
        )
      for (const entry of validateLocal(child))
        diagnostics.push(
          new Diagnostic({
            ...entry,
            path: [...here, ...entry.path],
            message: `${label}: ${entry.message}`,
          }),
        )
      ancestors.add(child)
      visit(child, here, depth + 1)
      ancestors.delete(child)
    }
  }
  visit(root, [], 1)
  return diagnostics
}
