import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ArchivedFlow, CrewMember, Flow, TaskStatus } from '../types'
import { BAD, CLAY, FONT, MONO, MUTED, OK, RUN, RUN_HI, SURFACE_CSS, WARN, emptySvg, fit, headerSvg, itemColor, pill, sectionSvg, span, textW, tok, xml } from './theme'
import { openHub, openHubLast, openSkills } from './nav'
import { levelColor } from './charts'
import { burnRate, recentSamples, windowName } from './usage'
import { monitorOf, monitorSvg, usageGridSvg } from './clawd'

// Skills | Tasks | Downloads, one row above the prompt (the bundle's shared look is theme.ts).
// Tasks follows the app's task list (it reads the update_plan / wrap_up calls on
// their way through, as savvy-progress did), draws it as a Pulse line, and opens a
// sidebar with Now, the Checklist and the Crew (the subagents of this session).

import { ensureSetup } from './setup'
// The state values this file reads or writes. The engine only follows atoms made in the
// file that uses them, so each file keeps its own (they all point at the same g-hub values).
const flow = atom({ plugin: 'g-hub', key: 'flow' } as const, null, { shape: 'flow-1' })
const crew = atom({ plugin: 'g-hub', key: 'crew' } as const, [], { shape: 'crew-1' })
const now = atom({ plugin: 'g-hub', key: 'now' } as const, 0)
const archive = atom({ plugin: 'g-hub', key: 'archive' } as const, [], { shape: 'archive-1' })
const usageSnap = atom({ plugin: 'g-hub', key: 'usage' } as const, null, { shape: 'usage-1' })
const dlItems = atom({ plugin: 'g-hub', key: 'dlItems' } as const, [], { shape: 'items-2' })
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'
const WRAP_TOOL = 'mcp__ccd_turn__wrap_up'
const MAX_TASKS = 60

// the shared palette (theme.ts): working, done, stopped
const BLUE = RUN
const DIM = MUTED

// The main loop's running turn, for the Stop action.
let mainTurnId: string | undefined

// ---------------------------------------------------------------- the flow

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const firstLine = (s: string): string => s.split(/\n/).map(l => l.trim()).find(Boolean) ?? ''

function liveFlow(prompt: string, t: number): Flow {
  return { prompt: clip(firstLine(prompt) || 'Working', 120), live: true, steps: 0, tasks: [], isFinished: false, isStopped: false, startedAt: t }
}

type PlanInput = { items?: { content?: string; status?: string }[]; advance?: boolean; done?: number[]; start?: number }
const STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'completed']

/** One update_plan call applied to the mirrored list, the way the app reads it. */
function applyPlan(tasks: Flow['tasks'], input: PlanInput): Flow['tasks'] {
  if (input.items?.length) {
    return input.items
      .filter(i => i.content?.trim())
      .slice(0, MAX_TASKS)
      .map(i => ({ title: clip((i.content ?? '').trim(), 120), status: STATUSES.includes(i.status as TaskStatus) ? (i.status as TaskStatus) : 'pending' }))
  }
  const next = tasks.map(x => ({ ...x }))
  if (input.advance) {
    const at = next.findIndex(x => x.status === 'in_progress')
    if (at >= 0) (next[at] as Flow['tasks'][number]).status = 'completed'
    const nx = next.findIndex(x => x.status === 'pending')
    if (nx >= 0) (next[nx] as Flow['tasks'][number]).status = 'in_progress'
  }
  for (const n of input.done ?? []) if (n >= 1 && n <= next.length) (next[n - 1] as Flow['tasks'][number]).status = 'completed'
  if (input.start && input.start >= 1 && input.start <= next.length) {
    for (const x of next) if (x.status === 'in_progress') x.status = 'pending'
    ;(next[input.start - 1] as Flow['tasks'][number]).status = 'in_progress'
  }
  return next
}

