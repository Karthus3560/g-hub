// Shared list rows, day headers, number tiles, charts and gauge rings for the hub.
// Pure drawing: strings of SVG, no `$`. Built on the bundle's palette in theme.ts.

import { BAD, CLAY, FONT, MONO, OK, SURFACE_CSS, WARN, fit, itemColor, span, textW, xml } from './theme'

type Piece = { svg: string; h: number }

const svgOf = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${SURFACE_CSS}</style>${body}</svg>`

/** Today, Yesterday or the date, for grouping finished things by day. */
export function dayLabel(ts: number, now: number): string {
  const dayOf = (x: number) => {
    const d = new Date(x)
    return Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000)
  }
  const diff = dayOf(now) - dayOf(ts)
  if (diff <= 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function ago(ms: number): string {
  if (ms < 60000) return 'just now'
  if (ms >= 86400000) {
    const d = Math.floor(ms / 86400000)
    return d === 1 ? 'yesterday' : `${d} days ago`
  }
  return `${span(ms)} ago`
}

/** Countdowns: m:ss, h:mm:ss, or days and hours once a day or more away. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s >= 86_400) return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`
}

/** The color for a used percentage: fine, getting close, nearly out. */
export const levelColor = (pct: number): string => (pct >= 90 ? BAD : pct >= 75 ? WARN : OK)

/** A day header inside a list: the label and a hairline. */
export function dayHeaderSvg(label: string, W: number): Piece {
  const H = 22
  const lw = textW(label, 11.5) + 10
  return {
    h: H,
    svg: svgOf(W, H, `<text class="s" x="2" y="15" font-family="${FONT}" font-size="11.5" font-weight="700">${xml(label)}</text><line x1="${lw.toFixed(1)}" y1="11" x2="${W - 1}" y2="11" class="ln" stroke-width="1"/>`),
  }
}

/** One compact list row: a status dot, a title, a muted line under it, a value on the right. */
export function rowSvg(o: { color: string; title: string; meta: string; right?: string; selected?: boolean }, W: number): Piece {
  const H = 42
  const rightW = o.right ? o.right.length * 0.6 * 11 + 10 : 0
  return {
    h: H,
    svg: svgOf(W, H, `<rect class="k" x="0.5" y="0.5" width="${W - 1}" height="${H - 4}" rx="10"${o.selected ? ` stroke="${CLAY}" stroke-width="1.4"` : ''}/>
<circle cx="15" cy="${(H - 4) / 2}" r="4.5" fill="${o.color}"/>
<text class="t" x="28" y="16.5" font-family="${FONT}" font-size="12.5" font-weight="600">${xml(fit(o.title, 12.5, W - 44 - rightW))}</text>
<text class="m" x="28" y="30.5" font-family="${MONO}" font-size="10">${xml(fit(o.meta, 10, W - 40, true))}</text>
${o.right ? `<text class="s" x="${W - 10}" y="16.5" text-anchor="end" font-family="${MONO}" font-size="11" font-variant-numeric="tabular-nums">${xml(o.right)}</text>` : ''}`),
  }
}

/** Big-number tiles in one row: a label above, the value below, a colored foot. */
export function tilesSvg(tiles: { label: string; value: string; color: string }[], W: number): Piece {
  const H = 64
  const gap = 8
  const tw = (W - gap * (tiles.length - 1)) / Math.max(1, tiles.length)
  const body = tiles
    .map((x, i) => {
      const left = i * (tw + gap)
      return `<rect class="k" x="${left.toFixed(1)}" y="0" width="${tw.toFixed(1)}" height="${H}" rx="11"/>
<rect x="${left.toFixed(1)}" y="${H - 3}" width="${tw.toFixed(1)}" height="3" rx="1.5" fill="${x.color}" fill-opacity="0.85"/>
<text class="m" x="${(left + 12).toFixed(1)}" y="20" font-family="${MONO}" font-size="9.5" letter-spacing="1">${xml(x.label.toUpperCase())}</text>
<text class="t" x="${(left + 12).toFixed(1)}" y="46" font-family="${FONT}" font-size="19" font-weight="700" font-variant-numeric="tabular-nums">${xml(fit(x.value, 19, tw - 20))}</text>`
    })
    .join('')
  return { h: H, svg: svgOf(W, H, body) }
}

