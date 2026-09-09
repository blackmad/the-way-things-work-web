import test from 'node:test'
import assert from 'node:assert/strict'
import { imageCompare, naturalCompare, titleFromOcr, topicPath } from '../scripts/import-utils.mjs'

test('groups machine assets into their article topic', () => {
  assert.equal(topicPath('ARTICLE1/AIRP/AIRP0M.DIB'), 'ARTICLE1/AIRP')
  assert.equal(topicPath('PRINCIPL/QFLY/QFLY0M.DIB'), 'PRINCIPL/QFLY')
  assert.equal(topicPath('WORKSHOP/WWWW0M.DIB'), 'WORKSHOP')
})

test('extracts a plausible title from OCR output', () => {
  assert.equal(titleFromOcr('AIRPLANE\nHow does an airplane fly?', 'AIRP'), 'Airplane')
  assert.equal(titleFromOcr('ahs\n\nCANDLE\nThe wax of a candle', 'CAND'), 'Candle')
  assert.equal(titleFromOcr('###\n', 'AIRP'), 'AIRP')
})

test('sorts numbered screens naturally', () => {
  assert.deepEqual(['PAGE10', 'PAGE2', 'PAGE1'].sort(naturalCompare), ['PAGE1', 'PAGE2', 'PAGE10'])
})

test('puts main article artwork before details and see-also cards', () => {
  const screens = ['AIRP0J', 'AIRP1N', 'AIRP0Z', 'AIRP0M'].map((id) => ({ id }))
  assert.deepEqual(screens.sort(imageCompare).map(({ id }) => id), ['AIRP0M', 'AIRP1N', 'AIRP0Z', 'AIRP0J'])
})
