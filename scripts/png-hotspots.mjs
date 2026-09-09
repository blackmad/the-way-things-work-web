const HOTSPOT_OPEN = 0x025b
const HOTSPOT_DESCRIPTOR = 0x0748

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

// Compiled Hotspot/AZAnimHotspot records have a stable prefix: an object marker,
// an optional object-name string, a four-word rectangle, and an action descriptor.
// Play actions (opcodes 4 and 7) name their ANI target directly in the string table.
export function extractMediaHotspots(buffer, { animationIds, imageIds }) {
  const { strings, dataOffset } = readPengeStrings(buffer)
  const knownAnimations = new Map(animationIds.map((id) => [id.toLowerCase(), id]))
  const knownImages = new Map(imageIds.map((id) => [id.toLowerCase(), id]))
  const hotspots = []
  let source = null

  for (let offset = dataOffset; offset + 30 <= buffer.length; offset++) {
    if (buffer.readUInt16BE(offset) === 3 &&
        buffer.readUInt16BE(offset + 2) === 0 &&
        buffer.readUInt16BE(offset + 6) === HOTSPOT_OPEN) {
      const candidate = strings[buffer.readUInt16BE(offset + 4)]
      source = candidate && (knownImages.get(candidate.toLowerCase()) || knownAnimations.get(candidate.toLowerCase()) || source)
    }
    if (buffer.readUInt16BE(offset) !== HOTSPOT_OPEN ||
        buffer.readUInt16BE(offset + 4) !== 4 ||
        buffer.readUInt16BE(offset + 14) !== HOTSPOT_DESCRIPTOR ||
        buffer.readUInt16BE(offset + 16) !== 1 ||
        buffer.readUInt16BE(offset + 18) !== 4 ||
        buffer.readUInt16BE(offset + 20) !== 1) continue

    const action = buffer.readUInt16BE(offset + 22)
    if (action !== 4 && action !== 7) continue
    const target = strings[buffer.readUInt16BE(offset + 24)]
    const canonicalAnimation = target && knownAnimations.get(target.toLowerCase())
    const canonicalImage = target && knownImages.get(target.toLowerCase())
    if (!source || (!canonicalAnimation && !canonicalImage)) continue

    const rect = [0, 1, 2, 3].map((index) => buffer.readUInt16BE(offset + 6 + index * 2))
    const [left, top, right, bottom] = rect
    if (right <= left || bottom <= top || right > 4096 || bottom > 4096) continue
    hotspots.push({
      source,
      rect,
      action: canonicalAnimation ? 'play' : 'open',
      target: canonicalAnimation || canonicalImage,
      sourceOffset: offset,
    })
  }
  return hotspots
}

export function extractAnimationHotspots(buffer, animationIds) {
  return extractMediaHotspots(buffer, { animationIds, imageIds: [] })
    .map(({ source: _, ...hotspot }) => hotspot)
}

export function extractIndirectHotspots(buffer, sourceIds) {
  const { strings, dataOffset } = readPengeStrings(buffer)
  const knownSources = new Map(sourceIds.map((id) => [id.toLowerCase(), id]))
  const hotspots = []
  let source = null
  for (let offset = dataOffset; offset + 30 <= buffer.length; offset++) {
    if (buffer.readUInt16BE(offset) === 3 &&
        buffer.readUInt16BE(offset + 2) === 0 &&
        buffer.readUInt16BE(offset + 6) === HOTSPOT_OPEN) {
      const candidate = strings[buffer.readUInt16BE(offset + 4)]
      source = candidate && (knownSources.get(candidate.toLowerCase()) || source)
    }
    if (!source ||
        buffer.readUInt16BE(offset) !== HOTSPOT_OPEN ||
        buffer.readUInt16BE(offset + 4) !== 4 ||
        buffer.readUInt16BE(offset + 14) !== HOTSPOT_DESCRIPTOR ||
        buffer.readUInt16BE(offset + 16) !== 1 ||
        buffer.readUInt16BE(offset + 18) !== 4 ||
        buffer.readUInt16BE(offset + 20) !== 1 ||
        buffer.readUInt16BE(offset + 22) !== 1) continue
    const rect = [0, 1, 2, 3].map((index) => buffer.readUInt16BE(offset + 6 + index * 2))
    const [left, top, right, bottom] = rect
    if (right <= left || bottom <= top || right > 4096 || bottom > 4096) continue
    hotspots.push({ source, rect, handlerOffset: buffer.readUInt32BE(offset + 24), sourceOffset: offset })
  }
  return hotspots
}

