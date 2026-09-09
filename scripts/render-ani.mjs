#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { compositePatch, dibInfo, parseAni } from './ani-codec.mjs'

const exec = promisify(execFile)

async function decodedBase(basePath, expectedBytes) {
  const { stdout } = await exec('magick', [basePath, '-alpha', 'off', '-depth', '8', 'rgb:-'], {
    encoding: 'buffer',
    maxBuffer: expectedBytes + 1024,
  })
  if (stdout.length !== expectedBytes) {
    throw new Error(`ImageMagick returned ${stdout.length} bytes for a ${expectedBytes}-byte base image`)
  }
  return Buffer.from(stdout)
}

export async function renderAni({ aniPath, basePath, outputPath }) {
  const [aniBuffer, dibBuffer] = await Promise.all([readFile(aniPath), readFile(basePath)])
  const animation = parseAni(aniBuffer)
  const base = dibInfo(dibBuffer)
  const baseFrame = await decodedBase(basePath, base.width * base.height * 3)
  const canvasWidth = Math.max(base.width, ...animation.records.map((record) => record.rect?.right || 0))
  const canvasHeight = Math.max(base.height, ...animation.records.map((record) => record.rect?.bottom || 0))
  const frame = Buffer.alloc(canvasWidth * canvasHeight * 3, 255)
  for (let y = 0; y < base.height; y++) {
    baseFrame.copy(frame, y * canvasWidth * 3, y * base.width * 3, (y + 1) * base.width * 3)
  }
  const audio = Buffer.concat(animation.records.map((record) => record.audio))
  const scratch = await mkdtemp(join(tmpdir(), 'twtw-ani-'))
  const audioPath = join(scratch, 'audio.u8')
  await mkdir(dirname(outputPath), { recursive: true })

  try {
    if (audio.length) await writeFile(audioPath, audio)
    const args = [
      '-nostdin', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pixel_format', 'rgb24',
      '-video_size', `${canvasWidth}x${canvasHeight}`,
      '-framerate', String(animation.header.framesPerSecond),
      '-i', 'pipe:0',
    ]
    if (audio.length) {
      args.push('-f', 'u8', '-ar', String(animation.header.audio.sampleRate), '-ac', '1', '-i', audioPath)
    }
    args.push(
      '-map', '0:v:0',
      ...(audio.length ? ['-map', '1:a:0'] : []),
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
      '-c:v', 'libvpx-vp9', '-crf', '18', '-b:v', '0', '-pix_fmt', 'yuv420p',
      '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1',
      ...(audio.length ? ['-c:a', 'libopus', '-b:a', '64k'] : []),
      outputPath,
    )

    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stdin.on('error', () => { /* Reported through the child exit code. */ })
    const processClosed = once(child, 'close')
    try {
      for (const record of animation.records) {
        compositePatch(frame, canvasWidth, canvasHeight, record, base.palette)
        if (!child.stdin.write(frame)) {
          await Promise.race([
            once(child.stdin, 'drain'),
            processClosed.then(([code]) => { throw new Error(`ffmpeg closed early with ${code}: ${stderr.trim()}`) }),
          ])
        }
      }
      child.stdin.end()
      const [exitCode] = await processClosed
      if (exitCode !== 0) throw new Error(`ffmpeg exited with ${exitCode}: ${stderr.trim()}`)
    } catch (error) {
      child.stdin.destroy()
      if (child.exitCode === null) child.kill('SIGTERM')
      await processClosed.catch(() => {})
      throw error
    }
    return {
      width: canvasWidth,
      height: canvasHeight,
      frames: animation.records.length,
      framesPerSecond: animation.header.framesPerSecond,
      duration: Math.max(animation.records.length / animation.header.framesPerSecond, audio.length / animation.header.audio.sampleRate),
      audioBytes: audio.length,
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

async function main() {
  const [aniPath, basePath, outputPath] = process.argv.slice(2).map((value) => value && resolve(value))
  if (!aniPath || !basePath || !outputPath) {
    throw new Error('Usage: node scripts/render-ani.mjs input.ANI base.DIB output.webm')
  }
  console.log(await renderAni({ aniPath, basePath, outputPath }))
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
