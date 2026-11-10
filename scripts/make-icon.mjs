// Draws media/icon.png (128x128): two arrows, request and response, on a
// rounded square. Run with `node scripts/make-icon.mjs`; the PNG is committed.
import {writeFileSync} from 'node:fs'
import {deflateSync} from 'node:zlib'

const SIZE = 128
const SAMPLES = 4
const scale = SIZE / 24

// Same geometry as media/restly.svg, in its 24-unit grid.
const segments = [
  [4, 8, 17, 8],
  [13.5, 4.5, 17, 8],
  [17, 8, 13.5, 11.5],
  [20, 16, 7, 16],
  [10.5, 12.5, 7, 16],
  [7, 16, 10.5, 19.5]
].map((s) => s.map((v) => v * scale))
const stroke = 1.1 * scale

function distToSegment(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

function insideRoundedRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), SIZE - r)
  const cy = Math.min(Math.max(y, r), SIZE - r)
  return Math.hypot(x - cx, y - cy) <= r
}

const pixels = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let bg = 0
    let fg = 0
    for (let sy = 0; sy < SAMPLES; sy++) {
      for (let sx = 0; sx < SAMPLES; sx++) {
        const px = x + (sx + 0.5) / SAMPLES
        const py = y + (sy + 0.5) / SAMPLES
        if (!insideRoundedRect(px, py, 26)) continue
        bg++
        if (segments.some((s) => distToSegment(px, py, s) <= stroke)) fg++
      }
    }
    const n = SAMPLES * SAMPLES
    const t = (x + y) / (2 * SIZE)
    // Background: blue to teal diagonal gradient.
    const br = 37 + (20 - 37) * t
    const bgG = 99 + (184 - 99) * t
    const bb = 235 + (166 - 235) * t
    const f = bg ? fg / bg : 0
    const i = (y * SIZE + x) * 4
    pixels[i] = Math.round(br + (255 - br) * f)
    pixels[i + 1] = Math.round(bgG + (255 - bgG) * f)
    pixels[i + 2] = Math.round(bb + (255 - bb) * f)
    pixels[i + 3] = Math.round((bg / n) * 255)
  }
}

const crcTable = Array.from({length: 256}, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4)
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])
writeFileSync(new URL('../media/icon.png', import.meta.url), png)
console.log(`wrote media/icon.png (${png.length} bytes)`)
