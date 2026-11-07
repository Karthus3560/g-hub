// The hub sidebar: one frame for every tab.
//
//   header (icon tile, title, live subtitle)
//   tabs: Tasks · Downloads · Gallery · Usage
//   sub-tabs, search and actions for the tab
//   sections: cards for what runs, compact rows grouped by day for what finished,
//   "Show more" paging, so long lists stay calm.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ArchivedFlow, DlSub, Download, GalSort, HistoryEntry, HubTab, TaskSub, UsageSample, UsageWindow } from '../types'
import { ago, barsSvg, clock, dayHeaderSvg, dayLabel, levelColor, lineSvg, ringSvg, rowSvg, tilesSvg } from './charts'
import { type View, beltSvg, loadHistory } from './downloads'
import { type GalItem, ensurePreview, ensureThumbs, galleryItems, galleryScannedAt, isScanning, previewOf, previewSvg, scanGallery, thumbOf, tileSvg } from './gallery'
import { TAB_TITLES, showTab } from './nav'
import { statsPieces } from './stats'
import { checklistSvg, colorOf, copyLast, crewSvg, doneCount, labelOf, nowSvg, titleOf } from './tasks'
import * as T from './theme'
import { burnRate, cooldownSvg, fillsAt, loadSamples, refreshUsage, windowName } from './usage'

// The state values this file reads or writes. The engine only follows atoms made in the
// file that uses them, so each file keeps its own (they all point at the same g-hub values).
const tabAtom = atom({ plugin: 'g-hub', key: 'tab' } as const, 'tasks')
const flow = atom({ plugin: 'g-hub', key: 'flow' } as const, null, { shape: 'flow-1' })
const crew = atom({ plugin: 'g-hub', key: 'crew' } as const, [], { shape: 'crew-1' })
const now = atom({ plugin: 'g-hub', key: 'now' } as const, 0)
const items = atom({ plugin: 'g-hub', key: 'dlItems' } as const, [], { shape: 'items-2' })
const archive = atom({ plugin: 'g-hub', key: 'archive' } as const, [], { shape: 'archive-1' })
const usage = atom({ plugin: 'g-hub', key: 'usage' } as const, null, { shape: 'usage-1' })
const taskSub = atom({ plugin: 'g-hub', key: 'taskSub' } as const, 'now')
const dlSub = atom({ plugin: 'g-hub', key: 'dlSub' } as const, 'active')
const dlQuery = atom({ plugin: 'g-hub', key: 'dlQuery' } as const, '')
const dlPage = atom({ plugin: 'g-hub', key: 'dlPage' } as const, 1)
const dlSel = atom({ plugin: 'g-hub', key: 'dlSel' } as const, '')
const galSub = atom({ plugin: 'g-hub', key: 'galSub' } as const, 'all')
const galSort = atom({ plugin: 'g-hub', key: 'galSort' } as const, 'newest')
const galQuery = atom({ plugin: 'g-hub', key: 'galQuery' } as const, '')
const galPage = atom({ plugin: 'g-hub', key: 'galPage' } as const, 1)
const galSel = atom({ plugin: 'g-hub', key: 'galSel' } as const, '')
const galStamp = atom({ plugin: 'g-hub', key: 'galStamp' } as const, 0)

const TABS: HubTab[] = ['tasks', 'downloads', 'gallery', 'usage']
const ROWS_PER_PAGE = 20
const TILES_PER_PAGE = 12
const ICON: Record<HubTab, T.IconKind> = { tasks: 'pulse', downloads: 'download', gallery: 'image', usage: 'gauge', lab: 'sparkle' }

type Piece = { svg: string; h: number }
const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

// ---------------------------------------------------------------- actions the buttons run