export const doneCount = (f: Flow): number => f.tasks.filter(x => x.status === 'completed').length
export const current = (f: Flow): number => {
  const at = f.tasks.findIndex(x => x.status === 'in_progress')
  return at >= 0 ? at : f.tasks.findIndex(x => x.status === 'pending')
}

export function titleOf(f: Flow | null): string {
  if (!f) return 'Ready'
  if (f.live || f.tasks.length === 0) return f.prompt
  if (f.isFinished) return f.tasks[f.tasks.length - 1]?.title ?? 'Done'
  const at = current(f)
  return (at >= 0 ? f.tasks[at]?.title : f.prompt) ?? f.prompt
}

export function labelOf(f: Flow | null): string {
  if (!f) return ''
  if (f.isStopped) return 'Stopped'
  if (f.live) return f.isFinished ? `Done · ${f.steps} ${f.steps === 1 ? 'step' : 'steps'}` : `${f.steps} ${f.steps === 1 ? 'step' : 'steps'}`
  if (f.isFinished) return 'Done'
  return `${doneCount(f)}/${f.tasks.length}`
}

export const colorOf = (f: Flow | null): string => (!f ? DIM : f.isStopped ? BAD : f.isFinished ? OK : BLUE)

// ---------------------------------------------------------------- drawing


const CSS = `<style>
${SURFACE_CSS}
@keyframes draw{0%{stroke-dashoffset:var(--len)}70%,100%{stroke-dashoffset:0}}
@keyframes ride{0%{offset-distance:0%}70%,100%{offset-distance:100%}}
@keyframes trace{from{stroke-dashoffset:70}to{stroke-dashoffset:-1400}}
@keyframes blink{50%{opacity:.35}}
@keyframes spin{to{transform:rotate(360deg)}}
.spin{animation:spin 1.2s linear infinite}
@keyframes eq{0%,100%{transform:scaleY(.3)}50%{transform:scaleY(1)}}
.draw{animation:draw 1.8s ease-in-out infinite}.ride{animation:ride 1.8s ease-in-out infinite}
.trace{animation:trace 2.6s linear infinite}.blink{animation:blink 1.4s ease-in-out infinite}
.eq{transform-box:fill-box;transform-origin:50% 100%;animation:eq .9s ease-in-out infinite}
@media (prefers-reduced-motion: reduce){.draw,.ride,.trace,.blink,.eq,.spin{animation:none!important}}
</style>`

const phase = (t: number, dur: number): string => (-((t / 1000) % dur)).toFixed(2)
const beat = (amp = 1): string => `l3 0 l3 ${(-11 * amp).toFixed(1)} l3 ${(16 * amp).toFixed(1)} l3 ${(-7 * amp).toFixed(1)} l3 ${(2 * amp).toFixed(1)}`

