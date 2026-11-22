import type { CaseConversionPolicy as ServerCaseConversionPolicy } from "spacetimedb/server"
import type { AnyModuleSpec } from "../contract/module.ts"
import { asCompilerSchemaBridge } from "./compiler-interop.ts"
import {
  CaseConversionPolicy,
  makeQueryBuilder,
  schema,
  t,
} from "./host-abi-compiler.ts"
import { mountedQueries, type MountQueries } from "./mount-context.ts"
import type {
  Declaration as EnvironmentDeclaration,
  LiteralValues,
} from "../contract/environment.ts"

const toCaseConversionPolicy = (
  policy: AnyModuleSpec["settings"]["caseConversionPolicy"],
): ServerCaseConversionPolicy => {
  switch (policy) {
    case undefined:
    case "snake_case":
      return CaseConversionPolicy.SnakeCase
    case "none":
      return CaseConversionPolicy.None
  }
}

// The SATS unit payload every allowed literal value carries.
const environmentLiteralPayload = {
  tag: "Product",
  value: { elements: [] },
} as const

/**
 * The SDK reads an environment literal set from a payload-free sum's
 * `algebraicType` and only checks that a `variants` member exists. `t.enum`
 * builds the same type but also installs every allowed value as a property of
 * its builder, which breaks on values such as `create`, `optional` or
 * `__proto__`. This constraint carries the type and nothing else.
 */
const environmentLiteralConstraint = (values: LiteralValues) => ({
  algebraicType: {
    tag: "Sum",
    value: {
      variants: values.map((name) => ({
        name,
        algebraicType: environmentLiteralPayload,
      })),
    },
  },
  variants: {},
})

const toCompilerEnvironmentBuilder = (
  declaration: EnvironmentDeclaration,
): unknown => {
  // Secrets are plain strings to the host; redaction applies when module code
  // reads them.
  const inner =
    declaration.kind === "literal"
      ? environmentLiteralConstraint(declaration.values)
      : t.string()
  // `t.option` reads only the inner type's `algebraicType`.
  return declaration.optional ? t.option(inner as never) : inner
}

/** Declaration metadata only: no environment value is part of the artifact. */
const toCompilerEnvironment = (
  environment: AnyModuleSpec["environment"],
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(environment ?? {}).map(([key, declaration]) => [
      key,
      toCompilerEnvironmentBuilder(declaration),
    ]),
  )

export const makeCompilerSchema = (
  module: AnyModuleSpec,
  materializedTables: Readonly<Record<string, unknown>>,
  entries: Readonly<Record<string, unknown>>,
  children: Readonly<Record<string, MountQueries>>,
  prefix: string,
) => {
  const nativeSchema = schema(
    { ...materializedTables, ...entries } as Parameters<typeof schema>[0],
    {
      CASE_CONVERSION_POLICY: toCaseConversionPolicy(
        module.settings.caseConversionPolicy,
      ),
      // Compiler boundary: literal constraints are structural SDK types, not
      // builder instances (see `environmentLiteralConstraint`).
      env: toCompilerEnvironment(module.environment) as never,
    },
  )
  const compiledSchema = asCompilerSchemaBridge(nativeSchema)
  const queries: MountQueries = {
    children,
    from:
      prefix === ""
        ? undefined
        : (makeQueryBuilder({
            tables: Object.fromEntries(
              Object.entries(
                (
                  nativeSchema.schemaType as Parameters<
                    typeof makeQueryBuilder
                  >[0]
                ).tables,
              ).map(([key, table]) => [
                key,
                {
                  ...table,
                  sourceName: prefix + (module.wireNames.tables[key] ?? key),
                },
              ]),
            ),
          }) as unknown as MountQueries["from"]),
  }
  const viewContext = <
    C extends { readonly from: unknown; readonly db: unknown },
  >(
    ctx: C,
  ): C =>
    prefix === "" && Object.keys(children).length === 0
      ? ctx
      : {
          ...ctx,
          db: ctx.db,
          from: queries.from ?? ctx.from,
          [mountedQueries]: queries,
        }
  return { compiledSchema, queries, viewContext }
}
