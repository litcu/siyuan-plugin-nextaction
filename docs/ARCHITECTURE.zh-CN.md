[English](./ARCHITECTURE.md)

# 架构文档

NextAction 是一款基于思源笔记的 GTD 任务管理插件，灵感来自 MyLifeOrganized。提供自动优先级计算、下一步行动视图、块转任务和增量同步。所有任务数据以 `custom-na-*` 自定义属性的形式存储在思源块上。

## 目录结构

```
siyuan-mylifeorganized/
  kernel.js                          # Webpack 构建产物（内核 Bundle）
  package.json
  plugin.json                        # 思源插件元数据
  webpack.kernel.config.js           # 内核 Bundle 构建配置
  vite.config.ts                     # 前端 Bundle 构建配置
  dist/                              # Vite 构建输出
  docs/                              # 文档
  vendor/                            # 参考项目（不参与构建）
  src/
    index.ts                         # 前端插件入口
    index.scss                       # 全局样式
    kernel.ts                        # 内核插件入口
    kernel/                          # 内核层
      cache-manager.ts               # 内存任务缓存
      mutex.ts                       # 异步互斥锁
      my-day-manager.ts              # 我的一天状态持久化
      priority-engine.ts             # 优先级计算引擎
      repeat-engine.ts               # 重复任务规则解析
      rpc-server.ts                  # RPC 方法注册表
      sync-engine.ts                 # 变更广播
      task-service.ts                # 核心业务逻辑
    frontend/                        # 前端层
      kernel-bridge.ts               # RPC 客户端封装
      constants.ts                   # 视图 ID、颜色
      stores/
        task-store.ts                # 主 Svelte store
        reminder-store.ts            # 提醒扫描器
      components/                    # Svelte 组件
      ui/                            # 通用 UI 组件（Na*）
        tokens.scss / primitives.scss
    shared/                          # 内核与前端共享
      types.ts                       # TaskCacheEntry 等
      constants.ts                   # ATTR_* 属性名、错误码
      settings.ts                    # PluginSettings
    i18n/
      en.json / zh-CN.json
```

## 双 Bundle 架构

需要内核访问的思源插件要求**两个独立 Bundle**，运行在不同的 JavaScript 上下文中：

|  | 内核 Bundle | 前端 Bundle |
|---|---|---|
| **入口** | `src/kernel.ts` | `src/index.ts` |
| **构建工具** | Webpack | Vite |
| **输出** | `kernel.js`（项目根目录） | `dist/index.js` |
| **格式** | ESM（`siyuan` 外部化） | CJS（`siyuan`、`process` 外部化） |
| **运行时** | 思源内核进程（Goja） | 浏览器 |
| **API 访问** | `siyuan.client.fetch`、`siyuan.rpc` | DOM、Svelte、`KernelBridge` |

**为什么需要两个 Bundle？** 思源的插件模型将内核进程与浏览器隔离。内核可访问思源后端 API（`/api/*`），前端运行在浏览器标签页中，通过思源的 RPC 机制与内核通信。拆分为两个 Bundle，让各自使用适合的运行时 API。

**通信路径**：前端调用 `plugin.kernel.rpc.call[method](params)`，经思源内部 IPC 路由到内核。内核返回结果或错误。对于推送通知，内核调用 `siyuan.rpc.broadcast("tasksChanged", notification)`，前端通过 `plugin.kernel.rpc.bind("tasksChanged", handler)` 接收。

## 数据流

```
用户操作（UI）
  → KernelBridge.call(method, params)         [前端 → 内核 RPC]
    → rpc-server.ts 中的 RPC 方法              [内核]
      → TaskService（读/写）                   [内核]
        → CacheManager（内存缓存）              [内核]
        → SiYuan API（via siyuanFetch）        [内核 → 思源]
      → SyncEngine.broadcastChanges()          [内核]
    → siyuan.rpc.broadcast("tasksChanged")     [内核 → 前端]
  → taskStore.applyChangeNotification()        [前端 store 更新]
```

关键设计决策：

