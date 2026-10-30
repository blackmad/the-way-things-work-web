import { execFile } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  animationBaseId,
  extractBookNavigationHotspots,
  extractIndirectHotspots,
  extractMediaHotspots,
  extractTopicNavigationHotspots,
  matchCardLabel,
  normalizeHotspotLabel,
  resolveIndirectAction,
} from './png-hotspots.mjs'

const exec = promisify(execFile)

async function command(program, args, options = {}) {
  try {
    return await exec(program, args, { maxBuffer: 16 * 1024 * 1024, ...options })
  } catch (error) {
    const detail = error.stderr?.trim() || error.message
    throw new Error(`${program} failed: ${detail}`)
  }
}

function hasRedInk(rgb, imageWidth, rect) {
  const [left, top, right, bottom] = rect
  let redPixels = 0
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const offset = (y * imageWidth + x) * 3
      const red = rgb[offset]
      const green = rgb[offset + 1]
      const blue = rgb[offset + 2]
      if (red > 135 && green < 170 && red > green * 1.25 && red > blue * 1.12) redPixels++
    }
  }
  return redPixels >= 5
}

function uppercaseRatio(value) {
  const letters = value.replace(/[^A-Za-z]/g, '')
  if (!letters) return 0
  const uppercase = letters.replace(/[^A-Z]/g, '').length
  return uppercase / letters.length
}

// The compiled Penge database groups authored hotspots under the page or card
// they belong to. A handful of pages inherit a card's group while carrying
// full-page coordinates; when that happens the rectangle is the reliable
// signal. Fall back to the topic's main 0M artwork rather than dropping the
// control because it does not fit the inherited card.
function fitAuthoredSource(sourceImage, rect, imageByTopicAndId) {
  if (!sourceImage) return null
  const [, , right, bottom] = rect
  if (right <= sourceImage.width && bottom <= sourceImage.height) return sourceImage
  const code = sourceImage.topicPath.split('/').at(-1)
  const main = imageByTopicAndId.get(`${sourceImage.topicPath}/${code}0M`.toLowerCase())
  if (main && right <= main.width && bottom <= main.height) return main
  return sourceImage
}

