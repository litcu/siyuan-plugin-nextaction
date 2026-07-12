# Tier 2 设计：任务依赖、顺序子任务、循环任务、项目支持、拖拽交互

> 日期：2026-07-06
> 范围：v0.2.0 核心功能
> 状态：已批准（含审查修订）

## 1. 概述

Tier 2 的主题是**依赖引擎与交互增强**，包含 5 项功能：

1. 任务依赖（na-depends + na-dep-mode）
2. 顺序子任务（na-sequential）
3. 循环/重复任务（na-repeat）
4. 项目支持（na-task="2" 完整逻辑）
5. 面板拖拽交互（排序 + 设为子任务）

**不在本范围内：** 将来/也许（na-someday）、任务搜索、自定义视图、移动端拖拽——推到 v0.2.1。

---

## 2. 数据模型变更

### 2.1 新增属性

| 属性 | 存储格式 | 说明 |
|------|---------|------|
| `na-depends` | `"id1\|id2\|id3"` | 依赖的任务 ID 列表，管道符分隔（与 context 一致） |
| `na-dep-mode` | `"all"` / `"any"` | 依赖模式：all=全部完成后才可执行，any=任一完成后即可执行。默认 all |
| `na-sequential` | `"1"` / 不存在 | 父任务标记：子任务按序逐个出现 |
| `na-repeat` | JSON 字符串 | 重复规则，格式见 2.2 |
| `na-sort` | `"0"`, `"1000"`, `"2000"`... | 子任务在父任务下的排序权重，用于拖拽排序 |

### 2.2 na-repeat 存储格式

```json
{"freq":"week","interval":1,"from":"due"}
```

| 字段 | 值 | 说明 |
|------|---|------|
| freq | `"day"` / `"week"` / `"month"` / `"year"` | 重复频率 |
| interval | 正整数 | 间隔数（1=每天/每周，2=每两周） |
| from | `"due"` / `"complete"` | 推算基准：due=从截止日，complete=从完成日。默认 due |

示例：
- 每周从完成日：`{"freq":"week","interval":1,"from":"complete"}`
- 每月从截止日：`{"freq":"month","interval":1,"from":"due"}`
- 每两周从截止日：`{"freq":"week","interval":2,"from":"due"}`

UI 中解析后分字段展示（频率下拉、间隔输入、推算基准单选），不在属性面板中直接显示原始 JSON。

### 2.3 TaskCacheEntry 扩展

```typescript
interface TaskCacheEntry {
    // ... 现有字段不变
    depends: string;        // na-depends 原始值
    depMode: string;        // na-dep-mode，默认 "all"
    sequential: boolean;    // na-sequential === "1"
    repeat: string;         // na-repeat 原始值
    sort: number;           // na-sort 转数字，默认 -1（表示未设置）
}
```

### 2.4 na-sort 设计意图

na-sort 是一个轻量级排序权重属性，解决三个问题：

1. **拖拽排序**：用户拖拽调整子任务顺序时，更新相关子任务的 na-sort 值
2. **顺序子任务**：na-sequential 开启时，引擎根据 na-sort 判定哪个子任务排在前面
3. **按项目视图的展示顺序**：子任务按 na-sort 排序

**na-sort 默认值与迁移：** sort 默认值为 -1（表示未设置）。现有任务没有 na-sort 属性，升级到 v0.2.0 时需执行一次性迁移：对每个父任务下的子任务，按缓存中的 childIds 原始顺序分配间距编号（0, 1000, 2000...），并批量写入 na-sort 属性。此迁移在 CacheManager.loadAll 完成后自动执行。isBlocked 中的顺序排序逻辑将 sort=-1 的任务排在最后。

**convertToTask 时的默认 na-sort：** 转为任务时，如果父任务已有子任务，新任务的 na-sort 设为父任务下最大 sort + 1000。若无子任务，na-sort 设为 0。

### 2.5 属性映射与构建同步

新增属性必须同步更新以下代码，否则缓存中该字段将始终为默认值：

