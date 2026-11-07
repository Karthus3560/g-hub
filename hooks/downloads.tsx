import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { DlItem, Download, HistoryEntry } from '../types'
import * as T from './theme'

// A live card under each download Claude starts: one bar per file or playlist
// item, sizes, speed, time left, and where it is saved. Bash output does not
// stream to mods, so progress is read from the disk once a second, and the
// expected size is asked of the server (curl -I) or of yt-dlp (--print filesize).

export const items = atom({ plugin: 'g-hub', key: 'dlItems' } as const, [], { shape: 'items-2' })

// ---------------------------------------------------------------- detection

const SHELL_PATTERNS: [RegExp, string][] = [
  [/\byt-dlp\b|\byoutube-dl\b/i, 'yt-dlp'],
  [/\bgallery-dl\b/i, 'gallery-dl'],
  [/\baria2c\b/i, 'aria2'],
  [/\bcurl(\.exe)?\b[^|;&]*(-o\b|-O\b|--output|--remote-name|https?:)/i, 'curl'],
  [/\bwget\b/i, 'wget'],
  [/\b(Invoke-WebRequest|iwr|Start-BitsTransfer)\b/i, 'web request'],
  [/\bgit\s+(clone|lfs\s+pull)\b/i, 'git clone'],
  [/\bgh\s+(release\s+download|repo\s+clone)\b/i, 'GitHub'],
  [/\b(huggingface-cli|hf)\s+download\b/i, 'Hugging Face'],
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b/i, 'npm install'],
  [/\b(pip|pip3|uv\s+pip|pipx)\s+install\b|\buv\s+(add|sync)\b/i, 'pip install'],
  [/\b(winget|choco|scoop|brew)\s+install\b/i, 'installer'],
  [/\bollama\s+pull\b/i, 'ollama pull'],
  [/\bdocker\s+pull\b/i, 'docker pull'],
]

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const short = (t: string, n = 160): string => {
  const one = t.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n - 1)}…` : one
}

function tokens(cmd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? '')
  return out
}
const after = (t: string[], ...flags: string[]): string | undefined => {
  for (let i = 0; i < t.length - 1; i++) if (flags.includes(t[i] as string)) return t[i + 1]
  for (const x of t) for (const f of flags) if (f.startsWith('--') && x.startsWith(`${f}=`)) return x.slice(f.length + 1)
  return undefined
}

/** Git Bash paths (/e/x) to Windows ones (E:/x). */
const toWin = (p: string): string => p.replace(/^\/([a-zA-Z])(\/|$)/, (_, d: string) => `${d.toUpperCase()}:/`)
const isAbs = (p: string): boolean => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')
const join = (dir: string, p: string): string => {
  const w = toWin(p)
  return isAbs(w) ? w : `${dir.replace(/[\\/]+$/, '')}/${w.replace(/^\.[\\/]/, '')}`
}
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '') || p
const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const urlsOf = (cmd: string): string[] => [...cmd.matchAll(/https?:\/\/[^\s"'<>|]+/g)].map(m => m[0])
const urlFile = (u: string): string => {
  try {
    return decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() ?? '') || 'index.html'
  } catch {
    return 'download'
  }
}

/** Where a command writes, worked out from its flags. */
function watchOf(kind: string, cmd: string, cwd: string): Download['watch'] {
  let dir = cwd
  let rest = cmd
  const cd = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)\s*/.exec(cmd)
  if (cd) {
    dir = join(cwd, cd[1] ?? cd[2] ?? cd[3] ?? '.')
    rest = cmd.slice(cd[0].length)
  }
  const t = tokens(rest)
  const url = urlsOf(rest)[0]

  if (kind === 'curl') {
    const out = after(t, '-o', '--output')
    const outDir = after(t, '--output-dir')
    const base = outDir ? join(dir, outDir) : dir
    if (out && out !== '-') return { mode: 'file', path: join(base, out) }
    if (url && (t.includes('-O') || t.includes('--remote-name') || /\s-\w*O/.test(rest))) return { mode: 'file', path: join(base, urlFile(url)) }
    return { mode: 'none', path: dir }
  }
  if (kind === 'wget') {
    const out = after(t, '-O', '--output-document')
    if (out === '-') return { mode: 'none', path: dir }
    if (out) return { mode: 'file', path: join(dir, out) }
    const pre = after(t, '-P', '--directory-prefix')
    return url ? { mode: 'file', path: join(pre ? join(dir, pre) : dir, urlFile(url)) } : { mode: 'none', path: dir }
  }
  if (kind === 'web request') {
    const out = after(t, '-OutFile', '-outfile', '-Destination')
    return out ? { mode: 'file', path: join(dir, out) } : { mode: 'none', path: dir }
  }
  if (kind === 'yt-dlp' || kind === 'gallery-dl') {
    let p = after(t, '-P', '--paths', '-d', '--directory')
    if (p && /^[a-z]+:(?![\\/])/i.test(p)) p = p.replace(/^[a-z]+:/i, '')
    let base = p ? join(dir, p) : dir
    const tpl = after(t, '-o', '--output')
    if (tpl && /[\\/]/.test(tpl)) {
      const tplDir = dirOf(tpl)
      if (!tplDir.includes('%(')) base = join(base, tplDir)
    }
    return { mode: 'dir', path: base }
  }
  if (kind === 'aria2') {
    const d = after(t, '-d', '--dir')
    return { mode: 'dir', path: d ? join(dir, d) : dir }
  }
  return { mode: 'none', path: dir }
}

function detect(tool: string, e: Record<string, unknown>): { kind: string; label: string; cmd: string } | undefined {
  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = str(e.command) ?? ''
    // Probes are not downloads: output thrown away, headers only, or a spider check.
    if (/(-o|-O|--output|--output-document)[\s=]+["']?(\/dev\/null|nul)\b/i.test(cmd)) return undefined
    if (/\bcurl\b[^|;&]*\s(-I|--head|-\w*I\w*)\b/.test(cmd) || /\bwget\b[^|;&]*--spider/.test(cmd)) return undefined
    // API calls are not downloads: a request that sends data or names a method other than GET
    if (/\bcurl\b[^|;&]*\s(-d|--data(-raw|-binary|-urlencode)?|--json|-F|--form|-T|--upload-file)[\s=]/.test(cmd)) return undefined
    if (/\bcurl\b[^|;&]*\s(-X|--request)[\s=]*["']?(POST|PUT|PATCH|DELETE)\b/i.test(cmd)) return undefined
    if (/\b(Invoke-WebRequest|iwr|Invoke-RestMethod|irm)\b[^|;&]*-(Method\s+["']?(Post|Put|Patch|Delete)|Body)\b/i.test(cmd)) return undefined
    for (const [re, kind] of SHELL_PATTERNS) if (re.test(cmd)) return { kind, label: short(cmd), cmd }
  }
  return undefined
}

// ---------------------------------------------------------------- disk polling

const TEMP = /\.(part(-Frag\d+)?|ytdl|temp|tmp|aria2)$/i
const keyOf = (name: string): string =>
  name.replace(TEMP, '').replace(TEMP, '').replace(/\.f\d+(?=\.[a-z0-9]+$)/i, '')

const lastTick = new Map<string, number>()
let isBusy = false

async function measure($: EngineInterface, d: Download, t: number): Promise<Partial<Download>> {
  const prev = new Map(d.items.map(i => [i.name, i]))
  const dt = Math.max(0.25, (t - (lastTick.get(d.id) ?? t - 1000)) / 1000)
  lastTick.set(d.id, t)
  const groups: { name: string; bytes: number; hasTemp: boolean; first: number }[] = []

  try {
    if (d.watch.mode === 'file') {
      for (const p of [d.watch.path, `${d.watch.path}.part`]) {
        if (await $.fs.exists(p)) {
          const s = await $.fs.stat(p)
          groups.push({ name: baseOf(d.watch.path), bytes: s.size, hasTemp: p.endsWith('.part'), first: 0 })
          break
        }
      }
    } else if (d.watch.mode === 'dir') {
      const byKey = new Map<string, { name: string; bytes: number; hasTemp: boolean; first: number }>()
      for (const f of await $.fs.list(d.watch.path)) {
        if (f.kind !== 'file' || f.mtimeMs < d.startedAt - 3000) continue
        const k = keyOf(f.name)
        const g = byKey.get(k) ?? { name: k, bytes: 0, hasTemp: false, first: f.mtimeMs }
        g.bytes += /\.ytdl$/i.test(f.name) ? 0 : f.size
        g.hasTemp = g.hasTemp || TEMP.test(f.name)
        g.first = Math.min(g.first, f.mtimeMs)
        byKey.set(k, g)
      }
      groups.push(...[...byKey.values()].sort((a, b) => a.first - b.first))
    }
  } catch {
    return {}
  }

  let grew = false
  const next: DlItem[] = groups.map((g, i) => {
    const p = prev.get(g.name)
    const delta = Math.max(0, g.bytes - (p?.bytes ?? 0))
    if (delta > 0) grew = true
    const speed = p ? p.speed * 0.5 + (delta / dt) * 0.5 : 0
    const isComplete = !g.hasTemp && (d.status !== 'running' || d.watch.mode === 'dir')
    return {
      name: g.name,
      bytes: g.bytes,
      total: d.totals[i] || undefined,
      speed,
      isComplete,
      firstAt: p?.firstAt ?? t,
      grewAt: delta > 0 ? t : (p?.grewAt ?? t),
      doneAt: isComplete ? (p?.doneAt ?? t) : undefined,
    }
  })
  return { items: next, grewAt: grew ? t : d.grewAt }
}

async function tick($: EngineInterface) {
  if (isBusy) return
  isBusy = true
  try {
    const list = await read($, items)
    const active = list.filter(d => d.status === 'running' && d.watch.mode !== 'none')
    if (active.length === 0) return
    const t = await $.clock.now()
    const results = new Map<string, Partial<Download>>()
    for (const d of active) results.set(d.id, await measure($, d, t))

    await update($, items, cur =>
      cur.map((d): Download => {
        const r = results.get(d.id)
        if (!r || d.status !== 'running') return d
        const merged = { ...d, ...r }
        // A background download is over once its files stop growing and no temp file is left.
        const settled =
          merged.isBackground &&
          t - merged.grewAt > 15000 &&
          (merged.items.length === 0 ? t - merged.startedAt > 120000 : merged.items.every(i => i.isComplete))
        return settled
          ? { ...merged, status: 'done', endedAt: merged.grewAt, items: merged.items.map(i => ({ ...i, isComplete: true, speed: 0 })) }
          : merged
      }),
    )
    await recordFinished($)
  } finally {
    isBusy = false
  }
}

/** Expected sizes: from the server for a link, from yt-dlp for a video or playlist. */
async function askTotals($: EngineInterface, d: Download, cmd: string) {
  const urls = urlsOf(cmd)
  if (urls.length === 0) return
  let totals: number[] = []
  try {
    if (d.kind === 'curl' || d.kind === 'wget' || d.kind === 'web request') {
      const { stdout } = await $.process.run(['curl', '-sIL', '--max-time', '10', urls[0] as string], { timeoutMs: 15000 })
      const lens = [...stdout.matchAll(/content-length:\s*(\d+)/gi)].map(m => Number(m[1]))
      const n = lens.filter(x => x > 0).pop()
      if (n) totals = [n]
    } else if (d.kind === 'yt-dlp') {
      const { stdout } = await $.process.run(
        ['yt-dlp', '--no-warnings', '--skip-download', '--print', '%(filesize,filesize_approx)s', ...urls],
        { timeoutMs: 120000 },
      )
      totals = stdout.split(/\r?\n/).filter(Boolean).map(l => Number.parseInt(l, 10) || 0)
    }
  } catch {
    return
  }
  if (totals.length === 0) return
  await update($, items, cur =>
    cur.map(x =>
      x.id === d.id ? { ...x, totals, items: x.items.map((it, i) => ({ ...it, total: totals[i] || undefined })) } : x,
    ),
  )
}

// a function declaration: the engine follows $ across files only into these
async function patch($: EngineInterface, id: string, fn: (d: Download) => Download): Promise<unknown> {
  return update($, items, cur => cur.map(d => (d.id === id ? fn(d) : d)))
}

// ---------------------------------------------------------------- drawing

const RUN = T.RUN
const DONE = T.OK
const ERR = T.BAD
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
const MONO = "ui-monospace,'Cascadia Mono',Consolas,monospace"

const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%mw]/.test(ch) ? 0.72 : 0.56)
const textW = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)
const fit = (s: string, size: number, maxW: number, mono = false): string => {
  const w = (x: string) => (mono ? x.length * 0.6 * size : textW(x, size))
  if (w(s) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (w(out + ch + '…') > maxW) break
    out += ch
  }
  return out + '…'
}
const noise = (x: number, y: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return s - Math.floor(s)
}

function size(n: number): string {
  if (n < 1024) return `${n} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const CSS = `<style>
${T.SURFACE_CSS}
.p0,.p1,.p2,.p3{animation:tw 2.4s ease-in-out infinite}.p1{animation-duration:2.9s;animation-delay:-.7s}.p2{animation-duration:1.9s;animation-delay:-1.3s}.p3{animation-duration:3.3s;animation-delay:-.4s}
@keyframes tw{0%,100%{opacity:1}50%{opacity:.3}}
.drop{animation:drop 1.1s cubic-bezier(.5,0,.5,1) infinite}@keyframes drop{0%{transform:translateY(-3px);opacity:.2}40%{opacity:1}100%{transform:translateY(3px);opacity:.15}}
@media (prefers-reduced-motion: reduce){.p0,.p1,.p2,.p3,.drop,.comet{animation:none!important}}
</style>`