/** Vertical bars to one scale with a faint grid; the last bar is emphasized. */
export function barsSvg(values: number[], labels: string[], W: number, color: string, fmt: (n: number) => string): Piece {
  const H = 130
  const top = 16
  const bottom = H - 20
  const max = Math.max(1, ...values)
  const n = Math.max(1, values.length)
  const slot = (W - 8) / n
  const bw = Math.max(3, slot * 0.62)
  const grid = [0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${(bottom - (bottom - top) * f).toFixed(1)}" y2="${(bottom - (bottom - top) * f).toFixed(1)}" class="ln" stroke-dasharray="3 4"/>`).join('')
  const bars = values
    .map((v, i) => {
      const h = v > 0 ? Math.max(2, ((bottom - top) * v) / max) : 0
      const x = 4 + i * slot + (slot - bw) / 2
      return `<rect x="${x.toFixed(1)}" y="${(bottom - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${color}" fill-opacity="${i === n - 1 ? 1 : 0.55}"/>`
    })
    .join('')
  const every = Math.ceil(n / 7)
  const labs = labels
    .map((l, i) => (i % every === 0 || i === n - 1 ? `<text class="m" x="${(4 + i * slot + slot / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-family="${MONO}" font-size="9">${xml(l)}</text>` : ''))
    .join('')
  const peak = `<text class="s" x="${W - 2}" y="11" text-anchor="end" font-family="${MONO}" font-size="9.5">max ${xml(fmt(max))}</text>`
  return { h: H, svg: svgOf(W, H, `<line x1="0" x2="${W}" y1="${bottom}" y2="${bottom}" class="ln"/>${grid}${bars}${labs}${peak}`) }
}

/** A line over time on a 0 to 100 scale, with an area under it and a live dot at the end. */
export function lineSvg(points: { x: number; y: number }[], W: number, color: string, caption: string): Piece {
  const H = 110
  const top = 18
  const bottom = H - 18
  if (points.length === 0) return { h: 50, svg: svgOf(W, 50, `<text class="m" x="${W / 2}" y="28" text-anchor="middle" font-family="${FONT}" font-size="12">No readings yet. They collect as you work.</text>`) }
  const xs = points.map(p => p.x)
  const x0 = Math.min(...xs)
  const x1 = Math.max(x0 + 1, ...xs)
  const X = (x: number) => 4 + ((x - x0) / (x1 - x0)) * (W - 12)
  const Y = (y: number) => bottom - (Math.max(0, Math.min(100, y)) / 100) * (bottom - top)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ')
  const last = points[points.length - 1] as { x: number; y: number }
  const grid = [25, 50, 75, 100].map(v => `<line x1="0" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="ln" stroke-dasharray="3 4"/>`).join('')
  return {
    h: H,
    svg: svgOf(W, H, `<style>@keyframes lp{0%,100%{opacity:1}50%{opacity:.35}}.lp{animation:lp 1.6s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.lp{animation:none}}</style>${grid}
<path d="${d} L${X(last.x).toFixed(1)} ${bottom} L${X(x0).toFixed(1)} ${bottom} Z" fill="${color}" fill-opacity="0.14"/>
<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
<circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="8" fill="${color}" fill-opacity="0.25" class="lp"/><circle cx="${X(last.x).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="4" fill="${color}"/>
<text class="m" x="2" y="11" font-family="${MONO}" font-size="9.5">${xml(caption)}</text>
<text class="m" x="${W - 2}" y="${H - 4}" text-anchor="end" font-family="${MONO}" font-size="9">now</text>`),
  }
}

/** Share by category as a donut, with a legend beside it. */
export function donutSvg(parts: { label: string; value: number }[], W: number): Piece {
  const H = Math.max(110, parts.length * 18 + 22)
  const total = parts.reduce((a, p) => a + p.value, 0) || 1
  const cx = 54
  const cy = H / 2
  const r = 38
  const C = 2 * Math.PI * r
  let off = 0
  const arcs = parts
    .map((p, i) => {
      const len = (p.value / total) * C
      const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${itemColor(i)}" stroke-width="14" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
      off += len
      return s
    })
    .join('')
  const legend = parts
    .map((p, i) => {
      const y = 20 + i * 18
      return `<rect x="112" y="${y - 9}" width="10" height="10" rx="2.5" fill="${itemColor(i)}"/><text class="t" x="128" y="${y}" font-family="${FONT}" font-size="12">${xml(fit(p.label, 12, W - 190))}</text><text class="s" x="${W - 2}" y="${y}" text-anchor="end" font-family="${MONO}" font-size="11">${Math.round((p.value / total) * 100)}%</text>`
    })
    .join('')
  return { h: H, svg: svgOf(W, H, `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="ln" stroke-width="14"/>${arcs}${legend}`) }
}

/** A gauge ring: the used part sweeps in, the value sits in the middle, a countdown under it. */
export function ringSvg(o: { label: string; percent: number; sub: string; color: string; pulse?: boolean }, size: number): Piece {
  const H = size + 30
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 9
  const C = 2 * Math.PI * r
  const used = (Math.max(0, Math.min(100, o.percent)) / 100) * C
  return {
    h: H,
    svg: svgOf(size, H, `<style>@keyframes rp{50%{opacity:.45}}.rp{animation:rp 1.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.rp{animation:none}}</style>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="ln" stroke-width="10"/>
<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${o.color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${used.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>
<text class="t" x="${cx}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-family="${FONT}" font-size="${Math.round(size * 0.21)}" font-weight="800">${Math.round(o.percent)}%</text>
<text class="m" x="${cx}" y="${(cy + size * 0.17).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="9.5" letter-spacing="1">${xml(o.label.toUpperCase())}</text>
<g${o.pulse ? ' class="rp"' : ''}><text x="${cx}" y="${size + 20}" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${o.color}">${xml(o.sub)}</text></g>`),
  }
}
