import * as AST from "effect/SchemaAST"

import { typedFromEntries } from "../../utils.ts"
import { validateSatsTypeIdentifier } from "../sats-identifier-validation.ts"
import {
  annotationInEncodedShape,
  encodedAst,
  StdbTypeAnnotationId,
} from "../schema-annotations.ts"
import {
  arrayRestAst,
  literalValuesFromAst,
  literalValueTuple,
  optionMemberAst,
} from "./ast-helpers.ts"
import type {
  AnyTypeBuilder,
  AnyValueType,
  BuilderFactories,
  StdbTypeFactory,
} from "./core.ts"
import {
  astFingerprint,
  contentAddressedSatsTypeBuilder,
  makeFingerprintState,
  typeBuilderCacheFor,
} from "./fingerprint.ts"
import { resolveLiteralBuilder } from "./literal-utils.ts"
import { typeInfo } from "./metadata.ts"

export class UnsupportedStdbTypeError extends Error {
  constructor(
    readonly ast: AST.AST,
    readonly path: string | undefined,
    detail?: string,
  ) {
    super(
      detail ??
        `unsupported Effect Schema AST ${ast._tag}. Use a supported Stdb.* value constructor, Stdb.string(BrandSchema) for branded strings, Stdb.literal(...) for literal unions, Stdb.option(...) for optional values, or Stdb.custom(schema, { type }) for schemas that need explicit SATS lowering`,
    )
  }
}

export class StdbTypeLoweringError extends Error {}

export const appendPath = (
  path: string | undefined,
  segment: string,
): string => (path != null && path !== "" ? `${path}.${segment}` : segment)

export const arrayItemPath = (path: string | undefined): string | undefined =>
  path != null && path !== "" ? `${path}[]` : undefined

export const unsupportedStdbType = (
  ast: AST.AST,
  path: string | undefined,
  detail?: string,
): never => {
  throw new UnsupportedStdbTypeError(ast, path, detail)
}

export const cachedTypeBuilder = (
  cache: WeakMap<object, AnyTypeBuilder>,
  ast: AST.AST,
  builder: AnyTypeBuilder,
) => {
  cache.set(ast as object, builder)
  return builder
}

export const unresolvedRecursiveBuilder = (): never => {
  throw new Error(
    "Recursive SpacetimeDB type builder was accessed before resolution",
  )
}

export const makeDeferredRecursiveBuilder = (): {
  readonly builder: AnyTypeBuilder
  readonly resolve: (value: AnyTypeBuilder) => void
} => {
  let resolved: AnyTypeBuilder | undefined
  const deferredAlgebraicType = {
    get tag() {
      return resolved?.algebraicType.tag ?? unresolvedRecursiveBuilder()
    },
    get value() {
      return (
        (resolved?.algebraicType as { readonly value?: unknown } | undefined)
          ?.value ?? unresolvedRecursiveBuilder()
      )
    },
  } as unknown as AnyTypeBuilder["algebraicType"]

  return {
    builder: {
      get algebraicType() {
        return deferredAlgebraicType
      },
    } as AnyTypeBuilder,
    resolve: (value) => {
      resolved = value
    },
  }
}

export const cachedRecursiveTypeBuilder = (
  cache: WeakMap<object, AnyTypeBuilder>,
  ast: AST.AST,
  evaluate: () => AnyTypeBuilder,
): AnyTypeBuilder => {
  const deferred = makeDeferredRecursiveBuilder()
  cache.set(ast as object, deferred.builder)

  try {
    const builder = evaluate()
    deferred.resolve(builder)
    cache.set(ast as object, builder)
    return builder
  } catch (error) {
    cache.delete(ast as object)
    throw error
  }
}