1. **`src/shared/constants.ts`** — 新增常量：
   - `ATTR_DEPENDS = "custom-na-depends"`
   - `ATTR_DEP_MODE = "custom-na-dep-mode"`
   - `ATTR_SEQUENTIAL = "custom-na-sequential"`
   - `ATTR_REPEAT = "custom-na-repeat"`
   - `ATTR_SORT = "custom-na-sort"`

2. **`src/shared/types.ts`** — TaskCacheEntry 接口新增五个字段（见 2.3）

3. **三处构建逻辑必须读取新属性：**
   - `cache-manager.ts` loadAll 中的行内构建
   - `task-service.ts` buildEntryFromAttrs 方法
   - `sync-engine.ts` buildEntryFromAttrs 方法

4. **`removeTask` 必须清除新增属性**，将 na-depends、na-dep-mode、na-sequential、na-repeat、na-sort 加入 clearAttrs 对象。

增量同步的 SQL 使用 `LIKE 'custom-na-%'` 通配符，因此新属性的变更能被 SQL 检测到，但 buildEntryFromAttrs 必须读取它们才能进入缓存。

### 2.6 na-repeat 写入验证

updateTask 设置 na-repeat 时，必须验证：

1. JSON.parse 不抛异常
2. freq ∈ {"day", "week", "month", "year"}
3. interval 为正整数且 ≤ 999
4. from ∈ {"due", "complete"} 或缺失（默认 "due"）

验证失败时返回 -32001（参数校验失败），不写入。

构建缓存条目时，若 na-repeat 解析失败，将 repeat 字段设为空字符串，记录警告日志。重复逻辑不执行。

---

## 3. 依赖引擎

### 3.1 核心职责

回答一个问题：**这个任务现在能不能做？** 答案由三个因素决定：

1. **显式依赖**（na-depends）：前置任务是否满足
2. **顺序约束**（na-sequential）：父任务开启顺序模式时，前面是否有未完成的兄弟
3. **现有过滤**：status=done/waiting、未到开始日期、有未完成子任务（Tier 1 已实现）

### 3.2 isBlocked 判定逻辑

```
isBlocked(entry, cache):
  // 1. 显式依赖
  if entry.depends 非空:
    depIds = entry.depends.split("|")
    validDepIds = []
    for depId in depIds:
      if cache[depId] 不存在:
        记录警告日志: "依赖引用不存在的任务: {depId}"
        continue   // 跳过不存在的依赖，视为已失效
      validDepIds.push(depId)

    if validDepIds 非空:
      if entry.depMode === "any":
        if 所有 validDepIds 对应的任务状态都不是 done → blocked
      else: // "all"
        if 任一 validDepIds 对应的任务状态不是 done → blocked
    // validDepIds 为空（全部失效）→ 视为无依赖，不被阻塞

  // 2. 顺序约束
  if entry.parentId 非空:
    parent = cache[entry.parentId]
    if parent?.sequential === true:
      siblings = parent.childIds 对应的缓存条目，按 sort 升序排列（sort=-1 排最后），取 blockId 列表
      我的序号 = siblings.indexOf(entry.blockId)
      if 我前面有任何一个兄弟（序号 < 我的序号）状态不是 done → blocked

  return unblocked
```

### 3.3 与 isNextActionCandidate 的关系

修改现有的 `isNextActionCandidate`，在末尾增加 `isBlocked` 检查：

```
isNextActionCandidate(entry, cache):
  现有规则（done/waiting/未到开始日期/有未完成子任务、taskType="2"）→ 直接排除
  isBlocked(entry, cache) → 也排除
  → 通过
```

### 3.4 实现位置

纯函数模块，无 IO，放在 `src/kernel/priority-engine.ts` 中，与 `isNextActionCandidate` 和 `calculateOrder` 同级。新增：

- `isBlocked(entry, cache): boolean`
- 修改 `isNextActionCandidate` 在末尾增加 `!isBlocked(entry, cache)` 判断

### 3.5 对其他 RPC 方法的影响

