// Clawd's band: the little clay creature from Claude Code's welcome screen walks the plan
// along the top line, and the limits are Clawd-shaped batteries that fill with clay.
//
// Pure drawing code (no engine calls), so the preview page can render every state.
// Every animation is CSS, started part-way in by a negative delay taken from the clock,
// so a redraw each second picks up where the last one was instead of starting over.

import type { Flow, UsageWindow } from '../types'
import { BAD, CLAY, FONT, MONO, OK, SURFACE_CSS, WARN, fit, itemColor, textW, xml } from './theme'

const DARK = '#1c1b19'
const EMPTY = '#8a857b'
const VERBS = ['clauding', 'pondering', 'tinkering', 'noodling', 'brewing', 'scheming', 'puttering']

/** How long Clawd celebrates a finished plan, and how long he waits before he naps. */
const PARTY_MS = 8_000
const NAP_AFTER_MS = 10 * 60_000

const ph = (t: number, d: number, off = 0): string => `animation-delay:-${(((t + off) % d) / 1000).toFixed(3)}s`

const CSS = `<style>${SURFACE_CSS}
@keyframes la{0%,49%{opacity:1}50%,100%{opacity:0}}.la{animation:la .36s steps(1) infinite}
@keyframes lb{0%,49%{opacity:0}50%,100%{opacity:1}}.lb{animation:lb .36s steps(1) infinite}
@keyframes bob{50%{transform:translateY(-1px)}}.bob{animation:bob .36s steps(2) infinite}
@keyframes hop{0%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}.hop{animation:hop .6s cubic-bezier(.3,.7,.4,1) infinite}
@keyframes spin{to{transform:rotate(360deg)}}.spin{animation:spin 2.4s linear infinite;transform-box:fill-box;transform-origin:center}
@keyframes zz{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(6px,-12px);opacity:0}}.zz{animation:zz 2.2s ease-out infinite;opacity:0}
@keyframes pop{0%{transform:scale(.2);opacity:0}30%{opacity:1}100%{transform:scale(1.4) translateY(-4px);opacity:0}}.pop{animation:pop 1s ease-out infinite;transform-box:fill-box;transform-origin:center;opacity:0}
@keyframes eye{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}.eye{animation:eye 3.6s infinite;transform-box:fill-box;transform-origin:center}
@keyframes chg{50%{opacity:.35}}.chg{animation:chg 1.2s ease-in-out infinite}
@keyframes wave{0%,100%{transform:rotate(0)}50%{transform:rotate(-25deg)}}.wave{animation:wave .5s ease-in-out infinite;transform-box:fill-box;transform-origin:0 100%}
@media (prefers-reduced-motion: reduce){.la,.lb,.bob,.hop,.spin,.zz,.pop,.eye,.chg,.wave{animation:none}.lb,.zz,.pop{opacity:0}}</style>`

// ---------------------------------------------------------------- Clawd himself
// 11 x 5 pixels: a head with two eye slots, arms out to the sides, four little legs.
const BODY = ['..XXXXXXX..', '..XEXXXEX..', 'XXXXXXXXXXX', '..XXXXXXX..']
const LEGS_A = '..X.X.X.X..'
const LEGS_B = '.X.X...X.X.'
const LEGS_SIT = '..XX...XX..'
const EYES = [3, 7]

function px(rows: string[], s: number, fill: string, y0 = 0): string {
  let out = ''
  rows.forEach((r, y) =>
    [...r].forEach((c, x) => {
      if (c === 'X') out += `<rect x="${(x * s).toFixed(2)}" y="${((y + y0) * s).toFixed(2)}" width="${(s + 0.6).toFixed(2)}" height="${(s + 0.6).toFixed(2)}" fill="${fill}"/>`
    }),
  )
  return `<g shape-rendering="crispEdges">${out}</g>`
}

export type Mood = 'walk' | 'sit' | 'sleep' | 'hop' | 'worried'

function eyes(s: number, mood: Mood, t: number): string {
  if (mood === 'sleep') return EYES.map(x => `<rect x="${x * s}" y="${(s * 1.55).toFixed(2)}" width="${s}" height="${(s * 0.3).toFixed(2)}" fill="${DARK}"/>`).join('')
  if (mood === 'worried')
    return EYES.map(x => `<rect x="${x * s}" y="${(s * 1.2).toFixed(2)}" width="${s}" height="${(s * 0.8).toFixed(2)}" fill="${DARK}"/>`).join('') + `<rect x="${4.5 * s}" y="${(3.3 * s).toFixed(2)}" width="${2 * s}" height="${(s * 0.35).toFixed(2)}" fill="${DARK}" opacity=".6"/>`
  if (mood === 'hop') return EYES.map(x => `<path d="M${x * s} ${(s * 1.8).toFixed(2)} L${x * s + s / 2} ${(s * 1.15).toFixed(2)} L${x * s + s} ${(s * 1.8).toFixed(2)}" fill="none" stroke="${DARK}" stroke-width="${(s * 0.3).toFixed(2)}"/>`).join('')
  return `<g class="eye" style="${ph(t, 3600)}">${EYES.map(x => `<rect x="${x * s}" y="${s}" width="${s}" height="${s}" fill="${DARK}"/>`).join('')}</g>`
}

