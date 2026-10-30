// Decoder for DKCODE/TWTW.PNG, the compiled "Penge" content database that
// drives the original Windows application.
//
// Layout (all integers are big-endian):
//
//   header     10 bytes: version, string-table byte length (u32 at 4),
//              string count (u16 at 8)
//   strings    length-prefixed Latin-1 strings, sorted alphabetically
//   data       serialized page objects
//
// The data region is a sequence of display-object records. Each record has a
// fixed 38-byte header followed by that object's hotspot records:
//
//   u16 type        0x65 popup (card, panel, glossary entry), 0x66 base page,
//                   0x67 scrolling index panel
//   u16 flags
//   u16 x, u16 y    where a popup is placed over the 540×450 page
//   u16 path + 1    1-based string reference to the topic directory, "\ARTICLE3\THER\"
//   u16 1, u16 0xc9, u16 1
//   u16 id          ordinal within the topic
//   u16 0x259, u16 2, u16 0, u16 0, u16 0
//   u16 width, u16 height
//   u16 3, u32 bitmap + 1   1-based string reference to the bitmap name, "THER0m"
//
// Hotspot records (class 0x25b) have a 22-byte header, one or more actions,
// and a two-byte trailer:
//
//   u16 0x25b, u16 cursor (0-based string reference, usually "Arrow")
//   u16 4, u16 left, top, right, bottom
//   u16 0x748, u16 1, u16 4
//   u16 action count
//   actions:
//     1  open popup      u32 record reference, u16 flag
//     2  built-in        u16 a, u16 b (print and zoom controls)
//     3  change page     u32 record reference, u16 flag
//     4  play sound      u16 name + 1, u32 0xffffffff, u16 1, u16 1, u16 0
//     7  play animation  u16 name + 1, u32 0xffffffff, u16 1, u16 1, u16 0
//     11 built-in        u16 control (Options dialog)
//   u16 0
//
// A record reference is the file offset of the target display-object record
// minus RECORD_REFERENCE_BASE. Every reference in the shipped database
// resolves to a popup or base-page record, which is how authored links were
// recovered without any OCR.

export const RECORD_REFERENCE_BASE = 0x1515b
export const RECORD_HEADER_BYTES = 38
export const HOTSPOT_HEADER_BYTES = 22
const ACTION_BYTES = { 1: 8, 2: 6, 3: 8, 4: 12, 7: 12, 11: 4 }

const DISPLAY_TYPES = new Set([0x65, 0x66, 0x67])
export const RECORD_TYPE = { popup: 0x65, page: 0x66, scroll: 0x67 }
export const HOTSPOT_ACTION = { openPopup: 1, builtIn: 2, changePage: 3, playSound: 4, playAnimation: 7, options: 11 }

export function readPengeStrings(buffer) {
  if (buffer.length < 10) throw new Error('Penge data is too short')
  const tableBytes = buffer.readUInt32BE(4)
  const stringCount = buffer.readUInt16BE(8)
  const strings = []
  let offset = 10
  for (let index = 0; index < stringCount; index++) {
    if (offset + 2 > buffer.length) throw new Error('Truncated Penge string table')
    const length = buffer.readUInt16BE(offset)
    offset += 2
    if (offset + length > buffer.length) throw new Error('Truncated Penge string')
    strings.push(buffer.subarray(offset, offset + length).toString('latin1'))
    offset += length
  }
  if (offset !== tableBytes + 8) throw new Error('Unexpected Penge string-table length')
  return { strings, dataOffset: offset }
}

function isRecordHeader(buffer, offset) {
  return offset + RECORD_HEADER_BYTES <= buffer.length &&
    DISPLAY_TYPES.has(buffer.readUInt16BE(offset)) &&
    buffer.readUInt16BE(offset + 10) === 1 &&
    buffer.readUInt16BE(offset + 12) === 0xc9 &&
    buffer.readUInt16BE(offset + 14) === 1 &&
    buffer.readUInt16BE(offset + 18) === 0x259 &&
    buffer.readUInt16BE(offset + 20) === 2 &&
    buffer.readUInt16BE(offset + 32) === 3
}

function isHotspotHeader(buffer, offset) {
  return offset + HOTSPOT_HEADER_BYTES + 2 <= buffer.length &&
    buffer.readUInt16BE(offset) === 0x25b &&
    buffer.readUInt16BE(offset + 4) === 4 &&
    buffer.readUInt16BE(offset + 14) === 0x748 &&
    buffer.readUInt16BE(offset + 16) === 1 &&
    buffer.readUInt16BE(offset + 18) === 4
}

function readActions(buffer, offset, count, stringAt) {
  const actions = []
  let cursor = offset
  for (let index = 0; index < count; index++) {
    if (cursor + 2 > buffer.length) break
    const code = buffer.readUInt16BE(cursor)
    const bytes = ACTION_BYTES[code]
    if (!bytes || cursor + bytes > buffer.length) break
    const action = { code }
    if (code === HOTSPOT_ACTION.openPopup || code === HOTSPOT_ACTION.changePage) {
      action.reference = buffer.readUInt32BE(cursor + 2)
      action.flag = buffer.readUInt16BE(cursor + 6)
    } else if (code === HOTSPOT_ACTION.playSound || code === HOTSPOT_ACTION.playAnimation) {
      action.name = stringAt(buffer.readUInt16BE(cursor + 2))
    }
    actions.push(action)
    cursor += bytes
  }
  return actions
}

