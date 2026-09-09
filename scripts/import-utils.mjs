import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

export const SECTION_TITLES = {
  ARTICLE1: 'Machines A–G',
  ARTICLE2: 'Machines G–P',
  ARTICLE3: 'Machines R–Z',
  PRINCIPL: 'Principles',
  INVENTOR: 'Inventors',
  GLOS: 'Glossary',
  WORKSHOP: 'Workshop',
  TIMELINE: 'Timeline',
  INDEX: 'Index',
  RELA: 'Related subjects',
  HELP: 'Help',
  OPTIONS: 'Options',
  TITLE: 'Title',
  NAV: 'Navigation',
  AZAZ: 'A–Z',
}

export const TOPIC_TITLES = {
  AUGR: 'Construction Auger',
  BRAS: 'Brass Instruments',
  CRAN: 'Tower Crane',
  DIFF: 'Differential',
  DRIL: "Dentist's Drill",
  ESCA: 'Escalator',
  HOVR: 'Hovercraft',
  LITC: 'Lightning Conductor',
  PERC: 'Percussion Instruments',
  ROLL: 'Window Shade',
  SCAP: 'Platform Scales',
  SPRN: 'Lawn Sprinkler',
  STRI: 'String Instruments',
  SUBM: 'Submarine',
  ULTR: 'Ultrasound',
  WOOD: 'Woodwind Instruments',
  QCAM: 'Cams and Cranks',
  QCOM: 'Computers',
  QELE: 'Electricity',
  QEMG: 'Electromagnetism',
  QFLO: 'Floating',
  QFLY: 'Flying',
  QFRI: 'Friction',
  QGEA: 'Gears',
  QHEA: 'Heat',
  QINC: 'Inclined Planes',
  QLIT: 'Light',
  QLVR: 'Levers',
  QMAG: 'Magnetism',
  QPHO: 'Photography',
  QPRE: 'Pressure',
  QPUL: 'Pulleys',
  QSCR: 'Screws',
  QSND: 'Sound',
  QSPR: 'Springs',
  QTEL: 'Telecommunications',
  QWAV: 'Waves',
  QWHE: 'Wheels',
  GLOS1: 'Glossary A–M',
  GLOS2: 'Glossary N–Z',
  A: 'Inventors A',
  B: 'Inventors B',
  C: 'Inventors C',
  D: 'Inventors D',
  E: 'Inventors E',
  F: 'Inventors F',
  G: 'Inventors G',
  H: 'Inventors H',
  IJK: 'Inventors I–K',
  L: 'Inventors L',
  M: 'Inventors M',
  MISC: 'Other Inventors',
  NO: 'Inventors N–O',
  PQ: 'Inventors P–Q',
  R: 'Inventors R',
  S: 'Inventors S',
  TUV: 'Inventors T–V',
  W: 'Inventors W',
  XYZ: 'Inventors X–Z',
}

export function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function imageCompare(a, b) {
  const priority = (id) => {
    if (/0M$/i.test(id)) return 0
    if (/\dM$/i.test(id)) return 1
    if (/\dN$/i.test(id)) return 2
    if (/\d[ZX]$/i.test(id)) return 3
    if (/\dR$/i.test(id)) return 4
    if (/J$/i.test(id)) return 9
    return 5
  }
  return priority(a.id) - priority(b.id) || naturalCompare(a.id, b.id)
}

export function topicPath(relativePath) {
  const parts = relativePath.split('/')
  const top = parts[0]
  if (/^ARTICLE[123]$/.test(top) || top === 'PRINCIPL' || top === 'INVENTOR' || top === 'GLOS') {
    return parts.length > 2 ? parts.slice(0, 2).join('/') : top
  }
  return top.includes('.') ? 'ROOT' : top
}

export function titleFromOcr(text, fallback) {
  const rejected = /principles of science|^(the way things work|see also|help|contents?)$/i
  const lines = text
    .split(/\r?\n/)
    .map((value) => value.trim().replace(/[^\p{L}\p{N}\-'& ]/gu, ''))
    .filter((value) => value.length >= 4 && value.length <= 50 && !rejected.test(value))
  const line = lines.find((value) => {
    const letters = value.replace(/[^\p{L}]/gu, '')
    const uppercase = letters.replace(/[^\p{Lu}]/gu, '')
    return letters.length >= 4 && uppercase.length / letters.length > 0.75
  }) || lines[0]
  if (!line) return fallback
  return line.toLowerCase().replace(/(^|\s|[-'])\p{L}/gu, (match) => match.toUpperCase()).trim()
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
