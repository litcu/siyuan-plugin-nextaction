# NextAction（今天干点啥）插件设计规格

> 版本: v0.1.0 MVP
> 日期: 2026-07-02
> 状态: 已批准

## 1. 项目概述

### 1.1 定位

NextAction 是一个思源笔记的 GTD 任务管理插件，灵感来自 MyLifeOrganized (MLO) 6.x。核心理念是"告诉用户现在最该做什么"——通过自动优先级计算，让普通用户快速上手，同时为深度 GTD 实践者提供完整的工作流支持。

### 1.2 名称

- 英文名: NextAction
- 中文名: 今天干点啥
- 属性前缀: `na-`
- 插件目录名: `nextaction`

### 1.3 目标用户

介于普通用户和深度GTD实践者之间：普通用户可以快速上手（转为任务 → 看Next Action → 做完标记完成），深度用户可以利用重要性、工作量、上下文、自动排序等完整GTD工作流。

### 1.4 明确排除的功能

- 任务计时、时间追踪、番茄钟——不在任何版本的计划中

---

## 2. 架构设计

### 2.1 整体架构

采用前端插件 + 内核插件的双轨架构。前端负责UI渲染和用户交互，内核负责业务逻辑、数据管理和后台任务。前端通过思源内置的 `this.kernel.rpc.call/broadcast` 机制与内核通信，无需自建WebSocket客户端。

