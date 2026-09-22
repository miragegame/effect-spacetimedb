
/**
 * A minimal in-memory stand-in for the SpaceTimeDB host datastore, faithful to
 * the parts of the `spacetime:sys@2.0` ABI that index scans depend on. It lets
 * a native-package test run the real `spacetimedb/server` runtime end to end
 * (insert, `find`, `filter`, `delete`) and observe which rows a scan returns,
 * rather than only which syscall the runtime picked.
 *
 * ABI semantics reproduced here, matching
 * `crates/core/src/host/v8/syscall/v2.rs`:
 * - an index scan buffer is `[prefix][rstart][rend]`, where `prefix_len` is the
 *   byte offset of `rstart`, each bound is a `u8` tag (0 included, 1 excluded,
 *   2 unbounded) followed by the BSATN value, and `rend = rstart` when
 *   `rend_len === 0`;
 * - a point scan matches rows whose index-key bytes equal the point exactly;
 * - `row_iter_bsatn_advance` returns a negated byte count on its final batch.
 *
 * Fixture obligations, because rows are compared as raw BSATN bytes:
 * - an index's columns must be a contiguous run of row columns beginning at
 *   `keyOffset` bytes into the row, so an index key is a row byte slice;
 * - a ranged index's final column must be one of the declared `TermKind`s, so
 *   ordering can be recovered from the encoded bytes.
 *
 * Constraints (uniqueness, auto-increment, schedules) are not enforced.
 */

export type TermKind = "u64"

export type IndexLayout = {
  /** Accessor name of the table the index belongs to. */
  readonly table: string
  /** Byte offset of the index's first column inside a row. Defaults to 0. */
  readonly keyOffset?: number
  /** How the index's final column is decoded when a scan supplies bounds. */
  readonly termKind?: TermKind
}

type ResolvedIndexLayout = {
  readonly table: string
  readonly keyOffset: number
  readonly termKind: TermKind
}

type RangeBound =
  | { readonly tag: "included"; readonly value: bigint }
  | { readonly tag: "excluded"; readonly value: bigint }
  | { readonly tag: "unbounded" }

const tableRows = new Map<string, Array<Uint8Array>>()
const tableIdsByName = new Map<string, number>()
const tableNamesById = new Map<number, string>()
const indexIdsByName = new Map<string, number>()
const indexLayoutsById = new Map<number, ResolvedIndexLayout>()
const iterators = new Map<number, Array<Uint8Array>>()

let configuredIndexes: Readonly<Record<string, IndexLayout>> = {}
let nextTableId = 1
let nextIndexId = 1
let nextIteratorId = 1

export const configure = (layout: {
  readonly indexes: Readonly<Record<string, IndexLayout>>
}): void => {
  configuredIndexes = layout.indexes
}

export const reset = (): void => {
  tableRows.clear()
  tableIdsByName.clear()
  tableNamesById.clear()
  indexIdsByName.clear()
  indexLayoutsById.clear()
  iterators.clear()
  nextTableId = 1
  nextIndexId = 1
  nextIteratorId = 1
}

const rowsOfTable = (tableName: string): Array<Uint8Array> => {
  const existing = tableRows.get(tableName)
  if (existing !== undefined) {
    return existing
  }
  const created: Array<Uint8Array> = []
  tableRows.set(tableName, created)
  return created
}

const rowsOfTableId = (tableId: number): Array<Uint8Array> => {
  const tableName = tableNamesById.get(tableId)
  if (tableName === undefined) {
    throw new Error(`Unknown table id ${String(tableId)}`)
  }
  return rowsOfTable(tableName)
}

const layoutOfIndexId = (indexId: number): ResolvedIndexLayout => {
  const layout = indexLayoutsById.get(indexId)
  if (layout === undefined) {
    throw new Error(`Unknown index id ${String(indexId)}`)
  }
  return layout
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((byte, at) => byte === right[at])

const readTerm = (
  bytes: Uint8Array,
  offset: number,
  termKind: TermKind,
): bigint => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  switch (termKind) {
    case "u64":
      return view.getBigUint64(offset, true)
  }
}