export function extractTopicNavigationHotspots(buffer, sourceIds) {
  const { strings, dataOffset } = readPengeStrings(buffer)
  const knownSources = new Map(sourceIds.map((id) => [id.toLowerCase(), id]))
  const hotspots = []
  let source = null
  for (let offset = dataOffset; offset + 30 <= buffer.length; offset++) {
    if (buffer.readUInt16BE(offset) === 3 &&
        buffer.readUInt16BE(offset + 2) === 0 &&
        buffer.readUInt16BE(offset + 6) === HOTSPOT_OPEN) {
      const candidate = strings[buffer.readUInt16BE(offset + 4)]
      source = candidate && (knownSources.get(candidate.toLowerCase()) || source)
    }
    if (!source ||
        buffer.readUInt16BE(offset) !== HOTSPOT_OPEN ||
        buffer.readUInt16BE(offset + 4) !== 4 ||
        buffer.readUInt16BE(offset + 14) !== HOTSPOT_DESCRIPTOR ||
        buffer.readUInt16BE(offset + 16) !== 1 ||
        buffer.readUInt16BE(offset + 18) !== 4 ||
        buffer.readUInt16BE(offset + 20) !== 1 ||
        buffer.readUInt16BE(offset + 22) !== 3) continue
    const rect = [0, 1, 2, 3].map((index) => buffer.readUInt16BE(offset + 6 + index * 2))
    const [left, top, right, bottom] = rect
    if (right <= left || bottom <= top || right > 4096 || bottom > 4096) continue
    hotspots.push({ source, rect, handlerOffset: buffer.readUInt32BE(offset + 24), sourceOffset: offset })
  }
  return hotspots
}

export function extractBookNavigationHotspots(buffer, sourceIds) {
  const { strings, dataOffset } = readPengeStrings(buffer)
  const knownSources = new Map(sourceIds.map((id) => [id.toLowerCase(), id]))
  const hotspots = []
  let source = null
  for (let offset = dataOffset; offset + 30 <= buffer.length; offset++) {
    if (buffer[offset] === 0x66 &&
        buffer[offset + 1] === 0 && buffer[offset + 2] === 7 &&
        buffer.readUInt32BE(offset + 3) === 0) {
      const candidate = strings[buffer.readUInt16BE(offset + 7)]
      source = candidate && (knownSources.get(candidate.toLowerCase()) || source)
    }
    if (!source ||
        buffer.readUInt16BE(offset) !== HOTSPOT_OPEN ||
        buffer.readUInt16BE(offset + 4) !== 4 ||
        buffer.readUInt16BE(offset + 14) !== HOTSPOT_DESCRIPTOR ||
        buffer.readUInt16BE(offset + 22) !== 3) continue
    const rect = [0, 1, 2, 3].map((index) => buffer.readUInt16BE(offset + 6 + index * 2))
    const [left, top, right, bottom] = rect
    if (right <= left || bottom <= top || right > 4096 || bottom > 4096) continue
    hotspots.push({ source, rect, handlerOffset: buffer.readUInt32BE(offset + 24), sourceOffset: offset })
  }
  return hotspots
}

export function normalizeHotspotLabel(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function matchCardLabel(label, cards) {
  const normalized = normalizeHotspotLabel(label)
  if (normalized.length < 3) return null
  const matches = cards.filter((card) => {
    const title = normalizeHotspotLabel(card.title)
    return title === normalized || (Math.min(title.length, normalized.length) >= 5 && (title.includes(normalized) || normalized.includes(title)))
  })
  return matches.length === 1 ? matches[0] : null
}

export function animationBaseId(animationId) {
  return animationId.length >= 3 ? animationId.slice(0, -2) : animationId
}
