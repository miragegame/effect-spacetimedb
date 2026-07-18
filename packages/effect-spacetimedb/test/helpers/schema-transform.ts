import * as Schema from "effect/Schema"
import * as SchemaGetter from "effect/SchemaGetter"

export const transform = <From extends Schema.Top, To extends Schema.Top>(
  from: From,
  to: To,
  options: {
    readonly decode: (value: From["Type"]) => To["Encoded"]
    readonly encode: (value: To["Encoded"]) => From["Type"]
  },
) =>
  from.pipe(
    Schema.decodeTo(to, {
      decode: SchemaGetter.transform(options.decode),
      encode: SchemaGetter.transform(options.encode),
    }),
  )
