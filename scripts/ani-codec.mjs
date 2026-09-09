const MARKER = Buffer.from('funky!')

function assertAvailable(buffer, offset, bytes, label) {
  if (offset < 0 || offset + bytes > buffer.length) {
    throw new Error(`${label} extends beyond the ANI file at byte ${offset}`)
  }
}

export function decodeFunkyRle(packed, expectedLength) {
  const decoded = Buffer.allocUnsafe(expectedLength)
  let input = 0
  let output = 0

  while (input < packed.length && output < decoded.length) {
    const control = packed[input++]
    if (control & 0x80) {
      const count = control & 0x7f
      assertAvailable(packed, input, count, 'Literal run')
      if (output + count > decoded.length) throw new Error('Literal run exceeds decoded rectangle')
      packed.copy(decoded, output, input, input + count)
      input += count
      output += count
    } else {
      assertAvailable(packed, input, 1, 'Repeated run')
      const value = packed[input++]
      if (output + control > decoded.length) throw new Error('Repeated run exceeds decoded rectangle')
      decoded.fill(value, output, output + control)
      output += control
    }
  }

  const trailingPadding = packed.subarray(input)
  const hasOnlyWordPadding = trailingPadding.length === 0
    || (trailingPadding.length === 2 && (trailingPadding[0] === 0x81 || trailingPadding[0] === 0x01))
  if ((!hasOnlyWordPadding && input !== packed.length) || output !== expectedLength) {
    throw new Error(`RLE length mismatch: consumed ${input}/${packed.length}, decoded ${output}/${expectedLength}`)
  }
  return decoded
}

export function parseAni(buffer) {
  assertAvailable(buffer, 0, 30, 'ANI header')
  const header = {
    version: buffer.readUInt16LE(0),
    declaredFrames: buffer.readUInt16LE(2),
    flags: buffer.readUInt16LE(4),
    framesPerSecond: buffer.readUInt16LE(6),
    reserved: [...buffer.subarray(8, 14)],
    audio: {
      format: buffer.readUInt16LE(14),
      channels: buffer.readUInt16LE(16),
      sampleRate: buffer.readUInt32LE(18),
      bytesPerSecond: buffer.readUInt32LE(22),
      blockAlign: buffer.readUInt16LE(26),
      bitsPerSample: buffer.readUInt16LE(28),
    },
  }
  if (header.version !== 1) throw new Error(`Unsupported ANI version ${header.version}`)
  if (header.audio.format !== 1 || header.audio.channels !== 1 || header.audio.bitsPerSample !== 8) {
    throw new Error('Only the observed mono 8-bit PCM ANI audio format is supported')
  }
  if (!header.framesPerSecond) throw new Error('ANI frame rate is zero')

  const records = []
  let cursor = 30
  while (cursor < buffer.length) {
    assertAvailable(buffer, cursor, 28, 'ANI record')
    const recordVersion = buffer.readUInt16LE(cursor)
    const audioLength = buffer.readUInt32LE(cursor + 2)
    const left = buffer.readUInt16LE(cursor + 6)
    const top = buffer.readUInt16LE(cursor + 8)
    const right = buffer.readUInt16LE(cursor + 10)
    const bottom = buffer.readUInt16LE(cursor + 12)
    const decodedLength = buffer.readUInt32LE(cursor + 14)
    const packedLength = buffer.readUInt32LE(cursor + 18)
    const markerOffset = cursor + 22
    if (!buffer.subarray(markerOffset, markerOffset + MARKER.length).equals(MARKER)) {
      throw new Error(`Missing funky! marker at byte ${markerOffset}`)
    }
    const audioStart = markerOffset + MARKER.length
    const pixelsStart = audioStart + audioLength
    const next = pixelsStart + packedLength
    assertAvailable(buffer, audioStart, audioLength + packedLength, 'ANI record payload')

    let pixels = null
    const width = right - left
    const height = bottom - top
    const stride = width + (width & 1)
    if (packedLength || decodedLength) {
      if (right <= left || bottom <= top || stride * height !== decodedLength) {
        throw new Error(`Invalid ANI rectangle ${left},${top}–${right},${bottom} (${decodedLength} pixels)`)
      }
      pixels = decodeFunkyRle(buffer.subarray(pixelsStart, next), decodedLength)
    }
    records.push({
      version: recordVersion,
      audio: buffer.subarray(audioStart, pixelsStart),
      rect: pixels ? { left, top, right, bottom, width, height, stride } : null,
      pixels,
      packedLength,
    })
    cursor = next
  }
  if (cursor !== buffer.length) throw new Error(`ANI parsing ended at ${cursor}/${buffer.length}`)
  return { header, records }
}

export function dibInfo(buffer) {
  if (buffer.subarray(0, 2).toString('ascii') !== 'BM') throw new Error('Animation base is not a Windows bitmap')
  const width = buffer.readInt32LE(18)
  const signedHeight = buffer.readInt32LE(22)
  const bits = buffer.readUInt16LE(28)
  const colorsUsed = buffer.readUInt32LE(46) || 2 ** bits
  if (bits !== 8) throw new Error(`Expected an 8-bit animation base, received ${bits}-bit`)
  const paletteOffset = 14 + buffer.readUInt32LE(14)
  assertAvailable(buffer, paletteOffset, colorsUsed * 4, 'DIB palette')
  const palette = Array.from({ length: colorsUsed }, (_, index) => {
    const offset = paletteOffset + index * 4
    return [buffer[offset + 2], buffer[offset + 1], buffer[offset]]
  })
  return { width, height: Math.abs(signedHeight), palette }
}

export function compositePatch(frame, frameWidth, frameHeight, record, palette) {
  if (!record.pixels || !record.rect) return frame
  const { left, top, width, height, stride, right, bottom } = record.rect
  if (left < 0 || top < 0 || right > frameWidth || bottom > frameHeight) {
    throw new Error(`ANI patch ${left},${top}–${right},${bottom} exceeds ${frameWidth}×${frameHeight} base`)
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = record.pixels[y * stride + x]
      // Palette index zero is the format's transparent/no-change value.
      if (index === 0) continue
      const color = palette[index]
      if (!color) throw new Error(`ANI references missing palette index ${index}`)
      const target = ((top + y) * frameWidth + left + x) * 3
      frame[target] = color[0]
      frame[target + 1] = color[1]
      frame[target + 2] = color[2]
    }
  }
  return frame
}
