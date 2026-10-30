// Controls that the original program wires in its executable rather than in
// the Penge content database: the era dial of the History of Machines, the
// A–Z dial, and the Principles of Science map. Rectangles are authored by hand
// against the converted screens so these section pages stay navigable.

const ERA_DIAL = [
  // Era screens in chronological order with the first timeline page of each.
  { image: 'TTTT4M', page: 'TT000M' }, // Antiquity
  { image: 'TTTT3M', page: 'TT020M' }, // Birth of Science
  { image: 'TTTT0M', page: 'TT040M' }, // Industrial Revolution
  { image: 'TTTT1M', page: 'TT070M' }, // Steam Age
  { image: 'TTTT2M', page: 'TT160M' }, // Silicon Age
]

const PRINCIPLE_LABELS = {
  QGEA: [358, 58, 436, 88],
  QEMG: [24, 76, 152, 106],
  QFLY: [458, 160, 500, 178],
  QSPR: [100, 163, 162, 181],
  QSCR: [184, 158, 238, 188],
  QINC: [308, 164, 375, 194],
  QPRE: [148, 219, 214, 236],
  QFRI: [343, 219, 416, 246],
  QELE: [455, 255, 530, 275],
  QFLO: [238, 264, 312, 288],
  QPHO: [14, 272, 118, 294],
  QWHE: [322, 300, 378, 324],
  QSND: [393, 300, 446, 326],
  QCAM: [240, 316, 306, 334],
  QMAG: [430, 326, 520, 344],
  QPUL: [178, 334, 228, 348],
  QLVR: [335, 370, 385, 388],
  QLIT: [10, 397, 84, 434],
  QCOM: [100, 412, 190, 430],
  QTEL: [362, 416, 514, 432],
  QHEA: [240, 424, 282, 440],
}

// Each entry: [topicId, imageId, rect, destination topicId, destination imageId]
export function builtinHotspots() {
  const entries = []
  ERA_DIAL.forEach(({ image, page }, index) => {
    const previous = ERA_DIAL[(index + ERA_DIAL.length - 1) % ERA_DIAL.length]
    const next = ERA_DIAL[(index + 1) % ERA_DIAL.length]
    entries.push(['TIMELINE', image, [306, 298, 354, 326], 'TIMELINE', previous.image])
    entries.push(['TIMELINE', image, [414, 298, 462, 326], 'TIMELINE', next.image])
    entries.push(['TIMELINE', image, [310, 366, 356, 420], 'TIMELINE', page])
  })
  // The A–Z dial: 26 letters on a ring of radius 90 around (270, 217), with
  // A just right of the top and the alphabet running clockwise. Letters map
  // to the same pages as the alphabet strip along the bottom of the A–Z list.
  const LETTER_PAGES = ['AZ000M', 'AZ010M', 'AZ030M', 'AZ060M', 'AZ070M', 'AZ090M', 'AZ100M', 'AZ110M', 'AZ120M', 'AZ130M', 'AZ140M', 'AZ150M', 'AZ170M', 'AZ190M', 'AZ200M', 'AZ210M', 'AZ230M', 'AZ240M', 'AZ250M', 'AZ280M', 'AZ300M', 'AZ310M', 'AZ320M', 'AZ330M', 'AZ330M', 'AZ330M']
  LETTER_PAGES.forEach((page, letter) => {
    const angle = (-90 + (letter + 0.5) * (360 / 26)) * Math.PI / 180
    const x = Math.round(270 + 90 * Math.cos(angle))
    const y = Math.round(217 + 90 * Math.sin(angle))
    entries.push(['AZAZ', 'AZAZ0M', [x - 11, y - 11, x + 11, y + 11], 'AZAZ', page])
  })
  entries.push(['AZAZ', 'AZAZ0M', [177, 297, 217, 317], 'AZAZ', 'AZ330M'])
  entries.push(['AZAZ', 'AZAZ0M', [323, 297, 363, 317], 'AZAZ', 'AZ010M'])
  entries.push(['AZAZ', 'AZAZ0M', [320, 335, 370, 370], 'AZAZ', 'AZ000M'])
  for (const [code, rect] of Object.entries(PRINCIPLE_LABELS)) entries.push(['PRINCIPL', 'QQQQ0M', rect, `PRINCIPL/${code}`, `${code}0M`])
  return entries
}