// "\ARTICLE3\THER\" -> "ARTICLE3/THER"
export function topicIdFromPengePath(path) {
  return (path || '').replace(/^[\\/]+|[\\/]+$/g, '').split(/[\\/]+/).filter(Boolean).join('/')
}

export function parsePenge(buffer) {
  const { strings, dataOffset } = readPengeStrings(buffer)
  const stringAt = (reference) => (reference > 0 && reference <= strings.length ? strings[reference - 1] : null)

  const records = []
  const recordsByOffset = new Map()
  let current = null
  for (let offset = dataOffset; offset + 2 <= buffer.length; offset++) {
    if (isRecordHeader(buffer, offset)) {
      current = {
        offset,
        type: buffer.readUInt16BE(offset),
        flags: buffer.readUInt16BE(offset + 2),
        x: buffer.readUInt16BE(offset + 4),
        y: buffer.readUInt16BE(offset + 6),
        path: stringAt(buffer.readUInt16BE(offset + 8)),
        id: buffer.readUInt16BE(offset + 16),
        width: buffer.readUInt16BE(offset + 28),
        height: buffer.readUInt16BE(offset + 30),
        bitmap: stringAt(buffer.readUInt32BE(offset + 34)),
        hotspots: [],
      }
      current.topicId = topicIdFromPengePath(current.path)
      records.push(current)
      recordsByOffset.set(offset, current)
      offset += RECORD_HEADER_BYTES - 1
      continue
    }
    if (!current || !isHotspotHeader(buffer, offset)) continue
    const count = buffer.readUInt16BE(offset + 20)
    current.hotspots.push({
      offset,
      cursor: strings[buffer.readUInt16BE(offset + 2)] ?? null,
      rect: [0, 1, 2, 3].map((index) => buffer.readUInt16BE(offset + 6 + index * 2)),
      actions: readActions(buffer, offset + HOTSPOT_HEADER_BYTES, count, stringAt),
    })
    offset += HOTSPOT_HEADER_BYTES - 1
  }

  let unresolved = 0
  for (const record of records) {
    for (const hotspot of record.hotspots) {
      for (const action of hotspot.actions) {
        if (action.reference === undefined) continue
        action.target = recordsByOffset.get(RECORD_REFERENCE_BASE + action.reference) || null
        if (action.reference && !action.target) unresolved++
      }
    }
  }
  const index = parseIndex(buffer, dataOffset, records[0]?.offset ?? buffer.length, strings, recordsByOffset)
  return { strings, records, unresolved, index }
}

// The region between the string table and the first page record is the
// Index. It is a run of rows in alphabetical order:
//
//   u16 label          0-based string reference
//   u16 flags
//   u16 0
//   u32 page           record reference of a base page
//   u16 count
//   u32 × count        popups to open on arrival (cards, panels)
//
// The page block in each row belongs to the heading in the row before it,
// so a heading's destination is read from the following row. A heading can
// repeat when it has several destinations. A few template records precede
// the table, so the longest non-decreasing run of rows is used.
function parseIndex(buffer, start, end, strings, recordsByOffset) {
  const rows = []
  let offset = start
  while (offset + 12 <= end) {
    const label = buffer.readUInt16BE(offset)
    const count = buffer.readUInt16BE(offset + 10)
    const page = recordsByOffset.get(RECORD_REFERENCE_BASE + buffer.readUInt32BE(offset + 6))
    const valid = buffer.readUInt16BE(offset + 4) === 0 && label < strings.length && count <= 8 && page && offset + 12 + count * 4 <= end
    const popups = []
    if (valid) {
      for (let item = 0; item < count; item++) {
        const popup = recordsByOffset.get(RECORD_REFERENCE_BASE + buffer.readUInt32BE(offset + 12 + item * 4))
        if (!popup) break
        popups.push(popup)
      }
    }
    if (!valid || popups.length !== count) {
      offset++
      continue
    }
    rows.push({ offset, label: strings[label], labelIndex: label, page, popups })
    offset += 12 + count * 4
  }
  let best = [], run = []
  for (const row of rows) {
    if (run.length && (row.labelIndex < run.at(-1).labelIndex || row.offset !== run.at(-1).offset + 12 + run.at(-1).popups.length * 4)) {
      if (run.length > best.length) best = run
      run = []
    }
    run.push(row)
  }
  const table = run.length > best.length ? run : best
  return table.slice(0, -1).map((row, index) => ({
    offset: row.offset,
    label: row.label,
    labelIndex: row.labelIndex,
    page: table[index + 1].page,
    popups: table[index + 1].popups,
  }))
}