export const typeBuilderFromAst = (
  ast: AST.AST,
  factories: BuilderFactories,
  path: string | undefined,
): AnyTypeBuilder => {
  const cache = typeBuilderCacheFor(factories)
  const cached = cache.get(ast as object)
  if (cached != null) {
    return cached
  }

  const normalized = encodedAst(ast)
  if (normalized !== ast) {
    return cachedRecursiveTypeBuilder(cache, ast, () =>
      typeBuilderFromAst(normalized, factories, path),
    )
  }

  const annotated = annotationInEncodedShape<StdbTypeFactory<AnyTypeBuilder>>(
    StdbTypeAnnotationId,
    ast,
  )
  if (annotated != null) {
    return cachedTypeBuilder(cache, ast, annotated(factories, path))
  }

  if (AST.isSuspend(ast)) {
    return cachedTypeBuilder(
      cache,
      ast,
      factories.lazy(() => typeBuilderFromAst(ast.thunk(), factories, path)),
    )
  }

  if (AST.isVoid(ast)) {
    return cachedTypeBuilder(cache, ast, factories.unit())
  }

  if (AST.isLiteral(ast)) {
    const values = literalValueTuple([ast.literal])
    if (values == null) {
      return unsupportedStdbType(ast, path)
    }

    return cachedTypeBuilder(
      cache,
      ast,
      resolveLiteralBuilder(factories, values),
    )
  }

  if (AST.isUnion(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const optionValue = optionMemberAst(ast)
      if (optionValue != null) {
        return factories.option(
          typeBuilderFromAst(optionValue, factories, path),
        )
      }

      const values = literalValuesFromAst(ast)
      if (values != null) {
        return resolveLiteralBuilder(factories, values)
      }

      return unsupportedStdbType(ast, path)
    })
  }

  if (AST.isArrays(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const rest = arrayRestAst(ast)
      if (rest != null) {
        return factories.array(
          typeBuilderFromAst(rest, factories, arrayItemPath(path)),
        )
      }

      return unsupportedStdbType(ast, path)
    })
  }

  if (AST.isObjects(ast)) {
    return cachedRecursiveTypeBuilder(cache, ast, () => {
      const identifier = annotationInEncodedShape<string>("identifier", ast)
      if (identifier !== undefined) {
        validateSatsTypeIdentifier(identifier)
      }

      const fields = typedFromEntries(
        ast.propertySignatures.map((property) => {
          if (typeof property.name !== "string") {
            return unsupportedStdbType(
              property.type,
              path,
              "SpacetimeDB struct lowering requires string property names",
            )
          }

          return [
            property.name,
            typeBuilderFromAst(
              property.type,
              factories,
              appendPath(path, property.name),
            ),
          ] as const
        }),
      ) as never
      const fingerprint = astFingerprint(ast, makeFingerprintState())

      return contentAddressedSatsTypeBuilder(
        factories,
        "Struct",
        fingerprint,
        (name) => factories.object(name, fields),
        identifier,
      )
    })
  }

  return unsupportedStdbType(ast, path)
}

export const typeBuilderWithFactories = (
  value: AnyValueType,
  factories: BuilderFactories,
  path?: string,
): AnyTypeBuilder => {
  try {
    const info = typeInfo(value)
    if (info != null) {
      const cache = typeBuilderCacheFor(factories)
      const cached = cache.get(value.schema.ast as object)
      if (cached != null) {
        return cached
      }

      return cachedRecursiveTypeBuilder(cache, value.schema.ast, () =>
        info.sats(factories, path, value),
      )
    }

    return typeBuilderFromAst(value.schema.ast, factories, path)
  } catch (cause) {
    if (cause instanceof StdbTypeLoweringError) {
      throw cause
    }

    const failurePath =
      cause instanceof UnsupportedStdbTypeError ? (cause.path ?? path) : path
    const message =
      cause instanceof Error && cause.message.length > 0
        ? cause.message
        : String(cause)
    throw new StdbTypeLoweringError(
      `SpaceTimeDB type lowering failed${failurePath != null && failurePath !== "" ? ` at ${failurePath}` : ""}: ${message}.`,
      {
        cause,
      },
    )
  }
}