- **所有写操作经过内核。** 前端不直接调用思源 API，确保 CacheManager 始终是权威数据源，互斥锁防止并发修改。
- **RPC 调用返回 Promise。** 每个 RPC 方法必须直接返回结果；没有方法名之外的请求/响应关联。
- **错误以返回值形式传递，而非抛出。** RPC 方法返回 `{ _rpcError: { code, message } }` 结构，前端 `KernelBridge` 检测此结构后转为 `RpcCallError` 异常。
- **变更通知经过防抖。** `SyncEngine` 收集待处理变更，在最后一次变更后等待 100ms，再广播包含所有受影响 blockId 的单条通知。

## RPC 方法

内核通过 `siyuan.rpc.bind` 注册 28 个 RPC 方法，前端通过 `KernelBridge` 的同名方法调用。

| 方法 | 参数 | 返回值 | 说明 |
|---|---|---|---|
| `echo` | `...any[]` | `any[]` | 健康检查/调试 |
| `convertToTask` | `{ blockId, cleanTitle?, taskType? }` | `TaskCacheEntry` | 将块转为任务；自动查找父任务 |
| `convertToTaskWithChildren` | `{ blockId, cleanTitle?, taskType? }` | `{ converted, skipped }` | 批量转换列表/文档子树 |
| `removeTask` | `{ blockId }` | `{ success }` | 清除任务属性；子任务重新指向祖父 |
| `updateTask` | `{ blockId, attrs }` | `TaskCacheEntry` | 更新属性；自动归一化 `na-*` → `custom-na-*` |
| `getTask` | `{ blockId }` | `TaskCacheEntry \| null` | 从缓存读取单个任务 |
| `getNextActions` | — | `TaskCacheEntry[]` | 下一步行动候选列表 |
| `getAllTasks` | `{ status?, sortBy? }` | `TaskCacheEntry[]` | 全部任务；sortBy: order/due/importance/priority |
| `getTasksByParent` | `{ parentBlockId }` | `TaskCacheEntry[]` | 获取子任务 |
| `recalcAllOrders` | — | `{ success }` | 重算所有任务的优先级分数 |
| `rebuildCache` | — | `{ success }` | 从思源数据库重建缓存 |
| `rebuildParentRelationships` | — | `{ fixed }` | 修复损坏的父子关系 |
| `getDoneTaskCount` | — | `{ count }` | 已完成任务计数 |
| `getContexts` | — | `string[]` | 所有上下文标签 |
| `getTags` | — | `string[]` | 所有标签 |
| `getProjectReminders` | — | `TaskCacheEntry[]` | 子任务全部完成的项目 |
| `reorderTask` | `{ blockId, parentId?, afterId? }` | `TaskCacheEntry` | 拖拽排序 |
| `getStatistics` | `{ period? }` | `StatisticsResult` | 聚合统计 |
| `updateSettings` | `{ settings }` | `PluginSettings` | 保存设置；保存前校验 |
| `getSettings` | — | `PluginSettings` | 当前设置 |
| `getMyDay` | — | `MyDayState` | 今日任务列表和排期 |
| `addTaskToMyDay` | `{ blockId }` | `MyDayState` | 加入我的一天 |
| `removeTaskFromMyDay` | `{ blockId }` | `MyDayState` | 从我的一天移除 |
| `reorderMyDayTask` | `{ blockId, afterId? }` | `MyDayState` | 我的一天排序 |
| `setMyDaySchedule` | `{ blockId, start, end }` | `MyDayState` | 设置时间线时段（毫秒时间戳） |
| `removeMyDaySchedule` | `{ blockId }` | `MyDayState` | 移除时间线时段 |
| `getReviewData` | — | `ReviewData` | 按回顾类别分组的任务 |
| `markTaskReviewed` | `{ blockIds }` | `TaskCacheEntry[]` | 更新指定任务的 reviewDate |

### 错误码

| 错误码 | 常量 | 含义 |
|---|---|---|
| -32000 | `RPC_ERROR_INTERNAL` | 内部错误 |
| -32001 | `RPC_ERROR_INVALID_PARAMS` | 参数无效 |
| -32002 | `RPC_ERROR_TASK_NOT_FOUND` | 任务不存在或不在缓存中 |
| -32003 | `RPC_ERROR_CIRCULAR_REF` | 会创建父子环路 |
| -32005 | `RPC_ERROR_NOT_READY` | 缓存未加载 |
| -32006 | `RPC_ERROR_TIMEOUT` | 写锁超时（10 秒） |
| -32007 | `RPC_ERROR_DEP_CYCLE` | 检测到依赖环路 |
| -32008 | `RPC_ERROR_NOT_TEXT_BLOCK` | 不可转换的块类型（非 p/h/d） |