async function openFolder($: EngineInterface, path: string, select: boolean): Promise<void> {
  const win = path.replace(/\//g, '\\')
  await $.process.run(select ? ['explorer', `/select,${win}`] : ['explorer', win]).catch(() => undefined)
}

async function copyText($: EngineInterface, text: string, surface: string, what: string): Promise<void> {
  const r = await $.ui.copy({ text, surface: surface as never })
  $.ui.toast(r.isCopied ? `Copied the ${what}.` : 'Could not reach the clipboard.')
}

async function clearFinished($: EngineInterface): Promise<void> {
  await update($, items, list => list.filter(d => d.status === 'running'))
  await update($, dlSel, () => '')
}

/** The gallery's list for the current filter, sort and search. */
function galleryView(all: GalItem[], sub: string, sort: GalSort, q: string, t: number): GalItem[] {
  let list = all
  if (sub === 'recent') list = list.filter(x => t - x.mtime < 7 * 86_400_000)
  else if (sub !== 'all') list = list.filter(x => x.folder === sub)
  if (q) list = list.filter(x => x.name.toLowerCase().includes(q.toLowerCase()) || x.folder.toLowerCase().includes(q.toLowerCase()))
  const sorted = [...list]
  if (sort === 'newest') sorted.sort((a, b) => b.mtime - a.mtime)
  else if (sort === 'largest') sorted.sort((a, b) => b.bytes - a.bytes)
  else sorted.sort((a, b) => a.name.localeCompare(b.name))
  return sorted
}

/** Makes the thumbnails the gallery shows now (after a filter, sort, search or page change). */
async function refreshGallery($: EngineInterface, force = false): Promise<void> {
  if (force || galleryItems().length === 0) await scanGallery($, force)
  const list = galleryView(galleryItems(), await read($, galSub), (await read($, galSort)) as GalSort, await read($, galQuery), Date.now())
  await ensureThumbs($, list.slice(0, (await read($, galPage)) * TILES_PER_PAGE))
}

async function setGallery($: EngineInterface, change: { sub?: string; sort?: GalSort; query?: string; more?: boolean }): Promise<void> {
  if (change.sub !== undefined) await update($, galSub, () => change.sub as string)
  if (change.sort !== undefined) await update($, galSort, () => change.sort as GalSort)
  if (change.query !== undefined) await update($, galQuery, () => change.query as string)
  await update($, galPage, n => (change.more ? n + 1 : 1))
  await refreshGallery($)
}

async function selectImage($: EngineInterface, path: string): Promise<void> {
  await update($, galSel, () => path)
  const x = galleryItems().find(i => i.path === path)
  if (x) await ensurePreview($, x)
}

// ---------------------------------------------------------------- the sidebar

export const registerHub = (on: On): void => {
  on('ui.render', { component: 'Pane', requestId: 'hub' }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const tab = (await read($, tabAtom)) as HubTab
    const t = (await read($, now)) || Date.now()
    const f = await read($, flow)
    const team = await read($, crew)
    const downloads = await read($, items)
    const history = await loadHistory($)
    const snap = await read($, usage)
    await read($, galStamp)
    const working = team.filter(a => a.status === 'running')
    const running = downloads.filter(d => d.status === 'running')
    const pics = galleryItems()

    const tabs = (
      <Box key="tabs" flexDirection="row" gap={1}>
        {TABS.map(k => (
          <Button key={`tab-${k}`} variant={k === tab ? 'primary' : undefined} label={TAB_TITLES[k]} onPress={() => void showTab($, k)} />
        ))}
      </Box>
    )

    // ---- the terminal draws a short text version
    if (!(e.surface !== 'terminal' && 'Svg' in ui)) {
      return (
        <Box flexDirection="column" gap={1}>
          {tabs}
          <Text bold>{TAB_TITLES[tab]}</Text>
          {tab === 'tasks' && <Text>{titleOf(f)} <Text color={colorOf(f)}>{labelOf(f)}</Text></Text>}
          {tab === 'downloads' && history.slice(0, 15).map(h => <Text key={`h-${h.id}`} wrap="truncate-end">{h.status === 'done' ? '✓' : '✕'} {h.title} <Text dimColor>· {T.size(h.bytes)}</Text></Text>)}
          {tab === 'usage' && (snap?.windows ?? []).map(w => <Text key={`w-${w.kind}`}>{windowName(w.kind, true)}: {Math.round(w.percent)}%{w.resetsAt ? ` · resets in ${clock(w.resetsAt - t)}` : ''}</Text>)}
          {tab === 'gallery' && <Text dimColor>{pics.length} images. The gallery draws thumbnails in the desktop app.</Text>}
        </Box>
      )
    }

    const { Svg } = ui
    const Input = 'Input' in ui ? ui.Input : null
    const W = Math.max(260, Math.min(560, ((e.props as { bodyColumns?: number }).bodyColumns || 44) * 8 - 8))
    const piece = (key: string, p: Piece, alt: string) => <Svg key={key} source={p.svg} alt={alt} width={W} height={p.h} />
    const section = (key: string, label: string, count?: string) => piece(key, T.sectionSvg(label, W, count), label)
    const empty = (key: string, text: string) => piece(key, T.emptySvg(text, W), text)
    const chip = (key: string, label: string, active: boolean, press: () => void) => (
      <Button key={key} plain={active ? undefined : true} dimColor={!active} variant={active ? 'secondary' : undefined} label={label} onPress={press} />
    )
    const bar = (key: string, children: unknown[]) => (
      <Box key={key} flexDirection="row" gap={1} flexWrap="wrap">
        {children as never}
      </Box>
    )

    const subtitle =
      tab === 'tasks'
        ? `${f ? labelOf(f) : 'Nothing running'}${working.length ? ` · ${working.length} ${working.length === 1 ? 'agent' : 'agents'} working` : ''}`
        : tab === 'downloads'
          ? `${running.length ? `${running.length} running · ` : ''}${history.length} in history`
          : tab === 'gallery'
            ? isScanning() && pics.length === 0 ? 'Looking for images…' : `${pics.length} images · ${new Set(pics.map(p => p.folder)).size} folders`
            : snap?.windows.length
              ? snap.windows.map(w => `${windowName(w.kind)} ${Math.round(w.percent)}%`).join(' · ')
              : 'Live from your account'
    const frame = [piece('head', T.headerSvg(ICON[tab], TAB_TITLES[tab], subtitle, W), `${TAB_TITLES[tab]}: ${subtitle}`), tabs]

    // ================================================================ Tasks
    if (tab === 'tasks') {
      const sub = (await read($, taskSub)) as TaskSub
      const past = (await read($, archive)) as ArchivedFlow[]
      const finished = team.filter(a => a.status !== 'running').slice().reverse()
      const hasList = f !== null && !f.live && f.tasks.length > 0
      const subs = bar('subs', [
        chip('ts-now', 'Now', sub === 'now', () => void update($, taskSub, () => 'now')),
        chip('ts-list', hasList && f ? `Checklist ${doneCount(f)}/${f.tasks.length}` : 'Checklist', sub === 'checklist', () => void update($, taskSub, () => 'checklist')),
        chip('ts-crew', `Crew ${team.length}`, sub === 'crew', () => void update($, taskSub, () => 'crew')),
        chip('ts-hist', `History ${past.length}`, sub === 'history', () => void update($, taskSub, () => 'history')),
      ])
      const actions = bar('acts', [<Button key="act-copy" plain dimColor label="Copy last answer" onPress={press => void copyLast($, press.surface)} />])
      const body: unknown[] = []
      if (sub === 'now') {
        body.push(piece('now', nowSvg(f, W, t), `Now: ${titleOf(f)} ${labelOf(f)}`))
        body.push(section('sec-working', 'Working now', working.length ? String(working.length) : undefined))
        if (working.length === 0) body.push(empty('w-empty', 'No subagents working right now.'))
        working.forEach(a => body.push(piece(`crew-${a.id}`, crewSvg(a, team.indexOf(a), W, t), `${a.description}: working`)))
      } else if (sub === 'checklist') {
        if (!hasList || !f) body.push(empty('l-empty', f?.live ? 'A quick question has no checklist.' : 'The checklist appears when Claude makes a plan.'))
        else {
          const doneN = doneCount(f)
          // more than five finished steps fold into one row, so the open ones stay in view
          if (doneN > 5 && !f.isFinished) {
            body.push(piece('l-fold', rowSvg({ color: T.OK, title: `${doneN} steps done`, meta: 'finished steps are folded away', right: `${doneN}/${f.tasks.length}` }, W), `${doneN} steps done`))
            body.push(piece('l-open', checklistSvg({ ...f, tasks: f.tasks.filter(x => x.status !== 'completed') }, W, t), 'Open steps'))
          } else body.push(piece('l-all', checklistSvg(f, W, t), f.tasks.map(x => `${x.status}: ${x.title}`).join('; ')))
        }
      } else if (sub === 'crew') {
        if (team.length === 0) body.push(empty('c-empty', 'Subagents show up here when Claude starts one.'))
        working.forEach(a => body.push(piece(`crew-${a.id}`, crewSvg(a, team.indexOf(a), W, t), `${a.description}: working`)))
        if (finished.length) body.push(section('sec-fin', 'Finished', String(finished.length)))
        finished.slice(0, ROWS_PER_PAGE).forEach(a =>
          body.push(piece(`fin-${a.id}`, rowSvg({ color: a.status === 'done' ? T.OK : T.BAD, title: a.description || a.type, meta: `${a.type} · ${a.steps} requests · ${T.tok(a.tokens)} tok · ${T.span((a.endedAt ?? t) - a.startedAt)}`, right: a.status === 'done' ? 'done' : 'failed' }, W), a.description)),
        )
      } else {
        if (past.length === 0) body.push(empty('h-empty', 'Finished plans and questions of this session collect here.'))
        let lastDay = ''
        past
          .slice()
          .reverse()
          .slice(0, ROWS_PER_PAGE)
          .forEach(x => {
            const day = dayLabel(x.endedAt, t)
            if (day !== lastDay) {
              body.push(piece(`hd-${x.id}`, dayHeaderSvg(day, W), day))
              lastDay = day
            }
            const meta = x.live ? `quick question · ${x.steps} steps · ${T.span(x.endedAt - x.startedAt)}` : `${x.done}/${x.total} steps · ${T.span(x.endedAt - x.startedAt)}`
            body.push(piece(`hx-${x.id}`, rowSvg({ color: x.outcome === 'done' ? T.OK : T.BAD, title: x.title, meta, right: ago(t - x.endedAt) }, W), x.title))
          })
      }
      return (
        <Box flexDirection="column" gap={1}>
          {frame}
          {subs}
          {actions}
          {body as never}
        </Box>
      )
    }

    // ================================================================ Downloads
    if (tab === 'downloads') {
      const sub = (await read($, dlSub)) as DlSub
      const q = (await read($, dlQuery)).trim().toLowerCase()
      const page = await read($, dlPage)
      const sel = await read($, dlSel)
      const sessionDone = downloads.filter(d => d.status === 'done').slice().reverse()
      const sessionFailed = downloads.filter(d => d.status === 'error').slice().reverse()
      const ids = new Set(downloads.map(d => d.id))
      const histDone = history.filter(h => h.status === 'done' && !ids.has(h.id))
      const histFailed = history.filter(h => h.status === 'error' && !ids.has(h.id))
      const failedCount = sessionFailed.length + histFailed.length
      const matches = (s: string) => !q || s.toLowerCase().includes(q)

      const subs = bar('subs', [
        chip('ds-active', `Active ${running.length}`, sub === 'active', () => void update($, dlSub, () => 'active')),
        chip('ds-done', 'Done', sub === 'done', () => void update($, dlSub, () => 'done')),
        chip('ds-failed', `Failed ${failedCount}`, sub === 'failed', () => void update($, dlSub, () => 'failed')),
        chip('ds-stats', 'Stats', sub === 'stats', () => void update($, dlSub, () => 'stats')),
      ])
      const lastFolder = [...downloads].reverse().find(d => d.watch.mode !== 'none')?.watch
      const actions = bar('acts', [
        ...(lastFolder ? [<Button key="act-open" plain dimColor label="Open last folder" onPress={() => void openFolder($, lastFolder.path, lastFolder.mode === 'file')} />] : []),
        ...(sessionDone.length || sessionFailed.length ? [<Button key="act-clear" plain dimColor label="Clear finished" onPress={() => void clearFinished($)} />] : []),
      ])
      const search =
        Input && (sub === 'done' || sub === 'failed') ? (
          <Input key="dl-q" label="Search" placeholder="name, tool or project" value={q} onInput={(v: string) => void update($, dlQuery, () => v)} onSubmit={(v: string) => void update($, dlQuery, () => v)} />
        ) : null
      const card = (d: Download) => {
        const view: View = d.status === 'error' ? 'error' : d.status === 'running' ? 'running' : 'done'
        return piece(`dl-${d.id}`, beltSvg(d, view, W, t), `${d.title || d.kind}: ${view}`)
      }
      const body: unknown[] = []

      if (sub === 'active') {
        if (running.length === 0) body.push(empty('a-empty', 'Nothing downloading right now.'))
        running.slice(0, 3).forEach(d => body.push(card(d)))
        if (running.length > 3) body.push(piece('a-more', rowSvg({ color: T.RUN, title: `+ ${running.length - 3} more running`, meta: running.slice(3).map(d => d.title || d.kind).join(' · ') }, W), 'More running'))
      } else if (sub === 'stats') {
        if (history.length === 0) body.push(empty('s-empty', 'Stats appear once downloads finish.'))
        else
          statsPieces(history, W, t).forEach(p => {
            if (p.label) body.push(section(`s-sec-${p.key}`, p.label))
            body.push(piece(`s-${p.key}`, p.piece, p.label ?? p.key))
          })
      } else {
        // Done or Failed: this session's (with receipts) first, then the history, by day
        type Row = { id: string; title: string; meta: string; right: string; color: string; at: number; live?: Download; error?: string; command?: string }
        const fromLive = (d: Download): Row => ({
          id: d.id,
          title: d.title || d.kind,
          meta: `${d.kind} · ${baseOf(d.project ?? '')}${d.error ? ` · ${d.error}` : ''}`,
          right: T.size(d.items.reduce((a, i) => a + Math.max(i.bytes, i.total ?? 0), 0)),
          color: d.status === 'error' ? T.BAD : T.OK,
          at: d.endedAt ?? d.startedAt,
          live: d,
          error: d.error,
          command: d.label,
        })
        const fromHist = (h: HistoryEntry): Row => ({
          id: h.id,
          title: h.title,
          meta: `${h.kind} · ${baseOf(h.project || '')}${h.files > 1 ? ` · ${h.files} files` : ''}`,
          right: h.bytes ? T.size(h.bytes) : '',
          color: h.status === 'error' ? T.BAD : T.OK,
          at: h.endedAt,
        })
        const all = (sub === 'done' ? [...sessionDone.map(fromLive), ...histDone.map(fromHist)] : [...sessionFailed.map(fromLive), ...histFailed.map(fromHist)])
          .filter(r => matches(`${r.title} ${r.meta}`))
          .sort((a, b) => b.at - a.at)
        if (all.length === 0) body.push(empty('r-empty', q ? 'Nothing matches that search.' : sub === 'done' ? 'Finished downloads show here.' : 'No failed downloads. Nice.'))
        let lastDay = ''
        all.slice(0, page * ROWS_PER_PAGE).forEach(r => {
          const day = dayLabel(r.at, t)
          if (day !== lastDay) {
            body.push(piece(`day-${r.id}`, dayHeaderSvg(day, W), day))
            lastDay = day
          }
          body.push(piece(`row-${r.id}`, rowSvg({ color: r.color, title: r.title, meta: r.meta, right: r.right || ago(t - r.at), selected: sel === r.id }, W), r.title))
          const btns: unknown[] = []
          if (r.live) btns.push(<Button key={`rc-${r.id}`} plain dimColor label={sel === r.id ? 'Hide receipt' : 'Show receipt'} onPress={() => void update($, dlSel, cur => (cur === r.id ? '' : r.id))} />)
          if (sub === 'failed' && r.command) btns.push(<Button key={`cp-${r.id}`} plain dimColor label="Copy command to retry" onPress={press => void copyText($, r.command as string, press.surface, 'command')} />)
          if (btns.length) body.push(bar(`rb-${r.id}`, btns))
          if (sel === r.id && r.live) body.push(card(r.live))
        })
        if (all.length > page * ROWS_PER_PAGE) body.push(<Button key="more" label={`Show ${Math.min(ROWS_PER_PAGE, all.length - page * ROWS_PER_PAGE)} more`} onPress={() => void update($, dlPage, n => n + 1)} />)
      }
      return (
        <Box flexDirection="column" gap={1}>
          {frame}
          {subs}
          {search}
          {actions}
          {body as never}
        </Box>
      )
    }

    // ================================================================ Gallery
    if (tab === 'gallery') {
      const sub = await read($, galSub)
      const sort = (await read($, galSort)) as GalSort
      const q = await read($, galQuery)
      const page = await read($, galPage)
      const sel = await read($, galSel)
      const folders = [...pics.reduce((m, p) => m.set(p.folder, (m.get(p.folder) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
      const subs = bar('subs', [
        chip('gs-all', `All ${pics.length}`, sub === 'all', () => void setGallery($, { sub: 'all' })),
        chip('gs-recent', 'Recent', sub === 'recent', () => void setGallery($, { sub: 'recent' })),
        ...folders.map(([name, n]) => chip(`gs-${name}`, `${name} ${n}`, sub === name, () => void setGallery($, { sub: name }))),
      ])
      const sorts = bar('sorts', [
        chip('so-new', 'Newest', sort === 'newest', () => void setGallery($, { sort: 'newest' })),
        chip('so-big', 'Largest', sort === 'largest', () => void setGallery($, { sort: 'largest' })),
        chip('so-name', 'Name', sort === 'name', () => void setGallery($, { sort: 'name' })),
        <Button key="rescan" plain dimColor label="Rescan" onPress={() => void refreshGallery($, true)} />,
      ])
      const selected = sel ? pics.find(p => p.path === sel) : undefined
      if (selected) {
        return (
          <Box flexDirection="column" gap={1}>
            {frame}
            {bar('pv-acts', [
              <Button key="pv-back" label="‹ Back to the gallery" onPress={() => void update($, galSel, () => '')} />,
              <Button key="pv-open" plain dimColor label="Open" onPress={() => void openFolder($, selected.path, false)} />,
              <Button key="pv-show" plain dimColor label="Show in folder" onPress={() => void openFolder($, selected.path, true)} />,
              <Button key="pv-copy" plain dimColor label="Copy path" onPress={press => void copyText($, selected.path.replace(/\//g, '\\'), press.surface, 'path')} />,
            ])}
            {piece('preview', previewSvg(selected, previewOf(selected.path) ?? thumbOf(selected.path), W), selected.name)}
          </Box>
        )
      }
      const list = galleryView(pics, sub, sort, q, t)
      const shown = list.slice(0, page * TILES_PER_PAGE)
      const cols = W >= 420 ? 4 : 3
      const size = Math.floor((W - (cols - 1) * 8) / cols)
      const rows: GalItem[][] = []
      for (let i = 0; i < shown.length; i += cols) rows.push(shown.slice(i, i + cols))
      const search = Input ? <Input key="gal-q" label="Search" placeholder="file or folder name" value={q} onInput={(v: string) => void setGallery($, { query: v })} onSubmit={(v: string) => void setGallery($, { query: v })} /> : null
      const scanned = galleryScannedAt()
      return (
        <Box flexDirection="column" gap={1}>
          {frame}
          {subs}
          {sorts}
          {search}
          {pics.length === 0 && empty('g-empty', isScanning() ? 'Looking for images in this project…' : 'No images found in this project folder.')}
          {pics.length > 0 && list.length === 0 && empty('g-none', 'Nothing matches that filter.')}
          {rows.map((r, i) => (
            <Box key={`gr-${i}`} flexDirection="row" gap={1}>
              {r.map(x => (
                <Box key={`gt-${x.path}`} flexDirection="column">
                  <Svg source={tileSvg(x, thumbOf(x.path), size, false).svg} alt={x.name} width={size} height={size + 20} />
                  <Button key={`gv-${x.path}`} plain dimColor label="View" onPress={() => void selectImage($, x.path)} />
                </Box>
              ))}
            </Box>
          ))}
          {list.length > shown.length && <Button key="g-more" label={`Show ${Math.min(TILES_PER_PAGE, list.length - shown.length)} more`} onPress={() => void setGallery($, { more: true })} />}
          {scanned && <Text key="g-foot" dimColor>{list.length} shown · scanned {ago(Date.now() - scanned)}</Text>}
        </Box>
      )
    }

    // ================================================================ Usage
    const samples: UsageSample[] = await loadSamples($)
    const windows: UsageWindow[] = snap?.windows ?? []
    const ringSize = Math.max(110, Math.min(150, Math.floor((W - 8 * Math.max(0, windows.length - 1)) / Math.max(1, windows.length))))
    const body: unknown[] = []
    windows.filter(w => w.percent >= 100).forEach(w => body.push(piece(`cd-${w.kind}`, cooldownSvg(w, W, t), `${windowName(w.kind, true)} used up`)))
    if (windows.length) {
      body.push(
        <Box key="rings" flexDirection="row" gap={1}>
          {windows.map(w => {
            const r = ringSvg({ label: windowName(w.kind), percent: w.percent, sub: w.resetsAt ? (w.percent >= 100 ? `cooldown ${clock(w.resetsAt - t)}` : `resets ${clock(w.resetsAt - t)}`) : 'no reset time', color: levelColor(w.percent), pulse: w.percent >= 90 }, ringSize)
            return <Svg key={`ring-${w.kind}`} source={r.svg} alt={`${windowName(w.kind, true)}: ${Math.round(w.percent)}% used`} width={ringSize} height={r.h} />
          })}
        </Box>,
      )
    } else body.push(empty('u-none', 'Rate windows appear on a subscription after the first reply. With an API key, cost and context show here.'))

    body.push(
      piece(
        'u-tiles',
        tilesSvg(
          [
            { label: 'context', value: snap?.contextPercent !== undefined ? `${snap.contextPercent}%` : '–', color: levelColor(snap?.contextPercent ?? 0) },
            { label: 'session cost', value: snap?.costUsd !== undefined ? `$${snap.costUsd.toFixed(2)}` : '–', color: T.CLAY },
            { label: 'session', value: snap ? T.span(t - snap.sessionStartedAt) : '–', color: T.RUN },
          ],
          W,
        ),
        'Context, cost and session time',
      ),
    )

    // burn rate: how fast each window fills, and whether it fills before it resets
    const pace: { key: 'five' | 'week'; kind: string; hours: number }[] = [
      { key: 'five', kind: 'five_hour', hours: 1 },
      { key: 'week', kind: 'seven_day', hours: 24 },
    ]
    const paceRows = pace
      .map(p => {
        const w = windows.find(x => x.kind === p.kind)
        if (!w) return null
        const rate = burnRate(samples, p.key, p.hours, t)
        const full = fillsAt(w, rate, t)
        const meta = rate === null ? 'collecting readings to measure the pace' : full ? `at this pace it fills ${new Date(full).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : 'at this pace it resets before it fills'
        return { w, rate, meta, full }
      })
      .filter(Boolean) as { w: UsageWindow; rate: number | null; meta: string; full: number | null }[]
    if (paceRows.length) {
      body.push(section('u-pace', 'Pace'))
      paceRows.forEach(r => body.push(piece(`pace-${r.w.kind}`, rowSvg({ color: r.full ? T.WARN : T.OK, title: windowName(r.w.kind, true), meta: r.meta, right: r.rate === null ? '–' : `${r.rate.toFixed(1)}%/h` }, W), r.meta)))
    }

    // the last 24 hours, hour by hour (the 5-hour window's highest reading in each hour)
    const hourly: number[] = []
    const hourLabels: string[] = []
    for (let i = 23; i >= 0; i--) {
      const end = t - i * 3600_000
      const inHour = samples.filter(s => s.at > end - 3600_000 && s.at <= end && typeof s.five === 'number')
      hourly.push(inHour.length ? Math.max(...inHour.map(s => s.five as number)) : 0)
      hourLabels.push(String(new Date(end).getHours()))
    }
    if (samples.some(s => typeof s.five === 'number')) {
      body.push(section('u-hourly', '5-hour window · last 24 hours'))
      body.push(piece('u-bars', barsSvg(hourly, hourLabels, W, T.RUN, n => `${Math.round(n)}%`), 'Hourly usage'))
    }
    const week = samples.filter(s => s.at > t - 7 * 86_400_000 && typeof s.week === 'number').map(s => ({ x: s.at, y: s.week as number }))
    if (windows.some(w => w.kind === 'seven_day')) {
      body.push(section('u-week', 'Weekly window · last 7 days'))
      body.push(piece('u-line', lineSvg(week, W, T.CLAY, '% of the weekly window'), 'Weekly usage'))
    }
    return (
      <Box flexDirection="column" gap={1}>
        {frame}
        {bar('u-acts', [
          <Button key="u-refresh" plain dimColor label="Refresh now" onPress={() => void refreshUsage($)} />,
        ])}
        {body as never}
        <Text key="u-foot" dimColor>{snap ? `Updated ${ago(Date.now() - snap.at)} · readings come with each reply` : 'Readings come with each reply.'}</Text>
      </Box>
    )
  })
}