```
┌──────────────────────────────────────────────┐
│                  前端插件 (V8/Electron)         │
│                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ 顶栏按钮  │ │ Dock面板  │ │ 斜杠菜单/命令 │  │
│  └────┬─────┘ └────┬─────┘ └──────┬───────┘  │
│       │            │              │          │
│  ┌────▼────────────▼──────────────▼───────┐  │
│  │           UI 层 (Svelte)               │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │任务面板   │ │任务编辑   │ │块转任务 │  │  │
│  │  │(多视图)   │ │弹窗      │ │操作     │  │  │
│  │  └──────────┘ └──────────┘ └────────┘  │  │
│  └────────────┬───────────────────────────┘  │
│               │ JSON-RPC (WebSocket)          │
└───────────────┼──────────────────────────────┘
                │
┌───────────────┼──────────────────────────────┐
│               ▼    内核插件 (TypeScript/goja)   │
│  ┌────────────────────────────────────────┐  │
│  │           业务逻辑层                     │  │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │  │
│  │  │任务服务   │ │优先级引擎 │ │缓存管理 │  │  │
│  │  │(CRUD)    │ │(排序计算) │ │(增量同步)│ │  │
│  │  └──────────┘ └──────────┘ └────────┘  │  │
│  │  ┌──────────┐ ┌──────────┐             │  │
│  │  │依赖引擎   │ │RPC服务   │             │  │
│  │  │(预留)    │ │(注册方法) │             │  │
│  │  └──────────┘ └──────────┘             │  │
│  └────────────┬───────────────────────────┘  │
│               │ siyuan.client.fetch()         │
│               ▼                               │
│  ┌────────────────────────────────────────┐  │
│  │       思源笔记后端 API                   │  │
│  │  /api/attr/*  /api/block/*  /api/query/*│  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### 2.2 职责划分

| 职责 | 位置 | 理由 |
|------|------|------|
| UI渲染、用户交互 | 前端 | 需要DOM |
| 任务CRUD | 内核 | 统一数据入口，保证一致性 |
| 优先级排序、依赖解析 | 内核 | 内存缓存上计算，性能好 |
| 缓存层（全量任务索引） | 内核 | 避免前端反复API调用 |
| RPC接口 | 内核 | 对前端暴露清晰的业务接口 |
| 后台定时任务 | 内核 | 第二档的逾期检查、第三档的提醒 |
| MCP工具注册 | 内核 | 原生支持 |

### 2.3 数据一致性设计

**三个数据变更来源：**

1. **用户通过插件UI操作** — 前端通过 `this.kernel.rpc.call.methodName()` 调用内核 → 内核更新属性 → 更新缓存 → 通过 `siyuan.rpc.broadcast()` 广播通知 → 前端通过 `this.kernel.rpc.bind()` 接收通知并刷新（实时）
2. **用户直接在思源中修改** — 内核定时增量同步（5秒）检测变更 → 更新缓存 → 广播通知（最多5秒延迟）
3. **其他插件或API修改** — 同第2种

**增量同步机制：**

- 每5秒执行一次（依赖goja引擎的setInterval支持，需在开发初期验证；若不支持，备选方案为前端setInterval定期调用内核RPC触发同步），SQL JOIN查询 blocks 和 attributes 表找出最近更新的块
- 与缓存对比，处理新增/变更
- 块删除检测：每60秒做一次全量比对——查询所有na-task属性不为空的块ID，与缓存中的ID做差集，差集即为已删除的块，从缓存移除并清理父任务的childIds

**前端即时刷新：**

- 用户在思源编辑器中操作（切换protyle等）时，前端EventBus捕获事件，主动向内核请求该块最新数据
- 广播通知包含变更详情（变更blockId列表和变更类型），前端据此做增量更新
- 广播做100ms防抖，合并多次变更

**并发安全：**

- 内核维护 isReady 标志，缓存构建完成前拒绝写操作
- MVP阶段使用全局写锁（Promise-based Mutex），一次只允许一个写操作执行，避免 await 期间其他RPC插入导致覆盖。v0.2.0再优化为per-blockId粒度
- 增量同步与RPC写操作通过同一个Mutex互斥，确保不会在同步期间执行写操作、不会在写操作期间启动同步
- 写操作必须有try/catch包裹和超时保护（10秒），异常后释放锁并返回错误码

**重连补偿：**

- 思源内置的 `kernel.rpc` 机制由框架管理连接和重连，前端无需自建重连逻辑
- 前端通过 `this.eventBus.on("kernel-plugin-state-change")` 监听内核状态变化，当内核重新进入running状态时，主动调用 `getAllTasks` 全量刷新前端状态

---

## 3. 数据模型

### 3.1 任务属性定义

任务数据存储在思源块的自定义属性中，属性名以 `na-` 前缀开头。所有属性值为字符串类型（思源API限制）。

| 属性名 | 类型 | 说明 | 示例值 | 版本 |
|--------|------|------|--------|------|
| `na-task` | `"1"` / `"2"` | 条目类型：1=任务，2=项目 | `"1"` | MVP |
| `na-status` | string | 任务状态 | `"todo"` | MVP |
| `na-priority` | string | 优先级ID | `"high"` | MVP |
| `na-due` | string | 截止日期，格式 YYYY-MM-DD | `"2026-07-15"` | MVP |
| `na-start` | string | 开始日期，格式 YYYY-MM-DD | `"2026-07-10"` | MVP |
| `na-context` | string | 上下文标签，`\|` 分隔 | `"@office\|@phone"` | MVP |
| `na-effort` | `"1"`~`"7"` | 工作量，4=一般 | `"5"` | MVP |
| `na-importance` | `"1"`~`"7"` | 重要性，4=一般 | `"6"` | MVP |
| `na-parent` | string | 父任务块ID，空字符串或属性不存在=顶层任务 | `"202008250000-a1b2c3d"` | MVP |
| `na-depends` | string | 依赖的任务ID列表，`\|` 分隔 | - | 第二档 |
| `na-dep-mode` | `"all"` / `"any"` | 依赖模式 | - | 第二档 |
| `na-sequential` | `"1"` / 不存在 | 子任务按序逐个出现 | - | 第二档 |
| `na-repeat` | string | 重复规则（简化版RRULE） | - | 第二档 |
| `na-someday` | `"1"` / 不存在 | 将来/也许标记 | - | 第二档 |
| `na-reminder` | string | 提醒时间，ISO datetime | - | 第三档 |

**关于 na-order：** 排序分值仅在内核缓存中维护，不写入块属性。理由：避免用户在属性面板误编辑、避免写入后触发增量同步再重算的循环依赖。

### 3.2 预设状态

| 状态ID | 显示名(en) | 显示名(zh-CN) | 含义 |
|--------|-----------|---------------|------|
| `todo` | To Do | 待办 | 尚未开始 |
| `doing` | In Progress | 进行中 | 正在做 |
| `waiting` | Waiting | 等待 | 等待他人或条件 |
| `done` | Done | 已完成 | 已完成 |

- "下一步行动"是视图筛选的结果，不是状态
- "取消任务"= 移除所有 `na-*` 属性，不是状态变更
- `waiting` 状态的任务不出现在 Next Action 视图中

### 3.3 预设优先级

| 优先级ID | 显示名(en) | 显示名(zh-CN) | 权重 |
|----------|-----------|---------------|------|
| `critical` | Critical | 紧急 | 5 |
| `high` | High | 高 | 4 |
| `medium` | Medium | 中 | 3 |
| `low` | Low | 低 | 2 |
| `none` | None | 无 | 1 |

### 3.4 属性值约定

- 日期格式严格为 `YYYY-MM-DD`，无时间无时区
- 上下文标签以 `|` 分隔（避免逗号歧义）
- 数值属性（importance/effort）存储为字符串 "1"~"7"，缓存中转为 number
- 属性转换统一通过 `attrToNumber(value, defaultVal)` 和 `numberToAttr(val)` 工具函数

### 3.5 块转任务时的层级关系维护

转换一个块为任务时，自动维护父子关系：

1. **向上查找：** 沿 parent_id 遍历祖先链（用SQL批量查询，非逐级API调用），找到最近的 na-task 属性不为空的祖先，设置当前块的 na-parent
2. **向下查找：** 查询当前块所有子孙块中已有 na-task 属性的，仅将 na-parent 为空或指向当前块上方祖先的子孙重新指向当前块，不破坏已有的更近父子关系

### 3.6 移除任务时的层级关系维护

移除一个任务（移除 na-* 属性）时：

1. 将该任务的所有子任务的 na-parent 重新指向被移除块的 na-parent（祖父任务）
2. 更新缓存中祖父任务的 childIds
3. 如果无祖父任务（或被移除块的 na-parent 为空/不存在），子任务的 na-parent 设为空（成为顶层任务）

**空值语义统一约定：** na-parent 属性值为空字符串 `""` 与属性不存在（未设置）视为等价，均表示顶层任务。所有读取 na-parent 的代码统一将空字符串和undefined/null视为"无父任务"。

---

## 4. 优先级排序算法

### 4.1 输入因子

| 因子 | 来源 | 权重方向 |
|------|------|---------|
| 重要性 | na-importance（1-7） | 越高越优先 |
| 工作量 | na-effort（1-7） | 越低越优先（快速赢） |
| 优先级 | na-priority（1-5权重） | 越高越优先 |
| 紧迫性 | 基于 na-due 与当前日期差值 | 越近越优先 |
| 开始状态 | 基于 na-start | 未到开始日期的任务不参与排序 |

### 4.2 计算公式

```
order = importance × 14 + urgency × 0.3 + priority_weight × 10 + (8 - effort) × 6
```

各项系数说明：
- `importance × 14`：贡献 14-98 分，最大权重因子，符合GTD重要性优先理念
- `urgency × 0.3`：贡献 0-60 分（无截止日时贡献30分），确保到期日近的任务得到提升但不压过重要性
- `priority_weight × 10`：贡献 10-50 分，用户手动设置的优先级有显著影响
- `(8 - effort) × 6`：贡献 6-42 分，低工作量任务（快速赢）获得加分

### 4.3 紧迫性分值

```
urgency = f(距截止日天数)
```

| 距截止日 | 紧迫性分值 |
|----------|-----------|
| 已逾期 | min(200, 100 + 逾期天数 × 2) |
| 今天到期 | 95 |
| 1天后 | 85 |
| 2天后 | 75 |
| 3天后 | 65 |
| 4天后 | 55 |
| 5天后 | 45 |
| 6天后 | 35 |
| 7天后 | 25 |
| 8-14天 | 15 |
| 15-30天 | 8 |
| 30天+ | 3 |
| 无截止日 | 100（避免"无截止日=永远不重要"，给予中等紧迫性贡献30分） |

日期计算统一使用UTC，避免时区问题。

### 4.4 Next Action 过滤规则

排除以下任务：
- `na-status = "done"` 的任务
- `na-status = "waiting"` 的任务
- `na-start` 未到的任务（开始日期在今天之后）
- 有未完成子任务的父任务（子任务 status 不为 done，包括 waiting 状态的子任务）

### 4.5 二级排序

na-order 相同时按：na-due 升序 → na-importance 降序 → blockId 字典序

### 4.6 按需计算策略

- 用户通过插件UI修改 importance/effort/priority/due/start 时，只重算当前任务的排序分值
- 修改 status 导致父任务是否应出现在Next Action中变化时，重新应用过滤规则（不需要重算order，因为Next Action的过滤和排序是两个独立步骤：先过滤再排序）
- 提供"重新计算所有优先级"命令，全量重算（分片执行，每片N个通过setTimeout(0)让出事件循环）

---

## 5. 内核模块设计

### 5.1 缓存管理器（CacheManager）

使用普通对象 `Object.create(null)` 作为缓存容器（避免Map在goja中的兼容性风险）。

```typescript
interface TaskCacheEntry {
    blockId: string
    parentId: string        // na-parent，空字符串=顶层任务
    status: string          // na-status
    priority: string        // na-priority
    importance: number      // na-importance → number
    effort: number          // na-effort → number
    due: string             // na-due
    start: string           // na-start
    context: string         // na-context
    taskType: string        // na-task ("1" or "2")
    order: number           // 优先级排序分值（仅缓存，不写入块属性）
    childIds: string[]      // 所有na-parent指向此块的任务ID
    title: string           // 从blocks表content字段获取，用于前端展示
}
```

**初始化流程（onloaded）：**

1. 设置 isReady = false
2. 异步执行缓存加载（不阻塞onload返回）：
   a. SQL查询所有 na-task 属性不为空的块（同时获取 id, parent_id, content, updated）
   b. 使用 batchGetBlockAttrs 批量读取 na-* 属性
   c. 构建缓存对象（title从SQL的content字段获取）和 childIds 反向索引
3. 设置 isReady = true

**增量同步（每5秒，onrunning 启动）：**

1. 检查 isWriting 标志，若正在写操作则跳过本次同步
2. 设置 isSyncing = true
3. SQL JOIN 查询 blocks + attributes，找出 blocks.updated > lastSyncTime 的变更（blocks.updated 格式为 YYYYMMDDHHmmss 字符串）
4. 对变更块：新增→加入缓存，属性变更→更新缓存，na-task被移除→从缓存删除并清理父任务childIds
5. 对缓存差集：SQL结果中不存在的blockId表示块已删除，从缓存移除
6. 检查 na-parent 变更，更新 childIds 反向索引
7. 设置 isSyncing = false

注：RPC写操作在执行前也需检查 isSyncing 标志，若正在同步则等待同步完成后再执行，实现双向互斥。
8. 有变更 → 广播通知（100ms防抖）

**rebuildCache 方法：** 清空缓存，重新执行初始化流程。

### 5.2 任务服务（TaskService）

对前端暴露的核心业务方法，通过RPC注册：

| RPC方法 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `convertToTask` | `{blockId: string}` | `TaskCacheEntry` | 将块转为任务，自动维护父子关系 |
| `removeTask` | `{blockId: string}` | `void` | 移除任务的na-*属性，子任务na-parent重指向 |
| `updateTask` | `{blockId: string, attrs: Record<string, string>}` | `TaskCacheEntry` | 更新任务属性，触发优先级重算 |
| `getTask` | `{blockId: string}` | `TaskCacheEntry \| null` | 获取单个任务详情 |
| `getNextActions` | `{context?: string, priority?: string, limit?: number}` | `TaskCacheEntry[]` | 获取Next Action列表。limit表示最多返回N条（内核侧截断），无offset不分页 |
| `getAllTasks` | `{status?: string, context?: string, sortBy?: string, limit?: number}` | `TaskCacheEntry[]` | 获取全部任务（支持筛选） |
| `getTasksByParent` | `{parentBlockId: string}` | `TaskCacheEntry[]` | 获取某个父任务下的子任务 |
| `createTask` | `{parentBlockId?: string, notebookId?: string, title: string, attrs?: Record<string, string>}` | `TaskCacheEntry` | 创建新任务块。若提供parentBlockId则在该块下追加子块并直接设置na-parent=parentBlockId（不执行向上查找，因为父关系已明确）；若无parentBlockId则需提供notebookId在指定笔记本下创建文档块，na-parent留空 |
| `recalcAllOrders` | `{}` | `void` | 全量重新计算所有任务的排序分值 |
| `rebuildCache` | `{}` | `void` | 重建缓存 |
| `batchUpdateTasks` | `{operations: Array<{blockId: string, attrs: Record<string, string>}>}` | `TaskCacheEntry[]` | 批量更新（v0.2.0实现，MVP不实现） |
| `getContexts` | `{}` | `string[]` | 从缓存中聚合所有已使用的上下文标签，供编辑弹窗的候选列表使用 |

**注：** 错误码 `-32003`（循环引用检测）在MVP中用于 na-parent 写入时的环检测。`-32004`（并发冲突）和 `-32006`（超时）在MVP全局写锁下使用概率低，但保留以备超时场景。

**updateTask 详细流程：**

1. 校验参数：blockId非空，attrs的key以na-开头，值为string，status值必须在预设列表中
2. 获取全局写锁（Mutex.acquire()），带10秒超时
3. 调用 setBlockAttrs 更新指定属性
4. 如果修改了 importance/effort/priority/due/start → 重算排序分值
5. 如果修改了 status 为 done → 检查父任务的 childIds，若所有子任务都完成，父任务可能出现在Next Action中
6. 更新缓存
7. 释放全局写锁（Mutex.release()），确保try/catch中也会释放
8. 广播变更通知

**循环引用检测算法：** 在 updateTask 修改 na-parent 时，从目标 parentId 沿缓存中的 parentId 链向上遍历（最多100层防止意外无限循环），若遇到当前 blockId 则拒绝并返回错误码 -32003。

**错误码体系：**

| 错误码 | 含义 |
|--------|------|
| -32001 | 参数校验失败 |
| -32002 | 任务不存在 |
| -32003 | 循环引用检测 |
| -32004 | 并发冲突 |
| -32005 | 内核未就绪 |
| -32006 | 超时 |

### 5.3 优先级引擎（PriorityEngine）

纯计算模块，无IO操作。详见第4节。

### 5.4 生命周期

```
onload:    注册RPC方法 + 异步加载缓存（全量查询）→ isReady = true
           注：缓存加载在onload中异步执行，不阻塞启动。isReady=false期间读操作返回空结果，写操作返回-32005
