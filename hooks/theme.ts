// The bundle's shared look (Skills, Tasks, Downloads). This file is copied, unchanged,
// into each mod, so all three draw with the same palette, type and pieces.
//
// Surfaces follow the Skills mod's warm Claude greys; status colors follow Downloads.

export const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',sans-serif"
export const MONO = "ui-monospace,'Cascadia Mono',Consolas,monospace"

/** Brand: headers, icon tiles, the Skills button. */
export const CLAY = '#D97757'
/** Working (and its lighter start, for gradients). */
export const RUN = '#8f8cf4'
export const RUN_HI = '#5fd0ff'
export const OK = '#5fbf8f'
export const BAD = '#e5636b'
export const WARN = '#e0a136'
export const MUTED = '#A39E93'
/** One color per file, agent or item, in order. */
export const ITEM_COLORS = ['#e8952b', '#5f7cf0', '#d9578f', '#22a898', '#8b66e0', '#86a83a', '#b8894f']
export const itemColor = (i: number): string => ITEM_COLORS[((i % ITEM_COLORS.length) + ITEM_COLORS.length) % ITEM_COLORS.length] as string

/** Text and surface classes every drawing uses: t (text), s (secondary), m (muted), k (card), ln (rule). */
export const SURFACE_CSS = `.t{fill:#2b2a27}.s{fill:#6b665c}.m{fill:#a39e93}.k{fill:#efebe3}.ln{stroke:#ddd6c9}.card{fill:#f7f4ee;stroke:#e3dccf}
@media (prefers-color-scheme: dark){.t{fill:#f0eee6}.s{fill:#c4beb2}.m{fill:#8f8a80}.k{fill:#2b2a27}.ln{stroke:#3b3a36}.card{fill:#24231f;stroke:#3b3a36}}`

export const xml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

const charEm = (ch: string): number => (/[\s.,:;'|!il1()[\]]/.test(ch) ? 0.3 : /[A-Z@%mw]/.test(ch) ? 0.72 : 0.56)
export const textW = (s: string, size: number): number => [...s].reduce((w, ch) => w + charEm(ch) * size, 0)

/** Cuts `s` to fit `maxW` pixels with an ellipsis; `mono` measures a monospace face. */
export function fit(s: string, size: number, maxW: number, mono = false): string {
  const w = (x: string) => (mono ? x.length * 0.6 * size : textW(x, size))
  if (w(s) <= maxW) return s
  let out = ''
  for (const ch of s) {
    if (w(out + ch + '…') > maxW) break
    out += ch
  }
  return out + '…'
}

export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export function size(n: number): string {
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

export const tok = (n: number): string => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

const svgOf = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${SURFACE_CSS}</style>${body}</svg>`

/** A pill: tinted fill, colored bold text. Returns its markup and width. */
export function pill(x: number, y: number, h: number, text: string, color: string, fontSize = 11): { svg: string; w: number } {
  const w = Math.round(text.length * 0.6 * fontSize + 16)
  return {
    w,
    svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${color}" fill-opacity="0.18"/><text x="${x + w / 2}" y="${y + h / 2 + fontSize * 0.36}" text-anchor="middle" font-family="${MONO}" font-size="${fontSize}" font-weight="700" fill="${color}">${xml(text)}</text>`,
  }
}

export type IconKind = 'pulse' | 'download' | 'sparkle' | 'image' | 'gauge'

/** The glyph inside a sidebar's clay icon tile, drawn in a 40px box at x,y. */
function glyph(kind: IconKind, x: number, y: number): string {
  const c = '#FBF7F0'
  if (kind === 'pulse') return `<path d="M${x + 7} ${y + 21} h7 l3 -8 l5 15 l3 -9 l2 2 h6" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
  if (kind === 'image') return `<rect x="${x + 9}" y="${y + 11}" width="22" height="18" rx="3" fill="none" stroke="${c}" stroke-width="2.4"/><circle cx="${x + 15}" cy="${y + 17}" r="2.2" fill="${c}"/><path d="M${x + 10} ${y + 27} l7 -7 l5 5 l3 -3 l5 5" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/>`
  if (kind === 'gauge') return `<path d="M${x + 9} ${y + 27} a11 11 0 1 1 22 0" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><path d="M${x + 20} ${y + 27} l6 -8" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><circle cx="${x + 20}" cy="${y + 27}" r="2.4" fill="${c}"/>`
  if (kind === 'download') return `<path d="M${x + 20} ${y + 9} v15 m-6 -6 l6 6 l6 -6 M${x + 11} ${y + 29} h18" fill="none" stroke="${c}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<path d="M${x + 20} ${y + 8} l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 l9 -3 z" fill="${c}"/>`
}

/** A sidebar's header, matching the Skills panel: a clay icon tile, the title, a muted subtitle. */
export function headerSvg(kind: IconKind, title: string, subtitle: string, W: number): { svg: string; h: number } {
  const H = 52
  return {
    h: H,
    svg: svgOf(W, H, `<rect x="2" y="6" width="40" height="40" rx="11" fill="${CLAY}"/>${glyph(kind, 2, 6)}
<text class="t" x="54" y="24" font-family="${FONT}" font-size="16" font-weight="700">${xml(fit(title, 16, W - 60))}</text>
<text class="m" x="54" y="41" font-family="${FONT}" font-size="12">${xml(fit(subtitle, 12, W - 60))}</text>`),
  }
}

/** A section label: spaced caps in clay, a hairline, and an optional count pill on the right. */
export function sectionSvg(label: string, W: number, count?: string): { svg: string; h: number } {
  const H = 24
  const lw = label.length * 0.6 * 10.5 * 1.12
  const p = count ? pill(W - (count.length * 0.6 * 10 + 16) - 1, 3, 18, count, MUTED, 10) : null
  const lineEnd = p ? W - p.w - 10 : W - 1
  return {
    h: H,
    svg: svgOf(W, H, `<text x="1" y="16" font-family="${MONO}" font-size="10.5" font-weight="700" letter-spacing="1.2" fill="${CLAY}">${xml(label.toUpperCase())}</text>
${lineEnd > lw + 14 ? `<line x1="${(lw + 10).toFixed(1)}" y1="12" x2="${lineEnd.toFixed(1)}" y2="12" class="ln" stroke-width="1"/>` : ''}${p ? p.svg : ''}`),
  }
}

/** A quiet one-line note in a section with nothing to show. */
export function emptySvg(text: string, W: number): { svg: string; h: number } {
  const H = 40
  return {
    h: H,
    svg: svgOf(W, H, `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" class="ln" stroke-dasharray="4 4"/>
<text class="m" x="14" y="24.5" font-family="${FONT}" font-size="12">${xml(fit(text, 12, W - 28))}</text>`),
  }
}
