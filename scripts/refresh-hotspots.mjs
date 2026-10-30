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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'public', 'content', 'manifest.json')
const pengePath = process.env.TWTW_PENGE || join(root, '.cache', 'twtw', 'raw', 'DKCODE', 'TWTW.PNG')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const topics = manifest.sections.flatMap((section) => section.topics)
const titles = new Map(topics.map((topic) => [topic.id, topic.title]))

const assets = { images: [], animations: [], audio: [] }
for (const topic of topics) {
  for (const kind of Object.keys(assets)) {
    for (const asset of topic[kind]) {
      asset.topicPath = topic.id
      delete asset.hotspots
      assets[kind].push(asset)
    }
  }
}

const { hotspotCount } = attachAuthoredHotspots({
  pengeBuffer: await readFile(pengePath),
  imageAssets: assets.images,
  animationAssets: assets.animations,
  audioAssets: assets.audio,
  titleFor: (topicId) => titles.get(topicId) || topicId.split('/').at(-1),
  log: console.log,
})

for (const asset of Object.values(assets).flat()) delete asset.topicPath
manifest.totals.hotspots = hotspotCount
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Wrote ${hotspotCount} hotspots to public/content/manifest.json`)