/** The Pulse line for a flow, drawn into x..x+W around the baseline y. */
function pulse(f: Flow | null, x0: number, W: number, y: number, t: number, amp = 1, paint?: string): string {
  const out: string[] = [`<line x1="${x0}" y1="${y}" x2="${x0 + W}" y2="${y}" class="ln" stroke-width="1.5"/>`]
  const strokeW = amp > 1 ? 2.4 : 2
  if (!f) return out.join('')
  if (f.live || f.tasks.length === 0) {
    const c = colorOf(f)
    if (f.isStopped) {
      out.push(`<line x1="${x0}" y1="${y}" x2="${x0 + W}" y2="${y}" stroke="${BAD}" stroke-width="${strokeW}"/><circle cx="${x0 + W - 4}" cy="${y}" r="3" fill="${BAD}"/>`)
      return out.join('')
    }
    let d = `M${x0} ${y}`
    for (let x = x0 + 10; x < x0 + W - 18; x += 40) d += ` L${x} ${y} ${beat(amp)} L${x + 15} ${y}`
    d += ` L${x0 + W} ${y}`
    out.push(
      f.isFinished
        ? `<path d="${d}" fill="none" stroke="${paint ?? c}" stroke-width="${strokeW}" stroke-linejoin="round"/><circle cx="${x0 + W - 4}" cy="${y}" r="3.5" fill="${OK}"/>`
        : `<path d="${d}" fill="none" stroke="${paint ?? c}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-dasharray="70 ${W + 140}" class="trace" style="animation-delay:${phase(t, 2.6)}s"/>`,
    )
    return out.join('')
  }
  const n = f.tasks.length
  const slot = W / n
  const at = current(f)
  const col = f.isStopped ? BAD : f.isFinished ? OK : BLUE
  f.tasks.forEach((task, i) => {
    const x = x0 + i * slot
    const bx = x + Math.min(slot * 0.35, Math.max(2, slot - 16))
    const path = `M${x.toFixed(1)} ${y} L${bx.toFixed(1)} ${y} ${beat(Math.min(amp, slot / 16))} L${(x + slot).toFixed(1)} ${y}`
    if (task.status === 'completed' || f.isFinished) {
      out.push(`<path d="${path}" fill="none" stroke="${paint ?? col}" stroke-width="${strokeW}" stroke-linejoin="round"/>`)
    } else if (i === at && f.isStopped) {
      out.push(`<line x1="${x}" y1="${y}" x2="${x + slot}" y2="${y}" stroke="${BAD}" stroke-width="${strokeW + 0.4}"/><circle cx="${x + slot / 2}" cy="${y}" r="3" fill="${BAD}"/>`)
    } else if (i === at) {
      const len = Math.round(slot * 2.2)
      out.push(`<path d="${path}" fill="none" stroke="${paint ?? BLUE}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-dasharray="${len}" class="draw" style="--len:${len};animation-delay:${phase(t, 1.8)}s"/>`)
      out.push(`<circle r="6.5" fill="#b9b6ff" fill-opacity="0.3" class="ride" style="offset-path:path('M${x.toFixed(1)} ${y} L${(x + slot).toFixed(1)} ${y}');animation-delay:${phase(t, 1.8)}s"/>`)
      out.push(`<circle r="3.2" fill="#eef4ff" class="ride" style="offset-path:path('M${x.toFixed(1)} ${y} L${(x + slot).toFixed(1)} ${y}');animation-delay:${phase(t, 1.8)}s"/>`)
    }
  })
  if (f.isFinished) out.push(`<circle cx="${x0 + W - 3}" cy="${y}" r="3.5" fill="${OK}"/>`)
  return out.join('')
}

/** Each state's gradient along the line, left to right. */
function paletteOf(f: Flow | null): string[] {
  if (!f) return ['#6d6d68', '#6d6d68']
  if (f.isStopped) return [WARN, '#ef8a5f', BAD]
  if (f.isFinished) return ['#6fe0c4', OK, '#8fd36a']
  return [RUN_HI, '#7fa8ff', RUN]
}

/** The gradient and glow a Pulse is painted with, spanning x0..x1. */
function pulseDefs(f: Flow | null, x0: number, x1: number, id: string): string {
  const stops = paletteOf(f).map((c, i, a) => `<stop offset="${a.length === 1 ? 0 : i / (a.length - 1)}" stop-color="${c}"/>`).join('')
  return `<defs><linearGradient id="pg${id}" gradientUnits="userSpaceOnUse" x1="${x0}" y1="0" x2="${x1}" y2="0">${stops}</linearGradient>
<filter id="gl${id}" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="2.2"/></filter></defs>`
}

/** A Pulse with a soft glow under it, painted with the state's gradient. */
function glowPulse(f: Flow | null, x0: number, W: number, y: number, t: number, amp: number, id: string): string {
  const paint = `url(#pg${id})`
  return `${pulseDefs(f, x0, x0 + W, id)}<g filter="url(#gl${id})" opacity="0.55">${pulse(f, x0, W, y, t, amp, paint)}</g>${pulse(f, x0, W, y, t, amp, paint)}`
}

