# NextAction 项目功能重构设计

状态：已确认基线（2026-08-24）；审查修订（2026-08-24）

本文档记录针对个人项目管理工具调研后的产品与领域决策，并作为 Phase 1 实现的约束。调研报告是方向参考，不是逐条照搬的规格。

## 1. 产品定位

NextAction 是思源内部、以结果为中心的个人项目执行系统，负责连接：

```text
收集 → 澄清 → 定义结果 → 规划 → Next Action
→ 执行 → 风险观察 → Review → 调整 → 确认完成
```

核心问题不是“项目有多少子任务”，而是：

- 这个项目最终要取得什么结果？
- 当前真正可以推进什么？
- 项目是否正在失控、等待或缺少下一步？
- 计划是否仍然符合现实？
- 什么时候可以确认结果已经达成？

## 2. 领域模型

### 2.1 Project

Project 是一个可结束的个人承诺，必须锚定在思源文档块上。Project 的唯一身份标记是现有 `custom-na-task = "2"`，并且块类型必须是文档；Outcome、DoD 和 `custom-na-kind` 不能单独把一个块变成 Project。它拥有独立的 Outcome、DoD、项目状态、项目 Review 和项目健康度，但底层仍复用思源块身份和任务写入边界。

Project 状态沿用现有任务状态：

| 任务状态 | 项目语义 |
| --- | --- |
| `inbox` | Draft：尚未澄清 |
| `todo` | Planned：已经规划 |
| `doing` | Active：当前承诺推进 |
| `waiting` | On Hold：暂缓但结果仍有效 |
| `someday` | Someday：暂不承诺 |
| `done` | Completed：结果已确认达成 |

不新增 `Dropped`、`Archived`。取消 Project 身份是清除 `custom-na-task` 项目标记，而不是清空 Outcome/DoD；该操作不会删除项目文档或行动，并清理所有直接 `custom-na-parent = 该项目 ID` 的 Action 关系。被清理的 Action 重新按结构父任务规则计算；其自身子 Action 不递归清理。

### 2.2 Action

Action 是推动 Project 结果发生的一次具体工作。它可以在任意思源位置创建，通过 `custom-na-parent` 归属于 Project，也可以保留原来的笔记上下文。

`custom-na-parent` 是统一逻辑父关系：

- 指向普通任务：表示父任务；
- 指向 Project：表示项目归属；
- 不要求等同于思源文档树的物理父块；
- 一个 Action 只能有一个逻辑父级。

### 2.3 Stage

Stage 是带有固定 `stage` 标记的 Action，不是新的领域对象。它可以有子 Action，也可以自己执行；执行、依赖、日期、Next Action 和完成规则与普通 Action 相同。Project 不设置 `custom-na-kind`；`custom-na-kind` 只适用于 Action，缺省或 `action` 表示普通 Action，`stage` 表示 Stage。

建议新增固定类型字段：

```text
custom-na-kind = action | stage
```

首阶段不开放任意自定义任务类型。

### 2.4 Outcome 与 DoD

- Outcome：单行纯文本，描述项目完成后得到的结果；
- DoD：多行纯文本，描述关闭项目前需要人工确认的条件；
- 两者的属性值是项目面板、Review、MCP 和 AI 的权威来源；
- 项目文档正文可以写更完整的背景、方案和说明；
- 需要逐项追踪的 DoD 条件应创建为 Action，不解析成第二套清单状态。

建议新增属性：

```text
custom-na-outcome
custom-na-dod
```

这些是核心保留属性，不属于用户自定义字段。Phase 1 必须同步以下数据通路：属性常量 → `TaskCacheEntry` → CacheManager/TaskRepository → 增量广播与同步 reducer → RPC/Kernel Bridge → MCP DTO、patch 和校验 → AI 上下文 schema → 前端详情草稿。Outcome 单行、DoD 多行，清空值表示“尚未填写”，不能被同名 `custom-na-ext-*` 字段覆盖。

### 2.5 项目身份与父关系矩阵

Project 的唯一身份是文档块上的 `custom-na-task = "2"`。`custom-na-kind` 只用于普通 Action/Stage。首阶段采用以下关系矩阵：

| 子项 | 父项 | 结果 |
| --- | --- | --- |
| Action/Stage | 普通 Task | 允许 |
| Action/Stage | Project | 允许，表示项目归属 |
| Project | Project | 禁止，避免嵌套项目重复计算 |
| Project | 普通 Task | 禁止，沿用现有错误语义 |
| 任意项 | 自身/循环/不存在的父级 | 拒绝或修复为无父级 |