## CacheManager

`CacheManager` 维护内存中的 `Record<blockId, TaskCacheEntry>`，每个条目上带有反向索引（`childIds[]`）。

### 启动流程（`loadAll`）

1. **SQL 发现** — 查询 `blocks JOIN attributes`，条件 `name = 'custom-na-task'`，找出所有任务块 ID。
2. **批量属性获取** — 用所有发现的 ID 调用 `batchGetBlockAttrs`，单次调用返回 `{blockId: {key: value}}`。
3. **构建条目** — 对每个块，从属性构建 `TaskCacheEntry`，通过 `calculateOrder()` 计算 `order`，存入缓存。
4. **构建反向索引** — 遍历所有条目，将有 `parentId` 的条目 blockId 追加到父条目的 `childIds[]`。
5. **传播项目排序** — 项目（`taskType === "2"`）的 `order = max(自身分数, 最大子任务分数)`，使项目以其最紧急子任务的优先级出现。
6. **计算阻塞状态** — 对每个条目执行 `getBlockedReason()`，设置 `blocked` / `blockedReason`。
7. **排序迁移** — 为 `sort === -1` 的旧条目分配间距编号。

### 完整性校验

`loadAll()` 之后，`verifyIntegrity()` 将缓存条目数与新的 SQL `COUNT(*)` 对比。如果数量不一致，自动重建缓存。

### 为什么用内存缓存？

内存缓存提供：

- 按 blockId 的 O(1) 查找
- 无需 SQL 的父子遍历反向索引
- 需要图遍历的预计算 `blocked` 状态
- 启动时单次 `batchGetBlockAttrs` 调用替代 N 次单独调用

## SyncEngine

`SyncEngine` 将内核侧的写操作桥接到前端通知：

1. **注册变更** — `TaskService` 中每个写方法在广播前调用 `syncEngine.addPendingChange(blockId, type)`。类型为 `"create"`、`"update"` 或 `"delete"`，`"delete"` 优先级最高。
2. **防抖** — `broadcastChanges()` 在最后一次变更后等待 100ms 再发送。100ms 内的多次写入合并为单条通知。
3. **广播** — 调用 `siyuan.rpc.broadcast("tasksChanged", notification)`，携带 `{ changedBlockIds: string[], changeTypes: Record<blockId, type> }`。

**常见坑**：调用 `broadcastChanges()` 但没先调用 `addPendingChange()` 会导致静默空操作。每个写路径必须在广播前注册变更。

## 优先级计算引擎

### 评分公式

`order` 字段是由 `calculateOrder()` 计算的复合分数：

```
order = (dueWeight * dueScore + startWeight * startScore + importanceWeight * importanceScore) / effortPenalty
```

默认权重：`dueWeight = 0.45`、`startWeight = 0.25`、`importanceWeight = 0.30`。所有权重之和必须为 1.0（由 `validateSettings` 校验）。

#### 截止日分数

- 已逾期：`100 + min(overdueCap, |差值天数| * overdueGrowth)` — 上限 `100 + overdueCap`（默认 120）
- 未来：`overdueBase + (100 - overdueBase) * exp(-差值天数 / dueDecayTau)` — 指数衰减至 `overdueBase`（默认 35）
- 无截止日：`noDueScore`（默认 35）

当 `due` 包含时间部分（`YYYY-MM-DDTHH:mm`）时使用精确时间戳比较。仅日期值（`YYYY-MM-DD`）与当天结束时间比较。

#### 开始日分数

- 已过开始日：100
- 超过 `startHorizon` 天：`minStartScore`（默认 10）
- 中间：从 `minStartScore` 到 100 的二次插值

#### 重要性分数

有效重要性将 1-7 的 `importance` 字段与优先级偏移结合：

