import test from 'node:test'
import assert from 'node:assert/strict'
import { animationBaseId, extractAnimationHotspots, extractTopicNavigationHotspots, matchCardLabel, normalizeHotspotLabel, readPengeStrings } from '../scripts/png-hotspots.mjs'

function fixture() {
  const strings = ['Arrow', 'AIRP0m0a', 'AIRP0m2a']
  const table = Buffer.concat(strings.map((value) => {
    const text = Buffer.from(value, 'latin1')
    const length = Buffer.alloc(2)
    length.writeUInt16BE(text.length)
    return Buffer.concat([length, text])
  }))
  const header = Buffer.alloc(10)
  header.writeUInt16BE(1, 0)
  header.writeUInt32BE(table.length + 2, 4)
  header.writeUInt16BE(strings.length, 8)
  const record = Buffer.alloc(30)
  record.writeUInt16BE(0x025b, 0)
  record.writeUInt16BE(0, 2)
  record.writeUInt16BE(4, 4)
  ;[45, 293, 74, 315].forEach((value, index) => record.writeUInt16BE(value, 6 + index * 2))
  record.writeUInt16BE(0x0748, 14)
  record.writeUInt16BE(1, 16)
  record.writeUInt16BE(4, 18)
  record.writeUInt16BE(1, 20)
  record.writeUInt16BE(7, 22)
  record.writeUInt16BE(2, 24)
  record.writeInt32BE(-1, 26)
  const source = Buffer.alloc(6)
  source.writeUInt16BE(3, 0)
  source.writeUInt16BE(0, 2)
  source.writeUInt16BE(1, 4)
  return Buffer.concat([header, table, source, record])
}

test('reads the length-prefixed Penge string table', () => {
  assert.deepEqual(readPengeStrings(fixture()).strings, ['Arrow', 'AIRP0m0a', 'AIRP0m2a'])
})

test('extracts an authored animation hotspot and its coordinates', () => {
  assert.deepEqual(extractAnimationHotspots(fixture(), ['AIRP0M0A', 'AIRP0M2A']), [{
    rect: [45, 293, 74, 315],
    action: 'play',
    target: 'AIRP0M2A',
    sourceOffset: 43,
  }])
})

test('derives the bitmap base from an animation target', () => {
  assert.equal(animationBaseId('AIRP0M2A'), 'AIRP0M')
})

test('retains authored rectangles for indirect navigation actions', () => {
  const data = fixture()
  data.writeUInt16BE(3, 43 + 22)
  data.writeUInt32BE(0x00043cc2, 43 + 24)
  assert.deepEqual(extractTopicNavigationHotspots(data, ['AIRP0M0A']), [{
    source: 'AIRP0M0A',
    rect: [45, 293, 74, 315],
    handlerOffset: 0x00043cc2,
    sourceOffset: 43,
  }])
})

test('matches a red label only to one card title', () => {
  const cards = [{ id: 'BALO0N', title: 'BURNER' }, { id: 'BALO1N', title: 'ENVELOPE' }]
  assert.equal(normalizeHotspotLabel(' Burner '), 'burner')
  assert.equal(matchCardLabel('BURNER', cards)?.id, 'BALO0N')
  assert.equal(matchCardLabel('unknown', cards), null)
})
