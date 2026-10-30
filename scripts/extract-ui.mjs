#!/usr/bin/env node
// Pull the animation control artwork out of the original executable.
// TWTW.EXE is a 16-bit New Executable; its BITMAP resources hold the
// 74×22 rewind/play/progress strip the program painted into the blank
// slot of every card that has its own film, plus the button states.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cache = process.env.TWTW_CACHE || join(root, '.cache', 'twtw', 'raw')
const outDir = join(root, 'public', 'content', 'ui')

// Resource id → published name.
const WANTED = {
  101: 'anim-control',      // 74×22 strip: rewind, play, progress bar
  116: 'anim-play',         // 16×16 play button, up
  120: 'anim-play-down',    // play button, pressed
  119: 'anim-pause',        // pause button, shown while the film runs
  117: 'anim-rewind',       // 15×16 rewind button, up
  115: 'anim-rewind-down',  // rewind button, pressed
}

export function readNeBitmaps(exe) {
  const ne = exe.readUInt32LE(0x3c)
  if (exe.toString('latin1', ne, ne + 2) !== 'NE') throw new Error('Not a New Executable')
  const table = ne + exe.readUInt16LE(ne + 0x24)
  const shift = exe.readUInt16LE(table)
  const bitmaps = new Map()
  let p = table + 2
  while (exe.readUInt16LE(p)) {
    const type = exe.readUInt16LE(p)
    const count = exe.readUInt16LE(p + 2)
    p += 8
    for (let i = 0; i < count; i++, p += 12) {
      if (type !== 0x8002) continue
      const offset = exe.readUInt16LE(p) << shift
      const length = exe.readUInt16LE(p + 2) << shift
      const id = exe.readUInt16LE(p + 6)
      if (!(id & 0x8000)) continue
      const dib = exe.subarray(offset, offset + length)
      const headerSize = dib.readUInt32LE(0)
      const bitsPerPixel = dib.readUInt16LE(14)
      const paletteBytes = bitsPerPixel <= 8 ? (1 << bitsPerPixel) * 4 : 0
      const fileHeader = Buffer.alloc(14)
      fileHeader.write('BM', 0)
      fileHeader.writeUInt32LE(14 + length, 2)
      fileHeader.writeUInt32LE(14 + headerSize + paletteBytes, 10)
      bitmaps.set(id & 0x7fff, {
        width: dib.readInt32LE(4),
        height: dib.readInt32LE(8),
        bmp: Buffer.concat([fileHeader, dib]),
      })
    }
  }
  return bitmaps
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bitmaps = readNeBitmaps(await readFile(join(cache, 'DKCODE', 'TWTW.EXE')))
  await mkdir(outDir, { recursive: true })
  for (const [id, name] of Object.entries(WANTED)) {
    const bitmap = bitmaps.get(Number(id))
    if (!bitmap) throw new Error(`Bitmap ${id} missing from TWTW.EXE`)
    const bmp = join(outDir, `${name}.bmp`)
    await writeFile(bmp, bitmap.bmp)
    await run('magick', [bmp, join(outDir, `${name}.png`)])
    await run('rm', [bmp])
    console.log(`${name}.png ${bitmap.width}×${bitmap.height}`)
  }
}
