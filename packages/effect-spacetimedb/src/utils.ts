/**
 * Prefix Effect tag and service ids with the package name.
 */
export const prefixId = <S extends string>(name: S) =>
  `effect-spacetimedb/${name}` as const

export const typedEntries = <RecordType extends Record<string, unknown>>(
  value: RecordType,
) =>
  Object.entries(value) as ReadonlyArray<
    {
      readonly [Key in keyof RecordType & string]: readonly [
        Key,
        RecordType[Key],
      ]
    }[keyof RecordType & string]
  >

export const typedFromEntries = <
  const Entries extends ReadonlyArray<readonly [PropertyKey, unknown]>,
>(
  entries: Entries,
) =>
  Object.fromEntries(entries) as {
    readonly [Entry in Entries[number] as Entry[0] & PropertyKey]: Entry[1]
  }