const ARROW = ['..##..', '..##..', '..##..', '######', '.####.', '..##..']
const TRAY = ['#......#', '########']
function arrowIcon(x: number, y: number, color: string, isMoving: boolean): string {
  const c = 2
  const px = (rows: string[], ox: number, oy: number) =>
    rows.flatMap((r, dy) => [...r].map((ch, dx) => (ch === '#' ? `<rect x="${ox + dx * c}" y="${oy + dy * c}" width="${c}" height="${c}"/>` : ''))).join('')
  return `<g fill="${color}"><g${isMoving ? ' class="drop"' : ''}>${px(ARROW, x + c, y)}</g>${px(TRAY, x, y + 7 * c)}</g>`
}

/** A dithered progress bar: a known ratio fills it, null sweeps a comet across. */
function bar(W: number, H: number, ratio: number | null, color: string, id: string): string {
  const CELL = 3
  const rows = Math.floor(H / CELL)
  const clip = `<defs><clipPath id="${id}"><rect width="${W}" height="${H}" rx="${H / 2}"/></clipPath></defs><rect class="k" width="${W}" height="${H}" rx="${H / 2}"/>`
  const dots: string[] = []
  if (ratio === null) {
    const cw = Math.min(120, Math.max(50, W * 0.3))
    const cols = Math.floor(cw / CELL)
    for (let c = 0; c < cols; c++) {
      const dens = 0.1 + 0.85 * Math.pow(c / cols, 1.6)
      for (let r = 0; r < rows; r++)
        if (noise(c, r) < dens) dots.push(`<rect class="p${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
    const dur = Math.max(1.4, W / 160).toFixed(2)
    return `${clip}<g clip-path="url(#${id})"><g fill="${color}" class="comet" style="animation:sw${id} ${dur}s linear infinite">${dots.join('')}</g></g><style>@keyframes sw${id}{from{transform:translateX(-${cw}px)}to{transform:translateX(${W}px)}}</style>`
  }
  const fillW = Math.round(W * Math.max(0, Math.min(1, ratio)))
  const cols = Math.floor(fillW / CELL)
  for (let c = 0; c < cols; c++) {
    const dens = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r++)
      if (noise(c, r) < dens) dots.push(`<rect class="p${Math.floor(noise(r, c) * 4)}" x="${c * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
  }
  return `${clip}<g clip-path="url(#${id})" fill="${color}">${dots.join('')}</g>`
}

function itemLine(it: DlItem, isRunning: boolean): string {
  if (it.isComplete || !isRunning) return it.total ? size(Math.max(it.bytes, it.total)) : size(it.bytes)
  const parts = [it.total ? `${size(it.bytes)} / ${size(it.total)}` : size(it.bytes)]
  if (it.speed > 1024) parts.push(`${size(it.speed)}/s`)
  if (it.total && it.speed > 1024) parts.push(`${span(((it.total - it.bytes) / it.speed) * 1000)} left`)
  return parts.join(' · ')
}

export type View = 'running' | 'done' | 'error'

/**
 * The lane belt: a server with its queue on the left, one belt per file that is
 * still arriving, each feeding that file's card, and the folder on the right
 * collecting finished files in the order they landed. Each file keeps one color.
 * Motion is CSS only (the row is an image): packets and belt marks slide at a
 * speed set from the file's real speed, phased from the clock so a redraw does
 * not make them jump.
 */
const ITEM_COLORS = T.ITEM_COLORS
const WARN = T.WARN
const icol = (i: number): string => ITEM_COLORS[i % ITEM_COLORS.length] as string

const BELT_CSS = `<style>
@keyframes mv{to{transform:translateX(15px)}}
@keyframes dash{to{stroke-dashoffset:-14}}
@keyframes pulse{0%{stroke-width:3.4}100%{stroke-width:1.6}}
@keyframes pop{0%{transform:scale(0) translateY(-6px);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}
@keyframes blink{50%{opacity:.35}}
.mv{animation:mv linear infinite}.dash{animation:dash linear infinite}.pulse{animation:pulse ease-out infinite}
.pop{transform-box:fill-box;transform-origin:center;animation:pop .6s ease-out both}.blink{animation:blink 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.mv,.dash,.pulse,.pop,.blink{animation:none!important}}
</style>`

const STALL_MS = 6000

type Landed = { it: DlItem; i: number }

const RECEIPT_CSS = `<style>
@keyframes print{from{opacity:0;transform:translateY(-5px)}to{opacity:1;transform:none}}
@keyframes thunk{0%{transform:scale(1.9) rotate(-9deg);opacity:0}55%{transform:scale(.94) rotate(-9deg);opacity:1}75%{transform:scale(1.03) rotate(-9deg)}100%{transform:scale(1) rotate(-9deg);opacity:1}}
.pr{animation:print .35s ease-out both}
.stamp{transform-box:fill-box;transform-origin:center;transform:rotate(-9deg)}
.stamp.thunk{animation:thunk .45s cubic-bezier(.3,1.4,.5,1) both}
@media (prefers-reduced-motion: reduce){.pr,.stamp.thunk{animation:none!important}}
</style>`

/**
 * The finished row as a delivery receipt: one line per saved file with dot
 * leaders to its size and how long it took, a total line, a torn bottom edge,
 * and a DELIVERED stamp. When the row first turns finished, the lines print one
 * after another and the stamp thunks down last.
 */
function receiptScene(d: Download, done: Landed[], view: View, W: number, narrow: boolean, t: number): { h: number; draw: (top: number) => string[] } {
  const MAX_LINES = 8
  const lines = done.slice(0, MAX_LINES)
  const more = done.length - lines.length
  const LH = 18
  const headH = 38 // room for the stamp, so it never covers a line
  const bodyLines = Math.max(1, lines.length) + (more > 0 ? 1 : 0)
  const totalH = 28
  const h = 8 + headH + bodyLines * LH + totalH + 16

  const sinceEnd = t - (d.endedAt ?? t)
  const fresh = sinceEnd < 4000
  const anim = (k: number) => (fresh ? ` class="pr" style="animation-delay:${(0.12 + k * 0.1 - sinceEnd / 1000).toFixed(2)}s"` : '')
  const bytesOf = (x: DlItem) => Math.max(x.bytes, x.total ?? 0)
  const tookOf = (x: DlItem) => (x.doneAt !== undefined && x.firstAt !== undefined && x.doneAt > x.firstAt ? x.doneAt - x.firstAt : undefined)

  return {
    h,
    draw: top => {
      const out: string[] = []
      const rx = 0.5, rw = Math.min(W - 1, narrow ? W - 1 : 560), y0 = top + 4, y1 = top + h - 8
      const pad = 14, left = rx + pad, right = rx + rw - pad
      const ok = view !== 'error'
      const ink = ok ? DONE : ERR

      // paper with a torn bottom edge: the sheet, then its teeth hanging below
      out.push(`<rect x="${rx}" y="${y0}" width="${rw}" height="${y1 - y0}" rx="6" class="k"/>`)
      const zig: string[] = [`M${rx} ${y1 - 6}`, `L${rx} ${y1}`]
      for (let x = rx; x < rx + rw; x += 8) zig.push(`L${Math.min(x + 4, rx + rw).toFixed(1)} ${y1 + 4} L${Math.min(x + 8, rx + rw).toFixed(1)} ${y1}`)
      out.push(`<path d="${zig.join(' ')} L${rx + rw} ${y1 - 6} Z" class="k"/>`)

      // heading: what was delivered where, and when
      const folder = baseOf(d.watch.mode === 'file' ? dirOf(d.watch.path) : d.watch.path) || d.kind
      const clock = new Date(d.endedAt ?? t)
      const hhmm = `${String(clock.getHours()).padStart(2, '0')}:${String(clock.getMinutes()).padStart(2, '0')}`
      const n = done.length
      const heading = `${n} ${n === 1 ? 'parcel' : 'parcels'} → ${folder}`
      // animation always rides on a wrapping <g>, never on an element that has its own class
      out.push(`<g${anim(0)}>`)
      out.push(`<text class="s" x="${left}" y="${y0 + 18}" font-family="${MONO}" font-size="11">${xml(fit(heading, 11, rw - 150, true))}</text>`)
      out.push(`<text class="m" x="${left}" y="${y0 + 31}" font-family="${MONO}" font-size="9.5" letter-spacing="1">RECEIPT · ${hhmm}</text>`)
      out.push(`</g>`)

      // one line per parcel: color chip, name, dot leaders, size · time
      let y = y0 + headH + 18
      if (lines.length === 0) {
        out.push(`<g${anim(1)}><text class="m" x="${left}" y="${y}" font-family="${MONO}" font-size="11">no parcels arrived</text></g>`)
        y += LH
      }
      lines.forEach(({ it, i }, k) => {
        const took = tookOf(it)
        const rightText = `${size(bytesOf(it))}${took !== undefined ? ` · ${span(took)}` : ''}`
        const rightW = rightText.length * 0.6 * 11
        const name = fit(it.name, 11, Math.max(60, (right - left) - rightW - 60), true)
        const nameEnd = left + 16 + name.length * 0.6 * 11
        out.push(`<g${anim(k + 1)}>`)
        out.push(`<rect x="${left}" y="${y - 8.5}" width="9" height="9" rx="2" fill="${ok ? icol(i) : ERR}"/>`)
        out.push(`<text class="t" x="${left + 16}" y="${y}" font-family="${MONO}" font-size="11">${xml(name)}</text>`)
        if (right - rightW - 6 > nameEnd + 6) out.push(`<line x1="${(nameEnd + 6).toFixed(1)}" y1="${y - 2}" x2="${(right - rightW - 6).toFixed(1)}" y2="${y - 2}" stroke="#8a8a86" stroke-opacity="0.6" stroke-width="1.6" stroke-dasharray="0.1 4.5" stroke-linecap="round"/>`)
        out.push(`<text class="s" x="${right}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11" font-variant-numeric="tabular-nums">${xml(rightText)}</text>`)
        out.push(`</g>`)
        y += LH
      })
      if (more > 0) {
        out.push(`<g${anim(lines.length + 1)}><text class="m" x="${left + 16}" y="${y}" font-family="${MONO}" font-size="10.5">… and ${more} more ${more === 1 ? 'parcel' : 'parcels'}</text></g>`)
        y += LH
      }

      // total
      const all = done.reduce((a, x) => a + bytesOf(x.it), 0)
      const dur = (d.endedAt ?? t) - d.startedAt
      const avg = dur > 0 ? (all / dur) * 1000 : 0
      const totalText = `${size(all)} · ${span(dur)}${avg > 1024 ? ` · ${size(avg)}/s` : ''}`
      out.push(`<g${anim(lines.length + 2)}>`)
      out.push(`<line x1="${left}" y1="${y - 6}" x2="${right}" y2="${y - 6}" stroke="#8a8a86" stroke-opacity="0.55" stroke-width="1" stroke-dasharray="4 3"/>`)
      out.push(`<text class="t" x="${left}" y="${y + 10}" font-family="${MONO}" font-size="11.5" font-weight="700" letter-spacing="1">TOTAL</text>`)
      out.push(`<text class="t" x="${right}" y="${y + 10}" text-anchor="end" font-family="${MONO}" font-size="11.5" font-weight="700" font-variant-numeric="tabular-nums">${xml(totalText)}</text>`)
      out.push(`</g>`)

      // the stamp, last
      const word = ok ? 'DELIVERED' : n > 0 ? 'PARTLY DELIVERED' : 'NOT DELIVERED'
      const sw = word.length * 9.2 + 22, sh = 26
      const sx = right - sw - 2, sy = y0 + 8
      const stampDelay = (0.12 + (lines.length + 3) * 0.1 + 0.1 - sinceEnd / 1000).toFixed(2)
      out.push(`<g class="stamp${fresh ? ' thunk' : ''}"${fresh ? ` style="animation-delay:${stampDelay}s"` : ''} opacity="0.92">`)
      out.push(`<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5" fill="none" stroke="${ink}" stroke-width="2.2"/>`)
      out.push(`<rect x="${sx + 3}" y="${sy + 3}" width="${sw - 6}" height="${sh - 6}" rx="3" fill="none" stroke="${ink}" stroke-width="0.8" stroke-opacity="0.7"/>`)
      out.push(`<text x="${sx + sw / 2}" y="${sy + sh / 2 + 5}" text-anchor="middle" font-family="${MONO}" font-size="13" font-weight="800" letter-spacing="2" fill="${ink}">${word}</text>`)
      out.push(`</g>`)
      return out
    },
  }
}

/** Keeps the end of a path (the folder that matters), cutting from the left. */
function fitTail(s: string, size: number, maxW: number): string {
  const per = size * 0.6
  if (s.length * per <= maxW) return s
  const keep = Math.max(4, Math.floor(maxW / per) - 1)
  return '…' + s.slice(s.length - keep)
}

export function beltSvg(d: Download, view: View, W: number, t: number): { svg: string; h: number } {
  const isRun = view === 'running'
  const narrow = W < 520
  const items = d.items.length > 0 ? d.items : [{ name: d.kind, bytes: 0, speed: 0, isComplete: !isRun } as DlItem]
  const indexed = items.map((it, i) => ({ it, i }))
  const totalCount = Math.max(items.length, d.totals.length)
  const done = indexed.filter(x => x.it.isComplete).sort((a, b) => (a.it.doneAt ?? 0) - (b.it.doneAt ?? 0))
  const open = indexed.filter(x => !x.it.isComplete)
  const laneList = isRun || view === 'error' ? open.slice(0, 4) : []
  const hiddenOpen = Math.max(0, open.length - laneList.length)
  const queued = isRun ? Math.max(0, d.totals.length - items.length) : 0

  const bytes = items.reduce((a, x) => a + x.bytes, 0)
  const known = items.length > 0 && items.every(x => x.total)
  const total = known ? items.reduce((a, x) => a + (x.total ?? 0), 0) : 0
  const speed = items.reduce((a, x) => a + (x.isComplete ? 0 : x.speed), 0)

  // ---- header: dot, title, summary
  const color = view === 'error' ? ERR : isRun ? RUN : DONE
  const head: string[] = []
  if (view === 'error') head.push(`Failed · ${done.length} of ${totalCount} saved`)
  else if (!isRun) head.push(`Done · ${done.length > 1 ? `${done.length} files · ` : ''}${bytes ? `${size(bytes)} · ` : ''}${span((d.endedAt ?? t) - d.startedAt)}`)
  else {
    if (totalCount > 1) head.push(`${done.length} of ${totalCount} saved`)
    if (total) head.push(`${Math.round((bytes / total) * 100)}%`)
    else if (bytes) head.push(size(bytes))
    if (speed > 1024) head.push(`${size(speed)}/s`)
    head.push(total && speed > 1024 ? `${span(((total - bytes) / speed) * 1000)} left` : span(t - d.startedAt))
  }
  const headText = head.join(' · ')
  // The summary sits beside the title, or on its own line when the two would squeeze each other.
  const twoLines = textW(d.title || d.kind, 13) + textW(headText, 12) + 40 > W
  const title = fit(d.title || d.kind, 13, twoLines ? W - 20 : W - textW(headText, 12) - 40)
  const out: string[] = [
    `<circle cx="5" cy="11" r="4" fill="${color}"${isRun ? ' class="blink"' : ''}/>`,
    `<text class="t" x="16" y="15.5" font-family="${FONT}" font-size="13" font-weight="600">${xml(title)}</text>`,
    twoLines
      ? `<text x="16" y="32" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums" fill="${color}">${xml(fit(headText, 12, W - 20))}</text>`
      : `<text x="${W - 2}" y="15.5" text-anchor="end" font-family="${FONT}" font-size="12" font-variant-numeric="tabular-nums" fill="${color}">${xml(headText)}</text>`,
  ]

  // ---- columns
  const top = twoLines ? 44 : 30
  const LANE_H = narrow ? 50 : 42
  const lanesN = Math.max(1, laneList.length)
  // finished: the parcel stack
  const scene = laneList.length > 0 ? null : receiptScene(d, done, view, W, narrow, t)
  const bodyH = scene ? scene.h : lanesN * LANE_H
  const bot = top + bodyH
  const sw = narrow ? 44 : 56
  const foldW = narrow ? 92 : Math.min(170, W * 0.22)
  const fx = W - foldW
  const cw = 24, ch = 30
  const cardX = fx - cw - 14
  const bx0 = sw + 12, bx1 = cardX - 8
  const id = d.id.replace(/[^a-z0-9]/gi, '').slice(-8)

  if (laneList.length > 0) {
    // server and its queue
    out.push(`<rect class="k" x="0.5" y="${top}" width="${sw}" height="${bodyH - 2}" rx="8"/>`)
    if (queued + hiddenOpen > 0) {
      out.push(`<text class="t" x="${sw / 2}" y="${top + 18}" text-anchor="middle" font-family="${MONO}" font-size="14" font-weight="700">${queued + hiddenOpen}</text>`)
      out.push(`<text class="m" x="${sw / 2}" y="${top + 30}" text-anchor="middle" font-family="${MONO}" font-size="9">${hiddenOpen && !queued ? 'more' : 'waiting'}</text>`)
    } else {
      // nothing queued: the server as a small rack, its top light on while bytes flow
      const rx = sw / 2 - 11, ry = top + (bodyH - 2) / 2 - 11
      for (let k = 0; k < 3; k++) {
        out.push(`<rect x="${rx}" y="${ry + k * 8}" width="22" height="6" rx="1.5" class="ln" fill="none" stroke-width="1.2"/>`)
        out.push(`<circle cx="${rx + 18}" cy="${ry + 3 + k * 8}" r="1.3" fill="${k === 0 ? (isRun ? DONE : view === 'error' ? ERR : '#888') : '#888'}"${k === 0 && isRun ? ' class="blink"' : ''}/>`)
      }
    }
    for (let k = 0; k < Math.min(queued, Math.floor((bodyH - 46) / 13)); k++) {
      const c = icol(items.length + k)
      out.push(`<rect x="7" y="${bot - 16 - k * 13}" width="${sw - 13}" height="9" rx="2.5" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.2" stroke-dasharray="3 2"/>`)
    }

    laneList.forEach(({ it, i }, s) => {
      const cy = top + LANE_H * s + (narrow ? 24 : 26)
      const c = view === 'error' ? ERR : icol(i)
      const stalled = isRun && !it.isComplete && it.grewAt !== undefined && t - it.grewAt > STALL_MS && t - d.startedAt > STALL_MS
      const moving = isRun && !stalled
      const v = 40 + Math.min(12, it.speed / (1024 * 1024)) * 24
      const period = 15 / v
      const phase = (-((t / 1000) % period)).toFixed(2)

      // track and moving marks
      out.push(`<line x1="${bx0}" y1="${cy}" x2="${bx1}" y2="${cy}" class="ln" stroke-width="7" stroke-linecap="round"/>`)
      out.push(`<line x1="${bx0}" y1="${cy}" x2="${bx1}" y2="${cy}" stroke="${c}" stroke-opacity="${view === 'error' ? 0.25 : 0.55}" stroke-width="2" stroke-dasharray="2 12"${moving ? ` class="dash" style="animation-duration:${(14 / v).toFixed(2)}s;animation-delay:${phase}s"` : ''}/>`)

      // evenly spaced packets riding into the card
      const pk: string[] = []
      for (let x = bx0 - 15; x < bx1; x += 15) pk.push(`<rect x="${x.toFixed(1)}" y="${cy - 11}" width="7" height="7" rx="1.6"/>`)
      out.push(`<defs><clipPath id="cl${s}${id}"><rect x="${bx0}" y="${cy - 16}" width="${bx1 - bx0 - 4}" height="20"/></clipPath></defs>`)
      out.push(`<g clip-path="url(#cl${s}${id})"><g fill="${c}" fill-opacity="${stalled ? 0.3 : view === 'error' ? 0.35 : 1}"${moving ? ` class="mv" style="animation-duration:${period.toFixed(2)}s;animation-delay:${phase}s"` : ''}>${pk.join('')}</g></g>`)

      // stalled: hatch and a pill saying how long nothing has arrived
      if (stalled) {
        out.push(`<defs><pattern id="ht${s}${id}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.5" height="7" fill="${WARN}" fill-opacity="0.5"/></pattern></defs>`)
        out.push(`<rect x="${bx0 - 3}" y="${cy - 14}" width="${bx1 - bx0 + 6}" height="20" fill="url(#ht${s}${id})"/>`)
        const msg = `no data for ${span(t - (it.grewAt ?? t))}`
        const mw = textW(msg, 11) + 18, mx = (bx0 + bx1) / 2
        out.push(`<rect x="${mx - mw / 2}" y="${cy - 14}" width="${mw}" height="19" rx="9.5" class="k" stroke="${WARN}" stroke-opacity="0.6"/>`)
        out.push(`<text x="${mx}" y="${cy - 1}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="600" fill="${WARN}">${xml(msg)}</text>`)
      }

      // label: name, a taken-name tag, and the status
      const ratio = it.total ? Math.min(1, it.bytes / it.total) : null
      const status =
        view === 'error' ? 'did not finish'
        : d.watch.mode === 'none' ? `working · ${span(t - d.startedAt)}`
        : stalled ? 'stalled'
        : it.total ? `${Math.floor((ratio ?? 0) * 100)}% · ${size(it.speed)}/s${it.speed > 1024 ? ` · ${span(((it.total - it.bytes) / it.speed) * 1000)} left` : ''}`
        : `${size(it.bytes)} of ? · ${size(it.speed)}/s`
      const nameMax = narrow ? bx1 - bx0 - 12 : (bx1 - bx0) * 0.55
      const nm = fit(it.name, 12, nameMax)
      const taken = /\(\d+\)\.[a-z0-9]+$/i.test(it.name)
      out.push(`<circle cx="${bx0 + 4}" cy="${cy - 19}" r="3.5" fill="${c}"/>`)
      out.push(`<text class="t" x="${bx0 + 12}" y="${cy - 15}" font-family="${FONT}" font-size="12" font-weight="600">${xml(nm)}</text>`)
      if (taken && !narrow) out.push(`<text x="${(bx0 + 22 + textW(nm, 12) * 1.12).toFixed(1)}" y="${cy - 15.5}" font-family="${MONO}" font-size="9.5" font-weight="600" fill="${ITEM_COLORS[4]}">name taken</text>`)
      const stColor = view === 'error' ? ERR : stalled ? WARN : undefined
      const stAttr = stColor ? `fill="${stColor}"` : 'class="s"'
      if (narrow) out.push(`<text ${stAttr} x="${bx0}" y="${cy + 17}" font-family="${MONO}" font-size="10.5">${xml(fit(status, 10.5, bx1 - bx0, true))}</text>`)
      else out.push(`<text ${stAttr} x="${bx1}" y="${cy - 15}" text-anchor="end" font-family="${MONO}" font-size="10.5" font-variant-numeric="tabular-nums">${xml(fit(status, 10.5, (bx1 - bx0) * 0.45, true))}</text>`)

      // the file card: fills with its bytes, pulses with each packet, red with a cross on failure
      const cyp = cy - ch / 2 - 3
      const fold = `M${cardX} ${cyp} L${cardX + cw - 7} ${cyp} L${cardX + cw} ${cyp + 7} L${cardX + cw} ${cyp + ch} L${cardX} ${cyp + ch} Z`
      out.push(`<defs><clipPath id="cc${s}${id}"><path d="${fold}"/></clipPath></defs>`)
      out.push(`<path d="${fold}" class="k"/>`)
      if (ratio !== null || view === 'error') {
        const r = ratio ?? 0.5
        out.push(`<rect clip-path="url(#cc${s}${id})" x="${cardX}" y="${(cyp + ch - r * ch).toFixed(1)}" width="${cw}" height="${(r * ch).toFixed(1)}" fill="${c}" fill-opacity="0.85"/>`)
      } else {
        for (let k = 0; k < 4; k++) out.push(`<rect clip-path="url(#cc${s}${id})" x="${cardX}" y="${cyp + 4 + k * 8}" width="${cw}" height="3.5" fill="${c}" fill-opacity="0.6"/>`)
        out.push(`<circle cx="${cardX + cw / 2}" cy="${cyp + ch / 2 + 2}" r="7" class="k" stroke="${c}" stroke-width="1.2"/>`)
        out.push(`<text class="t" x="${cardX + cw / 2}" y="${cyp + ch / 2 + 6}" text-anchor="middle" font-family="${MONO}" font-size="10" font-weight="700">?</text>`)
      }
      out.push(`<path d="${fold}" fill="none" stroke="${stalled ? WARN : c}" stroke-width="1.6"${moving ? ` class="pulse" style="animation-duration:${period.toFixed(2)}s;animation-delay:${phase}s"` : ''}/>`)
      if (view === 'error') out.push(`<path d="M${cardX + 7} ${cyp + 11} l10 10 M${cardX + 17} ${cyp + 11} l-10 10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>`)
      if (taken) out.push(`<rect x="${cardX + 6}" y="${cyp - 8}" width="24" height="13" rx="6.5" fill="${ITEM_COLORS[4]}"/><text x="${cardX + 18}" y="${cyp + 2}" text-anchor="middle" font-family="${MONO}" font-size="9" font-weight="700" fill="#fff">(1)</text>`)
    })

    // the folder: finished files in landing order; a fresh one pops in
    out.push(`<rect class="k" x="${fx}" y="${top}" width="${foldW - 0.5}" height="${bodyH - 2}" rx="8"/>`)
    const rows = Math.max(1, Math.floor((bodyH - 12) / 20))
    if (done.length === 0) out.push(`<text class="m" x="${fx + 8}" y="${top + 18}" font-family="${FONT}" font-size="11">${xml(fit(d.watch.mode === 'none' ? 'no files to track' : 'nothing saved yet', 11, foldW - 16))}</text>`)
    done.slice(-rows).forEach(({ it, i }, k) => {
      const y = top + 8 + k * 20
      const fresh = it.doneAt !== undefined && t - it.doneAt < 1200
      out.push(`<rect x="${fx + 8}" y="${y}" width="11" height="13" rx="2.5" fill="${icol(i)}"${fresh ? ` class="pop" style="animation-delay:${(-(t - (it.doneAt ?? t)) / 1000).toFixed(2)}s"` : ''}/>`)
      out.push(`<text class="t" x="${fx + 25}" y="${y + 10.5}" font-family="${MONO}" font-size="10.5">${xml(fit(it.name.replace(/\.[a-z0-9]+$/i, ''), 10.5, foldW - 32, true))}</text>`)
    })
    if (done.length > rows) out.push(`<text class="m" x="${fx + foldW - 8}" y="${bot - 6}" text-anchor="end" font-family="${MONO}" font-size="9.5">+${done.length - rows}</text>`)
  } else {
    if (scene) out.push(...scene.draw(top))
  }

  let y = bot + 4
  if (view === 'error' && d.error && d.error !== 'Interrupted') {
    out.push(`<text x="16" y="${y + 12}" font-family="${FONT}" font-size="11.5" fill="${ERR}">${xml(fit(d.error, 11.5, W - 20))}</text>`)
    y += 18
  }
  if (d.watch.mode !== 'none') {
    const where = d.watch.path.replace(/\//g, '\\')
    out.push(
      `<text class="m" x="16" y="${y + 12}" font-family="${FONT}" font-size="11">${isRun ? 'Saving to' : 'Saved to'}</text>`,
      `<text class="s" x="${isRun ? 72 : 66}" y="${y + 12}" font-family="${MONO}" font-size="11">${xml(fitTail(where, 11, W - 80))}</text>`,
    )
    y += 18
  }
  const h = y + 2
  return {
    h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${CSS}${BELT_CSS}${RECEIPT_CSS}${out.join('')}</svg>`,
  }
}

function textBar(width: number, ratio: number | null): string {
  if (ratio === null) return '░'.repeat(width)
  const f = Math.round(width * Math.max(0, Math.min(1, ratio)))
  return '█'.repeat(f) + '░'.repeat(width - f)
}

// ---------------------------------------------------------------- hooks

// ---------------------------------------------------------------- the sidebar and the shared history

const HISTORY_KEY = 'history-3'
const HISTORY_MAX = 500


export async function loadHistory($: EngineInterface): Promise<HistoryEntry[]> {
  const v = await $.store.get(HISTORY_KEY)
  return Array.isArray(v) ? (v as HistoryEntry[]) : []
}

/** Writes every download that ended and is not in the history yet; newest first, across sessions. */
async function recordFinished($: EngineInterface): Promise<void> {
  const all = (await read($, items)).filter(d => d.status !== 'running' && !d.isRecorded)
  const empty = all.filter(d => d.status !== 'error' && !d.items.some(i => i.bytes > 0))
  if (empty.length) await update($, items, list => list.map(x => (empty.some(e => e.id === x.id) ? { ...x, isRecorded: true } : x)))
  const pending = all.filter(d => !empty.includes(d))
  if (pending.length === 0) return
  const entries: HistoryEntry[] = pending.map(d => ({
    id: d.id,
    title: d.title || d.kind,
    kind: d.kind,
    status: d.status === 'error' ? 'error' : 'done',
    files: d.items.filter(i => i.isComplete).length,
    bytes: d.items.reduce((a, i) => a + Math.max(i.bytes, i.total ?? 0), 0),
    endedAt: d.endedAt ?? Date.now(),
    folder: d.watch.mode === 'none' ? '' : d.watch.path,
    project: d.project ?? '',
  }))
  const ids = new Set(entries.map(x => x.id))
  const prev = (await loadHistory($)).filter(x => !ids.has(x.id))
  await $.store.set(HISTORY_KEY, [...entries.reverse(), ...prev].slice(0, HISTORY_MAX))
  await update($, items, cur => cur.map(d => (ids.has(d.id) ? { ...d, isRecorded: true } : d)))
}

function ago(ms: number): string {
  if (ms < 60000) return 'just now'
  if (ms >= 86400000) {
    const d = Math.floor(ms / 86400000)
    return d === 1 ? 'yesterday' : `${d} days ago`
  }
  return `${span(ms)} ago`
}

/** The history as one drawing: a status dot, the title, then where and when. */
export function historySvg(list: HistoryEntry[], W: number, t: number): { svg: string; h: number } {
  const shown = list.slice(0, 15)
  const ROW = 36
  const h = shown.length * ROW + 4
  const rows = shown.map((x, k) => {
    const y = k * ROW + 2
    const ok = x.status === 'done'
    const right = x.bytes ? `${size(x.bytes)}${x.files > 1 ? ` · ${x.files} files` : ''}` : ''
    const rightW = right.length * 0.6 * 11 + 6
    const where = [baseOf(x.folder || ''), baseOf(x.project || '')].filter(Boolean)
    const meta = `${where.length === 2 && where[0] !== where[1] ? `${where[0]} · ${where[1]}` : (where[0] ?? x.kind)} · ${ago(t - x.endedAt)}`
    return `<rect class="k" x="0.5" y="${y}" width="${W - 1}" height="${ROW - 4}" rx="9"/>
<circle cx="14" cy="${y + 16}" r="4.5" fill="${ok ? DONE : ERR}"/>
<text class="t" x="26" y="${y + 13.5}" font-family="${FONT}" font-size="12" font-weight="600">${xml(fit(x.title, 12, W - 40 - rightW))}</text>
<text class="m" x="26" y="${y + 27}" font-family="${MONO}" font-size="10">${xml(fit(meta, 10, W - 40, true))}</text>
${right ? `<text class="s" x="${W - 10}" y="${y + 13.5}" text-anchor="end" font-family="${MONO}" font-size="11" font-variant-numeric="tabular-nums">${xml(right)}</text>` : ''}`
  })
  return { h, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}">${CSS}${rows.join('')}</svg>` }
}

/** Starts the once-a-second disk poll that keeps running downloads live. */
export function startDownloadsClock($: EngineInterface): void {
  $.clock.every(1000, () => tick($))
}

type ToolEvent = Record<string, unknown>
type ToolNext = (e: never) => Promise<{ deny?: string; isError?: true; text?: string }>

/** Called for every tool call (from register.tsx: a mod has one tool.call hook). Tracks downloads, passes the rest. */
export async function trackDownload($: EngineInterface, e: ToolEvent, next: ToolNext): Promise<unknown> {
  const ev = e
  const tool = str(ev.tool) ?? ''
  const found = detect(tool, ev)
  if (!found) return next(e as never)

  const t = await $.clock.now()
  const cwd = await $.session.cwd()
  const d: Download = {
    id: str(ev.tool_use_id) ?? `dl-${t}`,
    kind: found.kind,
    title: str(ev.description),
    label: found.label,
    watch: watchOf(found.kind, found.cmd, cwd),
    status: 'running',
    isBackground: ev.run_in_background === true,
    startedAt: t,
    grewAt: t,
    items: [],
    totals: [],
    project: cwd,
  }
  await update($, items, list => [...list.filter(x => x.id !== d.id), d].slice(-40))
  void askTotals($, d, found.cmd)

  try {
    const ran = await next(e as never)
    const failed = ran.deny !== undefined || ran.isError === true
    if (d.isBackground && !failed) return ran // the disk poll finishes it

    const end = await $.clock.now()
    const cur = (await read($, items)).find(x => x.id === d.id) ?? d
    const r = await measure($, { ...cur, status: failed ? 'error' : 'done' }, end)
    await patch($, d.id, x => ({
      ...x,
      ...r,
      status: failed ? 'error' : 'done',
      endedAt: end,
      error: failed ? short(ran.deny ?? ran.text ?? 'The command failed', 300) : undefined,
      items: (r.items ?? x.items).map(i => ({ ...i, isComplete: !failed || i.isComplete, speed: 0, doneAt: !failed || i.isComplete ? (i.doneAt ?? end) : undefined })),
    }))
    await recordFinished($)
    return ran
  } catch (err) {
    await patch($, d.id, x => ({ ...x, status: 'error', endedAt: Date.now(), error: short(String(err), 300) }))
    await recordFinished($)
    throw err
  }
}

export const registerDownloads = (on: On): void => {

  // The download's own tool row, redrawn with its progress. ctrl+o still shows the original.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const d = (await read($, items)).find(x => x.id === e.props.tool_use_id)
    if (!d) return next(e)
    if (!d.items.some(i => i.bytes > 0) && d.status !== 'error') return next(e)

    const view: View =
      e.props.isInterrupted || e.props.isErrored || d.status === 'error' ? 'error' : d.status === 'running' ? 'running' : 'done'
    const shown = e.props.isInterrupted && !d.error ? { ...d, error: 'Interrupted' } : d

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const t = await $.clock.now()
    const winPath = d.watch.path.replace(/\//g, '\\')
    const open =
      d.watch.mode !== 'none' ? (
        <Button
          key={`open-${d.id}`}
          plain
          dimColor
          label="Open folder"
          onPress={() =>
            void $.process
              .run(d.watch.mode === 'file' ? ['explorer', `/select,${winPath}`] : ['explorer', winPath])
              .catch(() => undefined)
          }
        />
      ) : null

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const W = Math.max(300, Math.min(760, (e.viewport?.columns ?? 100) * 8 - 60))
      const r = beltSvg(shown, view, W, t)
      const alt = `${d.title || d.kind}: ${view}. ${d.items.map(i => `${i.name} ${itemLine(i, view === 'running')}`).join('; ')}${d.watch.mode !== 'none' ? `. Saved to ${winPath}` : ''}`
      return (
        <Box flexDirection="column">
          <Svg source={r.svg} alt={alt} width={W} height={r.h} />
          {open}
        </Box>
      )
    }

    const isRun = view === 'running'
    const color = view === 'error' ? ERR : isRun ? RUN : DONE
    const w = Math.max(10, Math.min(30, (e.viewport?.columns ?? 80) - 60))
    const bytes = d.items.reduce((a, i) => a + i.bytes, 0)
    const total = d.items.length > 0 && d.items.every(i => i.total) ? d.items.reduce((a, i) => a + (i.total ?? 0), 0) : 0
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text color={color}>● </Text>
          <Text bold>{d.title || d.kind} </Text>
          <Text color={color}>{textBar(w, isRun ? (total ? bytes / total : null) : 1)}</Text>
          <Text dimColor> {isRun ? `${size(bytes)}${total ? ` / ${size(total)}` : ''} · ${span(t - d.startedAt)}` : view}</Text>
        </Text>
        {d.items.length > 1 &&
          d.items.slice(0, 8).map(it => (
            <Text key={it.name} wrap="truncate-end" dimColor>
              {'  '}
              {it.isComplete || !isRun ? '✓' : '⇣'} {it.name} · {itemLine(it, isRun)}
            </Text>
          ))}
        {view === 'error' && shown.error && <Text color={ERR} wrap="truncate-end">  {shown.error}</Text>}
        {d.watch.mode !== 'none' && <Text dimColor wrap="truncate-end">  Saved to {winPath}</Text>}
        {open}
      </Box>
    )
  })
}
