#!/usr/bin/env node
// Record the area each animation paints (the union of its patch rectangles)
// so the viewer can place its play control over the blank spot in the
// artwork. Reads the extracted disc, writes public/content/manifest.json.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAni } from './ani-codec.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = process.env.TWTW_CACHE || join(root, '.cache', 'twtw', 'raw')
const manifestPath = join(root, 'public', 'content', 'manifest.json')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
let count = 0
for (const topic of manifest.sections.flatMap((section) => section.topics)) {
  for (const animation of topic.animations) {
    if (!animation.playable) continue
    try {
      const { records } = parseAni(await readFile(join(cache, animation.source)))
      const rects = records.filter((record) => record.rect).map((record) => record.rect)
      if (!rects.length) continue
      animation.region = [
        Math.min(...rects.map((rect) => rect.left)),
        Math.min(...rects.map((rect) => rect.top)),
        Math.max(...rects.map((rect) => rect.right)),
        Math.max(...rects.map((rect) => rect.bottom)),
      ]
      count++
    } catch (error) {
      console.warn(`Could not read ${animation.source}: ${error.message}`)
    }
  }
}
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Recorded painted regions for ${count} animations.`)
