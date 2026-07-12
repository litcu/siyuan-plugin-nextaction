[中文](./ARCHITECTURE.zh-CN.md)

# Architecture

NextAction is a SiYuan Note plugin for GTD-style task management, inspired by MyLifeOrganized. It provides automatic priority calculation, next-action views, block-to-task conversion, and incremental sync. All task data is stored as custom attributes (`custom-na-*`) on SiYuan blocks.

## Directory Layout

```
siyuan-mylifeorganized/
  kernel.js                          # Webpack output (kernel bundle)
  package.json
  plugin.json                        # SiYuan plugin metadata
  webpack.kernel.config.js           # Kernel bundle build config
  vite.config.ts                     # Frontend bundle build config
  dist/                              # Vite build output
  docs/                              # Documentation
  vendor/                            # Reference projects (not part of build)
  src/
    index.ts                         # Frontend plugin entry point
    index.scss                       # Global styles
    kernel.ts                        # Kernel plugin entry point
    kernel/                          # Kernel layer
      cache-manager.ts               # In-memory task cache
      mutex.ts                       # Async mutex
      my-day-manager.ts              # My Day state persistence
      priority-engine.ts             # Priority calculation
      repeat-engine.ts               # Recurring task rules
      rpc-server.ts                  # RPC method registry
      sync-engine.ts                 # Change broadcasting
      task-service.ts                # Core business logic
    frontend/                        # Frontend layer
      kernel-bridge.ts               # RPC client
      constants.ts                   # View IDs, colors
      stores/
        task-store.ts                # Main Svelte store
        reminder-store.ts            # Reminder scanner
      components/                    # Svelte components
      ui/                            # Shared UI components (Na*)
        tokens.scss / primitives.scss
    shared/                          # Shared between kernel & frontend
      types.ts                       # TaskCacheEntry, etc.
      constants.ts                   # ATTR_* names, error codes
      settings.ts                    # PluginSettings
    i18n/
      en.json / zh-CN.json
```

## Dual-Bundle Architecture

SiYuan plugins that need kernel access require **two independent bundles**, each running in a different JavaScript context:

| | Kernel Bundle | Frontend Bundle |
|---|---|---|
| **Entry** | `src/kernel.ts` | `src/index.ts` |
| **Build tool** | Webpack | Vite |
| **Output** | `kernel.js` (project root) | `dist/index.js` |
| **Format** | ESM (`siyuan` externaled) | CJS (`siyuan`, `process` externaled) |
| **Runtime** | SiYuan kernel process (Goja) | Browser |
| **API access** | `siyuan.client.fetch`, `siyuan.rpc` | DOM, Svelte, `KernelBridge` |

**Why two bundles?** SiYuan's plugin model isolates the kernel process from the browser. The kernel has access to the SiYuan backend API (`/api/*`), while the frontend runs in a browser tab and communicates with the kernel through SiYuan's RPC mechanism. Splitting into two bundles lets each use the appropriate runtime APIs.

**Communication path:** Frontend calls `plugin.kernel.rpc.call[method](params)` which routes through SiYuan's internal IPC to the kernel. The kernel returns results or errors. For push notifications, the kernel calls `siyuan.rpc.broadcast("tasksChanged", notification)` which the frontend receives via `plugin.kernel.rpc.bind("tasksChanged", handler)`.

## Data Flow

```
User Action (UI)
  → KernelBridge.call(method, params)         [frontend → kernel RPC]
    → RPC method in rpc-server.ts              [kernel]
      → TaskService (read/write)               [kernel]
        → CacheManager (in-memory cache)       [kernel]
        → SiYuan API (via siyuanFetch)         [kernel → SiYuan]
      → SyncEngine.broadcastChanges()          [kernel]
    → siyuan.rpc.broadcast("tasksChanged")     [kernel → frontend]
  → taskStore.applyChangeNotification()        [frontend store update]
```

Key design decisions in this flow:

