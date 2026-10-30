import { builtinHotspots } from './builtin-hotspots.mjs'
import { imageCompare } from './import-utils.mjs'
import { HOTSPOT_ACTION, parsePenge, RECORD_TYPE } from './penge.mjs'

// Attach the authored hotspots from the compiled Penge database to the
// converted media. Every link is resolved from the database itself: popup and
// page references point at other display-object records, and sound and
// animation references name their media file. Nothing here reads pixels.
export function attachAuthoredHotspots({
  pengeBuffer,
  imageAssets,
  animationAssets,
  audioAssets = [],
  titleFor = (topicId) => topicId.split('/').at(-1),
  log = console.log,
}) {
  const key = (topicPath, id) => `${topicPath}/${id}`.toLowerCase()
  const imagesByKey = new Map(imageAssets.map((asset) => [key(asset.topicPath, asset.id), asset]))
  const animationsByKey = new Map(animationAssets.map((asset) => [key(asset.topicPath, asset.id), asset]))
  const audioByKey = new Map(audioAssets.map((asset) => [key(asset.topicPath, asset.id), asset]))
  const screenIndex = new Map()
  for (const images of Map.groupBy(imageAssets, (asset) => asset.topicPath).values()) {
    images.toSorted(imageCompare).forEach((asset, index) => screenIndex.set(asset, index))
  }

  const { records, unresolved } = parsePenge(pengeBuffer)
  const stats = { hotspots: 0, records: records.length, unresolvedReferences: unresolved, missingPages: new Set(), missingTargets: new Set(), skippedActions: 0 }
  const attached = new Set()

  function imageFor(record) {
    return record.bitmap ? imagesByKey.get(key(record.topicId, record.bitmap)) : undefined
  }

  function convert(record, action) {
    if (action.code === HOTSPOT_ACTION.openPopup || action.code === HOTSPOT_ACTION.changePage) {
      if (!action.target) return null
      const target = imageFor(action.target)
      if (!target) {
        stats.missingTargets.add(`${action.target.topicId}/${action.target.bitmap}`)
        return null
      }
      if (action.target.type === RECORD_TYPE.page) {
        const screen = screenIndex.get(target) || 0
        return {
          action: 'navigate',
          target: titleFor(target.topicPath),
          topicId: target.topicPath,
          screen,
          url: `#/topic/${encodeURIComponent(target.topicPath)}${screen ? `?screen=${screen}` : ''}`,
        }
      }
      return { action: 'open', target: target.id, url: target.url, at: [action.target.x, action.target.y] }
    }
    if (action.code === HOTSPOT_ACTION.playAnimation) {
      const animation = action.name && animationsByKey.get(key(record.topicId, action.name))
      if (!animation) {
        if (action.name) stats.missingTargets.add(`${record.topicId}/${action.name}`)
        return null
      }
      if (!animation.playable) return null
      return { action: 'play', target: animation.id, url: animation.url }
    }
    if (action.code === HOTSPOT_ACTION.playSound) {
      const sound = action.name && audioByKey.get(key(record.topicId, action.name))
      if (!sound) {
        if (action.name) stats.missingTargets.add(`${record.topicId}/${action.name}`)
        return null
      }
      return { action: 'sound', target: sound.id, url: sound.url }
    }
    stats.skippedActions++
    return null
  }

  for (const record of records) {
    const image = imageFor(record)
    if (!image) {
      if (record.hotspots.length) stats.missingPages.add(`${record.topicId}/${record.bitmap}`)
      continue
    }
    for (const hotspot of record.hotspots) {
      const rect = [
        Math.max(0, Math.min(hotspot.rect[0], image.width)),
        Math.max(0, Math.min(hotspot.rect[1], image.height)),
        Math.max(0, Math.min(hotspot.rect[2], image.width)),
        Math.max(0, Math.min(hotspot.rect[3], image.height)),
      ]
      if (rect[2] <= rect[0] || rect[3] <= rect[1]) continue
      const converted = hotspot.actions.map((action) => convert(record, action)).filter(Boolean)
      if (!converted.length) continue
      // A control that both plays a sound and opens something is one control:
      // keep the destination and carry the sound along with it.
      const primary = converted.find((entry) => entry.action !== 'sound') || converted[0]
      const sound = primary.action !== 'sound' && converted.find((entry) => entry.action === 'sound')
      const entry = { rect, ...primary, ...(sound ? { sound: sound.url } : {}) }
      const dedupe = `${image.topicPath}/${image.id}/${rect.join(',')}/${entry.action}/${entry.topicId || ''}/${entry.target}/${entry.screen ?? ''}`.toLowerCase()
      if (attached.has(dedupe)) continue
      attached.add(dedupe)
      image.hotspots ||= []
      image.hotspots.push(entry)
      stats.hotspots++
    }
  }

  // Section dials and maps are wired in the executable, not the database.
  for (const [topicId, imageId, rect, targetTopic, targetImage] of builtinHotspots()) {
    const image = imagesByKey.get(key(topicId, imageId))
    const target = imagesByKey.get(key(targetTopic, targetImage))
    if (!image || !target) continue
    const screen = screenIndex.get(target) || 0
    image.hotspots ||= []
    image.hotspots.push({
      rect,
      action: 'navigate',
      target: titleFor(target.topicPath),
      topicId: target.topicPath,
      screen,
      url: `#/topic/${encodeURIComponent(target.topicPath)}${screen ? `?screen=${screen}` : ''}`,
    })
    stats.hotspots++
  }

  log(`Attached ${stats.hotspots} authored hotspots from ${stats.records} Penge records.`)
  if (stats.unresolvedReferences) log(`${stats.unresolvedReferences} hotspot references did not resolve to a record.`)
  if (stats.missingPages.size) log(`${stats.missingPages.size} authored pages have no converted bitmap: ${[...stats.missingPages].slice(0, 10).join(', ')}`)
  if (stats.missingTargets.size) log(`${stats.missingTargets.size} link targets have no converted media: ${[...stats.missingTargets].slice(0, 10).join(', ')}`)
  return { hotspotCount: stats.hotspots, stats }
}
