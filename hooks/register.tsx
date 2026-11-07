import type { Register } from 'claude-code'

import { registerDownloads, trackDownload } from './downloads'
import { registerHub } from './hub'
import { openHub } from './nav'
import { ensureSetup } from './setup'
import { noteToolCall, registerTasks } from './tasks'
import { onMeasure } from './usage'

// g-hub: Skills | Tasks | Downloads | Gallery | Usage in one row above the prompt, a status
// strip above it, and one sidebar with tabs.
//
// The engine allows one hook per event without a matcher in a mod, so the features export
// plain functions where they share an event, and this file owns that one hook.

export const register: Register = on => {
  registerTasks(on)
  registerDownloads(on)
  registerHub(on)

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await ensureSetup($)
    return started
  })

  // the one tool.call hook: Tasks notes the call, Downloads wraps it if it downloads
  on('tool.call', async ($, e, next) => {
    await noteToolCall($, e as unknown as Record<string, unknown>)
    return trackDownload($, e as unknown as Record<string, unknown>, next as never) as never
  }).catch(($, e, next) => next(e)) // fail safe: a fault here never blocks a tool call

  // usage figures pushed whenever a window, the context or the cost moves
  on('session.measure', async ($, e, next) => {
    await onMeasure($, e).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'hub' }, async $ => {
    await openHub($, 'tasks')
    return { text: 'Hub toggled.' }
  })
}