取消 Project 身份时只清理直接指向该 Project 的 `custom-na-parent`；这些 Action 随后重新按结构父任务规则计算，其更深层子项不递归改写。UI、RPC、MCP 和外部属性同步都必须进入同一清理路径。

## 3. 核心规则

### 3.1 Next Action

系统自动推导 Next Action。候选 Action 必须满足：

- 不是 Project；
- 状态不是 `done / waiting / someday / inbox`；
- 已进入由全局 `startPreviewDays` 配置允许的开始窗口；项目总览、全局 Next Action、Review 和 MCP 必须共享同一套判断，不得各自使用不同的日期口径；
- 没有被依赖或顺序规则阻塞。

`someday` 明确不是 Next Action 候选。当前内核谓词与项目摘要存在分叉，Phase 1 的第一项治理工作是抽出共享谓词并让内核、前端、Review、MCP 全部调用它。

默认采用 Parallel（并行）；只有项目级顺序模式或显式依赖才阻塞后续行动。用户选择优先级，系统负责判断可执行性。

### 3.2 项目进度

项目进度只统计叶子 Action。叶子 Action 是没有有效 Action 子节点的 Action；Project 后代中的嵌套 Project 不属于父 Project 的 Action 进度，首阶段禁止把 Project 作为另一个 Project 的子节点。允许的父关系是 Task→Task、Task→Project、Project→Task；Project→Project、循环关系和不存在的父级均拒绝。

```text
已完成叶子 Action / 叶子 Action 总数
```

有子节点的 Stage 和其他父节点显示自己的子树进度，但不与叶子 Action 重复计数；没有子节点的 Stage 本身就是叶子 Action。Stage 即使有子节点也允许保留自己的状态，完成确认时将其未完成状态作为提示展示，但不重复计入百分比。

空项目显示 `0/0` 和“待澄清”，不直接标记为异常；只有已经进入 `todo/doing` 且仍为空的项目才产生“项目尚未拆解”风险。空项目没有自动完成候选，但用户可以在明确看到“尚未拆解”的提醒后手动确认关闭。

### 3.3 项目健康度

首阶段保留：

```text
onTrack / attention / blocked / complete
```

其中 `complete` 只表示 Project 已经处于 `done`；所有叶子 Action 完成但尚未确认关闭时，使用独立的 `completionCandidate` 信号，不把健康度提前标记为 `complete`。逾期、等待、阻塞、项目为空、没有 Next Action 等继续作为风险信号。不新增独立 `stalled` 状态。

### 3.4 项目完成

所有叶子 Action 完成后，系统只提示“项目可能可以完成”，不自动修改 Project 状态。确认流程必须展示 Outcome、DoD 和未完成的非叶子节点；这些非叶子节点作为人工检查提示，不因其状态单独阻止用户确认。用户确认后才写入 `done`。Outcome 或 DoD 为空时显示显著提醒，但不强制阻止渐进式项目关闭。

Project 进入 `done` 后，如果用户新增或重新打开一个直接归属于该 Project 的 Action，系统必须将 Project 自动恢复为 `doing`，并产生一次风险提示。用户可以在完成项目后继续创建后续维护项目，但不能让同一 Project 在存在未完成叶子 Action 时继续保持静默的 `complete`。

Outcome/DoD 的属性是唯一控制来源；项目正文中的背景、方案、研究和决策记录不被自动解析，也不与属性双向同步。项目澄清和详情编辑应优先提供属性入口，避免用户误以为正文同名内容会改变项目关闭检查。

### 3.5 Review

项目复用现有 `reviewInterval / reviewDate`：

- 没有周期时不产生周期 Review；
- 有逾期、无下一步、等待或阻塞等风险时仍进入 Review；
- 全局 Review 以 Project 为唯一队列项，多个风险合并为一个项目检查项；风险消失后从风险队列移除；用户仍可对没有周期、没有风险的项目执行“立即回顾”；
- 项目 Review 检查 Outcome、DoD、计划、Next Action、Waiting/Blocked 和项目状态。

## 4. 思源交互

### 4.1 创建

支持两种入口：

1. 自动在指定位置创建新的项目文档；
2. 选择已有文档转换为 Project。

两者进入同一个渐进式澄清流程，创建时允许只有标题。