- **All writes go through the kernel.** The frontend never calls SiYuan API directly. This ensures CacheManager stays authoritative and the mutex prevents concurrent modifications.
- **RPC calls return Promises.** Each RPC method must return its result directly; there is no request/response correlation beyond the method name.
- **Errors are returned, not thrown.** RPC methods return `{ _rpcError: { code, message } }` objects instead of throwing. The frontend `KernelBridge` detects this shape and converts it to a `RpcCallError` exception.
- **Change notifications are debounced.** `SyncEngine` collects pending changes, waits 100ms after the last change, then broadcasts a single notification with all affected block IDs.

## RPC Methods

The kernel registers 28 RPC methods via `siyuan.rpc.bind`. The frontend calls them through `KernelBridge` methods of the same name.

| Method | Parameters | Returns | Description |
|---|---|---|---|
| `echo` | `...any[]` | `any[]` | Health check / debug |
| `convertToTask` | `{ blockId, cleanTitle?, taskType? }` | `TaskCacheEntry` | Convert a block to task; auto-detects parent |
| `convertToTaskWithChildren` | `{ blockId, cleanTitle?, taskType? }` | `{ converted, skipped }` | Batch-convert a list/document subtree |
| `removeTask` | `{ blockId }` | `{ success }` | Strip task attributes; re-parent children |
| `updateTask` | `{ blockId, attrs }` | `TaskCacheEntry` | Update attributes; normalizes `na-*` → `custom-na-*` |
| `getTask` | `{ blockId }` | `TaskCacheEntry \| null` | Read single task from cache |
| `getNextActions` | — | `TaskCacheEntry[]` | Next-action candidates (kernel-filtered) |
| `getAllTasks` | `{ status?, sortBy? }` | `TaskCacheEntry[]` | Full task list; sortBy: order/due/importance/priority |
| `getTasksByParent` | `{ parentBlockId }` | `TaskCacheEntry[]` | Children of a parent task |
| `recalcAllOrders` | — | `{ success }` | Recalculate priority scores for all tasks |
| `rebuildCache` | — | `{ success }` | Full cache rebuild from SiYuan DB |
| `rebuildParentRelationships` | — | `{ fixed }` | Fix broken parent-child links |
| `getDoneTaskCount` | — | `{ count }` | Count of completed tasks |
| `getContexts` | — | `string[]` | Unique context labels |
| `getTags` | — | `string[]` | Unique tag labels |
| `getProjectReminders` | — | `TaskCacheEntry[]` | Projects whose children are all done |
| `reorderTask` | `{ blockId, parentId?, afterId? }` | `TaskCacheEntry` | Move task within parent's child list |
| `getStatistics` | `{ period? }` | `StatisticsResult` | Aggregated statistics |
| `updateSettings` | `{ settings }` | `PluginSettings` | Persist settings; validates before saving |
| `getSettings` | — | `PluginSettings` | Current settings |
| `getMyDay` | — | `MyDayState` | Today's task list + schedule |
| `addTaskToMyDay` | `{ blockId }` | `MyDayState` | Add task to My Day |
| `removeTaskFromMyDay` | `{ blockId }` | `MyDayState` | Remove task from My Day |
| `reorderMyDayTask` | `{ blockId, afterId? }` | `MyDayState` | Reorder within My Day |
| `setMyDaySchedule` | `{ blockId, start, end }` | `MyDayState` | Assign time slot (timestamps in ms) |
| `removeMyDaySchedule` | `{ blockId }` | `MyDayState` | Remove time slot |
| `getReviewData` | — | `ReviewData` | Tasks grouped by review category |
| `markTaskReviewed` | `{ blockIds }` | `TaskCacheEntry[]` | Update reviewDate for listed tasks |

### Error Codes