| 方法 | 影响 |
|------|------|
| getNextActions | 自动受益，已调用 isNextActionCandidate |
| getAllTasks | 不受影响，显示所有任务包括被阻塞的。前端可在 TaskCard 上显示"已阻塞"标记 |
| updateTask | 修改 na-depends / na-sequential 时广播变更，可能影响其他任务的 Next Action 可见性 |
| convertToTask | 设置 na-parent 时，如果父任务有 na-sequential="1"，新任务根据 na-sort 位置决定是否阻塞 |

### 3.6 依赖环路检测

在 updateTask 写入 na-depends 时，必须检测新增依赖是否会形成有向图中的环路。

检测算法：从当前任务的 na-depends 列表出发，沿缓存中的 depends 链做 BFS/DFS（最大深度 100），若回到当前 blockId 则拒绝并返回错误码 -32007（依赖环路）。

设置 na-sequential="1" 时不做环路检测——顺序约束是单向的（按 sort 值），不会形成环。但如果子任务同时有 na-depends 指向排序靠后的兄弟，可能导致逻辑矛盾（见 3.7）。

### 3.7 依赖与顺序约束的组合语义

当一个任务同时受到 na-depends 和 na-sequential 的约束时，采用 **AND 语义**：两个条件都必须满足，任务才不被阻塞。即：

```
isBlocked = (被显式依赖阻塞) OR (被顺序约束阻塞)
```

文档中的 isBlocked 伪代码已经隐含了 AND 语义（两个检查是串行的，任一 blocked 即返回 blocked），此处显式声明以消除歧义。

**矛盾检测：** 如果父任务有 na-sequential="1"，且某子任务的 na-depends 指向排序靠后的兄弟（即 sort 值比自己大的兄弟），这将导致该子任务被永久阻塞（顺序约束要求它先完成，但依赖要求后面的兄弟先完成）。updateTask 设置 na-depends 时，若父任务有 na-sequential="1"，应检查依赖是否指向排序靠后的兄弟，若是则返回警告（非错误，允许设置但前端显示冲突标记）。

---

## 4. 循环/重复任务

### 4.1 核心流程

用户标记一个循环任务为 done 时，在 updateTask 内持锁状态下触发重复逻辑：

```
updateTask(blockId, { "na-status": "done" }):
  1. 现有逻辑：setBlockAttrs 写入 done，更新缓存
  2. 新增检查：if entry.repeat 非空且 JSON 解析有效 → 触发重复逻辑

重复逻辑（在同一个写锁内执行）:
  1. 解析 na-repeat JSON → { freq, interval, from }
     解析失败 → 记录错误日志，清除 na-repeat，不执行重复，任务保持 done
  2. 计算下一个日期:
     - baseDate = from === "complete" ? 今天 : entry.due
     - 如果 from === "due" 且 entry.due 为空 → fallback 到今天
     - nextDate = baseDate + interval × freq
       - day: +interval 天
       - week: +interval×7 天
       - month: 日历月加 interval（如 7月15日 + 1月 = 8月15日，无30日则取月末）
       - year: 日历年加 interval
  3. 重置任务属性（第二次 setBlockAttrs）:
     - na-status → "todo"
     - na-due → nextDate（如果原来有 na-due）
     - na-start → 空字符串（重置，让引擎重新判定开始日期）
  4. 更新缓存（最终状态：status=todo, due=nextDate）
  5. 广播变更
```

**广播合并：** 重复逻辑触发了两次 setBlockAttrs（done → todo），但由于 SyncEngine 的广播有 100ms 防抖，且两次写入在同一写锁内连续完成，两次变更会被合并为一次广播。前端收到的最终状态是 status=todo + due=nextDate。

前端如需展示"任务完成一次"的反馈，可在 TaskCard 上短暂显示完成动画（通过 applyUpdate 中的临时标记实现），或在广播 payload 中附加 `_repeated: true` 标记。

### 4.2 边界情况处理

**月份/年份推算：** 如 1月31日 + 1月 = 2月28日（非闰年），3月31日 + 1月 = 4月30日。取目标月份的实际天数，不溢出到下个月。

**从截止日推算但没有截止日：** 退化为从完成日推算。

