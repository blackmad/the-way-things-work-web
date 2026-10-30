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
  entries.push(['AZAZ', 'AZAZ0M', [150, 70, 390, 215], 'AZAZ', 'AZ000M'])
  entries.push(['AZAZ', 'AZAZ0M', [170, 215, 235, 250], 'AZAZ', 'AZ000M'])
  entries.push(['AZAZ', 'AZAZ0M', [300, 215, 365, 250], 'AZAZ', 'AZ000M'])
  entries.push(['AZAZ', 'AZAZ0M', [320, 295, 370, 322], 'AZAZ', 'AZ000M'])
  for (const [code, rect] of Object.entries(PRINCIPLE_LABELS)) entries.push(['PRINCIPL', 'QQQQ0M', rect, `PRINCIPL/${code}`, `${code}0M`])
  return entries
}
