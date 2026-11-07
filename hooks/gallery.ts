// Gallery: every image in the project folder, as thumbnails.
//
// The scan walks the session's folder (skipping node_modules, .git and build output).
// Thumbnails are small JPEGs made with ffmpeg into %LOCALAPPDATA%\g-hub\thumbs, keyed by
// path and modified time, and drawn as base64 inside one small SVG per tile. Without
// ffmpeg, small images are embedded as they are and the rest get a labelled tile.

import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { MONO, SURFACE_CSS, fit, size, xml } from './theme'

// The state values this file writes (atoms are kept per file).
const galStamp = atom({ plugin: 'g-hub', key: 'galStamp' } as const, 0)

export type GalItem = { path: string; name: string; folder: string; bytes: number; mtime: number }

const IMAGE = /\.(png|jpe?g|webp|gif)$/i
const SKIP = new Set(['node_modules', '.git', '.cache', 'build', 'dist', '.next', 'out-tmp'])
const MAX_FILES = 3000
const MAX_DEPTH = 6
const THUMB = 160
const PREVIEW = 480
const EMBED_MAX = 60 * 1024

/** The module's own memory of the scan; a reload scans again. */
const mem: {
  root?: string
  items: GalItem[]
  scannedAt?: number
  scanning?: boolean
  ffmpeg?: string | null
  cacheDir?: string
  thumbs: Map<string, string>
  previews: Map<string, string>
  failed: Set<string>
} = { items: [], thumbs: new Map(), previews: new Map(), failed: new Set() }

export function galleryItems(): GalItem[] {
  return mem.items
}
export function galleryScannedAt(): number | undefined {
  return mem.scannedAt
}
export function isScanning(): boolean {
  return Boolean(mem.scanning)
}
export function thumbOf(p: string): string | undefined {
  return mem.thumbs.get(p)
}
export function previewOf(p: string): string | undefined {
  return mem.previews.get(p)
}