**叶子任务限制：** 第一版只支持叶子任务（没有未完成子任务的任务）的循环。父任务的循环推到后续版本。

**无效 JSON 防御：** 重复逻辑在解析 na-repeat 时用 try-catch 包裹。解析失败时：记录错误日志、清除 na-repeat 属性、不执行重复逻辑、任务正常停留在 done 状态。

### 4.3 前端展示

**TaskDetail 重复规则编辑区域：**

- 启用/关闭重复开关（关闭时立即调用 updateTask 清除 na-repeat，不经防抖）
- 频率下拉：每天 / 每周 / 每两周 / 每月 / 每年
- 间隔输入：数字，默认 1
- 推算基准：从截止日 / 从完成日（单选）

三个子控件（频率、间隔、推算基准）共享同一防抖定时器，提交时合并为 JSON 字符串。组件初始化时从 task.repeat 解析出三个本地变量，确保防抖提交时始终有完整值。

**TaskCard 标记：** 循环任务在截止日期旁显示小型循环图标，如 "🔄 每2周"。

**TaskCard 信息密度控制：**

- **已阻塞标记：** 不新增独立图标。当任务被阻塞时，StatusCheckbox 变为灰色锁形样式，替代原有状态样式而非新增元素
- **循环图标：** 小型内联标记，仅在截止日期旁显示
- 信息分级：默认显示状态、标题、截止日（+循环标记）；展开显示上下文、工作量、重要性、阻塞原因

---

## 5. 项目支持

### 5.1 项目与任务的区别

| 维度 | 任务（na-task="1"） | 项目（na-task="2"） |
|------|-------------------|-------------------|
| 本质 | 执行单元 | 容器/组织单元 |
| Next Action | 满足条件时出现 | **不在 Next Action 主列表中出现**；待收尾时出现在 Next Action 底部的"项目待收尾"区域 |
| 完成条件 | 用户手动标记 done | 所有子任务 done → 出现在"项目待收尾"区域 → 用户手动确认 done |
| 属性 | 全部可用 | 全部可用（截止日=项目 deadline、优先级=项目优先级） |
| 在按项目视图 | 可作为子节点 | 作为顶级节点 |
| 循环 | 支持 | 不支持 |
| 依赖 | 支持 | 支持（项目可以依赖其他任务/项目） |

### 5.2 内核逻辑变更

**isNextActionCandidate 修改：**

```
if entry.taskType === "2" → 永远不是 Next Action 候选
```

**新增 getProjectReminders RPC：**

```
getProjectReminders():
  遍历缓存中 taskType="2" 的条目
  过滤：status 不是 done，且 childIds 非空且全部 done
  返回这些项目列表

注：排除 childIds 为空的项目（空项目不需要收尾提醒）。
getProjectReminders 返回的项目不出现在 getNextActions 的结果中。
前端在 Next Action 视图中，将这两个列表分区展示：
上方为常规 Next Action 任务，下方为"项目待收尾"区域。
前端收到 tasksChanged 广播后需重新调用此 RPC 以保持列表最新。
```

**convertToTask 修改：**

新增可选参数 `taskType`，默认 `"1"`。用户通过右键菜单或编辑弹窗选择转为任务还是项目。

### 5.3 前端展示

**按项目视图重构：**

- 顶级只显示 taskType="2" 的项目
- 项目下展开子任务树（复用全部任务视图的树形逻辑）
- 项目卡片显示进度条（已完成子任务数 / 总子任务数）
- 项目卡片用不同样式区分（左侧蓝色竖条替代优先级色条，标题前显示文件夹图标，轻微蓝色调背景）

**任务/项目类型 UI 设计：**

- **右键菜单**："转为任务"下方增加"转为项目"选项
- **斜杠菜单**：增加"转为项目"选项（filter: ["转为项目", "convert to project", "zrxm"]）
- **命令面板**：增加"转为项目"命令
- **编辑弹窗类型切换**：弹窗顶部增加 SegmentControl 切换"任务"/"项目"，切换时立即提交 updateTask（不经防抖），切换为项目时禁用重复规则区域

---

## 6. 面板拖拽交互

