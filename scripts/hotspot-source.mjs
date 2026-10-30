const HOTSPOT_OPEN = 0x025b
const HOTSPOT_DESCRIPTOR = 0x0748
const PAGE_SOURCE = new Set([0x0065, 0x0066])

// Compiled Penge pages begin with a page-source record. Two layouts occur:
// a 0x65/0x66 record naming the page bitmap, or a type-3 record immediately
// followed by the first hotspot. A type-3 record embedded inside a 0x21c
// target descriptor is not a source change.
export function updateSource(buffer, strings, knownSources, offset, current) {
  const type = buffer.readUInt16BE(offset)
  if (PAGE_SOURCE.has(type) && offset + 10 <= buffer.length) {
    const candidate = strings[buffer.readUInt16BE(offset + 8)]
    const known = candidate && knownSources.get(candidate.toLowerCase())
    if (known) return known
  }
  if (type === 3 &&
      buffer.readUInt16BE(offset + 2) === 0 &&
      buffer.readUInt16BE(offset + 6) === HOTSPOT_OPEN) {
    if (offset >= 4 && buffer.readUInt16BE(offset - 4) === 0x021c) return current
    const candidate = strings[buffer.readUInt16BE(offset + 4)]
    const known = candidate && knownSources.get(candidate.toLowerCase())
    if (known) return known
  }
  return current
}
