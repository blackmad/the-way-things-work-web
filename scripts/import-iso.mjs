#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { imageCompare, naturalCompare, SECTION_TITLES, sha256, titleFromOcr, topicPath, TOPIC_TITLES } from './import-utils.mjs'
import { attachAuthoredHotspots } from './hotspot-attach.mjs'
import { renderAni } from './render-ani.mjs'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iso = resolve(process.argv[2] || process.env.TWTW_ISO || '')
let cache = join(root, '.cache', 'twtw', 'raw')
const output = join(root, 'public', 'content')

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

  // Display titles come from the curated tables, with OCR of the main screen
  // as an optional fallback for topics that have no entry yet.
  const titles = new Map()
  for (const [path, topicImages] of Map.groupBy(assets.filter((asset) => asset.type === 'images'), (asset) => asset.topicPath)) {
    const code = path.split('/').at(-1)
    let title = TOPIC_TITLES[code] || SECTION_TITLES[code] || code
    const preferred = topicImages.find((item) => /0M$/i.test(item.id)) || topicImages[0]
    if (preferred && !SECTION_TITLES[code] && !TOPIC_TITLES[code]) {
      try {
        const imageFile = join(root, 'public', decodeURIComponent(preferred.url.slice(1)))
        const { stdout } = await command('tesseract', [imageFile, 'stdout', '--psm', '11'], { timeout: 20_000 })
        title = titleFromOcr(stdout, title)
      } catch { /* OCR is optional metadata enrichment. */ }
    }
    titles.set(path, title)
  }

  const pengeData = filesByPath.get(join(cache, 'DKCODE', 'TWTW.PNG').toLowerCase())
  let hotspotCount = 0
  let index = []
  if (pengeData) {
    ({ hotspotCount, index } = attachAuthoredHotspots({
      pengeBuffer: await readFile(pengeData),
      imageAssets: assets.filter((asset) => asset.type === 'images'),
      animationAssets: assets.filter((asset) => asset.type === 'animations'),
      audioAssets: assets.filter((asset) => asset.type === 'audio'),
      titleFor: (topicId) => titles.get(topicId) || topicId.split('/').at(-1),
      log: console.log,
    }))
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
    const title = titles.get(path) || TOPIC_TITLES[code] || SECTION_TITLES[code] || code
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
    index,
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
