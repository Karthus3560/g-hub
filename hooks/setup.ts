// One-time setup: the commands, the clocks and the first usage reading.
//
// A mod first loaded in the middle of a session gets no session.start, so this also runs
// from Tasks' turn.start and its row. The engine lets `$` go only to function declarations
// of the mod's files, so this lives in its own file. The flag lives in the module: a
// reload, which cancels the old clocks, sets everything up again.

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import { startDownloadsClock } from './downloads'
import { refreshUsage } from './usage'

// The state values this file reads or writes (atoms are kept per file).
const flow = atom({ plugin: 'g-hub', key: 'flow' } as const, null, { shape: 'flow-1' })
const crew = atom({ plugin: 'g-hub', key: 'crew' } as const, [], { shape: 'crew-1' })
const now = atom({ plugin: 'g-hub', key: 'now' } as const, 0)
const usage = atom({ plugin: 'g-hub', key: 'usage' } as const, null, { shape: 'usage-1' })

let isSetUp = false
let seconds = 0

/** Moves the clock the drawings read: every second while something counts down or runs. */
function startClock($: EngineInterface): void {
  $.clock.every(1000, () => {
    void tick($)
  })
}

async function tick($: EngineInterface): Promise<void> {
  seconds++
  const list = await read($, crew)
  const f = await read($, flow)
  const snap = await read($, usage)
  const busy = list.some(a => a.status === 'running') || (f !== null && !f.isFinished && !f.isStopped)
  const counting = (snap?.windows ?? []).some(w => w.resetsAt !== undefined)
  // a new usage reading once a minute, between the pushes that come with each reply
  if (seconds % 60 === 0) await refreshUsage($).catch(() => undefined)
  const settling = f !== null && f.endedAt !== undefined && Date.now() - f.endedAt < 11 * 60_000
  if (busy || counting || settling) await update($, now, () => Date.now())
}

export async function ensureSetup($: EngineInterface): Promise<void> {
  if (isSetUp) return
  isSetUp = true
  startClock($)
  startDownloadsClock($)
  try {
    await refreshUsage($).catch(() => undefined)
    await $.command.register({ name: 'hub', description: 'Open or close the hub sidebar: Tasks, Downloads, Gallery and Usage' })
  } catch {
    // tried again on the next message or draw
    isSetUp = false
  }
}