/** The band strip: a tinted track with the dot, title, glowing Pulse, an agents pill and the count pill. */
function bandSvg(f: Flow | null, W: number, t: number, working = 0): string {
  const H = 24
  const narrow = W < 340
  // narrow: the short label, so the line keeps room to beat
  const label = narrow && f?.live && f.isFinished ? 'Done' : labelOf(f)
  const c = colorOf(f)
  const crewText = working ? (narrow ? `${working}` : `${working} ${working === 1 ? 'agent' : 'agents'}`) : ''
  const crewP = crewText ? pill(0, 3, H - 6, crewText, itemColor(0), 10.5) : null
  const labelW = label.length * 0.6 * 11.5 + 8 + (crewP ? crewP.w + 6 : 0)
  const pulseMin = narrow ? 50 : 90
  const titleMax = Math.max(40, Math.min(narrow ? W * 0.34 : W * 0.4, 260, W - 16 - 12 - pulseMin - labelW - 10))
  const title = fit(titleOf(f), 12.5, titleMax)
  const px = 23 + textW(title, 12.5) + 10
  const pw = Math.max(30, W - px - labelW - 14)
  const running = f !== null && !f.isFinished && !f.isStopped
  const pal = paletteOf(f)
  const pillW = label.length * 0.6 * 11.5 + 12
  const crewX = W - pillW - 3 - (crewP ? crewP.w + 6 : 0)
  const crewPill = crewP ? pill(crewX, 3, H - 6, crewText, itemColor(0), 10.5).svg : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}
<defs><linearGradient id="trk" x1="0" x2="1"><stop offset="0" stop-color="${pal[0]}" stop-opacity="0.16"/><stop offset="1" stop-color="${pal[pal.length - 1]}" stop-opacity="0.05"/></linearGradient></defs>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${H / 2}" fill="url(#trk)"/>
<circle cx="12" cy="12" r="6" fill="${c}" fill-opacity="0.22"${running ? ' class="blink"' : ''}/><circle cx="12" cy="12" r="3.5" fill="${c}"/>
<text class="t" x="23" y="16.5" font-family="${FONT}" font-size="12.5" font-weight="600">${xml(title)}</text>
${glowPulse(f, px + 6, Math.max(20, pw - 12), 13, t, 1, 'b')}
${crewPill}
${label ? `<rect x="${W - pillW - 3}" y="3" width="${pillW}" height="${H - 6}" rx="${(H - 6) / 2}" fill="${f ? pal[pal.length - 1] : '#6d6d68'}" fill-opacity="0.2"/>
<text x="${W - pillW / 2 - 3}" y="16" text-anchor="middle" font-family="${MONO}" font-size="11" font-weight="700" fill="${f ? pal[Math.min(1, pal.length - 1)] : '#9a9a96'}">${xml(label)}</text>` : ''}
</svg>`
}

/** The checklist as one card: a status mark per task, the current one tinted, finished ones struck through. */
export function checklistSvg(f: Flow, W: number, t: number): { svg: string; h: number } {
  const MAX = 20
  const ROW = 26
  const shown = f.tasks.slice(0, MAX)
  const more = f.tasks.length - shown.length
  const at = current(f)
  const H = 10 + shown.length * ROW + (more > 0 ? 20 : 0) + 4
  const rows = shown.map((x, i) => {
    const y = 6 + i * ROW
    const cy = y + ROW / 2
    const isCur = i === at && !f.isFinished
    const failed = isCur && f.isStopped
    const done = x.status === 'completed' || f.isFinished
    let mark: string
    if (done) mark = `<circle cx="20" cy="${cy}" r="7.5" fill="${OK}"/><path d="M16.4 ${cy} l2.5 2.6 l4.8 -5" fill="none" stroke="#1d1c1a" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`
    else if (failed) mark = `<circle cx="20" cy="${cy}" r="7.5" fill="${BAD}"/><path d="M17 ${cy - 3} l6 6 M23 ${cy - 3} l-6 6" stroke="#1d1c1a" stroke-width="1.9" stroke-linecap="round"/>`
    else if (isCur) mark = `<circle cx="20" cy="${cy}" r="6.5" fill="none" stroke="${RUN}" stroke-width="2.2" stroke-dasharray="27 14" class="spin" style="transform-origin:20px ${cy}px;animation-delay:${phase(t, 1.2)}s"/>`
    else mark = `<circle cx="20" cy="${cy}" r="6.5" fill="none" stroke="${MUTED}" stroke-width="1.5"/>`
    const title = fit(x.title, 12.5, W - 52)
    const tw = textW(title, 12.5)
    return `${isCur ? `<rect x="5" y="${y + 1}" width="${W - 10}" height="${ROW - 2}" rx="8" fill="${failed ? BAD : RUN}" fill-opacity="0.13"/>` : ''}${mark}
<text class="${done ? 'm' : 't'}" x="36" y="${cy + 4.3}" font-family="${FONT}" font-size="12.5"${isCur ? ' font-weight="600"' : ''}>${xml(title)}</text>
${done ? `<line x1="36" y1="${cy}" x2="${(36 + tw * 0.92).toFixed(1)}" y2="${cy}" stroke="${MUTED}" stroke-opacity="0.6" stroke-width="1"/>` : ''}`
  })
  if (more > 0) rows.push(`<text class="m" x="36" y="${H - 10}" font-family="${FONT}" font-size="11.5">+ ${more} more</text>`)
  return {
    h: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}<rect class="k" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>${rows.join('')}</svg>`,
  }
}

