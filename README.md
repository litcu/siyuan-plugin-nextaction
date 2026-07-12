# NextAction

[中文](./README.zh-CN.md)

A GTD task management plugin for [SiYuan Note](https://b3log.org/siyuan/).

NextAction lives inside your notes. Turn any block into a task, and it automatically calculates which one you should work on next based on deadlines, importance, and effort. No separate to-do app, no copy-pasting.

<!-- screenshot -->

## Quick Start

1. Install from the SiYuan marketplace, or download the release and place it in `data/plugins/siyuan-plugin-nextaction/`.
2. Open the dock panel — you'll see **Next Actions** showing tasks ready to work on.
3. Type `/zrw` on any text block to turn it into a task.
4. Click the status circle on the left side of the block to set status and priority.

That's it. Everything else is optional.

## How It Fits GTD

NextAction follows the five GTD stages: **Capture, Clarify, Organize, Reflect, Engage**.

### Capture

Type `/zrw` on any block, or right-click a block icon and choose **Convert to Task**. The block becomes a task with **Inbox** status — no decisions needed yet.

Use `/zrwz` on a list or document to batch-convert all child blocks into tasks at once.

### Clarify

Open the **Inbox** view. Every task here starts as Inbox status. For each one, decide:

- **Is it actionable?** If not, set it to **Someday/Maybe**.
- **Can I do it now?** If yes, set a status and priority. If you're waiting on someone, set **Waiting**.

### Organize

Set attributes that help the priority engine figure out what matters:

- **Due date** and **Start date** — tasks before their start date are hidden from Next Actions.
- **Importance** (1–7) and **Effort** (1–7) — feed into the automatic priority score.
- **Context** — tag with `@office`, `@phone`, etc., then filter by context in the panel.
- **Parent task** — nest tasks under a project; projects with unfinished children won't appear in Next Actions.

The priority engine uses a configurable multiplicative formula combining importance, urgency (days until due), effort, and weight. You don't need to manually sort anything.

### Reflect

The **Review** view gives you a GTD-style checklist: Are my Inbox empty? Are my projects moving? Are my Waiting items followed up?

You can also set a **review interval** on any task — NextAction will remind you to revisit it periodically.

### Engage

The **Next Actions** view shows only what you can actually do right now: not completed, not blocked, not waiting, past start date, no unfinished children. Pick one and go.

For daily planning, switch to **My Day**: drag tasks onto the timeline to schedule your day. The list resets each morning (configurable).

## Task Statuses

| Status | Meaning | Visual |
|--------|---------|--------|
| Inbox | Captured, not yet clarified | Light blue circle with down arrow |
| To Do | Clarified, not started | Gray hollow circle |
| In Progress | Working on it | Blue half-filled circle |
| Waiting | Blocked on someone or something | Orange dashed circle |
| Someday/Maybe | On hold for now | Gold circle with three dots |
| Done | Finished | Green circle with white checkmark |

## Priority Levels

Critical (red) > High (orange) > Medium (blue) > Low (gray) > None

Priority is a quick label. The actual ordering comes from the computed priority score, which factors in importance, due date, effort, and configurable weights. Adjust all parameters in Settings.

## Views

| View | What it shows |
|------|---------------|
| Next Actions | Tasks you can do right now, sorted by priority score |
| All Tasks | Every unfinished task in a tree, with search, filter, and drag-to-reorder |
| Projects | Tasks grouped by parent, with completion progress |
| Inbox | Inbox-status tasks awaiting clarification |
| My Day | Today's plan — timeline or list mode, drag to schedule |
| Someday/Maybe | Shelved tasks you might revisit |
| Waiting | Tasks blocked on external dependencies |
| Review | GTD checklist + tasks due for review |
| Statistics | Completion rate ring chart and distribution breakdown |
| Reminders | All pending reminders in one place |

<!-- screenshot -->

## Sidebar (Dock Panel)

A compact version with three tabs: **Next Actions**, **My Day**, and **Inbox**. Quick search and right-click menus included. Keep it open while you work.

<!-- screenshot -->

## Working with Tasks in the Editor

After converting a block to a task, a status circle appears on its left. Click it to open a menu where you can:

- Switch status
- Set priority
- Add to My Day
- Add a reminder
- View and edit all attributes
- Remove task (reverts the block to normal)

Right-click a task card in the panel for the same quick actions. Click the task title to open the full detail editor.

## Task Attributes

| Category | Fields |
|----------|--------|
| Basics | Title, Status, Priority |
| Dates | Due date, Start date (time-accurate to minutes) |
| Priority params | Importance (1–7), Effort (1–7) |
| Organization | Context (`@`), Tags, Parent task, Project |
| Dependencies | Depends on, Dependency mode (all/any), Sequential execution |
| Recurrence | Frequency (daily/weekly/biweekly/monthly/yearly), Interval, Anchor (due date or completion date) |
| Review | Review interval (days), Next review date |
| Reminders | Before-due reminders (multiple offsets), Fixed-time reminders |
| Custom | User-defined extension fields |
| Notes | Free-text notes |

<!-- screenshot -->

## Slash Commands

| Command | Action |
|---------|--------|
| `/zrw` | Convert current block to a task |
| `/zrxm` | Convert current block to a project |
| `/zrwz` | Batch-convert a list or document subtree into tasks |

You can also right-click a block icon or a document title icon for the same options.

## Settings

Five tabs:

1. **Task Defaults** — Default importance/effort, rebuild cache, fix parent-child relationships.
2. **My Day** — Enable/disable, daily reset time, default view mode, default schedule duration.
3. **Reminders** — Enable/disable, default advance offsets, sound selection.
4. **Custom Fields** — Add, remove, reorder custom attributes.
5. **Priority Parameters** — Weight distribution, decay/growth/lookahead tuning.

<!-- screenshot -->

## Sync & Performance

- Tasks are stored as custom attributes (`custom-na-*`) on SiYuan blocks, indexed by SQL.
- An in-memory cache holds all tasks; incremental sync polls every 5 seconds for changes.
- Writes are mutex-locked to prevent concurrency issues.
- Frontend and kernel communicate through SiYuan's RPC mechanism — see [ARCHITECTURE.md](./docs/ARCHITECTURE.md) for details.

## Installation

**From marketplace:** Open SiYuan's marketplace and search for "NextAction".

**Manual:** Download the latest release, extract it to your workspace's `data/plugins/siyuan-plugin-nextaction/` directory, and reload SiYuan.

## Development

```bash
pnpm install
pnpm run dev        # Watch mode (kernel + frontend in parallel)
pnpm run build      # Production build
pnpm run release    # Build + deploy to local plugin directory
pnpm run release:package  # Build package.zip for GitHub Release
```

For architecture details, see [ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Publishing

Releases are tag-driven. Run one of the following commands from a clean working tree:

```bash
pnpm run release:patch
pnpm run release:minor
pnpm run release:major
pnpm run release:current
pnpm run release:version -- 1.2.3
```

The command updates `package.json` and `plugin.json` when needed, commits the version bump, creates a `vX.Y.Z` tag, and pushes both the commit and tag. Use `release:current` for the first release if the current version is already correct. GitHub Actions then builds `package.zip` and creates the GitHub Release automatically.

## License

This project is licensed under the MIT License with the Commons Clause. You may use, modify, and share it, but you may not sell, paid-package, or monetize this plugin or derivative versions without permission. See [LICENSE](./LICENSE).
