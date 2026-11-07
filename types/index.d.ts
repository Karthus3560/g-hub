export type DownloadStatus = 'running' | 'done' | 'error'

/** One file (or one item of a playlist) a download is writing. */
export type DlItem = {
  /** Display name, with temp suffixes (.part, .f137, .ytdl) stripped. */
  name: string
  /** Bytes on disk now. */
  bytes: number
  /** Expected size, when the server or yt-dlp said. */
  total?: number
  /** Bytes per second, smoothed. */
  speed: number
  /** When it was first seen on disk. */
  firstAt?: number
  /** Last time bytes were added to it. */
  grewAt?: number
  /** When it was first seen complete. */
  doneAt?: number
  /** True once no temp file of it is left. */
  isComplete: boolean
}

export type Download = {
  id: string
  /** curl, yt-dlp, git, npm, ... */
  kind: string
  /** What Claude called the step (the tool call's description). */
  title?: string
  /** The command or URL, shortened. */
  label: string
  /** Where the files land: one file, a folder to watch, or nothing to watch. */
  watch: { mode: 'file' | 'dir' | 'none'; path: string }
  status: DownloadStatus
  isBackground: boolean
  startedAt: number
  endedAt?: number
  /** Last time any byte was added on disk. */
  grewAt: number
  error?: string
  items: DlItem[]
  /** Sizes yt-dlp or the server announced, in item order. */
  totals: number[]
  isHidden?: boolean
  /** The project folder the session ran in. */
  project?: string
  /** Already written to the history every session shares. */
  isRecorded?: boolean
}

/** One finished download in the history every session and project shares. */
export type HistoryEntry = {
  id: string
  title: string
  kind: string
  status: 'done' | 'error'
  files: number
  bytes: number
  endedAt: number
  folder: string
  project: string
}


export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** What the band and the sidebar draw: the task list mirrored, or a live turn with no list. */
export type Flow = {
  /** The person's prompt (first line) for a live turn. */
  prompt: string
  /** True for a turn with no task list: each tool call is a step. */
  live: boolean
  steps: number
  tasks: { title: string; status: TaskStatus }[]
  isFinished: boolean
  /** The turn ended by an abort, an error or a refusal while work was open. */
  isStopped: boolean
  startedAt: number
  endedAt?: number
}

export type CrewStatus = 'running' | 'done' | 'failed'

export type CrewMember = {
  id: string
  agentId?: string
  type: string
  description: string
  model?: string
  effort?: string
  status: CrewStatus
  startedAt: number
  endedAt?: number
  tokens: number
  contextTokens: number
  /** Model requests made so far. */
  steps: number
}


/** The hub sidebar's tabs. `lab` is a hidden test bench for the risky bits (spikes). */
export type HubTab = 'tasks' | 'downloads' | 'gallery' | 'usage' | 'lab'

export type TaskSub = 'now' | 'checklist' | 'crew' | 'history'
export type DlSub = 'active' | 'done' | 'failed' | 'stats'
export type GalSort = 'newest' | 'largest' | 'name'

/** A finished flow kept for the Tasks > History tab. */
export type ArchivedFlow = {
  id: string
  title: string
  live: boolean
  steps: number
  total: number
  done: number
  outcome: 'done' | 'stopped'
  startedAt: number
  endedAt: number
}

/** One rate-limit window as the last response reported it. */
export type UsageWindow = {
  /** five_hour, seven_day, or a gateway's spend_limit. */
  kind: string
  percent: number
  /** When it resets, ms since epoch. */
  resetsAt?: number
}

/** The latest usage reading: windows, context and cost. */
export type UsageSnapshot = {
  at: number
  windows: UsageWindow[]
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  costUsd?: number
  sessionStartedAt: number
}

/** One sample kept for the hourly and weekly charts (in $.store). */
export type UsageSample = { at: number; five?: number; week?: number; cost?: number }

declare module 'claude-code' {
  interface PluginState {
    'g-hub': {
      /** Downloads seen this session. */
      dlItems: Shaped<Download[]>
      /** The task list mirrored, or a live turn with no list. */
      flow: Shaped<Flow | null>
      /** Subagents of this session. */
      crew: Shaped<CrewMember[]>
      /** The clock drawings read, moved while something runs. */
      now: number
      /** Bumped by the Skills button; the skill-studio mod watches it and toggles its panel. */
      skillsPing: number
      /** Which tab the hub shows. */
      tab: HubTab
      /** Bumped when the Lab's spike results change, so the sidebar redraws. */
      labStamp: number
      /** The Lab tab's test field. */
      labQuery: string
      /** Finished flows of this session, newest last. */
      archive: Shaped<ArchivedFlow[]>
      /** The latest usage reading. */
      usage: Shaped<UsageSnapshot | null>
      /** The person hid the status strip above the row. */
      stripHidden: boolean
      /** Sub-tabs, search, paging and the expanded row, per tab. */
      taskSub: TaskSub
      dlSub: DlSub
      dlQuery: string
      dlPage: number
      dlSel: string
      galSub: string
      galSort: GalSort
      galQuery: string
      galPage: number
      galSel: string
      /** Bumped when the gallery's scan or thumbnails change. */
      galStamp: number
    }
  }
}
