import test from 'node:test'
import assert from 'node:assert/strict'
import { HOTSPOT_ACTION, parsePenge, readPengeStrings, RECORD_REFERENCE_BASE, topicIdFromPengePath } from '../scripts/penge.mjs'
import { attachAuthoredHotspots } from '../scripts/hotspot-attach.mjs'

const STRINGS = ['Arrow', '\\ARTICLE1\\AIRP\\', 'AIRP0m', 'AIRP0m0a', 'AIRP0m0s', 'AIRP0n', 'AIRP1m']
const string = (value) => STRINGS.indexOf(value)
const ref = (value) => string(value) + 1

function words(...values) {
  const out = Buffer.alloc(values.length * 2)
  values.forEach((value, index) => out.writeUInt16BE(value, index * 2))
  return out
}

function record(type, x, y, path, id, width, height, bitmap) {
  const header = words(type, type === 0x66 ? 7 : 0, x, y, ref(path), 1, 0xc9, 1, id, 0x259, 2, 0, 0, 0, width, height, 3)
  const bitmapRef = Buffer.alloc(4)
  bitmapRef.writeUInt32BE(ref(bitmap))
  return Buffer.concat([header, bitmapRef])
}

function hotspot(rect, ...actions) {
  const header = words(0x25b, string('Arrow'), 4, ...rect, 0x748, 1, 4, actions.length)
  return Buffer.concat([header, ...actions, words(0)])
}

function referenceAction(code, offset, flag = 0) {
  const out = Buffer.alloc(8)
  out.writeUInt16BE(code, 0)
  out.writeUInt32BE(offset - RECORD_REFERENCE_BASE, 2)
  out.writeUInt16BE(flag, 6)
  return out
}

function nameAction(code, name) {
  const out = Buffer.alloc(12)
  out.writeUInt16BE(code, 0)
  out.writeUInt16BE(ref(name), 2)
  out.writeInt32BE(-1, 4)
  out.writeUInt16BE(1, 8)
  out.writeUInt16BE(1, 10)
  return out
}

// Builds a database whose data region starts beyond RECORD_REFERENCE_BASE so
// that record references stay positive, as they do in the shipped file.
function fixture() {
  const table = Buffer.concat(STRINGS.map((value) => {
    const text = Buffer.from(value, 'latin1')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(text.length)
    return Buffer.concat([length, text])
  }))
  const header = Buffer.alloc(10)
  header.writeUInt16BE(1, 0)
  header.writeUInt32BE(table.length + 2, 4)
  header.writeUInt16BE(STRINGS.length, 8)
  const padding = Buffer.alloc(RECORD_REFERENCE_BASE)
  const start = header.length + table.length + padding.length
  const pageOffset = start
  const page = record(0x66, 0, 0, '\\ARTICLE1\\AIRP\\', 1, 540, 450, 'AIRP0m')
  // Record headers are 38 bytes; a hotspot is 22 bytes, its actions, and a
  // 2-byte trailer (reference actions are 8 bytes, name actions 12).
  const popupOffset = pageOffset + 38 + 32 + 36 + 44
  const secondPageOffset = popupOffset + 38
  const pageHotspots = Buffer.concat([
    hotspot([408, 42, 461, 91], referenceAction(HOTSPOT_ACTION.openPopup, popupOffset)),
    hotspot([45, 293, 74, 315], nameAction(HOTSPOT_ACTION.playAnimation, 'AIRP0m0a')),
    hotspot([10, 10, 60, 60], nameAction(HOTSPOT_ACTION.playSound, 'AIRP0m0s'), referenceAction(HOTSPOT_ACTION.changePage, secondPageOffset)),
  ])
  const bodyBeforePopup = Buffer.concat([page, pageHotspots])
  assert.equal(pageOffset + bodyBeforePopup.length, popupOffset)
  const popup = record(0x65, 186, 122, '\\ARTICLE1\\AIRP\\', 2, 181, 102, 'AIRP0n')
  const secondPage = record(0x66, 0, 0, '\\ARTICLE1\\AIRP\\', 3, 540, 450, 'AIRP1m')
  const secondPageHotspots = hotspot([5, 5, 50, 20], referenceAction(HOTSPOT_ACTION.changePage, pageOffset))
  return { buffer: Buffer.concat([header, table, padding, bodyBeforePopup, popup, secondPage, secondPageHotspots]), pageOffset, popupOffset }
}