```
effectiveImportance = clamp(importance + priorityOffset, 0.5, 8.5)
importanceScore = 10 + (effectiveImportance - 0.5) / 8 * 80   // 范围 [10, 90]
```

优先级偏移：紧急 +1.5、高 +0.8、中 0、低 -0.8、无 -1.2。

#### 努力惩罚

```
effortPenalty = 1 + effortScale * (effort - 4)
```

默认 `effortScale = 0.05`。努力范围 1-7，中性点为 4（无惩罚）。更高努力降低分数，更低努力提高分数。

### 项目继承

对于项目（`taskType === "2"`），order 取 `max(自身分数, 最大子任务分数)`——项目以其最紧急子任务的优先级呈现。确保有截止子任务的项目出现在正确位置。

### 特殊情况

- `status === "inbox"` 或 `"someday"`：`order = 0`，综合排序时始终沉底。
- `isNextActionCandidate()` 对以下任务返回 `false`：已完成、等待中、收集箱、开始日期超过 `startPreviewDays` 的未来任务、项目、被阻塞的任务。

### 阻塞原因

`getBlockedReason()` 按优先级返回首个匹配的原因：

1. `"inbox"` — 状态为收集箱
2. `"someday"` — 状态为将来/也许
3. `"children"` — 有未完成的子任务
4. `"dependency"` — 有未解决的依赖（受 `depMode` 影响：`"any"` = 任一未完成即阻塞；默认 `"all"` = 全部未完成才阻塞）
5. `"sequential"` — 父任务为顺序执行且前面的兄弟未完成

被阻塞的任务 `blocked = true`，排除在下一步行动候选之外。

## 前端 Store

`taskStore` 是带自定义方法的 Svelte writable store，持有：

- `allTasks: TaskCacheEntry[]` — 单次 `getAllTasks` RPC 返回的完整数据集
- `filterByView: Record<viewId, FilterState>` — 每个视图独立的筛选状态
- 派生值：`contexts[]`、`tags[]`、`doneCount`、`projectReminders[]`、`reviewDueCount`

### 增量更新

- `applyUpdate(entry)` — 替换或插入单条记录，重新派生聚合值。`updateTask` RPC 返回最新记录后调用。
- `applyRemove(blockId)` — 移除条目，重新派生聚合值。
- `applyChangeNotification(notification)` — 对每个变更块：若为 `"delete"` 则从数组移除；否则通过 `getTask` RPC 获取最新记录后修补。处理完毕后安排 2 秒延迟的全量 `loadTasks()` 刷新。延迟使多次快速变更合并，全量刷新修正可能间接受影响的 `blocked` 值（如完成一个依赖会解除依赖方的阻塞）。

### 序列号计数器

`loadTasks()` 在发起 RPC 调用前递增序列号计数器。响应到达时检查计数器——如果期间又发起了新的 `loadTasks()`，过期响应被丢弃。这防止快速切换视图时的竞态条件。

### 视图过滤

下一步行动过滤在前端本地完成，使用内核预计算的 `blocked` 字段。`getAllTasks` RPC 返回完整数据集，每个视图的 `FilterState` 在客户端应用。这消除了逐视图的 RPC 调用，使视图切换零延迟。

## 自定义属性（`custom-na-*`）

思源要求自定义属性使用 `custom-` 前缀才能被 SQL 索引。插件统一使用 `custom-na-*`。

### 属性名常量

所有属性名定义为 `src/shared/constants.ts` 中的 `ATTR_*` 常量：