function hashKey(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

async function tools($: EngineInterface): Promise<void> {
  if (mem.cacheDir === undefined) {
    const env = await $.process.run(['cmd', '/c', 'echo %LOCALAPPDATA%'])
    mem.cacheDir = `${env.stdout.trim().replace(/\\/g, '/')}/g-hub/thumbs`
    await $.fs.write(`${mem.cacheDir}/.keep`, '')
  }
  if (mem.ffmpeg === undefined) {
    const where = await $.process.run(['cmd', '/c', 'where ffmpeg'])
    mem.ffmpeg = where.stdout.split(/\r?\n/).find(l => l.trim().toLowerCase().endsWith('ffmpeg.exe'))?.trim() ?? null
  }
}

/** Walks the project folder for images. Runs again after a minute, or when asked. */
export async function scanGallery($: EngineInterface, force = false): Promise<void> {
  const root = (await $.session.cwd()).replace(/\\/g, '/')
  if (mem.scanning) return
  if (!force && mem.root === root && mem.scannedAt && Date.now() - mem.scannedAt < 60_000) return
  mem.scanning = true
  await update($, galStamp, n => n + 1)
  try {
    const found: GalItem[] = []
    let level = [root]
    for (let depth = 0; depth <= MAX_DEPTH && level.length && found.length < MAX_FILES; depth++) {
      const next: string[] = []
      for (const dir of level) {
        let list
        try {
          list = await $.fs.list(dir)
        } catch {
          continue
        }
        for (const f of list) {
          const p = `${dir}/${f.name}`
          if (f.kind === 'dir') {
            if (!SKIP.has(f.name) && !f.name.startsWith('.')) next.push(p)
          } else if (f.kind === 'file' && IMAGE.test(f.name)) {
            const rel = p.slice(root.length + 1)
            found.push({ path: p, name: f.name, folder: rel.includes('/') ? (rel.split('/')[0] as string) : '(top)', bytes: f.size, mtime: f.mtimeMs })
            if (found.length >= MAX_FILES) break
          }
        }
      }
      level = next
    }
    mem.root = root
    mem.items = found
    mem.scannedAt = Date.now()
  } finally {
    mem.scanning = false
    await update($, galStamp, n => n + 1)
  }
  // the first page in the default order gets its thumbnails right away
  await ensureThumbs($, [...mem.items].sort((a, b) => b.mtime - a.mtime).slice(0, 12))
}

/** Makes (or reads from the cache) the thumbnails for these items, then redraws once. */
export async function ensureThumbs($: EngineInterface, list: GalItem[]): Promise<void> {
  const todo = list.filter(x => !mem.thumbs.has(x.path) && !mem.failed.has(x.path))
  if (todo.length === 0) return
  await tools($)
  for (const x of todo) {
    try {
      const data = await thumbData($, x, THUMB, 'jpg')
      if (data) mem.thumbs.set(x.path, data)
      else mem.failed.add(x.path)
    } catch {
      mem.failed.add(x.path)
    }
  }
  await update($, galStamp, n => n + 1)
}

/** A larger preview for the selected image. */
export async function ensurePreview($: EngineInterface, x: GalItem): Promise<void> {
  if (mem.previews.has(x.path)) return
  await tools($)
  try {
    const data = await thumbData($, x, PREVIEW, 'jpg')
    if (data) mem.previews.set(x.path, data)
  } catch {
    // the tile stays as it is
  }
  await update($, galStamp, n => n + 1)
}

/** A data URI for the image at `width`: ffmpeg into the cache, or the file itself when small. */
async function thumbData($: EngineInterface, x: GalItem, width: number, ext: string): Promise<string | undefined> {
  if (mem.ffmpeg && mem.cacheDir) {
    const out = `${mem.cacheDir}/${hashKey(`${x.path}|${x.mtime}|${width}`)}.${ext}`
    if (!(await $.fs.exists(out))) {
      const r = await $.process.run([mem.ffmpeg, '-y', '-loglevel', 'error', '-i', x.path, '-vf', `scale=${width}:-2`, '-frames:v', '1', '-q:v', '7', out], { timeoutMs: 20000 })
      if (r.exitCode !== 0) return undefined
    }
    const b = (await $.fs.read(out, { as: 'bytes' })) as unknown as { base64: string }
    return `data:image/jpeg;base64,${b.base64}`
  }
  if (x.bytes <= EMBED_MAX) {
    const b = (await $.fs.read(x.path, { as: 'bytes' })) as unknown as { base64: string }
    const mime = /\.png$/i.test(x.name) ? 'png' : /\.gif$/i.test(x.name) ? 'gif' : /\.webp$/i.test(x.name) ? 'webp' : 'jpeg'
    return `data:image/${mime};base64,${b.base64}`
  }
  return undefined
}

/** One gallery tile: the thumbnail (or its type and size) and the name under it. */
export function tileSvg(x: GalItem, data: string | undefined, sizePx: number, selected: boolean): { svg: string; h: number } {
  const H = sizePx + 20
  const ext = (x.name.split('.').pop() ?? '').toUpperCase()
  const img = data
    ? `<image href="${data}" x="0" y="0" width="${sizePx}" height="${sizePx}" preserveAspectRatio="xMidYMid slice" clip-path="url(#c)"/>`
    : `<rect class="k" width="${sizePx}" height="${sizePx}" rx="9"/><text class="s" x="${sizePx / 2}" y="${sizePx / 2 - 2}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700">${xml(ext)}</text><text class="m" x="${sizePx / 2}" y="${sizePx / 2 + 14}" text-anchor="middle" font-family="${MONO}" font-size="10">${xml(size(x.bytes))}</text>`
  return {
    h: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${H}" viewBox="0 0 ${sizePx} ${H}"><style>${SURFACE_CSS}</style><defs><clipPath id="c"><rect width="${sizePx}" height="${sizePx}" rx="9"/></clipPath></defs>${img}
${selected ? `<rect x="1" y="1" width="${sizePx - 2}" height="${sizePx - 2}" rx="9" fill="none" stroke="#D97757" stroke-width="2.5"/>` : ''}
<text class="s" x="2" y="${sizePx + 14}" font-family="${MONO}" font-size="9.5">${xml(fit(x.name, 9.5, sizePx - 4, true))}</text></svg>`,
  }
}

/** The preview card: the image large, then name, size, folder and date. */
export function previewSvg(x: GalItem, data: string | undefined, W: number): { svg: string; h: number } {
  const imgH = Math.round(W * 0.66)
  const H = imgH + 62
  const img = data
    ? `<image href="${data}" x="0" y="0" width="${W}" height="${imgH}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect class="k" width="${W}" height="${imgH}" rx="12"/><text class="m" x="${W / 2}" y="${imgH / 2}" text-anchor="middle" font-family="${MONO}" font-size="12">making the preview…</text>`
  const when = new Date(x.mtime).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return {
    h: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${SURFACE_CSS}</style>${img}
<text class="t" x="2" y="${imgH + 22}" font-family="${MONO}" font-size="13" font-weight="700">${xml(fit(x.name, 13, W - 4, true))}</text>
<text class="m" x="2" y="${imgH + 42}" font-family="${MONO}" font-size="10.5">${xml(fit(`${size(x.bytes)} · ${x.folder} · ${when}`, 10.5, W - 4, true))}</text></svg>`,
  }
}
