// Downloads > Stats: totals, a 14-day chart, share by tool, top projects and the biggest
// downloads, all from the shared history. Pure: data in, drawings out.

import type { HistoryEntry } from '../types'
import { barsSvg, donutSvg, rowSvg, tilesSvg } from './charts'
import { BAD, OK, RUN, WARN, itemColor, size } from './theme'

type Piece = { svg: string; h: number }

const DAY = 86_400_000
const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

export function statsPieces(h: HistoryEntry[], W: number, now: number): { key: string; label?: string; piece: Piece }[] {
  const within = (days: number) => h.filter(x => now - x.endedAt < days * DAY)
  const ok = (l: HistoryEntry[]) => l.filter(x => x.status === 'done').length
  const bytes = (l: HistoryEntry[]) => l.reduce((a, x) => a + x.bytes, 0)
  const w7 = within(7)
  const w30 = within(30)
  const rate = h.length ? Math.round((ok(h) / h.length) * 100) : 0

  const out: { key: string; label?: string; piece: Piece }[] = []
  out.push({
    key: 'tiles',
    piece: tilesSvg(
      [
        { label: '7 days', value: String(w7.length), color: RUN },
        { label: '30 days', value: size(bytes(w30)), color: OK },
        { label: 'all time', value: String(h.length), color: itemColor(1) },
        { label: 'success', value: `${rate}%`, color: rate >= 90 ? OK : rate >= 70 ? WARN : BAD },
      ],
      W,
    ),
  })

  // the last 14 days, one bar each
  const days: number[] = []
  const labels: string[] = []
  for (let i = 13; i >= 0; i--) {
    const start = new Date(now - i * DAY)
    start.setHours(0, 0, 0, 0)
    const s = start.getTime()
    days.push(h.filter(x => x.endedAt >= s && x.endedAt < s + DAY).length)
    labels.push(i === 0 ? 'today' : String(start.getDate()))
  }
  out.push({ key: 'days', label: 'Downloads per day · 14 days', piece: barsSvg(days, labels, W, OK, n => `${n}`) })

  // share by tool
  const byKind = new Map<string, number>()
  for (const x of h) byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1)
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, value]) => ({ label, value }))
  if (kinds.length) out.push({ key: 'kinds', label: 'By tool', piece: donutSvg(kinds, W) })

  // top projects
  const byProject = new Map<string, { n: number; b: number }>()
  for (const x of h) {
    const k = baseOf(x.project || '') || 'unknown'
    const v = byProject.get(k) ?? { n: 0, b: 0 }
    v.n++
    v.b += x.bytes
    byProject.set(k, v)
  }
  ;[...byProject.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 5)
    .forEach(([name, v], i) => out.push({ key: `proj-${i}`, label: i === 0 ? 'Top projects' : undefined, piece: rowSvg({ color: itemColor(i), title: name, meta: `${v.n} ${v.n === 1 ? 'download' : 'downloads'}`, right: size(v.b) }, W) }))

  // the biggest downloads
  ;[...h]
    .sort((a, b) => b.bytes - a.bytes)
    .filter(x => x.bytes > 0)
    .slice(0, 5)
    .forEach((x, i) => out.push({ key: `big-${i}`, label: i === 0 ? 'Largest' : undefined, piece: rowSvg({ color: x.status === 'done' ? OK : BAD, title: x.title, meta: `${x.kind} · ${baseOf(x.project || '')}`, right: size(x.bytes) }, W) }))
  return out
}