| 常量 | 属性名 | 存储值 |
|---|---|---|
| `ATTR_TASK` | `custom-na-task` | `"1"`（任务）或 `"2"`（项目） |
| `ATTR_STATUS` | `custom-na-status` | inbox / todo / doing / waiting / someday / done |
| `ATTR_PRIORITY` | `custom-na-priority` | critical / high / medium / low / none |
| `ATTR_DUE` | `custom-na-due` | YYYY-MM-DD 或 YYYY-MM-DDTHH:mm |
| `ATTR_START` | `custom-na-start` | YYYY-MM-DD 或 YYYY-MM-DDTHH:mm |
| `ATTR_CONTEXT` | `custom-na-context` | 管道符分隔：`"@office\|@phone"` |
| `ATTR_EFFORT` | `custom-na-effort` | 1-7 |
| `ATTR_IMPORTANCE` | `custom-na-importance` | 1-7 |
| `ATTR_PARENT` | `custom-na-parent` | 父任务 blockId |
| `ATTR_DEPENDS` | `custom-na-depends` | 管道符分隔的 blockId |
| `ATTR_DEP_MODE` | `custom-na-dep-mode` | `"all"`（默认）或 `"any"` |
| `ATTR_SEQUENTIAL` | `custom-na-sequential` | `"1"` = 子任务顺序执行 |
| `ATTR_REPEAT` | `custom-na-repeat` | 重复规则 |
| `ATTR_SORT` | `custom-na-sort` | 手动排序值（整数） |
| `ATTR_COMPLETED` | `custom-na-completed` | 完成时间戳 |
| `ATTR_NOTE` | `custom-na-note` | 自由文本备注 |
| `ATTR_CREATED` | `custom-na-created` | 创建时间戳 |
| `ATTR_TAGS` | `custom-na-tags` | 管道符分隔标签 |
| `ATTR_REVIEW_INTERVAL` | `custom-na-review-interval` | 回顾间隔天数 |
| `ATTR_REVIEW_DATE` | `custom-na-review-date` | 下次回顾日期（YYYY-MM-DD） |
| `ATTR_REMINDER` | `custom-na-reminder` | ReminderItem 的 JSON 数组 |

自定义扩展字段使用 `custom-na-ext-` 前缀（`ATTR_EXT_PREFIX`）。

### 归一化

`updateTask` 自动归一化属性键：调用方可以传 `"na-status"`，会被转换为 `"custom-na-status"`。这是一个便利层，减少样板代码，但所有内部代码和缓存条目使用完整的 `custom-na-*` 形式。

### 管道符分隔值

`context` 和 `tags` 以管道符分隔字符串存储（`"@office|@phone"`）。前端展示时替换为逗号+空格，输入时以逗号分隔再合并回管道符。转换逻辑在 `TaskEditPopup.svelte` 中。

## 互斥锁

所有内核侧的写操作和同步周期通过异步 `Mutex`（定义在 `src/kernel/mutex.ts`）串行化。

- `acquire()` 返回 `{ release }` 句柄。锁持有直到 `release()` 被调用。
- 写操作有 10 秒超时（`WRITE_LOCK_TIMEOUT_MS`）。如果在此窗口内无法获取锁，操作失败并返回 `RPC_ERROR_TIMEOUT`。
- 互斥锁防止多个前端操作触发并发内核写入（如批量转换与同步周期同时运行）时的竞态条件。

## 我的一天

我的一天状态通过思源的 `siyuan.storage` API 持久化到独立 JSON 文件（`my-day-v1.json`），包含：

- `dayKey` — 当前日期字符串
- `tasks[]` — 有序的 `{ blockId, addedAt, scheduleStart, scheduleEnd, order }` 列表
- 在可配置时间自动重置（默认凌晨 5 点）

时间线视图使用每分钟像素布局（1.2 px/min），30 分钟吸附格和 15 分钟拖拽精度。

## 插件集成点

- **停靠面板** — 注册为 `nextaction_dock`，承载 `DockSidebar.svelte` 组件
- **Tab 面板** — 注册为 `nextaction_tab`，承载 `NextActionApp.svelte` 组件
- **斜杠菜单** — `/zrw` 将块转为任务；`/zrwz` 批量转换含子项。斜杠文字必须在思源重新渲染前手动从 DOM 中删除
- **块图标菜单** — 右键菜单添加「转为任务」等子项
- **命令面板** — `convertToTask`、`recalcOrders` 等命令，带 `[NextAction]` 前缀
- **事件总线** — 监听 `click-blockicon`、`click-editortitleicon` 和 `kernel-plugin-state-change`

## 国际化

翻译文件位于 `src/i18n/`（`en.json`、`zh-CN.json`）。思源自动加载匹配的语言环境。在插件类中通过 `this.i18n.keyName` 访问翻译。新增 key 时必须同时更新两个语言文件。英文文件作为用户语言环境缺少 key 时的回退。