| Code | Constant | Meaning |
|---|---|---|
| -32000 | `RPC_ERROR_INTERNAL` | Unexpected internal error |
| -32001 | `RPC_ERROR_INVALID_PARAMS` | Missing or malformed parameters |
| -32002 | `RPC_ERROR_TASK_NOT_FOUND` | Block is not a task or not in cache |
| -32003 | `RPC_ERROR_CIRCULAR_REF` | Would create a parent loop |
| -32005 | `RPC_ERROR_NOT_READY` | Cache not loaded yet |
| -32006 | `RPC_ERROR_TIMEOUT` | Write lock timeout (10s) |
| -32007 | `RPC_ERROR_DEP_CYCLE` | Dependency cycle detected |
| -32008 | `RPC_ERROR_NOT_TEXT_BLOCK` | Block type not convertible (non-p/h/d) |

## CacheManager

`CacheManager` maintains an in-memory `Record<blockId, TaskCacheEntry>` with a reverse index (`childIds[]`) on each entry.

### Startup sequence (`loadAll`)

1. **SQL discovery** — Query `blocks JOIN attributes` where `name = 'custom-na-task'` to find all task block IDs.
2. **Batch attribute fetch** — Call `batchGetBlockAttrs` with all discovered IDs. This returns `{blockId: {key: value}}` in a single call.
3. **Build entries** — For each block, construct a `TaskCacheEntry` from its attributes, compute `order` via `calculateOrder()`, and store in the cache.
4. **Build reverse index** — Iterate all entries; for each with a `parentId`, push its `blockId` onto the parent's `childIds[]`.
5. **Propagate project orders** — Projects (`taskType === "2"`) get `order = max(ownScore, maxChildOrder)` so they surface at their most urgent child's priority.
6. **Compute blocked status** — For each entry, run `getBlockedReason()` and set `blocked` / `blockedReason`.
7. **Sort migration** — Assign `sort` values to entries that have `sort === -1` (legacy entries without manual ordering).

### Integrity verification

After `loadAll()`, `verifyIntegrity()` compares the cache entry count against a fresh SQL `COUNT(*)`. If counts differ, the cache is automatically rebuilt.

### Why in-memory cache?

The in-memory cache provides:

- O(1) lookups for any task by blockId
- Reverse index for parent-child traversal without SQL
- Pre-computed `blocked` status that requires graph traversal
- Single `batchGetBlockAttrs` call at startup instead of N individual calls

## SyncEngine

`SyncEngine` bridges kernel-side writes to frontend notifications:

1. **Register changes** — Every write method in `TaskService` calls `syncEngine.addPendingChange(blockId, type)` before broadcasting. Types are `"create"`, `"update"`, or `"delete"`, with `"delete"` taking precedence.
2. **Debounce** — `broadcastChanges()` waits 100ms after the last change before sending. Multiple writes within 100ms are coalesced into a single notification.
3. **Broadcast** — Calls `siyuan.rpc.broadcast("tasksChanged", notification)` with `{ changedBlockIds: string[], changeTypes: Record<blockId, type> }`.

**Common pitfall:** Calling `broadcastChanges()` without first calling `addPendingChange()` results in a silent no-op. Every write path must register its changes before broadcasting.

## Priority Engine

### Scoring formula

The `order` field is a composite score calculated by `calculateOrder()`:

```
order = (dueWeight * dueScore + startWeight * startScore + importanceWeight * importanceScore) / effortPenalty
```

Default weights: `dueWeight = 0.45`, `startWeight = 0.25`, `importanceWeight = 0.30`. All weights must sum to 1.0 (validated by `validateSettings`).

#### Due score

- Overdue: `100 + min(overdueCap, |diffDays| * overdueGrowth)` — caps at `100 + overdueCap` (default 120)
- Future: `overdueBase + (100 - overdueBase) * exp(-diffDays / dueDecayTau)` — exponential decay toward `overdueBase` (default 35)
- No due date: `noDueScore` (default 35)

When `due` includes a time component (`YYYY-MM-DDTHH:mm`), exact-timestamp comparison is used. Date-only values (`YYYY-MM-DD`) are compared against end-of-day.

#### Start score

- Already started: 100
- Beyond `startHorizon` days: `minStartScore` (default 10)
- In between: quadratic interpolation from `minStartScore` to 100