/** The sidebar's Now card: the step in progress, a large Pulse, and a line of context. */
export function nowSvg(f: Flow | null, W: number, t: number): { svg: string; h: number } {
  const H = 92
  const note = !f
    ? 'Nothing running. Send a message and it shows up here.'
    : f.isStopped
      ? 'The turn stopped before the work was done.'
      : f.live
        ? f.isFinished ? `Answered in ${span((f.endedAt ?? t) - f.startedAt)} · ${f.steps} tool calls` : `A quick question: each tool call is a step · ${span(t - f.startedAt)}`
        : f.isFinished
          ? `All ${f.tasks.length} steps done in ${span((f.endedAt ?? t) - f.startedAt)}`
          : `Step ${Math.min(f.tasks.length, current(f) + 1)} of ${f.tasks.length} · ${span(t - f.startedAt)}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}
<rect class="k" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>
<text class="m" x="14" y="20" font-family="${MONO}" font-size="9.5" letter-spacing="1.2">NOW</text>
<text class="t" x="14" y="39" font-family="${FONT}" font-size="14" font-weight="600">${xml(fit(titleOf(f), 14, W - 28))}</text>
${glowPulse(f, 14, W - 28, 62, t, 1.3, 'n')}
<text class="s" x="14" y="83" font-family="${FONT}" font-size="11.5">${xml(fit(note, 11.5, W - 28))}</text>
</svg>`
  return { svg, h: H }
}

