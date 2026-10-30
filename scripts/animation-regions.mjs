#!/usr/bin/env node
// Record, for each animation, the area it paints (the union of its patch
// rectangles) and, for cards that carry their own film, the 74×22 slot in
// the artwork where the original program drew its rewind/play/progress
// control. Reads the extracted disc and the converted images,
// writes public/content/manifest.json.
import { readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAni } from './ani-codec.mjs'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = process.env.TWTW_CACHE || join(root, '.cache', 'twtw', 'raw')
const manifestPath = join(root, 'public', 'content', 'manifest.json')

// The AnimationControl bitmap in TWTW.EXE is 74×22. Card artwork leaves a
// gap for it between two horizontal rule lines (the gap is about 88 px),
// and the program drew the control centred in that gap.
export const CONTROL_SIZE = [74, 22]
const RULE_MIN_LENGTH = 40
const GAP_RANGE = [82, 94]

/** Find the control slot: a pair of rule lines on one row with a gap between them. */
export function findControlSlots(rgb, width, height, [slotWidth, slotHeight] = CONTROL_SIZE) {
  const dark = (x, y) => {
    const i = (y * width + x) * 3
    return rgb[i] + rgb[i + 1] + rgb[i + 2] < 360
  }
  const slots = []
  for (let y = 0; y < height; y++) {
    const runs = []
    for (let x = 0; x < width; x++) {
      if (!dark(x, y)) continue
      let end = x
      while (end + 1 < width && dark(end + 1, y)) end++
      if (end - x + 1 >= RULE_MIN_LENGTH) runs.push([x, end])
      x = end
    }
    for (let i = 0; i + 1 < runs.length; i++) {
      const gap = runs[i + 1][0] - runs[i][1] - 1
      if (gap < GAP_RANGE[0] || gap > GAP_RANGE[1]) continue
      const left = Math.floor((runs[i][1] + runs[i + 1][0]) / 2) - Math.floor(slotWidth / 2)
      const top = y - Math.floor(slotHeight / 2) + 1
      // A rule line can be two pixels thick; keep one slot per gap.
      const previous = slots[slots.length - 1]
      if (previous && Math.abs(previous[0] - left) <= 2 && top - previous[1] <= 2) continue
      // The slot itself must be clear of ink (text would mean a column gap, not a slot).
      let ink = 0
      for (let yy = Math.max(0, top); yy < Math.min(height, top + slotHeight); yy++) {
        if (yy === y) continue
        for (let xx = Math.max(0, left); xx < Math.min(width, left + slotWidth); xx++) if (dark(xx, yy)) ink++
      }
      if (ink > slotWidth) continue
      slots.push([left, top])
    }
  }
  return slots
}

async function readRgb(file) {
  const { stdout } = await run('magick', [file, '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 64e6 })
  return stdout
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  let regions = 0
  let controls = 0
  for (const topic of manifest.sections.flatMap((section) => section.topics)) {
    for (const animation of topic.animations) {
      if (!animation.playable) continue
      delete animation.control
      try {
        const { records } = parseAni(await readFile(join(cache, animation.source)))
        const rects = records.filter((record) => record.rect).map((record) => record.rect)
        if (rects.length) {
          animation.region = [
            Math.min(...rects.map((rect) => rect.left)),
            Math.min(...rects.map((rect) => rect.top)),
            Math.max(...rects.map((rect) => rect.right)),
            Math.max(...rects.map((rect) => rect.bottom)),
          ]
          regions++
        }
      } catch (error) {
        console.warn(`Could not read ${animation.source}: ${error.message}`)
      }
      // Only films shown in place on their own card get a control slot.
      const base = topic.images.find((image) => image.id === animation.baseId)
      if (!base || base.width !== animation.width || base.height !== animation.height) continue
      if (base.hotspots?.some((hotspot) => hotspot.action === 'play' && hotspot.target === animation.id)) continue
      const slots = findControlSlots(await readRgb(join(root, 'public', base.url)), base.width, base.height)
      if (slots.length === 1) {
        animation.control = slots[0]
        controls++
      } else if (slots.length > 1) {
        console.warn(`${base.id}: ${slots.length} candidate control slots, none recorded`)
      }
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Recorded painted regions for ${regions} animations and control slots for ${controls}.`)
}
