import type { StdbDiagnostic } from "./diagnostic.ts"
import { stringLiteralSatsVariantTag } from "./literal-tags.ts"
import type { AnyModuleSpec } from "./module.ts"
import { pushDiagnostic } from "./module-validation-common.ts"
import { outboxResultMetadataOf } from "./outbox-table.ts"
import {
  isReceiverSpec,
  receiverReservedParamNames,
} from "./remote-interface.ts"
import * as TypeDescriptor from "./type/descriptor.ts"
import { type AnyValueType, structFields, structFieldWireType } from "./type.ts"

/**
 * A receiver's signature hash covers its canonical parameter, field and variant
 * names, and a module's case policy decides those canonical names. A single
 * lowercase word is its own canonical name under every policy, so a sender's
 * binding matches the receiver whatever policy either side compiles with.
 */
const policyInvariantName = /^[a-z][a-z0-9]*$/

const checkName = (
  diagnostics: Array<StdbDiagnostic>,
  receiverKey: string,
  name: string,
  kind: "parameter" | "field" | "variant",
  path: ReadonlyArray<string | number>,
): void => {
  if (policyInvariantName.test(name)) {
    return
  }
  pushDiagnostic(
    diagnostics,
    "ReceiverNameNotPolicyInvariant",
    path,
    `Receiver ${receiverKey} ${kind} name ${name} must be one lowercase word (${policyInvariantName.source}) so its signature does not depend on a case policy.`,
  )
}

const visitTypeNames = (
  diagnostics: Array<StdbDiagnostic>,
  receiverKey: string,
  type: AnyValueType,
  path: ReadonlyArray<string | number>,
  visited: WeakSet<object>,
): void => {
  if (visited.has(type)) {
    return
  }
  visited.add(type)

  const descriptor = TypeDescriptor.describe(type)
  if (descriptor === undefined) {
    return
  }

  const visit = (
    child: AnyValueType,
    childPath: ReadonlyArray<string | number>,
  ) => visitTypeNames(diagnostics, receiverKey, child, childPath, visited)

  switch (descriptor.kind) {
    case "struct":
      for (const [name, field] of Object.entries(descriptor.fields)) {
        checkName(diagnostics, receiverKey, name, "field", [...path, name])
        visit(structFieldWireType(field), [...path, name])
      }
      return
    case "sum":
      for (const [name, variant] of Object.entries(descriptor.variants)) {
        checkName(diagnostics, receiverKey, name, "variant", [...path, name])
        visit(variant, [...path, name])
      }
      return
    case "literal":
      // String literals lower to an enum whose variant names are their SATS
      // tags; boolean and numeric literals lower to plain primitives.
      for (const value of descriptor.values) {
        if (typeof value === "string") {
          checkName(
            diagnostics,
            receiverKey,
            stringLiteralSatsVariantTag(value),
            "variant",
            [...path, value],
          )
        }
      }
      return
    case "array":
    case "option":
      visit(descriptor.item, path)
      return
    case "result":
      for (const member of descriptor.members) {
        visit(member, path)
      }
      return
    case "lazy":
      visit(descriptor.lazy(), path)
      return
    case "custom":
      if (descriptor.item !== undefined) {
        visit(descriptor.item, path)
      }
      return
    default:
      // Primitives carry no names.
      return
  }
}

/**
 * Rules for `StdbFn.receiver(...)` reducers: always public (the host delivers
 * only to client-callable reducers), never a schedule target or a settle
 * reducer, no parameter named like outbox metadata, and every name reachable
 * from the parameters policy-invariant.
 */
export const validateReceivers = (
  diagnostics: Array<StdbDiagnostic>,
  module: AnyModuleSpec,
): void => {
  for (const [key, reducer] of Object.entries(module.reducers)) {
    if (!isReceiverSpec(reducer)) {
      continue
    }

    const path = ["reducers", key]
    if (reducer.public !== true) {
      pushDiagnostic(
        diagnostics,
        "InvalidReceiver",
        [...path, "public"],
        `Receiver ${key} must be public: the host delivers inter-database calls only to client-callable reducers.`,
      )
    }
    if ((reducer as { readonly scheduled?: unknown }).scheduled !== undefined) {
      pushDiagnostic(
        diagnostics,
        "InvalidReceiver",
        [...path, "scheduled"],
        `Receiver ${key} cannot also be a scheduled target.`,
      )
    }
    if (outboxResultMetadataOf(reducer) !== undefined) {
      pushDiagnostic(
        diagnostics,
        "InvalidReceiver",
        [...path, "outboxResult"],
        `Receiver ${key} cannot also be a settle reducer.`,
      )
    }

    const visited = new WeakSet<object>()
    for (const [name, field] of Object.entries(
      structFields(reducer.params) ?? {},
    )) {
      const paramPath = [...path, "params", name]
      if (receiverReservedParamNames.has(name)) {
        pushDiagnostic(
          diagnostics,
          "ReceiverParamReserved",
          paramPath,
          `Receiver ${key} parameter ${name} would collide with the outbox column of the same name; rename it.`,
        )
      } else {
        checkName(diagnostics, key, name, "parameter", paramPath)
      }
      visitTypeNames(
        diagnostics,
        key,
        structFieldWireType(field),
        paramPath,
        visited,
      )
    }
  }
}
