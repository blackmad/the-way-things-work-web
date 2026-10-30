#!/usr/bin/env node
// Re-run authored-hotspot extraction against an existing build. This is useful
// when the Penge decoder improves but the converted media does not need to be
// rendered again:
//
//   TWTW_PENGE=/path/to/DKCODE/TWTW.PNG npm run hotspots
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { attachAuthoredHotspots } from './hotspot-attach.mjs'
import { INVENTOR_TAB_HANDLERS, PRINCIPLE_CROSS_REFERENCES } from './import-iso.mjs'
import { TOPIC_TITLES } from './import-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'public', 'content', 'manifest.json')
const pengePath = process.env.TWTW_PENGE || join(root, '.cache', 'twtw', 'raw', 'DKCODE', 'TWTW.PNG')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const topics = manifest.sections.flatMap((section) => section.topics)

const imageAssets = []
const animationAssets = []
for (const topic of topics) {
  for (const image of topic.images) {
    image.topicPath = topic.id
    delete image.hotspots
    imageAssets.push(image)
  }
  for (const animation of topic.animations) {
    animation.topicPath = topic.id
    delete animation.hotspots
    animationAssets.push(animation)
  }
}

const articleTopics = topics
  .filter((topic) => topic.id.startsWith('ARTICLE'))
  .map((topic) => ({ id: topic.id, title: topic.title }))

const { hotspotCount } = await attachAuthoredHotspots({
  pengeBuffer: await readFile(pengePath),
  imageAssets,
  animationAssets,
  cacheDir: join(root, '.cache', 'twtw', 'raw'),
  publicDir: join(root, 'public'),
  ocrDir: join(root, '.cache', 'twtw', 'hotspot-ocr'),
  topicTitles: TOPIC_TITLES,
  principleCrossReferences: PRINCIPLE_CROSS_REFERENCES,
  inventorTabHandlers: INVENTOR_TAB_HANDLERS,
  articleTopics,
  log: console.log,
})

for (const asset of [...imageAssets, ...animationAssets]) delete asset.topicPath
manifest.totals.hotspots = hotspotCount
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${hotspotCount} hotspots to public/content/manifest.json`)
