# NextAction

[中文](./README.zh-CN.md)

A GTD task manager for [SiYuan Note](https://b3log.org/siyuan/).

NextAction helps you decide what to do next. Turn any block into a task, add the useful bits - due date, importance, effort, context - and the plugin will filter for tasks you can act on now and put them in a workable order. Tasks still live in SiYuan, which fits people who already keep project notes, meeting notes, and running lists there.

<!-- screenshot -->

## Quick Start

1. Install NextAction from the SiYuan marketplace, or download a release and place it under your workspace's `data/plugins/` directory.
2. Type `/zrw` in any document to convert the current block into a task.
3. Click the status circle beside the block to set status, priority, or open task details.
4. Open the dock panel to use **Next Actions**, **My Day**, and **Inbox**.

That is enough to start. Importance, review intervals, reminders, dependencies, and custom fields can wait until your task list needs them.

## How It Fits GTD

NextAction follows the basic GTD rhythm: capture first, clarify later, organize into the right list, review regularly, and work from a short list of things you can actually do now.

### Capture: Get It Out of Your Head

- Type `/zrw` to convert the current block into a task. New tasks start in **Inbox**.
- Type `/zrxm` to convert the current block into a project.
- Type `/zrwz` to batch-convert a list or document subtree.
- You can also right-click a block icon or document title icon and choose **Convert to Task**.

Inbox items do not need to be perfect. Capture them first; decide what they mean later.

### Clarify: Decide What Happens Next

Open **Inbox** and process items one by one:

- If it is actionable, move it to **To Do** or **In Progress**.
- If it is not for now, move it to **Someday/Maybe**.
- If it depends on someone or something else, mark it as **Waiting**.
- If it no longer matters, remove the task attributes.

When a task needs more context, open its details and add due date, start date, importance, effort, context, tags, notes, and other fields.

### Organize: Put It in the Right List

Task statuses map to familiar GTD lists:

| Status | Visual | Best for |
|--------|--------|----------|
| Inbox | Light blue circle + down arrow | Captured, not clarified yet |
| To Do | Gray hollow circle | Clarified, not started |
| In Progress | Blue half-filled circle | Currently being worked on |
| Waiting | Orange dashed circle | Waiting on people, feedback, or conditions |
| Someday/Maybe | Gold circle + three dots | Maybe later |
| Done | Green solid circle + white check | Finished |

Priority has five levels: Critical (red) > High (orange) > Medium (blue) > Low (gray) > None.

Tasks can be nested. A project can contain tasks, and a task can contain subtasks. If a parent still has unfinished children, it will not be pushed into **Next Actions** as if it were ready to do.

### Reflect: Keep the Lists Alive

- **Review** shows a GTD-style checklist and tasks that are due for review.
- Any task can have a review interval, so it comes back when it needs attention.
- During review, you can move **Waiting** items back to **To Do**, or reactivate **Someday/Maybe** items.

### Engage: Work From What Is Available Now

**Next Actions** shows only tasks you can work on now. Completed tasks, waiting tasks, blocked parent tasks, and tasks before their start date are filtered out.

For daily planning, use **My Day**: pick tasks from Next Actions and drag them onto a timeline. The dock panel keeps a compact version nearby while you write.

<!-- screenshot -->

## Views

| View | What it is for |
|------|----------------|
| Next Actions | Available tasks, sorted by computed score |
| All Tasks | Tree view of unfinished tasks, with search, filters, and drag sorting |
| Projects | Tasks grouped by project, with child tasks and progress |
| Inbox | Inbox tasks waiting to be clarified |
| My Day | Today's plan, in list or timeline mode |
| Someday/Maybe | Shelved tasks that can be reactivated |
| Waiting | Tasks blocked by people or outside conditions |
| Review | GTD checklist and tasks due for review |
| Statistics | Completion and distribution overview |
| Reminders | Pending reminders in one place |

## Task Attributes

| Category | Fields |
|----------|--------|
| Basics | Title, status, priority |
| Dates | Due date, start date (minute-level precision) |
| Priority params | Importance (1-7), effort (1-7) |
| Organization | Context (`@`), tags, parent task, project |
| Dependencies | Dependent tasks, dependency mode (all/any), sequential execution |
| Recurrence | Frequency (daily/weekly/biweekly/monthly/yearly), interval, anchor |
| Review | Review interval, next review date |
| Reminders | Before-due reminders, fixed-time reminders |
| Custom | User-defined fields |
| Notes | Free-text notes |

## Working With Tasks in the Editor

After a block becomes a task, a status circle appears on its left:

- **Click the circle** to change status, set priority, add to My Day, add reminders, view attributes, or remove the task.
- **Left-click the circle in the panel** to open the status menu.
- **Right-click a task card in the panel** for quick status, priority, My Day, reminder, and remove actions.
- **Click the task title** to open the full detail editor.
- **Drag task cards** in All Tasks to adjust order.

## How Priority Is Calculated

NextAction computes a score from importance, effort, due-date urgency, and manual priority. Higher scores appear earlier.

You do not have to sort every task by hand. In everyday use, filling in importance, effort, and due date is usually enough to get a useful order. Tasks before their start date stay out of **Next Actions**, so they do not distract too early.

Priority parameters can be adjusted in settings.

## Settings

The settings panel has five sections:

1. **Task Defaults**: default importance, default effort, rebuild cache, fix parent-child relationships.
2. **My Day**: enable switch, daily reset time, default view mode, default scheduled duration.
3. **Reminders**: enable switch, default advance offsets, sound selection.
4. **Custom Fields**: add, remove, and reorder extension fields.
5. **Priority Parameters**: due date, start date, importance, decay, growth, lookahead, and related tuning.

## Installation

**Marketplace:** Settings -> Marketplace -> search for "NextAction" -> install.

**Manual:** Download the `siyuan-plugin-nextaction` folder from a release, place it under your workspace's `data/plugins/` directory, then enable it from **Settings -> Marketplace -> Downloaded**.

## Development

```bash
pnpm install
pnpm run dev              # Watch mode: kernel + app in parallel
pnpm run build            # Production build
pnpm run release          # Build and deploy to local plugin directory
pnpm run release:package  # Build package.zip for marketplace/GitHub release
```

Architecture notes: [ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Publishing

Releases are driven by Git tags. From a clean working tree, run:

```bash
pnpm run release:patch
pnpm run release:minor
pnpm run release:major
pnpm run release:current
pnpm run release:version -- 1.2.3
```

The command updates `package.json` and `plugin.json` when needed, commits the version bump, creates a `vX.Y.Z` tag, and pushes both commit and tag. If the current version is already correct for the first release, use `release:current`. GitHub Actions will build `package.zip` and create the GitHub Release after the tag is pushed.

## License

This project uses the MIT License with the Commons Clause. You may use, modify, and share this plugin. Without permission, you may not sell it, package it as a paid product, publish it as a paid listing, or monetize this plugin or derivative versions. See [LICENSE](./LICENSE).