### 6.1 实现方案

采用 **pointer events 自定义拖拽**，而非 HTML5 Drag and Drop API。理由：

1. HTML5 DnD 无法延迟 dragstart，与"长按触发"需求冲突
2. HTML5 DnD 的 dragover/drop 事件在不同浏览器行为不一致
3. 自定义拖拽可以精确控制 ghost 渲染、插入指示器位置
4. 思源自身的块拖拽也使用自定义实现（原生事件+手动 ghost），因此该方案与思源生态一致

实现要点：
- TaskCard 不设置 `draggable` 属性
- 在 pointerdown 时启动 300ms 长按计时器
- 若 pointerup 在 300ms 内触发 → 正常 click
- 若 300ms 超时后 pointermove 超过 5px 阈值 → 进入拖拽模式，创建 ghost 元素跟随指针
- 使用 `setPointerCapture` 确保 pointermove 在快速移动时不丢失
- 拖拽中通过 `document.elementFromPoint(x, y)` 检测目标卡片（需临时隐藏 ghost）
- StatusCheckbox 和操作按钮等子元素需 `on:pointerdown|stopPropagation` 防止误触发拖拽

### 6.2 拖拽范围

- **全部任务视图**：优先实现，树形结构天然适合拖拽
- **按项目视图**：项目功能实现后补上，逻辑复用

### 6.3 拖拽交互规则

**拖拽开始：** 长按 TaskCard 300ms 后移动超过 5px 触发，卡片变为半透明 ghost 跟随指针。

**拖拽目标判定算法：** 同时使用 X 和 Y 坐标，结合每个 TaskCard 的实际缩进级别：

1. **确定鼠标所在行的 TaskCard**：根据 Y 位置确定悬停的目标卡片
2. **计算插入类型**（基于 X 坐标相对于目标卡片的偏移）：
   - X 在目标卡片的缩进区域内（鼠标 X < 目标卡片内容区左边缘 + 一级缩进像素数）→ 成为子任务
   - X 在目标卡片的文本区域内 → 插入为目标卡片的同级
3. **确定插入位置**（基于 Y 坐标）：
   - Y 在目标卡片上方 40% → 插入到目标前面
   - Y 在目标卡片下方 40% → 插入到目标后面
   - Y 在目标卡片中间 20% → 如果 X 在缩进区域则成为子任务，否则插入为同级
4. **缩进级别对齐**：插入为同级时，新位置与目标卡片保持相同的 na-parent

**缩进区域计算：** 缩进区域的判定范围为从卡片左边缘起、宽度等于一级缩进像素数的区域（由 CSS 变量 `--na-indent-size` 控制，默认 28px）。为实现高亮效果，每个 TaskCard 的缩进区域前添加一个不可见但可响应 pointer events 的 div（class="na-indent-zone"），拖拽进入时添加高亮 class。

**放置后的操作：**

| 操作 | 调用的 RPC | 属性变更 |
|------|-----------|---------|
| 插入前面/后面 | `reorderTask` | 调整相关子任务的 na-sort 值 |
| 成为子任务 | `reorderTask` | na-parent → 目标 blockId，na-sort → 目标子任务末尾 |

**禁止的拖拽操作：**
- 不能拖到自己的子任务下（循环引用检测，复用现有 -32003 错误码）
- 项目（na-task="2"）不能成为普通任务（na-task="1"）的子任务
- 被阻塞的任务仍然可以拖拽排序，拖拽只改变顺序不改变状态

**项目的拖拽规则：**

| 操作 | 是否允许 | 说明 |
|------|---------|------|
| 项目拖拽排序（同级移动） | 允许 | 在按项目视图中调整项目顺序 |
| 项目成为普通任务的子任务 | 禁止 | 项目不能从属于任务 |
| 项目成为项目的子任务 | 允许 | 支持项目嵌套 |
| 项目内部的子任务拖出 | 允许 | 子任务可拖到其他项目或任务下 |
| 任务拖到项目下成为子任务 | 允许 | 这是设置 na-parent 的主要交互方式 |