#### Importance score

Effective importance combines the 1-7 `importance` field with a priority offset:

```
effectiveImportance = clamp(importance + priorityOffset, 0.5, 8.5)
importanceScore = 10 + (effectiveImportance - 0.5) / 8 * 80   // range [10, 90]
```

Priority offsets: critical +1.5, high +0.8, medium 0, low -0.8, none -1.2.

#### Effort penalty

```
effortPenalty = 1 + effortScale * (effort - 4)
```

Default `effortScale = 0.05`. Effort ranges 1-7; the neutral point is 4 (no penalty). Higher effort reduces the score, lower effort boosts it.

### Project inheritance

For projects (`taskType === "2"`), the order is `max(ownScore, maxChildOrder)` — a project surfaces at its most urgent child's priority level. This ensures projects with due children appear in the right place.

### Special cases

- `status === "inbox"` or `"someday"`: `order = 0`, always sinks to bottom in comprehensive sort.
- `isNextActionCandidate()` returns `false` for: done tasks, waiting tasks, inbox tasks, tasks with a future start date beyond `startPreviewDays`, projects, and blocked tasks.

### Blocked reasons

`getBlockedReason()` returns the first matching reason:

1. `"inbox"` — status is inbox
2. `"someday"` — status is someday
3. `"children"` — has incomplete child tasks
4. `"dependency"` — has unresolved dependencies (respects `depMode`: `"any"` = any incomplete dep blocks; default `"all"` = all deps must be incomplete to block)
5. `"sequential"` — parent is sequential and an earlier sibling is incomplete

Blocked tasks get `blocked = true` and are excluded from next-action candidates.

## Frontend Store

`taskStore` is a Svelte writable store with custom methods. It holds:

- `allTasks: TaskCacheEntry[]` — full dataset from a single `getAllTasks` RPC call
- `filterByView: Record<viewId, FilterState>` — per-view filter state
- Derived values: `contexts[]`, `tags[]`, `doneCount`, `projectReminders[]`, `reviewDueCount`

### Incremental updates

- `applyUpdate(entry)` — replace or insert a single entry, re-derive aggregates. Called after `updateTask` RPC returns the fresh entry.
- `applyRemove(blockId)` — remove an entry, re-derive aggregates.
- `applyChangeNotification(notification)` — for each changed block: if `"delete"`, remove from array; otherwise, fetch the entry via `getTask` RPC and patch it in. After processing, schedules a 2-second delayed full `loadTasks()` refresh. The delay allows multiple rapid changes to coalesce, and the full refresh corrects stale `blocked` values that can change indirectly (e.g. completing a dependency unblocks dependents).

### Sequence counter

`loadTasks()` increments a sequence counter before making the RPC call. When the response arrives, it checks the counter — if another `loadTasks()` was initiated in the meantime, the stale response is discarded. This prevents race conditions from rapid view switches.

### View filtering

Next-action filtering is done locally on the frontend using the `blocked` field pre-computed by the kernel. The `getAllTasks` RPC returns the full dataset; each view's `FilterState` is applied client-side. This eliminates per-view RPC calls and makes view switching instant.

## Custom Attributes (`custom-na-*`)

SiYuan requires the `custom-` prefix for custom attributes to be indexed by SQL. The plugin uses `custom-na-*` throughout.

### Attribute name constants

All attribute names are defined as `ATTR_*` constants in `src/shared/constants.ts`:

| Constant | Attribute name | Stored value |
|---|---|---|
| `ATTR_TASK` | `custom-na-task` | `"1"` (task) or `"2"` (project) |
| `ATTR_STATUS` | `custom-na-status` | inbox / todo / doing / waiting / someday / done |
| `ATTR_PRIORITY` | `custom-na-priority` | critical / high / medium / low / none |
| `ATTR_DUE` | `custom-na-due` | YYYY-MM-DD or YYYY-MM-DDTHH:mm |
| `ATTR_START` | `custom-na-start` | YYYY-MM-DD or YYYY-MM-DDTHH:mm |
| `ATTR_CONTEXT` | `custom-na-context` | pipe-separated: `"@office\|@phone"` |
| `ATTR_EFFORT` | `custom-na-effort` | 1-7 |
| `ATTR_IMPORTANCE` | `custom-na-importance` | 1-7 |
| `ATTR_PARENT` | `custom-na-parent` | parent blockId |
| `ATTR_DEPENDS` | `custom-na-depends` | pipe-separated blockIds |
| `ATTR_DEP_MODE` | `custom-na-dep-mode` | `"all"` (default) or `"any"` |
| `ATTR_SEQUENTIAL` | `custom-na-sequential` | `"1"` = sequential children |
| `ATTR_REPEAT` | `custom-na-repeat` | recurrence rule |
| `ATTR_SORT` | `custom-na-sort` | manual sort order (integer) |
| `ATTR_COMPLETED` | `custom-na-completed` | completion timestamp |
| `ATTR_NOTE` | `custom-na-note` | free-text note |
| `ATTR_CREATED` | `custom-na-created` | creation timestamp |
| `ATTR_TAGS` | `custom-na-tags` | pipe-separated tags |
| `ATTR_REVIEW_INTERVAL` | `custom-na-review-interval` | days between reviews |
| `ATTR_REVIEW_DATE` | `custom-na-review-date` | next review date (YYYY-MM-DD) |
| `ATTR_REMINDER` | `custom-na-reminder` | JSON array of ReminderItem |

Custom extension fields use the `custom-na-ext-` prefix (`ATTR_EXT_PREFIX`).

### Normalization

`updateTask` auto-normalizes attribute keys: callers may pass `"na-status"` and it will be converted to `"custom-na-status"`. This is a convenience layer to reduce boilerplate, but all internal code and cache entries use the full `custom-na-*` form.

### Pipe-separated values

`context` and `tags` are stored as pipe-separated strings (`"@office|@phone"`). The frontend displays them with comma+space and parses comma-separated input back to pipe format in `TaskEditPopup.svelte`.

## Mutex

All kernel-side write operations and sync cycles are serialized through an async `Mutex` (defined in `src/kernel/mutex.ts`).

- `acquire()` returns a `{ release }` handle. The lock is held until `release()` is called.
- Write operations have a 10-second timeout (`WRITE_LOCK_TIMEOUT_MS`). If the lock cannot be acquired within this window, the operation fails with `RPC_ERROR_TIMEOUT`.
- The mutex prevents race conditions when multiple frontend actions trigger concurrent kernel writes (e.g., batch conversion while a sync cycle is running).

## My Day

My Day state is persisted to a separate JSON file (`my-day-v1.json`) via SiYuan's `siyuan.storage` API. It contains:

- `dayKey` — the date string for the current day
- `tasks[]` — ordered list of `{ blockId, addedAt, scheduleStart, scheduleEnd, order }`
- Automatic reset at configurable hour (default 5:00 AM)

The timeline view uses a pixel-per-minute layout (1.2 px/min) with 30-minute snap slots and 15-minute drag resolution.

## Plugin Integration Points

- **Dock panel** — Registered as `nextaction_dock`, hosts `TaskPanel.svelte`
- **Slash menu** — `/zrw` converts a block to task; `/zrwz` batch-converts with children. Slash text must be manually deleted from the DOM before SiYuan re-renders.
- **Block icon menu** — Right-click context menu adds "Convert to Task" with sub-items
- **Command palette** — `convertToTask`, `recalcOrders` available via `[NextAction]` prefixed commands
- **Event bus** — Listens to `click-blockicon` and `kernel-plugin-state-change`

## Internationalization

Translation files live in `src/i18n/` (`en.json`, `zh-CN.json`). SiYuan auto-loads the matching locale. Access translations via `this.i18n.keyName` in the plugin class. New keys must be added to both language files simultaneously. The English file serves as the fallback when a key is missing in the user's locale.
