import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTROL_SIZE, findControlSlots } from '../scripts/animation-regions.mjs'

function canvas(width, height) {
  return Buffer.alloc(width * height * 3, 240)
}
function line(rgb, width, y, from, to) {
  for (let x = from; x <= to; x++) rgb.fill(0, (y * width + x) * 3, (y * width + x) * 3 + 3)
}

test('finds the control slot centred between two rule lines', () => {
  const rgb = canvas(200, 60)
  line(rgb, 200, 30, 10, 60)
  line(rgb, 200, 30, 148, 198)
  assert.deepEqual(CONTROL_SIZE, [74, 22])
  assert.deepEqual(findControlSlots(rgb, 200, 60), [[67, 20]])
})

test('ignores column gaps that contain text and gaps of the wrong width', () => {
  const rgb = canvas(200, 60)
  line(rgb, 200, 30, 10, 60)
  line(rgb, 200, 30, 148, 198)
  for (let y = 22; y < 38; y += 2) line(rgb, 200, y, 80, 130) // ink inside the slot
  assert.deepEqual(findControlSlots(rgb, 200, 60), [])
  const narrow = canvas(200, 60)
  line(narrow, 200, 30, 10, 60)
  line(narrow, 200, 30, 120, 198)
  assert.deepEqual(findControlSlots(narrow, 200, 60), [])
})
