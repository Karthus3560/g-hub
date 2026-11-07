<p align="center">
  <img alt="Claude Code mod" src="https://img.shields.io/badge/Claude%20Code-mod-D97757?style=for-the-badge&labelColor=1F1E1C">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-E3D5C1?style=for-the-badge&labelColor=1F1E1C"></a>
  <img alt="Version 0.1.1" src="https://img.shields.io/badge/version-0.1.1-D97757?style=for-the-badge&labelColor=1F1E1C">
</p>

<h1 align="center">G-Hub</h1>

<p align="center">
  <b>Stop guessing what Claude is doing. See it.</b><br>
  A live task monitor, your usage at a glance, and one hub sidebar for Tasks, Downloads, Gallery and Usage,<br>
  right above the Claude Code prompt.
</p>

---

## ✨ What you get

**Above the prompt**

| | |
|---|---|
| 🧭 **Four buttons** | **Skills · Tasks · Hub · Usage** in a tidy 2 × 2 grid. Tasks shows running helper agents, Hub shows running downloads, Usage turns amber or red as your busiest limit fills. |
| 🖥️ **Task monitor** | Every task Claude plans becomes its own **colored, labeled segment**. The one in progress glows with moving stripes and says what Claude is doing; finished ones fill solid; a ✓ lands when it's all done. A turn without a task list gets one segment per tool call. Progress and a live timer sit in the header. |
| 📊 **Usage grid** | Context fill · 5-hour window reset · session time · weekly reset, each with its own little gauge. The 5-hour and weekly figures are remembered across restarts until they reset. |

**The hub sidebar** (also `/hub`)

| | |
|---|---|
| ✅ **Tasks** | Now, Checklist, Crew (every subagent, live) and History. |
| ⬇️ **Downloads** | Live progress lanes for `yt-dlp`, `curl`, `npm` and friends, a receipt when each finishes, search, day groups, and Stats (totals, 14-day chart, by tool, by project). |
| 🖼️ **Gallery** | Every image in your project folder: folder chips, sort, search, thumbnails, preview, open, show in folder, copy path. Thumbnails need `ffmpeg`. |
| ⏱️ **Usage** | A ring and live countdown per window, cooldown cards, burn rate and pace, a 24-hour chart and a 7-day line. |

**Pairs with [Skill Studio](https://github.com/Karthus3560/skill-studio)**: the Skills button opens it, so every skill you own is one click away.

---

## 🚀 Install

> **Needs Claude Code with mods (function hooks) support.** Tested on Claude Code **2.1.317** (November 2026), in the desktop app's Code tab and in the terminal.

### In a terminal

```bash
claude plugin install g-hub --marketplace Karthus3560/g-hub
```

Or at the Claude Code prompt: `/plugin install g-hub --marketplace Karthus3560/g-hub`, answer **y**, and pick the **user** scope so it runs in every project.

### In the Claude desktop app

1. Click **+** next to the prompt box, then **Plugins**.
2. **Add marketplace** and enter `Karthus3560/g-hub`.
3. **Add plugin**, then choose **g-hub**.

### From a clone (to hack on it)

```bash
git clone https://github.com/Karthus3560/g-hub.git
claude --plugin-dir ./g-hub
```

Add Skill Studio the same way with `Karthus3560/skill-studio` for the Skills button.

---

## 👋 First run

Mods run inside a session, and a new chat's start screen is not a session yet. Open a chat and **send any first message**; the band appears above the prompt. Usage figures arrive with the first reply, then stay remembered.

---

## 🛠️ How it's built

Plain TypeScript against the Claude Code mod API: one `AbovePrompt` band, one `Pane` sidebar with tabs, a `ToolUse` card for downloads, and hooks on `tool.call`, `turn.*`, `agent.spawn` and `session.measure`. Every drawing is SVG with CSS motion phased from a clock, so redraws never stutter.

```
hooks/
  register.tsx   wiring: one hook per event
  tasks.tsx      the band above the prompt and the task tracking
  clawd.ts       the monitor, segmented bar and usage grid drawings
  hub.tsx        the sidebar: tabs, sub-tabs, search, paging
  downloads.tsx  download detection, lanes, receipts, history
  gallery.ts     image scan and thumbnails
  usage.ts       rate windows, context, cost, samples
  stats.ts, charts.ts, theme.ts, nav.ts, setup.ts
```

---

## 📄 License

[MIT](LICENSE) © 2026 Ghaith Saad Jawad
