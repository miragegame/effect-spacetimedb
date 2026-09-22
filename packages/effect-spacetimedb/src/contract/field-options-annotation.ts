import * as Data from "effect/Data"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import * as AST from "effect/SchemaAST"
import { ownAnnotation } from "./schema-annotations.ts"

/**
 * Field options ride on the Effect Schema AST under a key minted with
 * `Symbol.for`, which is *global*: two copies of `effect-spacetimedb` installed
 * side by side in one dependency graph (a direct dependency plus a transitive
 * one, a workspace link plus a registry install) resolve the same symbol and so
 * read each other's payloads. Published 0.6.0 wrote `defaultValue` where this
 * version writes `valueDefault`
 * (`effect-spacetimedb@0.6.0` `src/contract/type/core.ts:840`, versus
 * `src/contract/type/core.ts:841` here), so a cross-copy read used to *silently*
 * drop a column default rather than fail.
 *
 * Two things together close that hole, and neither is sufficient alone:
 *
 * 1. A **new key** (`…/StdbFieldOptions/versioned`). Changing the key alone only
 *    makes an incompatible payload invisible — an unannotated field and a field
 *    annotated by a foreign copy would be indistinguishable, which is the silent
 *    drop again under a different name. So the legacy key is still *read* (never
 *    written) purely as a detector: a value carrying it, and not ours, is a
 *    field authored by `effect-spacetimedb` 0.6.x or earlier and fails loudly.
 * 2. A **payload `version` member**, decoded through a schema. The key is now
 *    stable forever: a future release that changes the payload again bumps
 *    `version` under this same key, so *this* copy will see an unknown version
 *    and fail explicitly instead of partially reading it. Versioning the key
 *    name instead would put us right back at "a newer copy's annotation looks
 *    like no annotation at all".
 *
 * The boundary is whole-value: {@link findFieldOptionsAnnotationNode} walks the
 * encoded shape once and the *nearest* annotated node decides the version, so a
 * legacy annotation can never be shadowed by a current one deeper in the chain
 * (or the reverse) and read as a partial merge of the two.
 *
 * What we cannot fix: published 0.6.0 reads only the legacy key, so it sees a
 * field authored here as carrying no options at all. That direction is covered
 * by `scripts/mixed-version-smoke.mjs` and the release notes, not by code.
 */
export const StdbFieldOptionsAnnotationId = Symbol.for(
  "effect-spacetimedb/StdbFieldOptions/versioned",
)

/**
 * The unversioned key written by published `effect-spacetimedb` 0.6.x and
 * earlier. Read-only: this package never writes it again, and any value
 * carrying it is reported as an incompatible copy.
 */
export const StdbFieldOptionsLegacyAnnotationId = Symbol.for(
  "effect-spacetimedb/StdbFieldOptions",
)

/** Payload version written under {@link StdbFieldOptionsAnnotationId}. */
export const StdbFieldOptionsAnnotationVersion = 2 as const

export const IndexAlgorithmSchema = Schema.Literals(["btree", "hash", "direct"])

const FieldOptionsAnnotationSchema = Schema.Struct({
  version: Schema.Literal(StdbFieldOptionsAnnotationVersion),
  primaryKey: Schema.Boolean,
  autoInc: Schema.Boolean,
  unique: Schema.Boolean,
  index: Schema.UndefinedOr(IndexAlgorithmSchema),
  optional: Schema.Boolean,
  hasDefault: Schema.Boolean,
  valueDefault: Schema.Unknown,
  name: Schema.UndefinedOr(Schema.String),
})

export type FieldOptionsAnnotation = typeof FieldOptionsAnnotationSchema.Type

const decodeFieldOptionsAnnotation = Schema.decodeUnknownOption(
  FieldOptionsAnnotationSchema,
)

const decodeAnnotationVersion = Schema.decodeUnknownOption(
  Schema.Struct({ version: Schema.Finite }),
)

/**
 * Where an unreadable field-options annotation came from. Both arms carry only
 * data that exists in that case: a legacy payload has no version to report, and
 * an incompatible payload reports whatever version it claimed, if any.
 */
export type FieldOptionsAnnotationOrigin = Data.TaggedEnum<{
  LegacyPayload: {}
  IncompatiblePayload: {
    readonly version: number | undefined
  }
}>

export const FieldOptionsAnnotationOrigin =
  Data.taggedEnum<FieldOptionsAnnotationOrigin>()

/**
 * A field was annotated by a different copy of `effect-spacetimedb` than the one
 * reading it. The failed premise is supplied by the consumer's dependency graph,
 * not by this package's own code, so this is a typed authoring error in the same
 * family as `StdbTypeNotNameableError` rather than a defect.
 */
export class StdbFieldOptionsVersionError extends Data.TaggedError(
  "StdbFieldOptionsVersionError",
)<{
  readonly origin: FieldOptionsAnnotationOrigin
}> {
  override get message(): string {
    const found = FieldOptionsAnnotationOrigin.$match(this.origin, {
      LegacyPayload: () =>
        "annotation payload version 1 (effect-spacetimedb 0.6.x or earlier, which wrote an unversioned payload)",
      IncompatiblePayload: ({ version }) =>
        `annotation payload version ${version ?? "unknown"}`,
    })
    return `This field's SpaceTimeDB options were written by a different copy of effect-spacetimedb: found ${found}, but this copy reads annotation payload version ${StdbFieldOptionsAnnotationVersion}. Field options are stored under a global symbol, so two installed versions of effect-spacetimedb read each other's fields; deduplicate effect-spacetimedb to one version.`
  }
}

type FieldOptionsAnnotationNode =
  | { readonly key: "current"; readonly value: unknown }
  | { readonly key: "legacy"; readonly value: unknown }

/**
 * Walks the encoded shape once and returns the nearest node carrying *either*
 * field-options key, so the key that node used decides the payload version for
 * the whole value.
 */
const findFieldOptionsAnnotationNode = (
  ast: AST.AST,
): FieldOptionsAnnotationNode | undefined => {
  const current = ownAnnotation<unknown>(StdbFieldOptionsAnnotationId, ast)
  if (current !== undefined) {
    return { key: "current", value: current }
  }

  const legacy = ownAnnotation<unknown>(StdbFieldOptionsLegacyAnnotationId, ast)
  if (legacy !== undefined) {
    return { key: "legacy", value: legacy }
  }

  if (AST.isSuspend(ast)) {
    return findFieldOptionsAnnotationNode(ast.thunk())
  }

  for (const link of ast.encoding ?? []) {
    const found = findFieldOptionsAnnotationNode(link.to)
    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

/**
 * Reads the field-options annotation of a value type, or `undefined` when the
 * value carries none. Throws {@link StdbFieldOptionsVersionError} when the value
 * was annotated by an incompatible copy of this package; options are never
 * silently dropped.
 */
export const readFieldOptionsAnnotation = (
  ast: AST.AST,
): FieldOptionsAnnotation | undefined => {
  const found = findFieldOptionsAnnotationNode(ast)
  if (found === undefined) {
    return undefined
  }

  if (found.key === "legacy") {
    throw new StdbFieldOptionsVersionError({
      origin: FieldOptionsAnnotationOrigin.LegacyPayload(),
    })
  }

  const decoded = decodeFieldOptionsAnnotation(found.value)
  if (Option.isSome(decoded)) {
    return decoded.value
  }

  throw new StdbFieldOptionsVersionError({
    origin: FieldOptionsAnnotationOrigin.IncompatiblePayload({
      version: Option.getOrUndefined(
        Option.map(decodeAnnotationVersion(found.value), (it) => it.version),
      ),
    }),
  })
}