取消项目身份必须通过领域命令或等价的同步修复路径完成，不能只清空 `custom-na-task` 后留下悬挂的 `parentId`。外部直接改属性时，缓存重建必须识别项目身份消失并执行同样的直接子关系清理。

### 4.2 加入项目与物理移动

“加入项目”只设置：

```text
custom-na-parent = projectId
```

不改变块在思源中的物理位置。

“移动到项目文档”是独立动作：调用思源块移动能力，保留 block ID，并移动到项目文档末尾或用户指定位置。不自动创建固定标题区域。它不改变显式 `custom-na-parent`；如果移动的是原生列表项，必须连同其内容块和子树一起移动。由于当前代码只有逻辑排序 RPC、没有物理块移动调用链，这项能力不属于 Phase 1；实现前必须补齐目标容器、跨文档失败回滚、循环保护和撤销契约。

### 4.3 Project Support

Phase 2 再自动聚合项目文档一层关联：

- 项目文档直接引用的块/文档；
- 明确反向链接到项目文档的块/文档。

首阶段不实现支持材料聚合。Phase 2 只读取明确的思源块引用和文档引用，以及指向项目文档的直接反向链接；结果去重、只读展示，不递归、不参与项目完成/进度，也不自动将支持材料转换为 Action。

## 5. 视图与 AI 边界

首要路径：

```text
项目总览 → 项目详情/计划 → Next Action → 全局 Review
```

现有总览、层级、看板、计划、甘特视图继续保留，但属于辅助视图。首阶段明确不做 Timeboxing、容量预测和自动排程。

AI 只生成建议；由 AI 产生的创建、归属、结构移动、状态变更或删除必须先预览并由用户确认。现有 MCP 显式写入工具暂不宣称已经具备确认协议，不能被静默改写为“自动等待用户确认”；若未来要求外部 Agent 也遵守该边界，需另行设计 preview/apply 与确认令牌契约。

## 6. 分阶段实施计划

### Phase 1：Project Foundation

1. 固定 Project 身份标记、Outcome、DoD 和 `action/stage` 类型字段，并同步 constants、TaskCacheEntry、缓存/仓储、广播、RPC、MCP DTO/patch 和 AI schema；
2. 完善项目文档创建、转换、取消项目身份和渐进式澄清；
3. 明确并测试统一 `parentId` 的允许矩阵、循环校验与直接子关系清理；
4. 抽出共享 Project Domain Summary/leaf traversal，供 ProjectView、Review、MCP 和 Next Action 使用；
5. 重构项目树、叶子 Action 进度、Stage 展示和空项目语义；
6. 修正 Next Action、项目健康度、完成候选和完成后重开逻辑；
7. 将项目 Review 以单项目队列项接入全局 Review，补齐 ReviewData/RPC/前端展示契约；
8. 增加跨文档归属、阶段进度、完成确认、重开和移除项目属性的回归测试；
9. 物理移动 Action 作为独立后续切片：先完成目标定位、子树保留、循环保护、失败回滚和撤销契约后再实现。

### Phase 2：Note-native Project Control

1. 聚合一层正向引用和反向链接；
2. 从笔记提取 Action 并保留来源块；
3. 在项目详情中编辑 Outcome、DoD、阶段和支持材料；
4. 增加物理移动 Action 的可撤销流程；
5. 统一项目风险队列和 Review 操作；
6. 优化总览、详情、Next Action 和 Review 的主路径及窄面板体验。

### Phase 3：按证据扩展

仅在真实使用中出现明确需求后再考虑：

- 更丰富的里程碑/交付物类型；
- 日历和 Timeboxing；
- 容量与 Deadline Risk；
- Recurring Project；
- AI 规划、风险检测和排程。

## 7. 实施约束

- 继续遵守内核唯一写入边界和现有 RPC/MCP 契约；
- 无历史兼容性要求，可以直接调整未发布版本的数据模型；
- 不为了视图增加没有领域语义支撑的字段；
- 每个行为变更必须附带相关回归测试；
- 项目汇总、Next Action、Review 和 MCP 必须共享同一套领域判断，而不是各自实现一份规则；
- 现有 MCP 显式写入工具在 preview/apply 协议落地前保持原契约，AI 生成的提案不得绕过前端确认直接调用这些写入工具；
- Phase 1 按“共享字段与数据通路 → 父关系与清理 → 叶子进度与完成确认 → 统一 Next Action/健康度 → Review 契约 → UI”切片，每个切片先完成纯逻辑回归测试再接跨端调用。