const readBound = (bytes: Uint8Array, termKind: TermKind): RangeBound => {
  const tag = bytes[0]
  switch (tag) {
    case 0:
      return { tag: "included", value: readTerm(bytes, 1, termKind) }
    case 1:
      return { tag: "excluded", value: readTerm(bytes, 1, termKind) }
    case 2:
      return { tag: "unbounded" }
    default:
      throw new Error(`Unknown range bound tag ${String(tag)}`)
  }
}

const withinBounds = (
  value: bigint,
  from: RangeBound,
  to: RangeBound,
): boolean => {
  const aboveStart =
    from.tag === "unbounded"
      ? true
      : from.tag === "included"
        ? value >= from.value
        : value > from.value
  const belowEnd =
    to.tag === "unbounded"
      ? true
      : to.tag === "included"
        ? value <= to.value
        : value < to.value
  return aboveStart && belowEnd
}

const bufferBytes = (buf: ArrayBuffer, length: number): Uint8Array =>
  new Uint8Array(buf, 0, length)

const pointMatches = (
  layout: ResolvedIndexLayout,
  point: Uint8Array,
): ((row: Uint8Array) => boolean) => {
  const start = layout.keyOffset
  const end = start + point.length
  return (row) =>
    row.length >= end && bytesEqual(row.subarray(start, end), point)
}

const rangeMatches = (
  layout: ResolvedIndexLayout,
  scan: Uint8Array,
  prefixLen: number,
  rstartLen: number,
  rendLen: number,
): ((row: Uint8Array) => boolean) => {
  const prefix = scan.subarray(0, prefixLen)
  const rstart = scan.subarray(prefixLen, prefixLen + rstartLen)
  // The host reuses `rstart` as the end bound when `rend_len` is zero, which is
  // how the runtime encodes an equality term on the final key column.
  const rend =
    rendLen === 0
      ? rstart
      : scan.subarray(prefixLen + rstartLen, prefixLen + rstartLen + rendLen)
  const from = readBound(rstart, layout.termKind)
  const to = readBound(rend, layout.termKind)
  const prefixStart = layout.keyOffset
  const prefixEnd = prefixStart + prefixLen
  const termOffset = prefixEnd

  return (row) => {
    if (!bytesEqual(row.subarray(prefixStart, prefixEnd), prefix)) {
      return false
    }
    if (from.tag === "unbounded" && to.tag === "unbounded") {
      return true
    }
    return withinBounds(readTerm(row, termOffset, layout.termKind), from, to)
  }
}

const openIterator = (rows: ReadonlyArray<Uint8Array>): number => {
  const id = nextIteratorId++
  iterators.set(id, [...rows])
  return id
}

const removeMatching = (
  rows: Array<Uint8Array>,
  matches: (row: Uint8Array) => boolean,
): number => {
  const kept = rows.filter((row) => !matches(row))
  const removed = rows.length - kept.length
  rows.length = 0
  rows.push(...kept)
  return removed
}

export const moduleHooks = Symbol.for("spacetime:sys/moduleHooks")

export const register_hooks = (): void => undefined

export const table_id_from_name = (name: string): number => {
  const existing = tableIdsByName.get(name)
  if (existing !== undefined) {
    return existing
  }
  const id = nextTableId++
  tableIdsByName.set(name, id)
  tableNamesById.set(id, name)
  rowsOfTable(name)
  return id
}

export const index_id_from_name = (name: string): number => {
  const existing = indexIdsByName.get(name)
  if (existing !== undefined) {
    return existing
  }
  const configured = configuredIndexes[name]
  if (configured === undefined) {
    throw new Error(
      `Index ${name} has no configured layout; known layouts: ${Object.keys(
        configuredIndexes,
      ).join(", ")}`,
    )
  }
  const id = nextIndexId++
  indexIdsByName.set(name, id)
  indexLayoutsById.set(id, {
    table: configured.table,
    keyOffset: configured.keyOffset ?? 0,
    termKind: configured.termKind ?? "u64",
  })
  rowsOfTable(configured.table)
  return id
}

