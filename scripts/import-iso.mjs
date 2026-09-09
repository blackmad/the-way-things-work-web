#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { imageCompare, naturalCompare, SECTION_TITLES, sha256, titleFromOcr, topicPath, TOPIC_TITLES } from './import-utils.mjs'
import { renderAni } from './render-ani.mjs'
import { animationBaseId, extractBookNavigationHotspots, extractIndirectHotspots, extractMediaHotspots, extractTopicNavigationHotspots, matchCardLabel, normalizeHotspotLabel, resolveIndirectAction } from './png-hotspots.mjs'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iso = resolve(process.argv[2] || process.env.TWTW_ISO || '')
let cache = join(root, '.cache', 'twtw', 'raw')
const output = join(root, 'public', 'content')

// The Inventors book's alphabet tabs use shared compiled handlers. Keeping the
// handler mapping here lets us retain each page's authored rectangle rather than
// laying an approximate HTML alphabet over the scanned artwork.
const INVENTOR_TAB_HANDLERS = new Map([
  [148566, 'A'],
  [153534, 'B'],
  [161482, 'C'],
  [168618, 'D'],
  [172870, 'E'],
  [177314, 'F'],
  [184290, 'G'],
  [189578, 'H'],
  [194994, 'IJK'],
  [201746, 'L'],
  [207034, 'M'],
  [211394, 'NO'],
  [216770, 'PQ'],
  [223554, 'R'],
  [229718, 'S'],
  [233574, 'TUV'],
  [240198, 'W'],
  [241202, 'XYZ'],
  [243574, 'MISC'],
])

const PRINCIPLE_CROSS_REFERENCES = new Map([
  ['current', 'QELE'],
  ['heat', 'QHEA'],
  ['heats', 'QHEA'],
  ['buoyant', 'QFLO'],
  ['buoyancy', 'QFLO'],
  ['dense', 'QFLO'],
  ['density', 'QFLO'],
  ['lessdense', 'QFLO'],
])

async function command(program, args, options = {}) {
  try {
    return await exec(program, args, { maxBuffer: 16 * 1024 * 1024, ...options })
  } catch (error) {
    const detail = error.stderr?.trim() || error.message
    throw new Error(`${program} failed: ${detail}`)
  }
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return nested.flat()
}

async function mapLimit(values, limit, task) {
  let cursor = 0
  const workers = Array.from({ length: limit }, async () => {
    while (cursor < values.length) {
      const index = cursor++
      await task(values[index], index)
    }
  })
  await Promise.all(workers)
}

function urlPath(path) {
  return `/${relative(join(root, 'public'), path).split(sep).map(encodeURIComponent).join('/')}`
}

async function dimensions(file) {
  const { stdout } = await command('magick', ['identify', '-format', '%w %h', file])
  const [width, height] = stdout.trim().split(' ').map(Number)
  return { width, height }
}

async function isBitmap(file) {
  if (extname(file).toUpperCase() === '.DIB') return true
  const handle = await readFile(file)
  return handle.length > 2 && handle[0] === 0x42 && handle[1] === 0x4d
}

