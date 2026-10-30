#!/usr/bin/env node
// Re-render every playable animation from the extracted CD-ROM files without
// reconverting images or sounds, then refresh the manifest's animation
// metadata. Useful after a codec fix:
//
//   TWTW_JOBS=8 npm run animations
import { readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderAni } from './render-ani.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = process.env.TWTW_CACHE || join(root, '.cache', 'twtw', 'raw')
const manifestPath = join(root, 'public', 'content', 'manifest.json')
const only = process.argv.slice(2).map((value) => value.toLowerCase())

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const topics = manifest.sections.flatMap((section) => section.topics)
const imagesBySource = new Map(topics.flatMap((topic) => topic.images).map((image) => [image.source.toLowerCase(), image]))
const jobs = []
for (const topic of topics) {
  for (const animation of topic.animations) {
    if (!animation.playable) continue
    if (only.length && !only.includes(animation.id.toLowerCase())) continue
    const directory = animation.source.toLowerCase().split('/').slice(0, -1).join('/')
    const candidates = [...imagesBySource.keys()].filter((source) => source.split('/').at(-1) === `${animation.baseId.toLowerCase()}.dib`)
    const baseSource = candidates.find((source) => source.split('/').slice(0, -1).join('/') === directory) || candidates[0]
    const base = baseSource && imagesBySource.get(baseSource)
    if (!base) {
      console.warn(`No base bitmap for ${animation.id}`)
      continue
    }
    jobs.push({ animation, base })
  }
}

let completed = 0
let cursor = 0
const workers = Array.from({ length: Math.max(1, Math.min(8, Number(process.env.TWTW_JOBS) || 6)) }, async () => {
  while (cursor < jobs.length) {
    const { animation, base } = jobs[cursor++]
    const outputPath = join(root, 'public', ...animation.url.slice(1).split('/').map(decodeURIComponent))
    try {
      const rendered = await renderAni({ aniPath: join(cache, animation.source), basePath: join(cache, base.source), outputPath })
      Object.assign(animation, rendered, { bytes: (await stat(outputPath)).size })
    } catch (error) {
      console.warn(`\nCould not render ${animation.source}: ${error.message}`)
    }
    completed++
    if (completed % 25 === 0 || completed === jobs.length) process.stdout.write(`\rRendered ${completed}/${jobs.length}`)
  }
})
await Promise.all(workers)
process.stdout.write('\n')
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Updated ${jobs.length} animations in public/content/manifest.json`)