/** One subagent as a card: avatar (an equalizer while it works), what it does, model, steps, tokens, time. */
export function crewSvg(a: CrewMember, k: number, W: number, t: number): { svg: string; h: number } {
  const H = 64
  const c = a.status === 'failed' ? BAD : itemColor(k)
  const parts: string[] = [`<rect class="k" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12"/>`, `<rect x="12" y="12" width="34" height="34" rx="9" fill="${c}"/>`]
  if (a.status === 'running') {
    for (let b = 0; b < 3; b++) parts.push(`<rect x="${21 + b * 6}" y="20" width="4" height="18" rx="1.5" fill="#141414" class="eq" style="animation-delay:${(Number(phase(t, 0.9)) - b * 0.3).toFixed(2)}s"/>`)
  } else if (a.status === 'done') {
    parts.push(`<path d="M21 29 l5 5 l10 -11" fill="none" stroke="#141414" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`)
  } else {
    parts.push(`<path d="M22 22 l12 12 M34 22 l-12 12" stroke="#141414" stroke-width="2.6" stroke-linecap="round"/>`)
  }
  const tx = 58
  const type = a.type || 'agent'
  const model = [a.model?.replace(/^claude-/, ''), a.effort].filter(Boolean).join(' · ')
  parts.push(`<text class="t" x="${tx}" y="24" font-family="${FONT}" font-size="13" font-weight="600">${xml(fit(a.description || type, 13, W - tx - 12))}</text>`)
  const chipW = textW(type, 10) + 12
  parts.push(`<rect x="${tx}" y="31" width="${chipW}" height="15" rx="4" fill="#9a9a96" fill-opacity="0.18"/><text class="s" x="${tx + 6}" y="42" font-family="${MONO}" font-size="10">${xml(type)}</text>`)
  if (model) parts.push(`<text class="s" x="${tx + chipW + 8}" y="42" font-family="${MONO}" font-size="10.5">${xml(fit(model, 10.5, W - tx - chipW - 20))}</text>`)
  const state = a.status === 'running' ? 'working' : a.status === 'done' ? 'done' : 'failed'
  const meta = `${state} · ${a.steps} ${a.steps === 1 ? 'request' : 'requests'} · ${tok(a.tokens)} tok · ${span((a.endedAt ?? t) - a.startedAt)}`
  parts.push(`<text x="${tx}" y="57" font-family="${MONO}" font-size="10.5" fill="${a.status === 'failed' ? BAD : a.status === 'done' ? OK : '#9a9a96'}">${xml(fit(meta, 10.5, W - tx - 12))}</text>`)
  return { h: H, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${CSS}${parts.join('')}</svg>` }
}

// ---------------------------------------------------------------- actions

async function stopTurn($: EngineInterface): Promise<void> {
  if (!mainTurnId) {
    $.ui.toast('Nothing is running.')
    return
  }
  try {
    await $.turn.abort({ turnId: mainTurnId })
  } catch {
    $.ui.toast('Could not stop this turn.')
  }
}

export async function copyLast($: EngineInterface, surface: string): Promise<void> {
  const msgs = await $.session.messages()
  const last = [...msgs].reverse().find(m => m.role === 'assistant' && m.text.trim())
  if (!last) {
    $.ui.toast('No answer to copy yet.')
    return
  }
  const r = await $.ui.copy({ text: last.text.trim(), surface: surface as never })
  $.ui.toast(r.isCopied ? 'Copied the last answer.' : 'Could not reach the clipboard.')
}

// ---------------------------------------------------------------- hooks

/** One update_plan call, mirrored into the flow. */
async function mirrorPlan($: EngineInterface, input: PlanInput): Promise<void> {
  await update($, flow, f => {
    const base = f ?? liveFlow('Tasks', Date.now())
    const tasks = applyPlan(base.live ? [] : base.tasks, input)
    if (tasks.length === 0) return f
    const fresh = (input.items?.length ?? 0) > 0 && (base.live || base.isFinished)
    return {
      ...base,
      live: false,
      tasks,
      isFinished: tasks.every(x => x.status === 'completed'),
      isStopped: false,
      startedAt: fresh && !base.live ? Date.now() : base.startedAt,
      endedAt: tasks.every(x => x.status === 'completed') ? Date.now() : undefined,
    }
  })
}

/** wrap_up checks the list off and ends the work. */
async function finishPlan($: EngineInterface): Promise<void> {
  await update($, flow, f =>
    f ? { ...f, tasks: f.tasks.map(x => ({ ...x, status: 'completed' as const })), isFinished: true, endedAt: Date.now() } : f,
  )
}


/** Called for every tool call (from register.tsx): the task list's two tools update the mirror, any other is a live step. */
export async function noteToolCall($: EngineInterface, e: Record<string, unknown>): Promise<void> {
  if (e.agentId) return
  if (e.tool === PLAN_TOOL) await mirrorPlan($, e as unknown as PlanInput)
  else if (e.tool === WRAP_TOOL) await finishPlan($)
  else await update($, flow, f => (f && f.live && !f.isFinished ? { ...f, steps: f.steps + 1 } : f))
}

/** Keeps a finished flow for Tasks > History (the last 60 of the session). */
async function archiveFlow($: EngineInterface, f: Flow): Promise<void> {
  const entry: ArchivedFlow = {
    id: `${f.startedAt}`,
    title: f.live || f.tasks.length === 0 ? f.prompt : (f.tasks[f.tasks.length - 1]?.title ?? f.prompt),
    live: f.live,
    steps: f.steps,
    total: f.tasks.length,
    done: f.tasks.filter(x => x.status === 'completed').length,
    outcome: f.isStopped ? 'stopped' : 'done',
    startedAt: f.startedAt,
    endedAt: f.endedAt ?? Date.now(),
  }
  await update($, archive, list => [...list.filter(x => x.id !== entry.id), entry].slice(-60))
}


export const registerTasks = (on: On): void => {
  // A new message in the main loop: a live bar, unless a task list is still open.
  on('turn.start', async ($, e, next) => {
    void ensureSetup($).catch(() => undefined)
    const input = e as unknown as { agentId?: string; text?: string; turnId?: string }
    if (!input.agentId) {
      mainTurnId = input.turnId
      const f = await read($, flow)
      if (f && (f.isFinished || f.isStopped) && (f.steps > 0 || f.tasks.length > 0)) await archiveFlow($, f)
      if (!f || f.isFinished || f.isStopped || f.live) await update($, flow, () => liveFlow(input.text ?? '', Date.now()))
    }
    return next(e)
  })


  // Subagents join the crew when they start.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined) return started
    const member: CrewMember = {
      id: started.agentId ?? e.tool_use_id,
      agentId: started.agentId,
      type: e.subagentType,
      description: e.description,
      model: started.model,
      status: 'running',
      startedAt: Date.now(),
      tokens: 0,
      contextTokens: 0,
      steps: 0,
    }
    await update($, crew, list => [...list.filter(a => a.id !== member.id), member].slice(-40))
    await update($, now, () => Date.now())
    return started
  }).catch(($, e, next) => next(e)) // fail safe: a fault here never blocks a subagent

  // Each model request a subagent makes: tokens and steps.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentId || !usage) return result
    const used = (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
    await update($, crew, list =>
      list.map((a): CrewMember =>
        a.agentId !== agentId
          ? a
          : { ...a, model: usage.model || a.model, effort: typeof e.effort === 'string' ? e.effort : a.effort, tokens: a.tokens + used, contextTokens: used, steps: a.steps + 1 },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const t = Date.now()
    if (e.agentId) {
      await update($, crew, list =>
        list.map((a): CrewMember => (a.agentId === e.agentId ? { ...a, status: e.reason === 'answer' ? 'done' : 'failed', endedAt: t } : a)),
      )
    } else {
      mainTurnId = undefined
      const stopped = e.reason !== 'answer'
      await update($, flow, f => {
        if (!f) return f
        if (f.live) return f.isFinished ? f : { ...f, isFinished: !stopped, isStopped: stopped, endedAt: t }
        // a task list keeps going across turns; it only stops when a turn breaks off
        return stopped && !f.isFinished ? { ...f, isStopped: true, endedAt: t } : f
      })
    }
    await update($, now, () => t)
    return next(e)
  })

  // ---- the row above the prompt: Skills | Tasks [pulse] | Downloads | Copy
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    void ensureSetup($).catch(() => undefined)
    if (e.props.hasSurvey) return next(e)
    const drawn = await Promise.resolve(next(e)).catch(() => null)
    // never nest the engine's own placeholder: the desktop drops a band that does
    const below = drawn && typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine' ? drawn : null

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const f = await read($, flow)
    const list = await read($, crew)
    const t = (await read($, now)) || Date.now()
    const working = list.filter(a => a.status === 'running').length
    const snap = await read($, usageSnap)
    const downloading = (await read($, dlItems)).filter(d => d.status === 'running').length
    const top = snap?.windows.length ? snap.windows.reduce((a, w) => (w.percent > a.percent ? w : a)) : null

    // Each button says what it opens. The colored mark is the mod it belongs to; hovering lights the word.
    // Four buttons in a 2 x 2 grid: Skills | Tasks over Hub | Usage. Each carries its glyph and
    // name, and a small count where there is one (helpers running, downloads, what's left).
    const btn = (key: string, mark: string, word: string, color: string, onPress: (press: { surface: string }) => void, badge?: string, badgeColor?: string) => (
      <Box key={`box-${key}`} flexDirection="column" alignItems="stretch">
        <Button key={key} hover={{ color }} onPress={onPress}>
          <Text color={color} bold>{mark}</Text> <Text bold>{word}</Text>
          {badge ? <Text color={badgeColor ?? color} bold>{` ${badge}`}</Text> : null}
        </Button>
      </Box>
    )
    const skills = btn('skills', '✦', 'Skills', CLAY, () => void openSkills($))
    const tasks = btn('tasks', '∿', 'Tasks', RUN, () => void openHub($, 'tasks'), working ? `+${working}` : undefined)
    const hub = btn('hub', '▤', 'Hub', OK, () => void openHubLast($), downloading ? `↓${downloading}` : undefined)
    const usageBtn = btn('usage', '◔', 'Usage', top ? levelColor(top.percent) : CLAY, () => void openHub($, 'usage'))

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui
      const full = (e.props.bodyColumns || 100) * 8
      // the usage grid has a fixed width, so the monitor's width never moves with the numbers
      const usage = usageGridSvg({ contextPercent: snap?.contextPercent, sessionStartedAt: snap?.sessionStartedAt, windows: snap?.windows ?? [] }, t, 'ug')
      // the button grid takes about 150px; the monitor takes the rest
      // a count on Tasks or Hub widens its column a little: leave room so nothing is pushed off
      const badges = (working ? 26 : 0) + (downloading ? 26 : 0)
      const MW = Math.max(200, full - 206 - usage.w - badges)
      const MH = usage.h
      const mon = monitorOf(f, t, working)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" gap={1}>
            <Box key="grid" flexDirection="row" gap={1}>
              <Box key="grid-left" flexDirection="column" alignItems="center" gap={1}>
                {skills}
                {hub}
              </Box>
              <Box key="grid-right" flexDirection="column" alignItems="center" gap={1}>
                {tasks}
                {usageBtn}
              </Box>
            </Box>
            <Svg key="monitor" source={monitorSvg(mon, MW, MH, t, 'gm')} alt={`${mon.title}, ${mon.meta}`} width={MW} height={MH} />
            <Svg key="usage-grid" source={usage.svg} alt={usage.alt} width={usage.w} height={usage.h} />
          </Box>
          {below}
        </Box>
      )
    }

    const pct = f && !f.live && f.tasks.length ? doneCount(f) / f.tasks.length : f?.isFinished ? 1 : 0
    const barW = 14
    const filled = Math.round(barW * pct)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          {skills}
          {tasks}
          <Text color={colorOf(f)}>● </Text>
          <Text wrap="truncate-end">{titleOf(f)}</Text>
          <Text color={colorOf(f)}>{'━'.repeat(filled) + '─'.repeat(barW - filled)}</Text>
          <Text dimColor>{labelOf(f)}{working ? ` · ${working} agents` : ''}</Text>
          {hub}
          {usageBtn}
        </Box>
        {below}
      </Box>
    )
  })
}