test('reads the length-prefixed Penge string table', () => {
  assert.deepEqual(readPengeStrings(fixture().buffer).strings, STRINGS)
})

test('converts Penge directory paths to topic ids', () => {
  assert.equal(topicIdFromPengePath('\\ARTICLE3\\THER\\'), 'ARTICLE3/THER')
  assert.equal(topicIdFromPengePath('\\WORKSHOP\\'), 'WORKSHOP')
})

test('parses display-object records, their hotspots, and record references', () => {
  const { buffer, pageOffset, popupOffset } = fixture()
  const { records, unresolved } = parsePenge(buffer)
  assert.equal(unresolved, 0)
  assert.deepEqual(records.map((entry) => [entry.offset, entry.type, entry.bitmap, entry.topicId, entry.hotspots.length]), [
    [pageOffset, 0x66, 'AIRP0m', 'ARTICLE1/AIRP', 3],
    [popupOffset, 0x65, 'AIRP0n', 'ARTICLE1/AIRP', 0],
    [popupOffset + 38, 0x66, 'AIRP1m', 'ARTICLE1/AIRP', 1],
  ])
  const [page] = records
  assert.deepEqual(page.hotspots[0].rect, [408, 42, 461, 91])
  assert.equal(page.hotspots[0].actions[0].target, records[1])
  assert.equal(page.hotspots[1].actions[0].name, 'AIRP0m0a')
  assert.deepEqual(page.hotspots[2].actions.map((action) => action.code), [HOTSPOT_ACTION.playSound, HOTSPOT_ACTION.changePage])
  assert.equal(records[1].x, 186)
  assert.equal(records[1].y, 122)
})

test('attaches resolved links to converted media', () => {
  const images = [
    { topicPath: 'ARTICLE1/AIRP', id: 'AIRP0M', url: '/content/images/ARTICLE1/AIRP/AIRP0M.webp', width: 540, height: 450 },
    { topicPath: 'ARTICLE1/AIRP', id: 'AIRP1M', url: '/content/images/ARTICLE1/AIRP/AIRP1M.webp', width: 540, height: 450 },
    { topicPath: 'ARTICLE1/AIRP', id: 'AIRP0N', url: '/content/images/ARTICLE1/AIRP/AIRP0N.webp', width: 181, height: 102 },
  ]
  const animations = [{ topicPath: 'ARTICLE1/AIRP', id: 'AIRP0M0A', url: '/content/animations/ARTICLE1/AIRP/AIRP0M0A.webm', playable: true }]
  const audio = [{ topicPath: 'ARTICLE1/AIRP', id: 'AIRP0M0S', url: '/content/audio/ARTICLE1/AIRP/AIRP0M0S.mp3' }]
  const { hotspotCount } = attachAuthoredHotspots({
    pengeBuffer: fixture().buffer, imageAssets: images, animationAssets: animations, audioAssets: audio, titleFor: () => 'Airplane', log: () => {},
  })
  assert.equal(hotspotCount, 4)
  assert.deepEqual(images[0].hotspots, [
    { rect: [408, 42, 461, 91], action: 'open', target: 'AIRP0N', url: '/content/images/ARTICLE1/AIRP/AIRP0N.webp', at: [186, 122] },
    { rect: [45, 293, 74, 315], action: 'play', target: 'AIRP0M0A', url: '/content/animations/ARTICLE1/AIRP/AIRP0M0A.webm' },
    { rect: [10, 10, 60, 60], action: 'navigate', target: 'Airplane', topicId: 'ARTICLE1/AIRP', screen: 1, url: '#/topic/ARTICLE1%2FAIRP?screen=1', sound: '/content/audio/ARTICLE1/AIRP/AIRP0M0S.mp3' },
  ])
  assert.deepEqual(images[1].hotspots, [
    { rect: [5, 5, 50, 20], action: 'navigate', target: 'Airplane', topicId: 'ARTICLE1/AIRP', screen: 0, url: '#/topic/ARTICLE1%2FAIRP' },
  ])
  assert.equal(images[2].hotspots, undefined)
})
