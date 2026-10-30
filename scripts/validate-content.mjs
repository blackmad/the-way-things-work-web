#!/usr/bin/env node
import { access, readFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'public', 'content', 'manifest.json')

function localPath(url) {
  return join(root, 'public', ...url.slice(1).split('/').map(decodeURIComponent))
}

async function main() {
  await access(manifestPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const topicIds = new Set()
  const urls = new Set()
  const counts = { topics: 0, images: 0, animations: 0, audio: 0, hotspots: 0, playable: 0, preserved: 0 }
  const failures = []
  const allTopics = manifest.sections.flatMap((section) => section.topics)
  const knownTopicIds = new Set(allTopics.map((topic) => topic.id))
  const allImages = allTopics.flatMap((topic) => topic.images)
  const allAnimations = allTopics.flatMap((topic) => topic.animations)
  const allAudio = allTopics.flatMap((topic) => topic.audio)
  const topicsById = new Map(allTopics.map((topic) => [topic.id, topic]))

  for (const section of manifest.sections) {
    for (const topic of section.topics) {
      counts.topics++
      if (topicIds.has(topic.id)) failures.push(`Duplicate topic ID: ${topic.id}`)
      topicIds.add(topic.id)
      for (const kind of ['images', 'animations', 'audio']) {
        for (const asset of topic[kind]) {
          counts[kind]++
          if (kind === 'animations') asset.playable ? counts.playable++ : counts.preserved++
          for (const url of [asset.url, asset.archiveUrl].filter(Boolean)) {
            if (urls.has(url) && url === asset.url) failures.push(`Duplicate primary URL: ${url}`)
            urls.add(url)
            try {
              const info = await stat(localPath(url))
              if (!info.isFile() || info.size === 0) failures.push(`Empty media file: ${url}`)
              if (url === asset.url && info.size !== asset.bytes) failures.push(`Size mismatch: ${url}`)
            } catch {
              failures.push(`Missing media file: ${url}`)
            }
          }
          if (kind === 'images') {
            for (const hotspot of asset.hotspots || []) {
              counts.hotspots++
              const [left, top, right, bottom] = hotspot.rect
              if (left < 0 || top < 0 || right <= left || bottom <= top || right > asset.width || bottom > asset.height) {
                failures.push(`Invalid hotspot rectangle on ${topic.id}/${asset.id}: ${hotspot.rect.join(',')}`)
              }
              if (!['play', 'open', 'navigate', 'sound'].includes(hotspot.action)) failures.push(`Unknown hotspot action on ${topic.id}/${asset.id}: ${hotspot.action}`)
              const validTarget = hotspot.action === 'play'
                ? allAnimations.some((animation) => animation.id === hotspot.target && animation.url === hotspot.url && animation.playable)
                : hotspot.action === 'open'
                  ? allImages.some((image) => image.id === hotspot.target && image.url === hotspot.url)
                  : hotspot.action === 'sound'
                    ? allAudio.some((sound) => sound.id === hotspot.target && sound.url === hotspot.url)
                    : knownTopicIds.has(hotspot.topicId) && (hotspot.screen || 0) < topicsById.get(hotspot.topicId).images.length
              if (!validTarget) {
                failures.push(`Missing hotspot target on ${topic.id}/${asset.id}: ${hotspot.target}`)
              }
              if (hotspot.sound && !allAudio.some((sound) => sound.url === hotspot.sound)) {
                failures.push(`Missing hotspot sound on ${topic.id}/${asset.id}: ${hotspot.sound}`)
              }
            }
          }
        }
      }
    }
  }

  for (const entry of manifest.index || []) {
    const topic = topicsById.get(entry.topicId)
    if (!topic || (entry.screen || 0) >= topic.images.length) failures.push(`Index entry points nowhere: ${entry.label}`)
    if (entry.open && !allImages.some((image) => image.id === entry.open && image.url === entry.url)) failures.push(`Index entry opens a missing card: ${entry.label}`)
  }

  for (const key of ['topics', 'images', 'animations', 'audio']) {
    if (counts[key] !== manifest.totals[key]) failures.push(`Manifest ${key}: expected ${manifest.totals[key]}, found ${counts[key]}`)
  }
  if (counts.hotspots !== (manifest.totals.hotspots || 0)) failures.push(`Manifest hotspots: expected ${manifest.totals.hotspots || 0}, found ${counts.hotspots}`)
  if (failures.length) {
    console.error(failures.join('\n'))
    process.exitCode = 1
    return
  }
  console.log(`Validated ${counts.topics} topics, ${counts.images} images, ${counts.audio} sounds, ${counts.animations} animations (${counts.playable} playable, ${counts.preserved} preserved variants), and ${counts.hotspots} authored hotspots.`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