onrunning: 启动增量同步定时器(5s) + 块删除检测定时器(60s)
onunload:  停止定时器 → 清理缓存
```

---

## 6. 前端模块设计

### 6.1 整体结构

前端插件继承 Plugin 基类，不直接调用思源后端API，所有业务操作通过RPC委托给内核。

### 6.2 内核通信

前端使用思源内置的 `this.kernel.rpc` 机制与内核通信，无需自建WebSocket客户端：

- **调用内核方法：** `await this.kernel.rpc.call.methodName(params)` — 自动发送JSON-RPC请求并等待响应
- **接收内核广播：** `this.kernel.rpc.bind("methodName", handler)` — 注册广播监听，内核通过 `siyuan.rpc.broadcast()` 推送变更通知
- **监听内核状态：** `this.eventBus.on("kernel-plugin-state-change", handler)` — 监听内核生命周期变化，当内核重新进入running状态时全量刷新前端数据
- **批量调用：** `await this.kernel.rpc.batch(...requests)` — 一次发送多个RPC请求

前端通过 `this.kernel.rpc.bind("tasksChanged", handler)` 接收内核广播的任务变更通知，据此做增量更新。

### 6.3 状态管理

使用 Svelte 的 writable store：

```typescript
interface TaskState {
    tasks: TaskCacheEntry[]
    loading: boolean
    error: string | null
    activeView: 'nextAction' | 'all' | 'byProject'
    filters: {
        context?: string
        priority?: string
        status?: string
    }
}
```

更新策略：广播增量更新 + 视图切换时主动请求。

### 6.4 任务面板（Dock面板）

三个视图Tab：

1. **Next Action视图**（默认）：调用 getNextActions，按排序分值降序，支持上下文/优先级筛选
2. **全部任务视图**：调用 getAllTasks，支持按属性排序和分组折叠
3. **按项目视图**：展示所有顶层任务（na-parent为空的任务，不区分na-task="1"或"2"）为根节点，其子任务缩进展示。调用 getAllTasks 获取数据后在前端按 parentId 组织成树形结构

面板底部："新建任务"按钮 + "重新计算优先级"按钮

### 6.5 任务卡片

```
[优先级色点] 任务标题
[📅 截止日] [🏷 上下文] [📊 工作量:5] [⭐ 重要性:6]
```

- 左侧圆点颜色表示优先级（紧急=红，高=橙，中=蓝，低=灰，无=透明边框），圆点可点击，一键标记完成（status → done）
- 点击标题 → 跳转到对应块
- 点击属性区域 → 打开编辑弹窗
- 右键 → 上下文菜单，包含以下操作项：
  - 标记为待办（status → todo）
  - 标记为进行中（status → doing）
  - 标记为等待（status → waiting）
  - 标记为完成（status → done）
  - 分隔线
  - 优先级子菜单：紧急/高/中/低/无
  - 分隔线
  - 移除任务

### 6.6 任务编辑弹窗

使用思源 Dialog 组件 + Svelte 渲染。每个字段值变化后500ms防抖提交（合并快速连续修改为一次updateTask RPC调用），不设保存按钮。弹窗中不提供 na-task（任务/项目类型）切换——项目类型在v0.2.0实现，MVP中所有任务默认为 na-task="1"。

| 字段 | 控件 | 默认值 |
|------|------|--------|
| 状态 | 下拉选择 | todo |
| 优先级 | 下拉选择 | none |
| 重要性 | 7圆点可点击 | 4 |
| 工作量 | 7圆点可点击 | 4 |
| 截止日期 | 日期选择器 | 空 |
| 开始日期 | 日期选择器 | 空 |
| 上下文 | 多选标签输入 | 空 |

### 6.7 插件入口注册

- 顶栏按钮：点击切换Dock面板
- Dock面板：渲染TaskPanel
- 斜杠菜单："转为任务"、"新建任务"
- 块标菜单：任务操作项
- 快捷键命令：转为任务、新建任务、打开任务面板、重新计算优先级
- i18n 注册

---

## 7. 项目结构与构建

### 7.1 开发目录

```
siyuan-mylifeorganized/
├── plugin.json
├── package.json
├── icon.png
├── preview.png
├── README.md
├── README.zh-CN.md
├── tsconfig.json
├── vite.config.ts                  # 前端构建
├── webpack.kernel.config.js        # 内核构建
├── scripts/
│   └── make_dev_copy.js            # 开发模式自动复制
├── src/
│   ├── index.ts                    # 前端插件入口
│   ├── kernel.ts                   # 内核插件入口
│   ├── index.scss
│   ├── declarations.d.ts
│   ├── i18n/
│   │   ├── en.json
│   │   └── zh-CN.json
│   ├── frontend/
│   │   ├── kernel-bridge.ts          # 封装this.kernel.rpc调用的类型安全包装
│   │   ├── constants.ts
│   │   ├── components/
│   │   │   ├── TaskPanel.svelte
│   │   │   ├── NextActionView.svelte
│   │   │   ├── AllTasksView.svelte
│   │   │   ├── ProjectView.svelte
│   │   │   ├── TaskCard.svelte
│   │   │   ├── TaskEditPopup.svelte
│   │   │   ├── TaskContextMenu.svelte
│   │   │   ├── FilterBar.svelte
│   │   │   └── PriorityDot.svelte
│   │   └── stores/
│   │       └── task-store.ts
│   ├── kernel/
│   │   ├── cache-manager.ts
│   │   ├── task-service.ts
│   │   ├── priority-engine.ts
│   │   ├── sync-engine.ts
│   │   ├── rpc-server.ts
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   └── utils.ts
│   └── shared/
│       ├── types.ts
│       └── constants.ts
├── docs/
│   └── superpowers/
│       └── specs/
└── vendor/                         # 参考项目（不打包）
```

### 7.2 构建配置

| 模块 | 构建工具 | 输出 | esbuild target |
|------|---------|------|---------------|
| 前端插件 | Vite 5 + @sveltejs/vite-plugin-svelte | CommonJS (index.js + index.css) | es6 |
| 内核插件 | webpack 5 + esbuild-loader | ES Module (kernel.js) | es2015 |

关键配置：
- `siyuan` 包作为外部依赖，不打包
- 前端：Vite `build.lib.formats: ["cjs"]`，输出 CommonJS 格式的 index.js + index.css
- 内核：webpack `library.type: "module"` + `experiments.outputModule: true`，输出 ES Module 格式的 kernel.js
- 开发模式自动复制到 `D:\z00813717\Documents\SiYuan\SecBar\data\plugins\nextaction\`

### 7.3 部署目标

构建产物复制到 `D:\z00813717\Documents\SiYuan\SecBar\data\plugins\nextaction\`

### 7.4 plugin.json

```json
{
  "name": "nextaction",
  "author": "z00813717",
  "url": "",
  "version": "0.1.0",
  "minAppVersion": "3.7.0",
  "kernels": ["windows", "linux", "darwin", "ios", "android", "docker"],
  "backends": ["windows", "linux", "darwin", "ios", "android", "docker"],
  "frontends": ["desktop", "mobile", "browser-desktop", "browser-mobile", "desktop-window"],
  "disabledInPublish": false,
  "displayName": {
    "default": "NextAction",
    "zh-CN": "今天干点啥"
  },
  "description": {
    "default": "GTD task management plugin inspired by MyLifeOrganized",
    "zh-CN": "灵感来自 MyLifeOrganized 的 GTD 任务管理插件"
  },
  "readme": {
    "default": "README.md",
    "zh-CN": "README.zh-CN.md"
  },
  "funding": {
    "openCollective": "",
    "patreon": "",
    "github": "",
    "custom": []
  },
  "keywords": ["GTD", "task", "todo", "next action", "任务管理", "下一步行动"]
}
```

---

## 8. 国际化

### 8.1 规范

- 文件：`src/i18n/en.json` 和 `src/i18n/zh-CN.json`
- 格式：扁平JSON键值对，所有语言文件的key完全一致
- 访问：`this.i18n.keyName`
- addCommand 的 langKey 自动关联i18n
- 变量插值：`${name}` 语法，代码中手动replace
- MVP只支持英文和简体中文

### 8.2 i18n键值规划（部分）

| 键名 | en | zh-CN |
|------|-----|-------|
| pluginName | NextAction | 今天干点啥 |
| topBarTip | NextAction Task Manager | 今天干点啥 任务管理 |
| nextAction | Next Actions | 下一步行动 |
| allTasks | All Tasks | 全部任务 |
| byProject | By Project | 按项目 |
| statusTodo | To Do | 待办 |
| statusDoing | In Progress | 进行中 |
| statusWaiting | Waiting | 等待 |
| statusDone | Done | 已完成 |
| priorityCritical | Critical | 紧急 |
| priorityHigh | High | 高 |
| priorityMedium | Medium | 中 |
| priorityLow | Low | 低 |
| priorityNone | None | 无 |
| importance | Importance | 重要性 |
| effort | Effort | 工作量 |
| dueDate | Due Date | 截止日期 |
| startDate | Start Date | 开始日期 |
| context | Context | 上下文 |
| convertToTask | Convert to Task | 转为任务 |
| createTask | Create Task | 新建任务 |
| removeTask | Remove Task | 移除任务 |
| recalcOrders | Recalculate Priorities | 重新计算优先级 |
| noTasks | No tasks yet | 暂无任务 |
| taskPanel | Task Panel | 任务面板 |

---

## 9. 开发路线图

### 9.1 整体版本规划

| 版本 | 主题 | 核心功能 |
|------|------|---------|
| v0.1.0 | MVP | 第一档：核心GTD流程 |
| v0.2.0 | 依赖与重复 | 第二档：任务依赖、循环任务、自定义视图、将来/也许、项目 |
| v0.3.0 | 提醒与日历 | 第三档：提醒通知、日历视图、统计回顾、四象限、数据库关联 |
| v0.4.0 | AI与集成 | MCP工具注册、自然语言输入、批量操作 |

### 9.2 v0.1.0 MVP 任务分解

**阶段1：项目脚手架**
- 初始化项目结构、package.json、tsconfig
- 配置Vite前端构建 + webpack内核构建
- 配置开发模式自动复制
- 编写 plugin.json、i18n文件
- 验证：空插件能加载

**阶段2：内核插件骨架**
- kernel.ts 入口和生命周期
- RPC服务端框架
- siyuan.client.fetch 封装
- 验证：前端能RPC调用echo

**阶段3：缓存管理器**
- TaskCacheEntry 类型定义
- 初始化全量加载
- childIds 反向索引
- 增量同步引擎
- 块删除检测
- rebuildCache 方法
- 验证：缓存正确加载和同步

**阶段4：任务服务与优先级引擎**
- convertToTask / removeTask / updateTask / createTask
- getTask / getNextActions / getAllTasks / getTasksByParent
- recalcAllOrders
- 优先级引擎
- 输入校验和错误码
- 循环引用防护
- 验证：RPC完成CRUD和排序

**阶段5：前端RPC客户端与状态管理**
- KernelRpcClient
- tasksStore
- 广播增量更新
- 验证：前端调用RPC、store更新

**阶段6：前端UI**
- 顶栏按钮 + Dock面板
- TaskPanel + 三个视图
- TaskCard + TaskEditPopup + TaskContextMenu
- FilterBar
- 斜杠菜单 + 块标菜单 + 快捷键
- 验证：完整用户操作流程

**阶段7：收尾与文档**
- i18n校验
- 移动端适配检查
- README编写
- 全流程集成测试
- 版本0.1.0

### 9.3 v0.2.0 功能规划

| 功能 | 描述 |
|------|------|
| 任务依赖 | na-depends + na-dep-mode，依赖引擎，Next Action增加依赖过滤 |
| 顺序子任务 | na-sequential，子任务按序逐个出现 |
| 循环/重复任务 | na-repeat，完成后自动生成下一次 |
| 将来/也许 | na-someday，不出现在Next Action |
| 自定义视图 | 保存筛选条件组合 |
| 任务搜索 | 按标题、上下文、属性搜索 |
| 项目支持 | na-task="2" 完整逻辑 |