function mediaId(source) {
  return basename(source, extname(source))
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

function animationBase(file, filesByPath, bitmapsByName) {
  const id = basename(file, extname(file))
  if (id.length < 3) return null
  const baseId = id.slice(0, -2)
  const expected = join(dirname(file), `${baseId}.DIB`).toLowerCase()
  const exact = filesByPath.get(expected)
  if (exact) return { path: exact, inferred: false }
  const global = bitmapsByName.get(`${baseId}.dib`.toLowerCase())
  if (global) return { path: global, inferred: true }
  const aliases = {
    BEL0Z: 'BELL0Z',
    NAVB0M: 'NAV',
    QHEA2Z: 'QHEA2X',
    QHEA3Z: 'QHEA3X',
    QSNDOZ: 'QSND0Z',
    TELE1X: 'TELE0X',
    TITL2M: 'TITL1M',
  }
  const alias = aliases[baseId]
  const inferred = alias && bitmapsByName.get(`${alias}.dib`.toLowerCase())
  return inferred ? { path: inferred, inferred: true } : null
}

async function main() {
  if (!process.argv[2] && !process.env.TWTW_ISO) {
    throw new Error('Usage: npm run import -- /absolute/path/to/disc.iso')
  }
  const input = await stat(iso)
  const extractedInput = input.isDirectory()
  if (extractedInput) cache = iso
  await mkdir(dirname(cache), { recursive: true })
  if (!extractedInput) await rm(cache, { recursive: true, force: true })
  await rm(output, { recursive: true, force: true })
  if (!extractedInput) await mkdir(cache, { recursive: true })
  await mkdir(output, { recursive: true })

  if (extractedInput) {
    console.log('Using previously extracted CD-ROM files…')
  } else {
    console.log('Extracting ISO…')
    await command('7z', ['x', '-y', `-o${cache}`, iso])
  }
  const files = await walk(cache)
  const filesByPath = new Map(files.map((file) => [file.toLowerCase(), file]))
  const bitmapsByName = new Map(files.filter((file) => extname(file).toUpperCase() === '.DIB').map((file) => [basename(file).toLowerCase(), file]))
  const candidates = []
  for (const file of files) {
    const ext = extname(file).toUpperCase()
    if (ext === '.ANI') candidates.push({ type: 'animations', file })
    else if (ext === '.WAV') candidates.push({ type: 'audio', file })
    else if (await isBitmap(file)) candidates.push({ type: 'images', file })
  }

  const assets = []
  let completed = 0
  await mapLimit(candidates, Math.max(2, Math.min(8, Number(process.env.TWTW_JOBS) || 6)), async ({ type, file }) => {
    const source = relative(cache, file).split(sep).join('/')
    const sourceWithoutExtension = source.slice(0, source.length - extname(source).length)
    let target
    let metadata = {}
    if (type === 'images') {
      target = join(output, 'images', `${sourceWithoutExtension}.webp`)
      await mkdir(dirname(target), { recursive: true })
      metadata = await dimensions(file)
      await command('magick', [file, '-define', 'webp:lossless=true', target])
    } else if (type === 'audio') {
      target = join(output, 'audio', `${sourceWithoutExtension}.mp3`)
      await mkdir(dirname(target), { recursive: true })
      await command('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-i', file, '-codec:a', 'libmp3lame', '-q:a', '3', target])
    } else {
      const archiveTarget = join(output, 'animations-original', `${sourceWithoutExtension}.ani`)
      await mkdir(dirname(archiveTarget), { recursive: true })
      await copyFile(file, archiveTarget)
      const base = animationBase(file, filesByPath, bitmapsByName)
      if (base) {
        target = join(output, 'animations', `${sourceWithoutExtension}.webm`)
        try {
          metadata = {
            playable: true,
            archiveUrl: urlPath(archiveTarget),
            inferredBase: base.inferred,
            baseId: mediaId(base.path),
            ...(await renderAni({ aniPath: file, basePath: base.path, outputPath: target })),
          }
        } catch (error) {
          console.warn(`\nCould not render ${source}: ${error.message}`)
          await rm(target, { force: true })
          target = archiveTarget
          metadata = { playable: false }
        }
      } else {
        target = archiveTarget
        metadata = { playable: false }
      }
    }
    const info = await stat(target)
    assets.push({
      type,
      topicPath: topicPath(source),
      id: mediaId(source),
      source,
      url: urlPath(target),
      bytes: info.size,
      ...metadata,
    })
    completed++
    if (completed % 100 === 0 || completed === candidates.length) {
      process.stdout.write(`\rConverted ${completed}/${candidates.length}`)
    }
  })
  process.stdout.write('\n')

  const pengeData = filesByPath.get(join(cache, 'DKCODE', 'TWTW.PNG').toLowerCase())
  let hotspotCount = 0
  const inferredTopicTitles = new Map()
  if (pengeData) {
    const animationAssets = assets.filter((asset) => asset.type === 'animations')
    const imageAssets = assets.filter((asset) => asset.type === 'images')
    const imageByTopicAndId = new Map(imageAssets.map((asset) => [
      `${asset.topicPath}/${asset.id}`.toLowerCase(), asset,
    ]))
    const imagesById = Map.groupBy(imageAssets, (asset) => asset.id.toLowerCase())
    const animationsById = Map.groupBy(animationAssets, (asset) => asset.id.toLowerCase())
    const authored = extractMediaHotspots(await readFile(pengeData), {
      animationIds: animationAssets.map((asset) => asset.id),
      imageIds: imageAssets.map((asset) => asset.id),
    })
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
      if (!sourceImage || !target) continue
      const [left, top, right, bottom] = hotspot.rect
      if (right > sourceImage.width + 16 || bottom > sourceImage.height + 16) continue
      const key = `${sourceImage.topicPath}/${sourceImage.id}/${hotspot.rect.join(',')}/${hotspot.action}/${target.topicPath}/${target.id}`.toLowerCase()
      if (attached.has(key)) continue
      attached.add(key)
      sourceImage.hotspots ||= []
      sourceImage.hotspots.push({ rect: hotspot.rect, action: hotspot.action, target: target.id, url: target.url })
      hotspotCount++
    }

    const ocrDir = join(root, '.cache', 'twtw', 'hotspot-ocr')
    await rm(ocrDir, { recursive: true, force: true })
    await mkdir(ocrDir, { recursive: true })
    let ocrSequence = 0
    async function ocrCrop(file, rect, scale = '600%', pageSegmentation = '7', threshold = '70%') {
      const [left, top, right, bottom] = rect
      const target = join(ocrDir, `${ocrSequence++}.png`)
      await command('magick', [file, '-crop', `${right - left}x${bottom - top}+${left}+${top}`, '-resize', scale, '-colorspace', 'gray', '-threshold', threshold, target])
      try {
        const { stdout } = await command('tesseract', [target, 'stdout', '--psm', pageSegmentation], { timeout: 20_000 })
        return stdout.split(/\r?\n/).map((line) => line.replace(/[^A-Za-z0-9 &'’-]/g, '').trim()).find((line) => /[A-Za-z]{3}/.test(line)) || ''
      } catch {
        return ''
      }
    }
    const cardTitleCache = new Map()
    async function cardTitle(card) {
      if (cardTitleCache.has(card.url)) return cardTitleCache.get(card.url)
      const file = join(root, 'public', decodeURIComponent(card.url.slice(1)))
      const title = await ocrCrop(file, [8, 2, card.width - 8, Math.min(card.height, 24)], '800%', '7', '62%')
      cardTitleCache.set(card.url, title)
      return title
    }

    const articleTopics = []
    for (const [id, topicImages] of Map.groupBy(imageAssets.filter((asset) => asset.topicPath.startsWith('ARTICLE')), (asset) => asset.topicPath)) {
      const code = id.split('/').at(-1)
      let title = TOPIC_TITLES[code]
      if (!title) {
        const preferred = topicImages.find((item) => /0M$/i.test(item.id)) || topicImages[0]
        try {
          const { stdout } = await command('tesseract', [join(root, 'public', decodeURIComponent(preferred.url.slice(1))), 'stdout', '--psm', '11'], { timeout: 20_000 })
          title = titleFromOcr(stdout, code)
        } catch { title = code }
      }
      inferredTopicTitles.set(id, title)
      articleTopics.push({ id, title })
    }

    const indirect = extractIndirectHotspots(await readFile(pengeData), [...imageAssets, ...animationAssets].map((asset) => asset.id))
    const indirectByImage = new Map()
    for (const hotspot of indirect) {
      const sourceAnimation = (animationsById.get(hotspot.source.toLowerCase()) || []).find((asset) =>
        imageByTopicAndId.has(`${asset.topicPath}/${asset.baseId || animationBaseId(asset.id)}`.toLowerCase()),
      )
      const sourceImage = sourceAnimation
        ? imageByTopicAndId.get(`${sourceAnimation.topicPath}/${sourceAnimation.baseId || animationBaseId(sourceAnimation.id)}`.toLowerCase())
        : (imagesById.get(hotspot.source.toLowerCase()) || [])[0]
      if (!sourceImage) continue
      const [, , right, bottom] = hotspot.rect
      // Some authored controls intentionally overhang the 544×432 stage (the
      // mammoth's SEE ALSO placard is the common example). Retain a modest
      // overhang and clip it when emitting the browser hit area.
      if (right > sourceImage.width + 32 || bottom > sourceImage.height + 32) continue
      const cards = imageAssets.filter((asset) => asset.topicPath === sourceImage.topicPath && /\d+n$/i.test(asset.id))
      if (!cards.length) continue
      const group = indirectByImage.get(sourceImage) || { cards, hotspots: [] }
      group.hotspots.push(hotspot)
      indirectByImage.set(sourceImage, group)
    }

    for (const [sourceImage, group] of indirectByImage) {
      let rgb
      try {
        ({ stdout: rgb } = await command('magick', [join(cache, sourceImage.source), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
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
              target: TOPIC_TITLES[decoded.target] || decoded.target,
              topicId: decoded.topicId,
              url: `#/topic/${encodeURIComponent(decoded.topicId)}`,
            })
          }
          hotspotCount++
          continue
        }

        if (!hasRedInk(rgb, sourceImage.width, clippedRect)) continue
        const label = await ocrCrop(join(cache, sourceImage.source), clippedRect)
        const principleCode = PRINCIPLE_CROSS_REFERENCES.get(normalizeHotspotLabel(label))
        const match = matchCardLabel(label, titledCards.map(({ card, title }) => ({ ...card, title })))
        if (!match) {
          if (principleCode) {
            const topicId = `PRINCIPL/${principleCode}`
            const key = `${sourceImage.topicPath}/${sourceImage.id}/${clippedRect.join(',')}/navigate/${topicId}`.toLowerCase()
            if (!attached.has(key)) {
              attached.add(key)
              sourceImage.hotspots ||= []
              sourceImage.hotspots.push({ rect: clippedRect, action: 'navigate', target: TOPIC_TITLES[principleCode] || principleCode, topicId, url: `#/topic/${encodeURIComponent(topicId)}` })
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

    const topicNavigation = extractTopicNavigationHotspots(await readFile(pengeData), imageAssets.map((asset) => asset.id))
    const navigationBySource = Map.groupBy(topicNavigation, (hotspot) => hotspot.source.toLowerCase())
    for (const sourceImage of imageAssets.filter((asset) => /0M$/i.test(asset.id) && asset.topicPath.startsWith('ARTICLE'))) {
      const relatedId = `${sourceImage.id.replace(/0M$/i, '')}0J`
      const related = imageByTopicAndId.get(`${sourceImage.topicPath}/${relatedId}`.toLowerCase())
      if (!related) continue
      const candidates = navigationBySource.get(sourceImage.id.toLowerCase()) || []
      if (!candidates.length) continue
      let rgb
      try {
        ({ stdout: rgb } = await command('magick', [join(cache, related.source), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
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
        const label = await ocrCrop(join(cache, related.source), rect)
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

    const bookHotspots = extractBookNavigationHotspots(await readFile(pengeData), imageAssets.map((asset) => asset.id))
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
        const code = INVENTOR_TAB_HANDLERS.get(hotspot.handlerOffset)
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
          target: TOPIC_TITLES[code] || code,
          topicId,
          url: `#/topic/${encodeURIComponent(topicId)}`,
        })
        hotspotCount++
      }

      let rgb
      try {
        ({ stdout: rgb } = await command('magick', [join(cache, sourceImage.source), '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 }))
      } catch { continue }
      const matchedNavigation = []
      for (const hotspot of hotspots) {
        if (!hasRedInk(rgb, sourceImage.width, hotspot.rect)) continue
        const label = await ocrCrop(join(cache, sourceImage.source), hotspot.rect)
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
  }

  const topicGroups = new Map()
  for (const asset of assets) {
    const group = topicGroups.get(asset.topicPath) || { images: [], animations: [], audio: [] }
    const { type, topicPath: _, ...publicAsset } = asset
    group[type].push(publicAsset)
    topicGroups.set(asset.topicPath, group)
  }

  const topics = []
  for (const [path, media] of topicGroups) {
    media.images.sort(imageCompare)
    media.animations.sort((a, b) => naturalCompare(a.id, b.id))
    media.audio.sort((a, b) => naturalCompare(a.id, b.id))
    const code = path.split('/').at(-1)
    let title = TOPIC_TITLES[code] || SECTION_TITLES[code] || inferredTopicTitles.get(path) || code
    const preferred = media.images.find((item) => /0M$/i.test(item.id)) || media.images[0]
    if (preferred && !SECTION_TITLES[code] && !TOPIC_TITLES[code]) {
      try {
        const imageFile = join(root, 'public', decodeURIComponent(preferred.url.slice(1)))
        const { stdout } = await command('tesseract', [imageFile, 'stdout', '--psm', '11'], { timeout: 20_000 })
        title = titleFromOcr(stdout, title)
      } catch { /* OCR is optional metadata enrichment. */ }
    }
    topics.push({
      id: path,
      code,
      title,
      sourcePath: path,
      ...media,
    })
  }

  const sectionGroups = new Map()
  for (const topic of topics) {
    const id = topic.id.split('/')[0]
    const section = sectionGroups.get(id) || { id, title: SECTION_TITLES[id] || id, topics: [] }
    section.topics.push(topic)
    sectionGroups.set(id, section)
  }
  const sections = [...sectionGroups.values()]
    .sort((a, b) => naturalCompare(a.title, b.title))
    .map((section) => ({ ...section, topics: section.topics.sort((a, b) => naturalCompare(a.title, b.title)) }))

  const manifest = {
    schemaVersion: 1,
    source: {
      label: process.env.TWTW_SOURCE_LABEL || (extractedInput ? 'TWTW.PNG from extracted CD-ROM' : basename(iso)),
      sha256: process.env.TWTW_SOURCE_SHA256 || await sha256(extractedInput ? pengeData : iso),
    },
    generatedAt: new Date().toISOString(),
    totals: {
      topics: topics.length,
      images: assets.filter((asset) => asset.type === 'images').length,
      animations: assets.filter((asset) => asset.type === 'animations').length,
      audio: assets.filter((asset) => asset.type === 'audio').length,
      hotspots: hotspotCount,
    },
    sections,
  }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Imported ${manifest.totals.topics} topics, ${assets.length} media assets, and ${hotspotCount} authored hotspots.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
