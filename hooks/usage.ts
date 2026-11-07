// Usage: the rate-limit windows (5-hour, weekly, spend), context fill and cost, as the
// engine reports them. Read on startup and pushed by session.measure whenever they move.
// Samples go to $.store (shared by every session) for the hourly and weekly charts.

import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { UsageSample, UsageSnapshot, UsageWindow } from '../types'
import { clock, levelColor } from './charts'
import { BAD, CLAY, FONT, MONO, MUTED, OK, RUN, SURFACE_CSS, fit, textW, xml } from './theme'

// The state values this file reads or writes (atoms are kept per file).
const usage = atom({ plugin: 'g-hub', key: 'usage' } as const, null, { shape: 'usage-1' })

const SAMPLES_KEY = 'usage-samples-1'
const SAMPLES_MAX = 3000
const SAMPLE_EVERY = 60_000

/** A window's short name for the strip and its long one for the tab. */
export function windowName(kind: string, long = false): string {
  if (kind === 'five_hour') return long ? '5-hour window' : '5h'
  if (kind === 'seven_day') return long ? 'Weekly window' : 'week'
  if (kind === 'spend_limit') return long ? 'Spend limit' : 'spend'
  return kind.replace(/_/g, ' ')
}

type RawUsage = {
  startedAt: number
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  cost?: { usd: number }
}

function toSnapshot(u: RawUsage): UsageSnapshot {
  const windows: UsageWindow[] = u.rateLimits.map(r => ({
    kind: r.kind,
    percent: r.percentUsed,
    resetsAt: r.resetsAt ? Date.parse(r.resetsAt) || undefined : undefined,
  }))
  return {
    at: Date.now(),
    windows,
    contextPercent: u.context.percent,
    contextTokens: u.context.tokens,
    contextWindow: u.context.window,
    costUsd: u.cost?.usd,
    sessionStartedAt: u.startedAt,
  }
}

/** Reads the figures now and keeps them; called at setup and on a timer. */
export async function refreshUsage($: EngineInterface): Promise<void> {
  const u = (await $.session.usage()) as unknown as RawUsage
  await keep($, toSnapshot(u))
}

/** session.measure pushes the same figures whenever one moves. */
export async function onMeasure($: EngineInterface, e: unknown): Promise<void> {
  const m = e as { context: RawUsage['context']; rateLimits: RawUsage['rateLimits']; cost?: { usd: number } }
  const started = ((await $.session.usage()) as unknown as RawUsage).startedAt
  await keep($, toSnapshot({ startedAt: started, context: m.context, rateLimits: m.rateLimits, cost: m.cost }))
}

const WINDOWS_KEY = 'last-windows-1'

async function keep($: EngineInterface, fresh: UsageSnapshot): Promise<void> {
  let snap = fresh
  if (fresh.windows.length > 0) await $.store.set(WINDOWS_KEY, fresh.windows)
  else {
    const kept = await $.store.get(WINDOWS_KEY)
    const still = Array.isArray(kept) ? (kept as UsageWindow[]).filter(w => w.resetsAt !== undefined && w.resetsAt > fresh.at) : []
    if (still.length) snap = { ...fresh, windows: still }
  }
  await update($, usage, () => snap)
  const samples = await loadSamples($)
  const last = samples[samples.length - 1]
  const five = snap.windows.find(w => w.kind === 'five_hour')?.percent
  const week = snap.windows.find(w => w.kind === 'seven_day')?.percent
  const moved = !last || last.five !== five || last.week !== week
  if (!last || snap.at - last.at >= SAMPLE_EVERY || moved) {
    samples.push({ at: snap.at, five, week, cost: snap.costUsd })
    await $.store.set(SAMPLES_KEY, samples.slice(-SAMPLES_MAX))
  }
  memSamples = samples.slice(-SAMPLES_MAX)
}

// the samples as last read or written, so the band can measure the pace every second
let memSamples: UsageSample[] | null = null

/** The usage readings, from memory after the first read. */
export async function recentSamples($: EngineInterface): Promise<UsageSample[]> {
  if (!memSamples) memSamples = await loadSamples($)
  return memSamples
}

export async function loadSamples($: EngineInterface): Promise<UsageSample[]> {
  const v = await $.store.get(SAMPLES_KEY)
  return Array.isArray(v) ? (v as UsageSample[]) : []
}

/** Percent per hour over the last `hours`, from the samples; null without enough readings. */
export function burnRate(samples: UsageSample[], key: 'five' | 'week', hours: number, now: number): number | null {
  const since = samples.filter(s => s.at >= now - hours * 3600_000 && typeof s[key] === 'number')
  if (since.length < 2) return null
  const a = since[0] as UsageSample
  const b = since[since.length - 1] as UsageSample
  const dh = (b.at - a.at) / 3600_000
  if (dh < 0.05) return null
  const dp = (b[key] as number) - (a[key] as number)
  // a window that reset in between shows as a drop: no honest rate then
  return dp < 0 ? null : dp / dh
}

