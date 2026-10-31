/**
 * The off-host `spacetime:sys` stub, except that `procedure_http_request`
 * answers: it records the header entries of every outbound request exactly as
 * the SDK serialized them for the host, then answers `200` with no headers and
 * an empty body.
 *
 * Reading the BSATN by hand keeps the assertion at the host boundary: what is
 * recorded is what the host would decode, not what the SDK meant to send.
 */
export * from "../../../src/testing/spacetime-sys"

export type RecordedHttpHeader = {
  readonly name: string
  readonly value: string
}

/** `HttpMethod.Extension`, the only method variant that carries a payload. */
const httpMethodExtensionTag = 9

/**
 * BSATN `HttpResponse { headers: { entries: [] }, version: Http11, code: 200 }`:
 * a `u32` entry count, the `HttpVersion` tag, then the code as a `u16`.
 */
const okResponse = new Uint8Array([0, 0, 0, 0, 2, 200, 0])

const textDecoder = new TextDecoder()

const recordedRequests: Array<ReadonlyArray<RecordedHttpHeader>> = []

/** `HttpRequest` opens with its method, then `headers: { entries: [...] }`. */
const headerEntriesOf = (
  request: Uint8Array,
): ReadonlyArray<RecordedHttpHeader> => {
  const view = new DataView(
    request.buffer,
    request.byteOffset,
    request.byteLength,
  )
  let offset = 0
  const readU32 = (): number => {
    const value = view.getUint32(offset, true)
    offset += 4
    return value
  }
  const readBytes = (): Uint8Array => {
    const length = readU32()
    const bytes = request.subarray(offset, offset + length)
    offset += length
    return bytes
  }

  const methodTag = view.getUint8(offset)
  offset += 1
  if (methodTag === httpMethodExtensionTag) readBytes()

  const entryCount = readU32()
  const entries: Array<RecordedHttpHeader> = []
  for (let index = 0; index < entryCount; index += 1) {
    const name = textDecoder.decode(readBytes())
    const value = textDecoder.decode(readBytes())
    entries.push({ name, value })
  }
  return entries
}

export const procedure_http_request = (
  request: Uint8Array,
  _body: Uint8Array | string,
): [response: Uint8Array, body: Uint8Array] => {
  recordedRequests.push(headerEntriesOf(request))
  return [okResponse, new Uint8Array()]
}

/** Every request recorded since the last take, oldest first. */
export const takeRecordedRequests = (): ReadonlyArray<
  ReadonlyArray<RecordedHttpHeader>
> => recordedRequests.splice(0, recordedRequests.length)