export const datastore_insert_bsatn = (
  tableId: number,
  row: ArrayBuffer,
  rowLen: number,
): number => {
  rowsOfTableId(tableId).push(new Uint8Array(bufferBytes(row, rowLen)))
  return 0
}

export const datastore_update_bsatn = (): number => {
  throw new Error("datastore_update_bsatn is not modelled by this fixture host")
}

export const datastore_table_row_count = (tableId: number): bigint =>
  BigInt(rowsOfTableId(tableId).length)

export const datastore_table_scan_bsatn = (tableId: number): number =>
  openIterator(rowsOfTableId(tableId))

export const datastore_index_scan_point_bsatn = (
  indexId: number,
  point: ArrayBuffer,
  pointLen: number,
): number => {
  const layout = layoutOfIndexId(indexId)
  const matches = pointMatches(layout, bufferBytes(point, pointLen))
  return openIterator(rowsOfTable(layout.table).filter(matches))
}

export const datastore_index_scan_range_bsatn = (
  indexId: number,
  buf: ArrayBuffer,
  prefixLen: number,
  _prefixElems: number,
  rstartLen: number,
  rendLen: number,
): number => {
  const layout = layoutOfIndexId(indexId)
  const matches = rangeMatches(
    layout,
    bufferBytes(buf, prefixLen + rstartLen + rendLen),
    prefixLen,
    rstartLen,
    rendLen,
  )
  return openIterator(rowsOfTable(layout.table).filter(matches))
}

export const datastore_delete_by_index_scan_point_bsatn = (
  indexId: number,
  point: ArrayBuffer,
  pointLen: number,
): number => {
  const layout = layoutOfIndexId(indexId)
  return removeMatching(
    rowsOfTable(layout.table),
    pointMatches(layout, bufferBytes(point, pointLen)),
  )
}

export const datastore_delete_by_index_scan_range_bsatn = (
  indexId: number,
  buf: ArrayBuffer,
  prefixLen: number,
  _prefixElems: number,
  rstartLen: number,
  rendLen: number,
): number => {
  const layout = layoutOfIndexId(indexId)
  return removeMatching(
    rowsOfTable(layout.table),
    rangeMatches(
      layout,
      bufferBytes(buf, prefixLen + rstartLen + rendLen),
      prefixLen,
      rstartLen,
      rendLen,
    ),
  )
}

export const datastore_delete_all_by_eq_bsatn = (
  tableId: number,
  relation: ArrayBuffer,
  relationLen: number,
): number => {
  // The relation buffer is a `u32` row count followed by the encoded rows.
  const encoded = bufferBytes(relation, relationLen).subarray(4)
  return removeMatching(rowsOfTableId(tableId), (row) =>
    bytesEqual(row, encoded),
  )
}

export const datastore_clear = (tableId: number): bigint => {
  const rows = rowsOfTableId(tableId)
  const cleared = BigInt(rows.length)
  rows.length = 0
  return cleared
}

export const row_iter_bsatn_advance = (
  iter: number,
  buffer: ArrayBuffer,
): number => {
  const pending = iterators.get(iter)
  if (pending === undefined) {
    return 0
  }

  const total = pending.reduce((sum, row) => sum + row.length, 0)
  if (total > buffer.byteLength) {
    throw { __buffer_too_small__: total }
  }

  const target = new Uint8Array(buffer)
  let offset = 0
  for (const row of pending) {
    target.set(row, offset)
    offset += row.length
  }
  iterators.delete(iter)
  // A negated count tells the runtime this was the final batch.
  return -offset
}

export const row_iter_bsatn_close = (iter: number): void => {
  iterators.delete(iter)
}

export const volatile_nonatomic_schedule_immediate = (): void => undefined

export const console_log = (): void => undefined

export const console_timer_start = (): number => 1

export const console_timer_end = (): void => undefined

export const identity = (): bigint => 0n

export const get_jwt_payload = (): string => ""

export const procedure_http_request = (): void => undefined

export const procedure_start_mut_tx = (): bigint => 0n

export const procedure_commit_mut_tx = (): void => undefined

export const procedure_abort_mut_tx = (): void => undefined
