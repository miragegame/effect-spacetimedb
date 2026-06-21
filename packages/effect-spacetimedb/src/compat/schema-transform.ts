import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"
import * as ParseResult from "./parse-result.ts"

export const transformOrFail = <From extends Schema.Top, To extends Schema.Top>(
  from: From,
  to: To,
  options: {
    readonly strict?: boolean
    readonly decode: (
      value: From["Type"],
    ) => Effect.Effect<To["Encoded"], ParseResult.ParseIssue>
    readonly encode: (
      value: To["Encoded"],
    ) => Effect.Effect<From["Type"], ParseResult.ParseIssue>
  },
) =>
  from.pipe(
    Schema.decodeTo(to, {
      decode: SchemaGetter.transformOrFail((value: From["Type"]) =>
        options.decode(value),
      ),
      encode: SchemaGetter.transformOrFail((value: To["Encoded"]) =>
        options.encode(value),
      ),
    }),
  ) as unknown as Schema.Codec<To["Type"], From["Encoded"], never, never>