/** Clawd at pixel size `s` (11s wide, 5s tall). */
export function clawd(s: number, mood: Mood, t: number, fill = CLAY): string {
  let legs: string
  if (mood === 'walk') legs = `<g class="la" style="${ph(t, 360)}">${px([LEGS_A], s, fill, 4)}</g><g class="lb" style="${ph(t, 360)}">${px([LEGS_B], s, fill, 4)}</g>`
  else if (mood === 'sit' || mood === 'sleep') legs = px([LEGS_SIT], s, fill, 4)
  else legs = px([LEGS_A], s, fill, 4)
  return px(BODY, s, fill) + eyes(s, mood, t) + legs
}

/** The starburst from Claude's logo: uneven rays around a point. */
export function spark(cx: number, cy: number, r: number, fill = CLAY, extra = ''): string {
  let d = ''
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2
    const len = r * (i % 2 ? 0.72 : 1)
    const w = r * 0.16
    const nx = Math.cos(a + Math.PI / 2) * w
    const ny = Math.sin(a + Math.PI / 2) * w
    d += `M${(cx + nx).toFixed(2)} ${(cy + ny).toFixed(2)} L${(cx + Math.cos(a) * len).toFixed(2)} ${(cy + Math.sin(a) * len).toFixed(2)} L${(cx - nx).toFixed(2)} ${(cy - ny).toFixed(2)} Z `
  }
  return `<path ${extra} d="${d}" fill="${fill}"/><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(r * 0.22).toFixed(2)}" fill="${fill}"/>`
}

// ---------------------------------------------------------------- the top line
const stepsText = (n: number): string => (n === 0 ? 'quick answer' : `${n} ${n === 1 ? 'step' : 'steps'}`)

export type Walk = { title: string; meta: string; mood: Mood; progress: number; marks: number; passed: number; party: boolean; agents: number }

/** What the top line shows for a flow: who Clawd is, where he stands, what to say. */
export function walkOf(f: Flow | null, t: number, agents: number): Walk {
  const base = { agents }
  if (!f) return { ...base, title: 'Ready when you are', meta: 'waiting for a message', mood: 'sit', progress: 0, marks: 0, passed: 0, party: false }
  const since = f.endedAt ? t - f.endedAt : 0
  const total = f.live ? 0 : f.tasks.length
  const done = f.tasks.filter(x => x.status === 'completed').length
  const current = f.tasks.find(x => x.status === 'in_progress')
  if (f.isStopped)
    return { ...base, title: 'Stopped', meta: f.live ? stepsText(f.steps) : `${done}/${total} done`, mood: 'worried', progress: total ? done / total : 0.5, marks: total || Math.min(f.steps, 12), passed: total ? done : Math.min(f.steps, 12), party: false }
  if (f.isFinished) {
    const party = since < PARTY_MS
    const mood: Mood = party ? 'hop' : since > NAP_AFTER_MS ? 'sleep' : 'sit'
    const n = total || Math.min(f.steps, 12)
    return { ...base, title: party ? 'All done!' : since > NAP_AFTER_MS ? 'Napping · send a message' : 'Done', meta: total ? `${total}/${total} · ${f.endedAt ? 'finished' : ''}`.trim() : stepsText(f.steps), mood, progress: 1, marks: n, passed: n, party }
  }
  if (total) {
    const title = current?.title ?? f.tasks.find(x => x.status === 'pending')?.title ?? 'Working'
    return { ...base, title, meta: `${done}/${total} · ${Math.round((done / total) * 100)}%`, mood: 'walk', progress: Math.min(0.97, (done + 0.5) / total), marks: total, passed: done, party: false }
  }
  // a turn with no task list: each tool call is a step, the road has no known end
  const n = Math.min(f.steps, 12)
  return { ...base, title: f.prompt || 'Working', meta: stepsText(f.steps), mood: 'walk', progress: Math.min(0.92, 1 - 1 / (1 + f.steps / 6)), marks: n, passed: n, party: false }
}

