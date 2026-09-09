import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeFunkyRle, parseAni } from '../scripts/ani-codec.mjs'

test('decodes funky literal and repeated runs', () => {
  const packed = Buffer.from([3, 9, 0x83, 1, 2, 3, 2, 7])
  assert.deepEqual([...decodeFunkyRle(packed, 8)], [9, 9, 9, 1, 2, 3, 7, 7])
})

test('parses a minimal ANI record', () => {
  const file = Buffer.alloc(30 + 22 + 6 + 4 + 3)
  file.writeUInt16LE(1, 0)
  file.writeUInt16LE(1, 2)
  file.writeUInt16LE(5, 6)
  file.writeUInt16LE(1, 14)
  file.writeUInt16LE(1, 16)
  file.writeUInt32LE(22050, 18)
  file.writeUInt32LE(22050, 22)
  file.writeUInt16LE(1, 26)
  file.writeUInt16LE(8, 28)
  file.writeUInt16LE(1, 30)
  file.writeUInt32LE(4, 32)
  file.writeUInt16LE(0, 36)
  file.writeUInt16LE(0, 38)
  file.writeUInt16LE(2, 40)
  file.writeUInt16LE(1, 42)
  file.writeUInt32LE(2, 44)
  file.writeUInt32LE(3, 48)
  file.write('funky!', 52)
  file.set([128, 128, 128, 128], 58)
  file.set([0x82, 4, 5], 62)
  const parsed = parseAni(file)
  assert.equal(parsed.header.framesPerSecond, 5)
  assert.deepEqual([...parsed.records[0].pixels], [4, 5])
})
