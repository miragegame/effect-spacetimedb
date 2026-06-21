import {
  typeBuilderWithFactories as typeBuilderWithFactoriesFromType,
  type AnyValueType,
} from "../type.ts"

type TypeBuilderFactories = Parameters<
  typeof typeBuilderWithFactoriesFromType
>[1]

export const typeBuilderWithFactories = (
  value: AnyValueType,
  factories: TypeBuilderFactories,
  path?: string,
): ReturnType<typeof typeBuilderWithFactoriesFromType> =>
  typeBuilderWithFactoriesFromType(value, factories, path)