/** The full-width top line: title on the left, Clawd walking the path to the flag. */
export function clawdLineSvg(w: Walk, W: number, t: number): string {
  const H = 34
  const titleMax = Math.min(240, Math.max(90, W * 0.28))
  const x0 = Math.ceil(Math.min(titleMax, Math.max(textW(fit(w.title, 12.5, titleMax), 12.5), 90)) + 22)
  const x1 = W - 36
  const s = 2.4
  const cw = 11 * s
  const parts: string[] = []
  parts.push(`<line x1="${x0}" y1="30" x2="${x1 + 20}" y2="30" stroke="${EMPTY}" stroke-opacity=".45" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>`)
  const marks = Math.max(0, w.marks)
  for (let i = 0; i < marks; i++) {
    const x = x0 + ((x1 - x0) * (i + 0.5)) / marks
    if (i < w.passed) parts.push(w.party ? `<g class="pop" style="${ph(t, 1000, i * 140)}">${spark(x, 21, 6)}</g>${spark(x, 24, 4.5, CLAY, 'opacity=".55"')}` : spark(x, 24, 4.5))
    else parts.push(`<rect x="${(x - 2).toFixed(1)}" y="26" width="4" height="4" fill="${EMPTY}" fill-opacity=".55"/>`)
  }
  // the flag at the end of the road
  parts.push(`<line x1="${x1 + 20}" y1="8" x2="${x1 + 20}" y2="30" stroke="${EMPTY}" stroke-width="1.6"/><g ${w.party ? `class="wave" style="${ph(t, 500)}"` : ''}><path d="M${x1 + 21} 8 L${x1 + 31} 11.5 L${x1 + 21} 15 Z" fill="${CLAY}"/></g>`)
  const atEnd = w.progress >= 1
  const at = atEnd ? x1 + 2 - cw : x0 + (x1 - x0) * w.progress - cw / 2
  const anim = w.mood === 'hop' ? `class="hop" style="${ph(t, 600)}"` : w.mood === 'walk' ? `class="bob" style="${ph(t, 360)}"` : ''
  parts.push(`<g transform="translate(${at.toFixed(1)} ${(30 - 5 * s).toFixed(1)})"><g ${anim}>${clawd(s, w.mood, t)}</g></g>`)
  if (w.mood === 'walk') {
    const verb = `${VERBS[Math.floor(t / 2200) % VERBS.length]}…${w.agents ? ` +${w.agents} ${w.agents === 1 ? 'helper' : 'helpers'}` : ''}`
    const vx = at + cw + 9
    // the thought goes left of Clawd near the flag, so it never runs off the line
    const left = vx + 14 + verb.length * 6.3 > W
    const sx = left ? at - 9 : vx
    parts.push(`<g class="spin" style="${ph(t, 2400)}">${spark(sx, 9, 5)}</g>`)
    parts.push(`<text x="${left ? sx - 8 : sx + 8}" y="12.5" ${left ? 'text-anchor="end" ' : ''}font-family="${MONO}" font-size="10.5" font-style="italic" fill="#e3a990">${xml(verb)}</text>`)
  }
  if (w.mood === 'sleep') parts.push([0, 1].map(i => `<text class="zz" style="${ph(t, 2200, i * 1100)}" x="${(at + cw + 2).toFixed(1)}" y="12" font-size="${8 + i * 2}" font-family="${MONO}" fill="${EMPTY}">z</text>`).join(''))
  if (w.mood === 'worried') parts.push(`<text x="${(at + cw + 4).toFixed(1)}" y="12" font-family="${MONO}" font-size="11" font-weight="700" fill="${BAD}">!</text>`)
  parts.push(`<text class="t" x="2" y="15" font-family="${FONT}" font-size="12.5" font-weight="700">${xml(fit(w.title, 12.5, x0 - 20))}</text>`)
  parts.push(`<text class="m" x="2" y="29" font-family="${MONO}" font-size="10.5">${xml(fit(w.meta, 10.5, x0 - 20, true))}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${parts.join('')}</svg>`
}

// ---------------------------------------------------------------- the meters
const level = (used: number): string => (used >= 90 ? BAD : used >= 70 ? WARN : CLAY)

/** Countdown to the minute, so the meters' widths hold still: `3d 4h`, `1h 05m`, `12m`, `now`. */
export function leftText(ms: number): string {
  const m = Math.ceil(ms / 60_000)
  if (m <= 0) return 'now'
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export type Meter = { svg: string; w: number; h: number; alt: string }

/** `short`, when given, makes the compact one-line form: the figure, the name, then `short`. */
function meterSvg(art: string, artW: number, big: string, name: string, small: string, bigColor?: string, short?: string): Meter {
  const H = 30
  const tx = artW + 6
  const fig = `<tspan ${bigColor ? `fill="${bigColor}"` : 'class="t"'} font-weight="700">${xml(big)}</tspan>`
  if (short !== undefined) {
    const tail = short ? ` · ${short}` : ''
    const w = Math.ceil(tx + textW(big, 12.5) * 1.08 + textW(` ${name}`, 12.5) + tail.length * 0.6 * 10.5 + 4)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${CSS}${art}<text x="${tx}" y="19.5" font-family="${FONT}" font-size="12.5">${fig}<tspan class="m">${xml(` ${name}`)}</tspan><tspan class="m" font-family="${MONO}" font-size="10.5">${xml(tail)}</tspan></text></svg>`
    return { svg, w, h: H, alt: `${name} ${big}, ${small}` }
  }
  const w = Math.ceil(tx + Math.max(textW(big, 12.5) * 1.08 + textW(` ${name}`, 12.5), small.length * 0.6 * 10.5) + 4)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${CSS}${art}<text x="${tx}" y="13" font-family="${FONT}" font-size="12.5">${fig}<tspan class="m">${xml(` ${name}`)}</tspan></text><text class="m" x="${tx}" y="26" font-family="${MONO}" font-size="10.5">${xml(small)}</text></svg>`
  return { svg, w, h: H, alt: `${name} ${big}, ${small}` }
}

/** A limit as a Clawd-shaped battery: clay fills him from the feet up with what's left. */
export function batterySvg(win: UsageWindow, name: string, rate: number | null, t: number, id: string, compact = false): Meter {
  const s = 3.2
  const W = 11 * s
  const Hh = 5 * s
  const used = Math.max(0, Math.min(100, Math.round(win.percent)))
  const left = 100 - used
  const out = left <= 0
  const lvl = (Hh * left) / 100
  const y0 = 3
  const mood: Mood = out ? 'sleep' : left < 30 ? 'worried' : 'walk'
  const silhouette = [...BODY, LEGS_A]
  let art = `<defs><clipPath id="${id}"><rect x="0" y="${(Hh - lvl).toFixed(2)}" width="${W + 1}" height="${(lvl + 1).toFixed(2)}"/></clipPath></defs><g transform="translate(0 ${y0})">`
  art += px(silhouette, s, EMPTY).replace('<g ', '<g opacity=".35" ')
  art += `<g clip-path="url(#${id})">${px(silhouette, s, level(used))}</g>`
  art += mood === 'walk' ? eyes(s, 'sit', t) : eyes(s, mood, t)
  if (out) art += `<g class="chg" style="${ph(t, 1200)}"><path d="M${W + 4} 1 L${W + 1} 7 L${W + 4} 7 L${W + 2} 12 L${W + 7} 5 L${W + 4} 5 L${W + 6} 1 Z" fill="${WARN}"/></g>`
  art += '</g>'
  const reset = win.resetsAt ? leftText(win.resetsAt - t) : ''
  let small: string
  if (out) small = reset ? `recharged in ${reset}` : 'recharging'
  else if (rate && rate > 0 && win.resetsAt) {
    const lasts = (left / rate) * 3600_000
    small = lasts >= win.resetsAt - t ? `till reset · ${reset}` : `${leftText(lasts)} left · reset ${reset}`
  } else small = reset ? `resets in ${reset}` : 'no reset reported'
  return meterSvg(art, W + 9, out ? 'recharging' : `${left}%`, name, small, out ? WARN : undefined, compact ? reset : undefined)
}

/** Context as Clawd's thought cloud, filling as the conversation grows. */
export function cloudSvg(percent: number, id: string, compact = false): Meter {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const shape = '<path d="M8 23 Q2 23 3 18 Q2 13 8 13 Q9 7 16 8 Q21 5 25 10 Q32 10 31 16 Q34 22 27 23 Z"/>'
  const lvl = (16 * p) / 100
  const fill = p >= 90 ? BAD : p >= 70 ? WARN : '#e3a990'
  const art = `<defs><clipPath id="${id}">${shape}</clipPath></defs><g fill="${EMPTY}" fill-opacity=".35">${shape}</g><rect x="0" y="${(23 - lvl).toFixed(1)}" width="34" height="${(lvl + 1).toFixed(1)}" fill="${fill}" clip-path="url(#${id})"/><circle cx="5" cy="26" r="1.5" fill="${EMPTY}" fill-opacity=".35"/>${p >= 70 ? spark(17, 15, 3.2, '#ffffff', 'opacity=".85"') : ''}`
  return meterSvg(art, 34, `${p}%`, compact ? 'ctx' : 'thoughts', p >= 70 ? 'head full · compact' : 'room to think', undefined, compact ? (p >= 70 ? 'full' : '') : undefined)
}

/** Spend instead of windows (an API key has no reset windows): a clay coin. */
export function costSvg(usd: number, compact = false): Meter {
  const art = `<circle cx="13" cy="15" r="10" fill="${CLAY}" fill-opacity=".18" stroke="${CLAY}" stroke-width="1.5"/><text x="13" y="19.5" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="${CLAY}">$</text>`
  return meterSvg(art, 26, `$${usd.toFixed(2)}`, 'session', 'this session so far', undefined, compact ? '' : undefined)
}

// ---------------------------------------------------------------- the terminal monitor
// A little screen the height of the two button rows: the step written like a prompt line,
// and a heartbeat drawn from Claude Code's spinner glyphs. The beat is laid out once per
// draw and slides by one beat with CSS, so it moves smoothly between redraws.

export type MonitorMode = 'run' | 'idle' | 'done' | 'stop'
/** One segment of the bar: finished, the one being worked on, still to do, or where a turn broke off. */
export type Seg = 'done' | 'now' | 'todo' | 'stop'
/** `names` holds each segment's task title (empty for a turn without a task list). */
export type Monitor = { title: string; meta: string; mode: MonitorMode; progress: number; agents: number; elapsed: number; steps: number; segs: Seg[]; names: string[] }

/** Most segments a turn without a task list draws (one per tool call, the latest ones). */
const MAX_SEGS = 24

/** What the monitor shows for a flow. */
export function monitorOf(f: Flow | null, t: number, agents: number): Monitor {
  const w = walkOf(f, t, agents)
  const mode: MonitorMode = !f ? 'idle' : f.isStopped ? 'stop' : f.isFinished ? 'done' : 'run'
  const title = mode === 'idle' ? 'Ready when you are' : mode === 'done' ? (f?.live ? 'Done' : 'All done') : w.title
  const elapsed = f ? (f.endedAt ?? t) - f.startedAt : 0
  let segs: Seg[] = []
  if (f && !f.live && f.tasks.length) {
    segs = f.tasks.map(x => (x.status === 'completed' ? 'done' : x.status === 'in_progress' ? (mode === 'stop' ? 'stop' : mode === 'done' ? 'done' : 'now') : 'todo'))
  } else if (f) {
    segs = Array.from({ length: Math.min(f.steps, mode === 'done' ? MAX_SEGS : MAX_SEGS - 1) }, (): Seg => 'done')
    if (mode === 'run') segs.push('now')
    if (mode === 'stop') segs.push('stop')
    if (segs.length === 0) segs = ['done'] // a quick answer: one segment, filled
  }
  const names = f && !f.live && f.tasks.length ? f.tasks.map(x => x.title) : []
  return { title, meta: w.meta, mode, progress: mode === 'idle' ? 0 : w.progress, agents, elapsed: Math.max(0, elapsed), steps: f?.steps ?? 0, segs, names }
}

const SEG_GAP = 3
const STRIPE = 7

/** The segmented bar: each segment its own color and labeled with its task; the one in
 *  progress fills with moving stripes and also says what Claude is up to. */
function segBar(segs: Seg[], names: string[], verb: string, x0: number, x1: number, top: number, h: number, t: number, id: string): string {
  const out: string[] = []
  if (segs.length === 0) {
    out.push(`<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${h}" rx="6" fill="${EMPTY}" fill-opacity=".08" stroke="${EMPTY}" stroke-opacity=".28" stroke-dasharray="3 3"/>`)
    out.push(`<text x="${(x0 + x1) / 2}" y="${top + h / 2 + 3.5}" text-anchor="middle" font-family="${MONO}" font-size="10" font-style="italic" fill="#6b675f">send a message to start</text>`)
    return out.join('')
  }
  const n = segs.length
  const w = (x1 - x0 - SEG_GAP * (n - 1)) / n
  const r = Math.min(6, w / 2)
  const label = (x: number, y: number, text: string, fill: string, size: number, extra = ''): string =>
    `<text x="${(x + w / 2).toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="${size}" fill="${fill}"${extra}>${xml(text)}</text>`
  segs.forEach((st, i) => {
    const x = x0 + i * (w + SEG_GAP)
    const c = itemColor(i)
    const box = `x="${x.toFixed(2)}" y="${top}" width="${w.toFixed(2)}" height="${h}" rx="${r.toFixed(1)}"`
    if (st === 'done') {
      out.push(`<rect ${box} fill="${c}"/><rect x="${(x + 1).toFixed(2)}" y="${top + 1}" width="${Math.max(0, w - 2).toFixed(2)}" height="${(h / 2 - 1).toFixed(1)}" rx="${Math.max(0, r - 1).toFixed(1)}" fill="#ffffff" fill-opacity=".14"/>`)
    } else if (st === 'now') {
      const lines: string[] = []
      for (let lx = -h; lx < w + h + STRIPE; lx += STRIPE) lines.push(`<line x1="${(x + lx).toFixed(1)}" y1="${top + h}" x2="${(x + lx + h).toFixed(1)}" y2="${top}" stroke="${c}" stroke-opacity=".55" stroke-width="3"/>`)
      out.push(`<defs><clipPath id="${id}n${i}"><rect ${box}/></clipPath></defs>`)
      out.push(`<rect ${box} fill="${c}" fill-opacity=".2"/>`)
      out.push(`<g clip-path="url(#${id}n${i})"><g class="${id}p" style="${ph(t, 600)}">${lines.join('')}</g></g>`)
      out.push(`<g class="${id}q" style="${ph(t, 1400)}"><rect ${box} fill="none" stroke="${c}" stroke-width="1.6"/></g>`)
    } else if (st === 'stop') {
      out.push(`<rect ${box} fill="${BAD}" fill-opacity=".25" stroke="${BAD}" stroke-width="1.3"/>`)
    } else {
      out.push(`<rect ${box} fill="${EMPTY}" fill-opacity=".08" stroke="${EMPTY}" stroke-opacity=".32" stroke-dasharray="2 2"/>`)
    }
    // the label: the task's name where it fits, its number where only that fits
    const ink = st === 'done' ? '#1c1b19' : st === 'stop' ? BAD : st === 'now' ? '#ffffff' : '#8a857b'
    const name = names[i] ?? ''
    const room = w - 12
    const mid = top + h / 2 + 3.5
    if (st === 'now' && room >= 40) {
      // two lines: the task (or the step number) and what Claude is doing right now
      out.push(label(x, top + h / 2 - 2, fit(name || `step ${i + 1}`, 10, room, true), ink, 10, ' font-weight="700"'))
      out.push(label(x, top + h / 2 + 10, fit(verb, 9.5, room, true), '#ffd9c4', 9.5, ' font-style="italic"'))
    } else if (name && room >= 30) {
      out.push(label(x, mid, fit(name, 10, room, true), ink, 10, ` font-weight="700"${st === 'done' ? ' fill-opacity=".8"' : ''}`))
    } else if (w >= 12) {
      out.push(label(x, mid, String(i + 1), ink, 10, ` font-weight="700"${st === 'done' ? ' fill-opacity=".75"' : ''}`))
    }
  })
  return out.join('')
}

const elapsedText = (ms: number): string =>
  ms < 60_000 ? `${Math.floor(ms / 1000)}s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)}m ${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}s` : leftText(ms)

export function monitorSvg(m: Monitor, W: number, H: number, t: number, id: string): string {
  const x0 = 8
  const x1 = W - 8
  const barTop = 22
  const barH = H - barTop - 7
  const css = `<style>
@keyframes ${id}p{to{transform:translateX(${STRIPE}px)}}.${id}p{animation:${id}p .6s linear infinite}
@keyframes ${id}q{50%{opacity:.35}}.${id}q{animation:${id}q 1.4s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.${id}p,.${id}q{animation:none}}</style>`
  const parts: string[] = []
  parts.push(`<defs><clipPath id="${id}f"><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="9"/></clipPath></defs>`)
  parts.push(`<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="9" fill="#1f1d1b" stroke="#3b3a36"/>`)
  parts.push(`<g clip-path="url(#${id}f)">`)
  for (let gx = 0; gx < W; gx += 22) parts.push(`<line x1="${gx}" y1="18" x2="${gx}" y2="${H}" stroke="#2a2825"/>`)
  const verb = `${VERBS[Math.floor(t / 2200) % VERBS.length]}…`
  const allDone = m.mode === 'done' && m.segs.every(x => x === 'done')
  parts.push(segBar(m.segs, m.names, verb, x0, allDone ? x1 - 18 : x1, barTop, barH, t, id))
  if (allDone) parts.push(`<path d="M${x1 - 12} ${barTop + barH / 2} l3.5 3.5 l7.5 -8.5" stroke="${OK}" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`)
  parts.push('</g>')

  // the header: the step like a prompt line on the left; progress and the time on the right
  const time = elapsedText(m.elapsed)
  const base = m.meta.replace(/ · finished$/, '')
  const metaText =
    m.mode === 'idle' ? 'waiting'
    : m.mode === 'run' ? `${base}${m.agents ? ` · +${m.agents}` : ''} · ${time}`
    : m.mode === 'done' ? `${base} · ✓ ${time}`
    : `${base} · stopped ${time}`
  const metaColor = m.mode === 'stop' ? BAD : m.mode === 'done' ? OK : '#9a958b'
  const metaW = metaText.length * 0.6 * 10.5
  parts.push(`<text x="10" y="14" font-family="${MONO}" font-size="11.5" font-weight="700" fill="#ecebe6"><tspan fill="${CLAY}">❯</tspan> ${xml(fit(m.title, 11.5, W - metaW - 44, true))}</text>`)
  parts.push(`<text x="${W - 10}" y="14" text-anchor="end" font-family="${MONO}" font-size="10.5" fill="${metaColor}">${xml(metaText)}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${css}${parts.join('')}</svg>`
}

// ---------------------------------------------------------------- slim meters (stacked beside the monitor)
function slimSvg(art: string, big: string, name: string, tail: string, bigColor?: string): Meter {
  const H = 20
  const tx = 26
  const w = Math.ceil(tx + textW(big, 12) * 1.08 + textW(` ${name}`, 12) + tail.length * 0.6 * 10.5 + 4)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">${CSS}${art}<text x="${tx}" y="14" font-family="${FONT}" font-size="12"><tspan ${bigColor ? `fill="${bigColor}"` : 'class="t"'} font-weight="700">${xml(big)}</tspan><tspan class="m">${xml(` ${name}`)}</tspan><tspan class="m" font-family="${MONO}" font-size="10.5">${xml(tail)}</tspan></text></svg>`
  return { svg, w, h: H, alt: `${name} ${big}${tail}` }
}

/** A limit as a small Clawd battery on one line: what's left, then how long it lasts or when it resets. */
export function slimBatterySvg(win: UsageWindow, name: string, rate: number | null, t: number, id: string): Meter {
  const s = 1.8
  const Wc = 11 * s
  const Hc = 5 * s
  const used = Math.max(0, Math.min(100, Math.round(win.percent)))
  const left = 100 - used
  const lv = (Hc * left) / 100
  const rows = [...BODY, LEGS_A]
  let art = `<defs><clipPath id="${id}"><rect x="0" y="${(Hc - lv).toFixed(2)}" width="${Wc + 1}" height="${(lv + 1).toFixed(2)}"/></clipPath></defs><g transform="translate(2 5)">`
  art += px(rows, s, EMPTY).replace('<g ', '<g opacity=".35" ')
  art += `<g clip-path="url(#${id})">${px(rows, s, level(used))}</g>`
  art += left <= 0 ? eyes(s, 'sleep', t) : left < 30 ? eyes(s, 'worried', t) : eyes(s, 'sit', t)
  art += '</g>'
  const reset = win.resetsAt ? leftText(win.resetsAt - t) : ''
  let tail: string
  if (left <= 0) tail = reset ? ` · back ${reset}` : ''
  else if (rate && rate > 0 && win.resetsAt && (left / rate) * 3600_000 < win.resetsAt - t) tail = ` · ${leftText((left / rate) * 3600_000)} left`
  else tail = reset ? ` · till reset · ${reset}` : ''
  return slimSvg(art, left <= 0 ? 'recharging' : `${left}%`, name, tail, left <= 0 ? WARN : undefined)
}

/** Context as a small thought cloud on one line. */
export function slimCloudSvg(percent: number, id: string): Meter {
  const p = Math.max(0, Math.min(100, Math.round(percent)))
  const shape = '<path d="M5 15 Q1 15 2 11.5 Q1 8 5 8 Q6 4 10.5 5 Q13.5 3 16 6 Q20.5 6 20 10 Q22 14 17.5 15 Z"/>'
  const lvl = (11 * p) / 100
  const fill = p >= 90 ? BAD : p >= 70 ? WARN : '#e3a990'
  const art = `<defs><clipPath id="${id}">${shape}</clipPath></defs><g fill="${EMPTY}" fill-opacity=".35">${shape}</g><rect x="0" y="${(15 - lvl).toFixed(1)}" width="23" height="${(lvl + 1).toFixed(1)}" fill="${fill}" clip-path="url(#${id})"/>`
  return slimSvg(art, `${p}%`, 'context', p >= 70 ? ' · compact soon' : '')
}

/** Spend on one line, for an API key with no reset windows. */
export function slimCostSvg(usd: number): Meter {
  const art = `<circle cx="11" cy="10" r="7.5" fill="${CLAY}" fill-opacity=".18" stroke="${CLAY}" stroke-width="1.3"/><text x="11" y="13.8" text-anchor="middle" font-family="${FONT}" font-size="10" font-weight="700" fill="${CLAY}">$</text>`
  return slimSvg(art, `$${usd.toFixed(2)}`, 'session', '')
}

// ---------------------------------------------------------------- the usage grid (beside the monitor)
// Two rows of two tiles, the same height as the button grid:
//   context        | 5-hour reset
//   session time   | weekly reset
// Each tile is an icon and its figure, with a small label under the figure.

const TILE_W = 128
const TILE_H = 29
const GRID_GAP = 4

function tileBox(x: number, y: number, icon: string, value: string, label: string, valueColor?: string): string {
  return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${TILE_W - 1}" height="${TILE_H - 1}" rx="8" fill="${EMPTY}" fill-opacity=".1" stroke="${EMPTY}" stroke-opacity=".22"/>` +
    `<g transform="translate(${x + 5} ${y + 3.5})">${icon}</g>` +
    `<text x="${x + 32}" y="${y + 13}" font-family="${FONT}" font-size="12.5" font-weight="700" ${valueColor ? `fill="${valueColor}"` : 'class="t"'}>${xml(value)}</text>` +
    `<text class="m" x="${x + 32}" y="${y + 24}" font-family="${MONO}" font-size="9.5">${xml(fit(label, 9.5, TILE_W - 36, true))}</text>`
}

/** A ring for a reset window: the arc is how much is used, colored by level; ticks mark the days of a week. */
function ringIcon(used: number | null, days: number, t: number, pulse: boolean): string {
  const r = 9
  const C = 2 * Math.PI * r
  const cx = 11
  const cy = 11
  let s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${EMPTY}" stroke-opacity=".3" stroke-width="3"/>`
  if (used !== null) {
    const f = (C * Math.max(0, Math.min(100, used))) / 100
    s += `<g${pulse ? ` class="chg" style="${ph(t, 1200)}"` : ''}><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${level(used)}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${f.toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/></g>`
  }
  for (let i = 0; i < days; i++) {
    const a = (i / days) * Math.PI * 2 - Math.PI / 2
    s += `<line x1="${(cx + Math.cos(a) * 4.2).toFixed(2)}" y1="${(cy + Math.sin(a) * 4.2).toFixed(2)}" x2="${(cx + Math.cos(a) * 5.6).toFixed(2)}" y2="${(cy + Math.sin(a) * 5.6).toFixed(2)}" stroke="${EMPTY}" stroke-width="1.1"/>`
  }
  if (days === 0) s += `<circle cx="${cx}" cy="${cy}" r="1.6" fill="${EMPTY}"/>`
  return s
}

/** Context: the thought cloud, filling with the conversation. */
function cloudIcon(p: number, id: string): string {
  const shape = '<path d="M5 18 Q0.5 18 1.5 13.5 Q0.5 9 5.5 9 Q6.5 4 12 5 Q15.5 2.5 18 6.5 Q23 6.5 22.5 11.5 Q24 17 19 18 Z"/>'
  const lvl = (14 * p) / 100
  const fill = p >= 90 ? BAD : p >= 70 ? WARN : '#e3a990'
  return `<defs><clipPath id="${id}">${shape}</clipPath></defs><g fill="${EMPTY}" fill-opacity=".35">${shape}</g><rect x="0" y="${(18 - lvl).toFixed(1)}" width="25" height="${(lvl + 1).toFixed(1)}" fill="${fill}" clip-path="url(#${id})"/>`
}

/** Session time: a stopwatch whose hand sweeps once a minute. */
function stopwatchIcon(t: number): string {
  return `<circle cx="11" cy="12" r="8.5" fill="none" stroke="${CLAY}" stroke-width="2"/><rect x="9" y="0.5" width="4" height="2.5" rx="1" fill="${CLAY}"/><line x1="17.5" y1="4.5" x2="19" y2="3" stroke="${CLAY}" stroke-width="1.8" stroke-linecap="round"/>` +
    `<g class="sw" style="${ph(t, 60_000)}"><line x1="11" y1="12" x2="11" y2="6" stroke="${CLAY}" stroke-width="1.8" stroke-linecap="round"/></g><circle cx="11" cy="12" r="1.5" fill="${CLAY}"/>`
}

export type UsageGridInput = {
  contextPercent?: number
  sessionStartedAt?: number
  windows: UsageWindow[]
}

/** The four usage tiles as one drawing. */
export function usageGridSvg(u: UsageGridInput, t: number, id: string): { svg: string; w: number; h: number; alt: string } {
  const W = TILE_W * 2 + GRID_GAP * 2
  const H = TILE_H * 2 + GRID_GAP
  const five = u.windows.find(w => w.kind === 'five_hour')
  const week = u.windows.find(w => w.kind === 'seven_day')
  const ctx = u.contextPercent === undefined ? null : Math.max(0, Math.min(100, Math.round(u.contextPercent)))
  const session = u.sessionStartedAt ? leftText(t - u.sessionStartedAt) : '—'
  const win = (w: UsageWindow | undefined, name: string, days: number, x: number, y: number): [string, string] => {
    if (!w) return [tileBox(x, y, ringIcon(null, days, t, false), '—', `${name} · waiting`), `${name} not reported yet`]
    const used = Math.round(w.percent)
    const out = used >= 100
    const left = w.resetsAt ? leftText(w.resetsAt - t) : '—'
    const label = out ? `${name} · cooldown` : `${name} · ${used}% used`
    return [tileBox(x, y, ringIcon(used, days, t, used >= 90), left, label, out ? BAD : undefined), `${name} resets in ${left}, ${used}% used`]
  }
  const [fiveTile, fiveAlt] = win(five, '5h', 0, TILE_W + GRID_GAP * 2, 0)
  const [weekTile, weekAlt] = win(week, 'week', 7, TILE_W + GRID_GAP * 2, TILE_H + GRID_GAP)
  const tiles = [
    tileBox(0, 0, cloudIcon(ctx ?? 0, `${id}c`), ctx === null ? '—' : `${ctx}%`, ctx !== null && ctx >= 70 ? 'context · full' : 'context', ctx !== null && ctx >= 90 ? BAD : undefined),
    fiveTile,
    tileBox(0, TILE_H + GRID_GAP, stopwatchIcon(t), session, 'session time'),
    weekTile,
  ]
  const css = `<style>@keyframes ${id}w{to{transform:rotate(360deg)}}.sw{animation:${id}w 60s linear infinite;transform-box:view-box;transform-origin:11px 12px}@media (prefers-reduced-motion: reduce){.sw{animation:none}}</style>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${css}${tiles.join('')}</svg>`
  return { svg, w: W, h: H, alt: `context ${ctx ?? 'unknown'}%, ${fiveAlt}, session ${session}, ${weekAlt}` }
}