/** When a window fills at `rate` % per hour, if before it resets. */
export function fillsAt(w: UsageWindow, rate: number | null, now: number): number | null {
  if (!rate || rate <= 0) return null
  const at = now + ((100 - w.percent) / rate) * 3600_000
  return w.resetsAt && at >= w.resetsAt ? null : at
}

/** The thin status strip above the row: each window as a meter, context, cost, downloads. */
export function stripSvg(snap: UsageSnapshot | null, downloading: number, W: number, t: number): string {
  const H = 18
  const parts: string[] = []
  let x = 4
  const text = (s: string, cls: string, size = 10.5, extra = '') => {
    parts.push(`<text class="${cls}" x="${x.toFixed(1)}" y="13" font-family="${MONO}" font-size="${size}"${extra}>${xml(s)}</text>`)
    x += s.length * 0.6 * size + 6
  }
  if (!snap || (snap.windows.length === 0 && snap.costUsd === undefined && snap.contextPercent === undefined)) {
    text('usage shows after the first reply', 'm')
  } else {
    for (const w of snap.windows) {
      if (x > W - 120) break
      const c = levelColor(w.percent)
      text(windowName(w.kind), 's', 10, ' font-weight="700"')
      const mw = 44
      parts.push(`<rect x="${x.toFixed(1)}" y="5" width="${mw}" height="7" rx="3.5" fill="${MUTED}" fill-opacity="0.25"/><rect x="${x.toFixed(1)}" y="5" width="${((mw * Math.min(100, w.percent)) / 100).toFixed(1)}" height="7" rx="3.5" fill="${c}"/>`)
      x += mw + 6
      if (w.percent >= 100 && w.resetsAt) {
        parts.push(`<g class="pl"><text x="${x.toFixed(1)}" y="13" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${BAD}">cooldown ${xml(clock(w.resetsAt - t))}</text></g>`)
        x += (9 + clock(w.resetsAt - t).length) * 0.6 * 10.5 + 10
      } else {
        parts.push(`<text x="${x.toFixed(1)}" y="13" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${c}">${Math.round(w.percent)}%</text>`)
        x += `${Math.round(w.percent)}%`.length * 0.6 * 10.5 + 5
        if (w.resetsAt) text(`· ${clock(w.resetsAt - t)}`, 'm', 10)
      }
      x += 8
    }
    if (snap.contextPercent !== undefined && x < W - 70) {
      text('ctx', 's', 10, ' font-weight="700"')
      parts.push(`<text x="${x.toFixed(1)}" y="13" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${levelColor(snap.contextPercent)}">${snap.contextPercent}%</text>`)
      x += `${snap.contextPercent}%`.length * 0.6 * 10.5 + 14
    }
    if (snap.costUsd !== undefined && x < W - 50) text(`$${snap.costUsd.toFixed(2)}`, 's', 10.5)
  }
  if (downloading > 0) {
    const label = `↓ ${downloading}`
    const dx = W - label.length * 0.6 * 10.5 - 34
    if (dx > x) {
      parts.push(`<text x="${dx.toFixed(1)}" y="13" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${OK}">${xml(label)}</text>`)
      for (let k = 0; k < 3; k++) parts.push(`<rect x="${(W - 26 + k * 7).toFixed(1)}" y="6" width="5" height="5" rx="1.2" fill="${OK}" class="pk" style="animation-delay:${(-k * 0.25).toFixed(2)}s"/>`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${SURFACE_CSS}
@keyframes pl{50%{opacity:.4}}.pl{animation:pl 1.2s ease-in-out infinite}
@keyframes pk{0%{opacity:.2;transform:translateX(-4px)}50%{opacity:1}100%{opacity:.2;transform:translateX(4px)}}.pk{animation:pk .75s linear infinite}
@media (prefers-reduced-motion: reduce){.pl,.pk{animation:none}}</style>${parts.join('')}</svg>`
}

/** Countdown to the minute, so the strip's widths hold still: `3d4h`, `1h05`, `12m`, `now`. */
export function shortLeft(ms: number): string {
  const m = Math.ceil(ms / 60_000)
  if (m <= 0) return 'now'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d${h}h`
  return h > 0 ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m}m`
}

export type Meter = { key: string; label: string; percent?: number; value?: string; sub?: string; color: string; pulse?: boolean; packets?: boolean }

/** The strip's meters, in a fixed order: context, each window, cost, then downloads while any run. */
export function stripMeters(snap: UsageSnapshot | null, downloading: number, t: number): Meter[] {
  const out: Meter[] = []
  if (snap?.contextPercent !== undefined) out.push({ key: 'ctx', label: 'context', percent: snap.contextPercent, color: levelColor(snap.contextPercent) })
  for (const w of snap?.windows ?? []) {
    const p = Math.max(0, Math.min(100, Math.round(w.percent)))
    const left = w.resetsAt ? shortLeft(w.resetsAt - t) : undefined
    out.push(
      p >= 100
        ? { key: w.kind, label: windowName(w.kind), percent: 100, sub: `cooldown ${left ?? ''}`.trim(), color: BAD, pulse: true }
        : { key: w.kind, label: windowName(w.kind), percent: p, ...(left ? { sub: left } : {}), color: levelColor(p), pulse: p >= 90 },
    )
  }
  if (snap?.costUsd !== undefined) out.push({ key: 'cost', label: 'session', value: `${snap.costUsd.toFixed(2)}`, color: CLAY })
  if (downloading > 0) out.push({ key: 'dl', label: downloading === 1 ? 'download' : 'downloads', value: String(downloading), color: OK, packets: true })
  return out
}

/** One meter of the strip: a ring (or a mark), the figure, then its name and countdown in muted ink. */
export function meterSvg(m: Meter): { svg: string; w: number; h: number; alt: string } {
  const H = 30
  const R = 9
  const cx = R + 4
  const C = 2 * Math.PI * R
  const figure = m.percent !== undefined ? `${m.percent}%` : (m.value ?? '')
  const rest = ` ${m.label}${m.sub ? ` · ${m.sub}` : ''}`
  const tx = cx + R + 8
  const w = Math.ceil(tx + textW(figure, 12.5) * 1.08 + textW(rest, 12.5) + 6)
  let mark: string
  if (m.percent !== undefined) {
    const filled = (C * m.percent) / 100
    mark = `<circle cx="${cx}" cy="15" r="${R}" fill="none" stroke="${MUTED}" stroke-opacity=".25" stroke-width="3"/><g${m.pulse ? ' class="pl"' : ''}><circle cx="${cx}" cy="15" r="${R}" fill="none" stroke="${m.color}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${filled.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx} 15)"/></g>`
  } else if (m.packets) {
    mark = [0, 1, 2].map(k => `<g class="pk" style="animation-delay:${(-k * 0.25).toFixed(2)}s"><rect x="${cx - 9 + k * 6.5}" y="12" width="5" height="6" rx="1.4" fill="${m.color}"/></g>`).join('')
  } else {
    mark = `<circle cx="${cx}" cy="15" r="${R}" fill="${m.color}" fill-opacity=".16" stroke="${m.color}" stroke-width="1.5"/><text x="${cx}" y="19" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="700" fill="${m.color}">$</text>`
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}"><style>${SURFACE_CSS}
@keyframes pl{50%{opacity:.4}}.pl{animation:pl 1.2s ease-in-out infinite}
@keyframes pk{0%{opacity:.2;transform:translateX(-3px)}50%{opacity:1}100%{opacity:.2;transform:translateX(3px)}}.pk{animation:pk .75s linear infinite}
@media (prefers-reduced-motion: reduce){.pl,.pk{animation:none}}</style>${mark}<text x="${tx}" y="19.5" font-family="${FONT}" font-size="12.5"><tspan class="t" font-weight="700">${xml(figure)}</tspan><tspan class="m">${xml(rest)}</tspan></text></svg>`
  return { svg, w, h: H, alt: `${m.label} ${figure}${m.sub ? `, ${m.sub}` : ''}` }
}

/** The cooldown card shown when a window is used up. */
export function cooldownSvg(w: UsageWindow, W: number, t: number): { svg: string; h: number } {
  const H = 58
  const left = w.resetsAt ? clock(w.resetsAt - t) : 'soon'
  return {
    h: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${SURFACE_CSS}@keyframes cp{50%{opacity:.5}}.cp{animation:cp 1.4s ease-in-out infinite}@media (prefers-reduced-motion: reduce){.cp{animation:none}}</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${BAD}" fill-opacity="0.12" stroke="${BAD}" stroke-opacity="0.5"/>
<g class="cp"><circle cx="22" cy="${H / 2}" r="7" fill="${BAD}"/></g>
<text class="t" x="40" y="24" font-family="${FONT}" font-size="13.5" font-weight="700">${xml(fit(`Cooldown · ${windowName(w.kind, true)} used up`, 13.5, W - 50))}</text>
<text x="40" y="43" font-family="${MONO}" font-size="12" font-weight="700" fill="${BAD}">resets in ${xml(left)}</text></svg>`,
  }
}

export const RUN_COLOR = RUN
