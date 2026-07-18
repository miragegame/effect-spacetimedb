export type SatsTypeNameKind = "Struct" | "Enum" | "Sum"

export class SatsTypeNameCollisionError extends Error {
  constructor(
    readonly typeName: string,
    readonly existingFingerprint: string,
    readonly fingerprint: string,
  ) {
    super(
      `Generated SATS type name collision for ${typeName}; distinct structural fingerprints produced the same digest.`,
    )
  }
}

export type SatsTypeNameHasher = (fingerprint: string) => string

const textEncoder = new TextEncoder()
const Fnv64Prime = 0x100000001b3n
const Fnv64Mask = 0xffffffffffffffffn
const Fnv64OffsetA = 0xcbf29ce484222325n
const Fnv64OffsetB = 0x84222325cbf29ce4n
type FingerprintPart = string | ReadonlyArray<FingerprintPart>

const fnv1a64 = (input: string, offset: bigint): string => {
  let hash = offset
  for (const byte of textEncoder.encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * Fnv64Prime) & Fnv64Mask
  }

  return hash.toString(16).padStart(16, "0")
}

export const stableStructuralDigest: SatsTypeNameHasher = (fingerprint) =>
  `${fnv1a64(fingerprint, Fnv64OffsetA)}${fnv1a64(fingerprint, Fnv64OffsetB)}`

const decimalWord = (hex: string): string =>
  BigInt(`0x${hex}`).toString(10).padStart(20, "0")

export const decimalDigestSuffix = (digest: string): string => {
  if (!/^[0-9a-fA-F]{32}$/.test(digest)) {
    throw new Error(
      `Generated SATS type name digest must be 32 hexadecimal characters; received ${digest}`,
    )
  }

  return `${decimalWord(digest.slice(0, 16))}${decimalWord(digest.slice(16, 32))}`
}

export const makeContentAddressedNameFactory = (
  hash: SatsTypeNameHasher = stableStructuralDigest,
) => {
  const fingerprintsByName = new Map<string, string>()

  return (kind: SatsTypeNameKind, fingerprint: string): string => {
    const name = `EffectSpacetimeDb${kind}${decimalDigestSuffix(hash(fingerprint))}`
    const existing = fingerprintsByName.get(name)

    if (existing !== undefined && existing !== fingerprint) {
      throw new SatsTypeNameCollisionError(name, existing, fingerprint)
    }

    fingerprintsByName.set(name, fingerprint)
    return name
  }
}

export const contentAddressedName = makeContentAddressedNameFactory()

const encodeText = (value: string): string => `${value.length}:${value}`

const encodePart = (value: FingerprintPart): string =>
  typeof value === "string"
    ? `s${encodeText(value)}`
    : `a${value.length}[${value.map(encodePart).join("")}]`

export const structuralFingerprint = (
  tag: string,
  value?: FingerprintPart,
): string =>
  value === undefined
    ? `t${encodeText(tag)}`
    : `t${encodeText(tag)}${encodePart(value)}`

export const primitiveFingerprint = (kind: string): string =>
  structuralFingerprint("primitive", kind)

export const arrayFingerprint = (item: string): string =>
  structuralFingerprint("array", item)

export const optionFingerprint = (item: string): string =>
  structuralFingerprint("option", item)

export const recursiveFingerprint = (id: string): string =>
  structuralFingerprint("recursive", id)

export const productFingerprint = (
  fields: ReadonlyArray<readonly [string, string]>,
): string => structuralFingerprint("product", fields)

export const enumFingerprint = (
  variants: ReadonlyArray<readonly [string, string]>,
): string => structuralFingerprint("enum", variants)

export const sumFingerprint = (
  variants: ReadonlyArray<readonly [string, string]>,
): string => structuralFingerprint("sum", variants)
