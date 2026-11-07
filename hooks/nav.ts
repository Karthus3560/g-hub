// The hub sidebar's navigation, shared by every module: which tab shows, and the
// one call every row button makes to open (or close) the hub on its tab.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { HubTab } from '../types'
import { scanGallery } from './gallery'

export const PANE = 'hub'
export const tabAtom = atom({ plugin: 'g-hub', key: 'tab' } as const, 'tasks')
// The Skills button bumps this; the skill-studio mod watches the write and toggles its own
// panel (a mod can open only its own panels, and a slash command would post into the chat).
export const skillsPing = atom({ plugin: 'g-hub', key: 'skillsPing' } as const, 0)

export const TAB_TITLES: Record<HubTab, string> = {
  tasks: 'Tasks',
  downloads: 'Downloads',
  gallery: 'Gallery',
  usage: 'Usage',
  lab: 'Lab',
}

/** Opens the hub on `tab`; pressing the button of the tab already showing closes it. */
export async function openHub($: EngineInterface, tab: HubTab): Promise<void> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  const current = await read($, tabAtom)
  if (isOpen && current === tab) {
    await $.ui.close({ id: PANE })
    return
  }
  await update($, tabAtom, () => tab)
  await $.ui.open({ id: PANE, title: TAB_TITLES[tab] })
  if (tab === 'gallery') void scanGallery($)
}

/** The Hub button: Downloads or Gallery, whichever showed last (Tasks and Usage have buttons of their own). */
export async function openHubLast($: EngineInterface): Promise<void> {
  const current = await read($, tabAtom)
  await openHub($, current === 'gallery' ? 'gallery' : 'downloads')
}

/** Switches tabs inside an open hub. */
export async function showTab($: EngineInterface, tab: HubTab): Promise<void> {
  await update($, tabAtom, () => tab)
  await $.ui.open({ id: PANE, title: TAB_TITLES[tab] })
  if (tab === 'gallery') void scanGallery($)
}

export async function openSkills($: EngineInterface): Promise<void> {
  await update($, skillsPing, n => n + 1)
}
