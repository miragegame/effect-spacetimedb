const fallbackGuidance =
  "Use a supported Stdb.* value constructor or Stdb.custom(schema, { type }) to make SpaceTimeDB lowering explicit."

export const unsupportedTypeMessage = (
  path: ReadonlyArray<string | number>,
): string =>
  `Unsupported SpaceTimeDB type at ${path.join(".")}. ${fallbackGuidance}`