### 6.4 新增 RPC：reorderTask

```
参数：{ blockId, parentId?, afterId? }
  blockId: 被拖拽的任务
  parentId: 新的父任务 ID（空字符串=顶层）。若与当前相同则只是排序变更
  afterId: 放在哪个任务后面（空字符串=第一个位置）

逻辑：
  1. 校验：循环引用检测 + 项目不能成为任务的子任务
  2. 如果 parentId 变更 → 更新 na-parent
  3. 重新计算受影响的兄弟任务的 na-sort 值
  4. 批量更新属性：
     - 正常拖拽（仅更新 1 个 sort 值）→ 单次 setBlockAttrs
     - 重新编号触发时（间距 < 10）→ 先更新缓存中所有 sort 值，释放锁并广播，
       然后使用 Promise.all 并行发起多个 setBlockAttrs 持久化
  5. 更新缓存
  6. 广播变更
```

### 6.5 na-sort 间距编号策略

使用间距编号（类似 Figma 的图层排序）：

- 初始 sort 值为 0, 10000, 20000, 30000...（增大间距推迟重新编号）
- 插入到两个任务之间时取中间值（如 15000）
- 当间距过小（< 10）时，对该父任务下所有子任务做一次重新编号
- 大多数拖拽操作只需更新一个任务的 sort 值

### 6.6 移动端拖拽

v0.2.0 不实现移动端拖拽。理由：

1. 移动端触摸交互与长按冲突（系统上下文菜单、文本选择）
2. 拖拽操作在小屏幕上精度不足
3. 排序和设为子任务可通过上下文菜单或编辑弹窗完成

**替代方案（v0.2.1）：** 移动端 TaskCard 的长按弹出上下文菜单，包含"移动到..."选项，打开任务选择器选择新的父任务或位置。桌面端拖拽使用的 pointer events 同时支持鼠标和触摸输入，若未来需要启用移动端拖拽，只需调整长按阈值和禁用系统上下文菜单即可。

---

## 7. 不在本范围内

| 功能 | 原因 | 计划 |
|------|------|------|
| 将来/也许（na-someday） | waiting 状态 + 不转任务已覆盖其核心价值 | 如有用户需求后续再加 |
| 任务搜索 | 独立于依赖引擎，v0.2.1 实现 | v0.2.1 |
| 自定义视图 | 独立于依赖引擎，v0.2.1 实现 | v0.2.1 |
| 父任务循环 | 复杂度高，需重置所有子任务状态 | 后续版本 |
| 移动端拖拽 | 触摸交互与长按冲突，精度不足 | v0.2.1 |

---

## 8. Tier 2 i18n 键值规划

| 键名 | en | zh-CN |
|------|-----|-------|
| dependencies | Dependencies | 依赖 |
| depMode | Dependency Mode | 依赖模式 |
| depModeAll | All must complete | 全部完成 |
| depModeAny | Any can complete | 任一完成 |
| blocked | Blocked | 已阻塞 |
| sequential | Sequential | 顺序执行 |
| repeat | Repeat | 重复 |
| repeatFreq | Frequency | 频率 |
| repeatEveryDay | Every day | 每天 |
| repeatEveryWeek | Every week | 每周 |
| repeatEvery2Weeks | Every 2 weeks | 每两周 |
| repeatEveryMonth | Every month | 每月 |
| repeatEveryYear | Every year | 每年 |
| repeatInterval | Interval | 间隔 |
| repeatFrom | Calculate from | 推算基准 |
| repeatFromDue | Due date | 截止日 |
| repeatFromComplete | Completion date | 完成日 |
| project | Project | 项目 |
| task | Task | 任务 |
| projectReminders | Projects to Close | 项目待收尾 |
| convertToProject | Convert to Project | 转为项目 |
| projectProgress | {done}/{total} completed | {done}/{total} 已完成 |
| depCycleDetected | Dependency cycle detected | 检测到依赖环路 |
| invalidRepeatRule | Invalid repeat rule | 无效的重复规则 |
| depConflictWarning | Dependency conflicts with sequential order | 依赖与顺序约束冲突 |