export async function attachAuthoredHotspots({
  pengeBuffer,
  imageAssets,
  animationAssets,
  cacheDir,
  publicDir,
  ocrDir,
  topicTitles,
  principleCrossReferences,
  inventorTabHandlers,
  articleTopics,
  log = console.log,
}) {
  const sourceFile = (asset) => asset.url
    ? join(publicDir, decodeURIComponent(asset.url.slice(1)))
    : join(cacheDir, asset.source)

  const imageByTopicAndId = new Map(imageAssets.map((asset) => [
    `${asset.topicPath}/${asset.id}`.toLowerCase(), asset,
  ]))
  const imagesById = Map.groupBy(imageAssets, (asset) => asset.id.toLowerCase())
  const animationsById = Map.groupBy(animationAssets, (asset) => asset.id.toLowerCase())
  const authored = extractMediaHotspots(pengeBuffer, {
    animationIds: animationAssets.map((asset) => asset.id),
    imageIds: imageAssets.map((asset) => asset.id),
  })

  let hotspotCount = 0
  const attached = new Set()

  for (const hotspot of authored) {
    let sourceImage
    let target
    if (hotspot.action === 'play') {
      target = (animationsById.get(hotspot.target.toLowerCase()) || []).find((asset) =>
        asset.playable && imageByTopicAndId.has(`${asset.topicPath}/${asset.baseId || animationBaseId(asset.id)}`.toLowerCase()),
      )
      if (target) sourceImage = imageByTopicAndId.get(`${target.topicPath}/${target.baseId || animationBaseId(target.id)}`.toLowerCase())
    } else {
      const sourceAnimation = (animationsById.get(hotspot.source.toLowerCase()) || []).find((asset) =>
        imageByTopicAndId.has(`${asset.topicPath}/${asset.baseId || animationBaseId(asset.id)}`.toLowerCase()),
      )
      sourceImage = sourceAnimation
        ? imageByTopicAndId.get(`${sourceAnimation.topicPath}/${sourceAnimation.baseId || animationBaseId(sourceAnimation.id)}`.toLowerCase())
        : (imagesById.get(hotspot.source.toLowerCase()) || [])[0]
      const candidates = imagesById.get(hotspot.target.toLowerCase()) || []
      target = candidates.find((asset) => asset.topicPath === sourceImage?.topicPath) || candidates[0]
    }
    sourceImage = fitAuthoredSource(sourceImage, hotspot.rect, imageByTopicAndId)
    if (!sourceImage || !target) continue
    const [, , right, bottom] = hotspot.rect
    if (right > sourceImage.width + 32 || bottom > sourceImage.height + 32) continue
    const key = `${sourceImage.topicPath}/${sourceImage.id}/${hotspot.rect.join(',')}/${hotspot.action}/${target.topicPath}/${target.id}`.toLowerCase()
    if (attached.has(key)) continue
    attached.add(key)
    sourceImage.hotspots ||= []
    sourceImage.hotspots.push({ rect: hotspot.rect, action: hotspot.action, target: target.id, url: target.url })
    hotspotCount++
  }

  await rm(ocrDir, { recursive: true, force: true })
  await mkdir(ocrDir, { recursive: true })
  let ocrSequence = 0
  async function ocrCrop(file, rect, scale = '600%', pageSegmentation = '7', threshold = '70%') {
    const [left, top, right, bottom] = rect
    const target = join(ocrDir, `${ocrSequence++}.png`)
    const settings = ['-crop', `${right - left}x${bottom - top}+${left}+${top}`, '-resize', scale, '-colorspace', 'gray']
    if (threshold) settings.push('-threshold', threshold)
    await command('magick', [file, ...settings, target])
    try {
      const { stdout } = await command('tesseract', [target, 'stdout', '--psm', pageSegmentation], { timeout: 20_000 })
      return stdout.split(/\r?\n/).map((line) => line.replace(/[^A-Za-z0-9 &'’-]/g, '').trim()).find((line) => /[A-Za-z]{3}/.test(line)) || ''
    } catch {
      return ''
    }
  }

  async function ocrLines(file, rect, scale = '500%', pageSegmentation = '6') {
    const [left, top, right, bottom] = rect
    const target = join(ocrDir, `${ocrSequence++}.png`)
    await command('magick', [file, '-crop', `${right - left}x${bottom - top}+${left}+${top}`, '-resize', scale, '-colorspace', 'gray', '-normalize', target])
    try {
      const { stdout } = await command('tesseract', [target, 'stdout', '--psm', pageSegmentation], { timeout: 20_000 })
      return stdout.split(/\r?\n/).map((line) => line.replace(/[^A-Za-z0-9 &'’-]/g, '').trim()).filter(Boolean)
    } catch {
      return []
    }
  }

  const cardTitleCache = new Map()
  async function cardTitle(card) {
    if (cardTitleCache.has(card.url)) return cardTitleCache.get(card.url)
    const file = join(publicDir, decodeURIComponent(card.url.slice(1)))
    let title = ''
    if (/\d+z$/i.test(card.id) || card.width > 300) {
      // Principle panels and wide callout sheets carry their heading lower
      // than the small 0N cards. Read the top fifth and keep the longest
      // all-caps line, which avoids mistaking body copy for a title.
      const lines = await ocrLines(file, [4, 2, card.width - 4, Math.min(card.height, 90)])
      const candidates = lines.filter((line) => uppercaseRatio(line) >= 0.72 && /[A-Za-z]{3}/.test(line))
      title = candidates.sort((a, b) => b.length - a.length)[0] || ''
    } else {
      title = await ocrCrop(file, [8, 2, card.width - 8, Math.min(card.height, 24)], '800%', '7', '62%')
    }
    cardTitleCache.set(card.url, title)
    return title
  }

  const indirect = extractIndirectHotspots(pengeBuffer, [...imageAssets, ...animationAssets].map((asset) => asset.id))
  const indirectByImage = new Map()
  for (const hotspot of indirect) {
    const sourceAnimation = (animationsById.get(hotspot.source.toLowerCase()) || []).find((asset) =>
      imageByTopicAndId.has(`${asset.topicPath}/${asset.baseId || animationBaseId(asset.id)}`.toLowerCase()),
    )
    let sourceImage = sourceAnimation
      ? imageByTopicAndId.get(`${sourceAnimation.topicPath}/${sourceAnimation.baseId || animationBaseId(sourceAnimation.id)}`.toLowerCase())
      : (imagesById.get(hotspot.source.toLowerCase()) || [])[0]
    sourceImage = fitAuthoredSource(sourceImage, hotspot.rect, imageByTopicAndId)
    if (!sourceImage) continue
    const [, , right, bottom] = hotspot.rect
    if (right > sourceImage.width + 32 || bottom > sourceImage.height + 32) continue
    const cards = imageAssets.filter((asset) =>
      asset.topicPath === sourceImage.topicPath && /\d+(?:n|z)$/i.test(asset.id) && !/\d+0m$/i.test(asset.id),
    )
    if (!cards.length) continue
    const group = indirectByImage.get(sourceImage) || { cards, hotspots: [] }
    group.hotspots.push(hotspot)
    indirectByImage.set(sourceImage, group)
  }

  for (const [sourceImage, group] of indirectByImage) {
    let rgb
    try {
      ({ stdout: rgb } = await command('magick', [sourceFile(sourceImage), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
    } catch { continue }
    const titledCards = []
    for (const card of group.cards) titledCards.push({ card, title: await cardTitle(card) })
    for (const hotspot of group.hotspots) {
      const clippedRect = [
        hotspot.rect[0],
        hotspot.rect[1],
        Math.min(hotspot.rect[2], sourceImage.width),
        Math.min(hotspot.rect[3], sourceImage.height),
      ]
      if (clippedRect[2] <= clippedRect[0] || clippedRect[3] <= clippedRect[1]) continue

      const decoded = resolveIndirectAction(sourceImage.topicPath, hotspot.handlerOffset)
      if (decoded) {
        if (decoded.action === 'open') {
          const target = imageByTopicAndId.get(`${sourceImage.topicPath}/${decoded.target}`.toLowerCase())
          if (!target) continue
          const key = `${sourceImage.topicPath}/${sourceImage.id}/${clippedRect.join(',')}/open/${target.topicPath}/${target.id}`.toLowerCase()
          if (attached.has(key)) continue
          attached.add(key)
          sourceImage.hotspots ||= []
          sourceImage.hotspots.push({ rect: clippedRect, action: 'open', target: target.id, url: target.url })
        } else {
          const key = `${sourceImage.topicPath}/${sourceImage.id}/${clippedRect.join(',')}/navigate/${decoded.topicId}`.toLowerCase()
          if (attached.has(key)) continue
          attached.add(key)
          sourceImage.hotspots ||= []
          sourceImage.hotspots.push({
            rect: clippedRect,
            action: 'navigate',
            target: topicTitles[decoded.target] || decoded.target,
            topicId: decoded.topicId,
            url: `#/topic/${encodeURIComponent(decoded.topicId)}`,
          })
        }
        hotspotCount++
        continue
      }

      if (!hasRedInk(rgb, sourceImage.width, clippedRect)) continue
      const label = await ocrCrop(sourceFile(sourceImage), clippedRect)
      const principleCode = principleCrossReferences.get(normalizeHotspotLabel(label))
      const match = matchCardLabel(label, titledCards.map(({ card, title }) => ({ ...card, title })))
      if (!match) {
        if (principleCode) {
          const topicId = `PRINCIPL/${principleCode}`
          const key = `${sourceImage.topicPath}/${sourceImage.id}/${clippedRect.join(',')}/navigate/${topicId}`.toLowerCase()
          if (!attached.has(key)) {
            attached.add(key)
            sourceImage.hotspots ||= []
            sourceImage.hotspots.push({ rect: clippedRect, action: 'navigate', target: topicTitles[principleCode] || principleCode, topicId, url: `#/topic/${encodeURIComponent(topicId)}` })
            hotspotCount++
          }
          continue
        }
        const relatedId = `${sourceImage.id.replace(/0M$/i, '')}0J`
        const related = imageByTopicAndId.get(`${sourceImage.topicPath}/${relatedId}`.toLowerCase())
        const looksLikeSeeAlso = hotspot.rect[0] > sourceImage.width * .8 &&
          hotspot.rect[1] > sourceImage.height * .75 &&
          hotspot.rect[2] - hotspot.rect[0] > 40 &&
          hotspot.rect[3] - hotspot.rect[1] > 30
        if (!related || !looksLikeSeeAlso) continue
        const key = `${sourceImage.topicPath}/${sourceImage.id}/${clippedRect.join(',')}/open/${related.topicPath}/${related.id}`.toLowerCase()
        if (attached.has(key)) continue
        attached.add(key)
        sourceImage.hotspots ||= []
        sourceImage.hotspots.push({ rect: clippedRect, action: 'open', target: related.id, url: related.url })
        hotspotCount++
        continue
      }
      const key = `${sourceImage.topicPath}/${sourceImage.id}/${hotspot.rect.join(',')}/open/${match.topicPath}/${match.id}`.toLowerCase()
      if (attached.has(key)) continue
      attached.add(key)
      sourceImage.hotspots ||= []
      sourceImage.hotspots.push({ rect: hotspot.rect, action: 'open', target: match.id, url: match.url })
      hotspotCount++
    }
  }

  const topicNavigation = extractTopicNavigationHotspots(pengeBuffer, imageAssets.map((asset) => asset.id))
  const navigationBySource = Map.groupBy(topicNavigation, (hotspot) => hotspot.source.toLowerCase())
  for (const sourceImage of imageAssets.filter((asset) => /0M$/i.test(asset.id) && asset.topicPath.startsWith('ARTICLE'))) {
    const relatedId = `${sourceImage.id.replace(/0M$/i, '')}0J`
    const related = imageByTopicAndId.get(`${sourceImage.topicPath}/${relatedId}`.toLowerCase())
    if (!related) continue
    const candidates = navigationBySource.get(sourceImage.id.toLowerCase()) || []
    if (!candidates.length) continue
    let rgb
    try {
      ({ stdout: rgb } = await command('magick', [sourceFile(related), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
    } catch { continue }
    const groups = Map.groupBy(candidates.filter((hotspot) =>
      hotspot.rect[2] <= related.width && hotspot.rect[3] <= related.height && hasRedInk(rgb, related.width, hotspot.rect),
    ), (hotspot) => hotspot.handlerOffset)
    for (const hotspots of groups.values()) {
      const rect = [
        Math.min(...hotspots.map((hotspot) => hotspot.rect[0])),
        Math.min(...hotspots.map((hotspot) => hotspot.rect[1])),
        Math.max(...hotspots.map((hotspot) => hotspot.rect[2])),
        Math.max(...hotspots.map((hotspot) => hotspot.rect[3])),
      ]
      const label = await ocrCrop(sourceFile(related), rect)
      const match = matchCardLabel(label, articleTopics)
      if (!match) continue
      const key = `${related.topicPath}/${related.id}/${rect.join(',')}/navigate/${match.id}`.toLowerCase()
      if (attached.has(key)) continue
      attached.add(key)
      related.hotspots ||= []
      related.hotspots.push({ rect, action: 'navigate', target: match.title, topicId: match.id, url: `#/topic/${encodeURIComponent(match.id)}` })
      hotspotCount++
    }
  }

  const bookHotspots = extractBookNavigationHotspots(pengeBuffer, imageAssets.map((asset) => asset.id))
  const bookByImage = new Map()
  for (const hotspot of bookHotspots) {
    const sourceImage = (imagesById.get(hotspot.source.toLowerCase()) || []).find((asset) => asset.topicPath.startsWith('INVENTOR/'))
    if (!sourceImage || hotspot.rect[2] > sourceImage.width || hotspot.rect[3] > sourceImage.height) continue
    const group = bookByImage.get(sourceImage) || []
    group.push(hotspot)
    bookByImage.set(sourceImage, group)
  }
  for (const [sourceImage, hotspots] of bookByImage) {
    const attachedTabHandlers = new Set()
    for (const hotspot of hotspots) {
      const code = inventorTabHandlers.get(hotspot.handlerOffset)
      if (!code || attachedTabHandlers.has(hotspot.handlerOffset)) continue
      attachedTabHandlers.add(hotspot.handlerOffset)
      const topicId = `INVENTOR/${code}`
      const key = `${sourceImage.topicPath}/${sourceImage.id}/${hotspot.rect.join(',')}/navigate/${topicId}`.toLowerCase()
      if (attached.has(key)) continue
      attached.add(key)
      sourceImage.hotspots ||= []
      sourceImage.hotspots.push({
        rect: hotspot.rect,
        action: 'navigate',
        target: topicTitles[code] || code,
        topicId,
        url: `#/topic/${encodeURIComponent(topicId)}`,
      })
      hotspotCount++
    }

    let rgb
    try {
      ({ stdout: rgb } = await command('magick', [sourceFile(sourceImage), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
    } catch { continue }
    const matchedNavigation = []
    for (const hotspot of hotspots) {
      if (!hasRedInk(rgb, sourceImage.width, hotspot.rect)) continue
      const label = await ocrCrop(sourceFile(sourceImage), hotspot.rect)
      const match = matchCardLabel(label, articleTopics)
      if (!match) continue
      matchedNavigation.push({ hotspot, match })
    }
    const navigationByTarget = Map.groupBy(matchedNavigation, ({ match }) => match.id)
    for (const candidates of navigationByTarget.values()) {
      // Repeated book layouts differ by a pixel or two. The last authored
      // occurrence belongs to the final composited page represented by the DIB.
      const { hotspot, match } = candidates.sort((a, b) => a.hotspot.sourceOffset - b.hotspot.sourceOffset).at(-1)
      const key = `${sourceImage.topicPath}/${sourceImage.id}/${hotspot.rect.join(',')}/navigate/${match.id}`.toLowerCase()
      if (attached.has(key)) continue
      attached.add(key)
      sourceImage.hotspots ||= []
      sourceImage.hotspots.push({ rect: hotspot.rect, action: 'navigate', target: match.title, topicId: match.id, url: `#/topic/${encodeURIComponent(match.id)}` })
      hotspotCount++
    }
  }

  await rm(ocrDir, { recursive: true, force: true })
  if (hotspotCount !== 0) log(`Attached ${hotspotCount} authored hotspots.`)
  return { hotspotCount }
}
