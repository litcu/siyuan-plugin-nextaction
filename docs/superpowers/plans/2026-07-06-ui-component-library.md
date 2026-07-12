# NextAction UI 组件库实施计划

日期：2026-07-07
设计规格：`docs/superpowers/specs/2026-07-06-ui-component-library-design.md`

## 概览

本计划将设计规格文档中的所有设计决策落地为代码。共 19 个任务，分为 4 个阶段：

1. **基础设施**（Task 1-2）：创建 tokens.scss 和 primitives.scss
2. **Svelte 组件**（Task 3-12）：逐个实现 10 个组件
3. **业务迁移**（Task 13-17）：将现有组件从 b3-* 迁移到自建组件
4. **收尾验证**（Task 18-19）：清理、构建验证

每个任务都有明确的输入、输出和验证标准。阶段内任务按编号顺序执行；阶段 2 的 Task 3-12 可并行（组件之间无依赖），阶段 3 的 Task 14-17 也可并行（各迁移不同文件）。

---

## 阶段 1：基础设施

### Task 1：创建 tokens.scss

**目标**：在 `src/frontend/ui/tokens.scss` 中定义所有 `--na-*` 设计 token，包含深色默认值和浅色覆盖。

**输入**：设计规格中的"完整 Token 定义"章节

**操作**：

1. 创建 `src/frontend/ui/tokens.scss`
2. 写入 `.nextaction { ... }` 选择器内的所有 token 变量（状态色、优先级色、语义色、表面与交互、反馈色、尺寸、间距、预留）
3. 写入 `:root[data-theme-mode="light"] .nextaction { ... }` 浅色覆盖块
4. 深色为默认（思源默认深色），浅色通过属性选择器覆盖

**输出文件**：`src/frontend/ui/tokens.scss`

**验证**：
- 文件存在且 SCSS 语法正确
- 所有设计规格中列出的 token 都已定义
- 浅色块覆盖了所有颜色 token（尺寸/间距无需覆盖）
- 无 `@media (prefers-color-scheme)` 出现

---

### Task 2：创建 primitives.scss

**目标**：在 `src/frontend/ui/tokens.scss` 中定义所有纯 CSS 基础元素样式，替代 b3-select、b3-button、b3-text-field、fn__a、fn__ellipsis。

**输入**：设计规格中的"基础元素样式"章节

**操作**：

1. 创建 `src/frontend/ui/primitives.scss`
2. 实现以下 CSS 类：
   - `.na-select`、`.na-select--sm` — 下拉选择框，默认 `width: 100%`
   - `.na-input` — 文本/日期/数字输入，默认 `width: 100%`
   - `.na-button`、`.na-button--primary`、`.na-button--danger`、`.na-button--icon`、`.na-button--sm` — 按钮变体
   - `.na-link` — 链接
   - `.na-ellipsis` — 文本溢出省略
   - `.na-list-item`、`.na-list-item--sm`、`.na-list-item--action` — 列表项变体
3. 所有尺寸/间距/圆角使用 `--na-*` token 变量
4. 配色使用 `--b3-theme-*` + `--na-*` 变量
5. 聚焦时边框变 `--b3-theme-primary`

**输出文件**：`src/frontend/ui/primitives.scss`

**验证**：
- 文件存在且 SCSS 语法正确
- 每个类对照设计规格中的清单无遗漏
- `.na-select` 和 `.na-input` 默认 `width: 100%`（消除 inline style 需求）
- 无硬编码颜色值

---

## 阶段 2：Svelte 组件

以下 10 个组件相互独立，可并行实现。每个组件遵循相同的模式：

1. 创建 `src/frontend/ui/NaXxx.svelte`
2. 实现组件逻辑（props、events、slots）
3. 编写组件内 scoped `<style>` 或依赖全局 CSS 类
4. 确保组件在 `.nextaction` 容器内正确渲染

---

### Task 3：NaChip.svelte

**目标**：标签芯片组件，用于 SearchSelect 中的已选项显示。

**Props**：`label: string`（必填）、`color?: string`、`onClose?: () => void`、`ellipsis: boolean = true`

**操作**：

1. 创建 `src/frontend/ui/NaChip.svelte`
2. 圆角药丸形，背景 `var(--na-color-chip-bg)`，hover `var(--na-color-chip-hover-bg)`
3. `onClose` 存在时显示关闭按钮（SVG × icon）
4. `ellipsis=true` 时文字超长省略（`text-overflow: ellipsis`）
5. `color` 存在时左侧显示色条或背景着色

**验证**：组件可渲染，点击关闭按钮触发回调

---

### Task 4：NaChipGroup.svelte

**目标**：芯片容器，flex wrap 布局。

**Props**：无（纯布局容器，用 `<slot>` 接收子 NaChip）

**操作**：

1. 创建 `src/frontend/ui/NaChipGroup.svelte`
2. CSS 类 `na-chip-group`，`display: flex; flex-wrap: wrap; gap: var(--na-space-xs)`

**验证**：内含多个 NaChip 时自动换行

---

### Task 5：NaSearchSelect.svelte

**目标**：重构现有 SearchSelect.svelte，移除所有 b3-* 依赖。

**操作**：

1. 创建 `src/frontend/ui/NaSearchSelect.svelte`
2. Props 与现有 SearchSelect 完全一致：`multi, selected, selectedLabel, searchFn, allOptions, placeholder`
3. 内部替换：
   - `b3-chips` → `<NaChipGroup>`
   - `b3-chip` → `<NaChip>`
   - `b3-list-item b3-list-item--narrow` → `.na-list-item .na-list-item--sm`
   - `fn__ellipsis` → `.na-ellipsis`
   - "新增"选项 → `.na-list-item--action`
4. 所有 inline style 移入 CSS 类
5. 行为逻辑完全保持不变（搜索过滤、多选/单选、外部点击关闭等）

**验证**：与原 SearchSelect 行为一致，无 b3-* 类残留

---

### Task 6：NaSegmentControl.svelte

**目标**：分段选择器，替代 TaskDetail 中的手动按钮组。

**Props**：`options: { value: string, label: string }[]`（必填）、`value: string = ""`（双向绑定）

**操作**：

1. 创建 `src/frontend/ui/NaSegmentControl.svelte`
2. CSS 类 `na-segment-control`，水平排列选项按钮
3. 选中态：`--b3-theme-primary` 背景 + `--b3-theme-on-primary` 文字
4. 未选态：`--na-color-chip-bg` 背景 + `--b3-theme-on-background` 文字
5. 点击选项时 dispatch `change` 事件 + 更新 `value`

**验证**：点击切换选中态，外部绑定 value 同步

---

### Task 7：NaToggle.svelte

**目标**：开关切换组件，替代 TaskDetail 中的原生 checkbox。

**Props**：`checked: boolean = false`（双向绑定）、`disabled: boolean = false`

**Dispatch**：`change`

**操作**：

1. 创建 `src/frontend/ui/NaToggle.svelte`
2. 视觉：轨道（圆角矩形 ~36×20px）+ 滑块（圆形 ~16px）
3. 开启态轨道 `--b3-theme-primary`，关闭态 `--b3-border-color`
4. 滑块白色，开启时向右滑动
5. 禁用态降低透明度
6. `aria-role="switch"` 无障碍支持

**验证**：点击切换状态，外部绑定 checked 同步

---

### Task 8：NaBadge.svelte

**目标**：优先级药丸标签，替代 TaskCard 中的 inline style + priorityRgba 逻辑。

**Props**：`text: string`（必填）、`color?: string`

**操作**：

1. 创建 `src/frontend/ui/NaBadge.svelte`
2. 圆角药丸形，文字色用传入 `color`，背景色为 `color` 的 15% 透明度版本
3. 内部实现 `priorityRgba` 等效逻辑（解析 hex → 计算 rgba），不再依赖 utils.ts 中的函数
4. CSS 类 `na-badge`

**验证**：传入不同颜色正确渲染，无需 inline style

---

### Task 9：NaDotRating.svelte

**目标**：圆点评分组件，替代 TaskDetail 中的手动 dot 循环。

**Props**：`count: number = 7`、`value: number = 0`（双向绑定）、`color: string = "var(--b3-theme-primary)"`

**Dispatch**：`change`

**操作**：

1. 创建 `src/frontend/ui/NaDotRating.svelte`
2. 水平排列 `count` 个圆形 `<span>`
3. 前 `value` 个填充 `color`，其余空心 `--b3-border-color`
4. 点击圆点时设置 `value` 为该位置，dispatch `change`
5. CSS 类 `na-dot-rating`、`na-dot-rating__dot`、`na-dot-rating__dot--filled`

**验证**：点击第 N 个圆点，value 变为 N

---

### Task 10：NaProgressBar.svelte

**目标**：进度条组件，替代 ProjectView 中的三层 div。

**Props**：`percent: number = 0`、`label?: string`、`color: string = "var(--na-color-done)"`

**操作**：

1. 创建 `src/frontend/ui/NaProgressBar.svelte`
2. CSS 类 `na-progress`、`na-progress__bar`、`na-progress__fill`
3. 填充宽度 = `percent%`，背景色用 `color`
4. 可选 `label` 显示在左侧
5. 从 `na-project-progress` 重命名为 `na-progress`（更通用）

**验证**：传入 percent=60 时填充宽度 60%

---

### Task 11：NaTooltip.svelte

**目标**：悬浮提示组件，替代原生 `title=""` 属性。

**Props**：`text: string`（必填）、`position: "top"|"bottom"|"left"|"right" = "top"`、`delay: number = 300`

**操作**：

1. 创建 `src/frontend/ui/NaTooltip.svelte`
2. 用 Svelte 的 `bind:clientWidth/clientHeight` + `requestAnimationFrame` 定位
3. 背景 `--b3-theme-surface`，边框 `--b3-border-color`，文字 `--b3-theme-on-background`
4. `pointer-events: none`
5. 延迟显示/隐藏

**验证**：鼠标悬停 300ms 后出现提示，移开后消失

---

### Task 12：NaEmpty.svelte

**目标**：空状态/加载状态占位，替代 `na-view__loading` 和 `na-view__empty`。

**Props**：`text?: string`、`icon?: string`、`loading: boolean = false`、`action?: { label: string, onClick: () => void }`

**操作**：

1. 创建 `src/frontend/ui/NaEmpty.svelte`
2. CSS 类 `na-empty`
3. 加载态：CSS 旋转动画小圆环
4. 空态：icon + text + 可选按钮
5. 按钮使用 `.na-button--sm`

**验证**：loading=true 显示旋转动画，loading=false 显示文字和可选操作

---

## 阶段 3：业务迁移

### Task 13：重构 index.scss

**目标**：将 index.scss 改为导入 tokens + primitives，删除死代码，替换硬编码颜色，修正主题检测。

**操作**：

1. 在 index.scss 顶部添加：
   ```scss
   @use "./frontend/ui/tokens";
   @use "./frontend/ui/primitives";
   ```
2. 删除 `@media (prefers-color-scheme: light)` 块（约第 23-27 行），替换为 `:root[data-theme-mode="light"] .nextaction { ... }` 覆盖块（token 中的颜色已在 tokens.scss 中定义，此处只需删除旧的 media query）
3. 删除死代码：
   - `na-detail__dropdown`（约 680-693 行）
   - `na-project-item__toggle`（约 513-518 行）
4. 修复 bug：`na-project-item__header` 的 `display: none` → 删除该规则
5. 替换所有硬编码颜色：
   - `#3498db` → `var(--na-color-doing)` 或 `var(--na-color-project)` 或 `var(--na-color-drag-indicator)`（根据语义上下文）
   - `#5dade2` → `var(--na-color-waiting)`
   - `#27ae60` → `var(--na-color-done)`
   - `#95a5a6` → `var(--na-color-blocked)`
   - `#fff`（在 checkbox done::after 中）→ `var(--b3-theme-on-primary)`
   - `rgba(52,152,219,0.05)` → `var(--na-color-project-bg)`
   - `rgba(53,131,235,0.08)` → `var(--na-color-selected-bg)`
   - hover 背景 `rgba(255,255,255,0.05)` → `var(--na-color-hover-bg)`
6. 删除与 NaBadge 内聚后不再需要的 `priorityRgba` 相关 CSS
7. `na-project-progress*` 重命名为 `na-progress*`（与 NaProgressBar 组件一致）

**输出文件**：`src/index.scss`（修改后）

**验证**：
- `pnpm run build:app` 构建成功
- 无 `prefers-color-scheme` 残留
- 无 `na-detail__dropdown`、`na-project-item__toggle` 残留
- 无 `#3498db`、`#5dade2`、`#27ae60`、`#95a5a6` 硬编码残留
- `na-project-item__header` 不再有 `display: none`

---

### Task 14：迁移 FilterBar.svelte

**目标**：将 FilterBar 中的 3 个 b3-select 替换为 na-select。

**操作**：

1. `class="b3-select"` → `class="na-select na-select--sm"`（3 处）
2. 移除 `na-filter-bar` 中 `select { flex: 1; ... }` 的 CSS 规则，`.na-select--sm` 自带完整样式
3. 移除任何 inline style

**验证**：FilterBar 中无 `b3-` 类残留，`pnpm run build:app` 成功

---

### Task 15：迁移 TaskDetail.svelte

**目标**：将 TaskDetail 中所有 b3-* 类替换为自建组件/类。这是改动量最大的文件。

**操作**：

1. 导入新组件：
   ```svelte
   import NaSegmentControl from './ui/NaSegmentControl.svelte'
   import NaToggle from './ui/NaToggle.svelte'
   import NaDotRating from './ui/NaDotRating.svelte'
   import NaSearchSelect from './ui/NaSearchSelect.svelte'
   ```
2. 6 个 `<select class="b3-select" style="width:100%">` → `<select class="na-select">`
3. 3 个 `<input class="b3-text-field" style="width:100%">` → `<input class="na-input">`
4. 关闭按钮 `class="b3-button b3-button--icon"` → `class="na-button na-button--icon"`
5. 删除按钮 `class="b3-button b3-button--remove b3-button--small"` → `class="na-button na-button--danger na-button--sm"`
6. 跳转链接 `class="fn__a" style="font-size:12px"` → `class="na-link"`
7. 替换手动按钮组为 `<NaSegmentControl options={...} bind:value={...}>`
8. 替换手动 checkbox 为 `<NaToggle bind:checked={...}>`（2 处）
9. 替换手动 dot 循环为 `<NaDotRating count={7} bind:value={...}>`（2 处）
10. 替换 SearchSelect 引用为 NaSearchSelect
11. 移除所有 9 处 `style="width:100%"` inline style
12. 删除 TaskDetail 中与 `na-detail__dropdown` 相关的任何 HTML（死代码）

**验证**：
- TaskDetail 中无 `b3-`、`fn__` 类残留
- 无 `style="width:100%"` 残留
- `pnpm run build:app` 成功

---

### Task 16：迁移 TaskCard + StatusCheckbox + PriorityDot

**目标**：三个小组件一起迁移，涉及硬编码颜色和 inline style 的替换。

**操作 - TaskCard.svelte**：

1. `na-task-card__priority-badge` + inline style → `<NaBadge text={...} color={...}>`
2. `na-task-card--project` 硬编码 `#3498db` → `var(--na-color-project)` 和 `rgba(52,152,219,0.05)` → `var(--na-color-project-bg)`
3. `.selected` 硬编码 `rgba(53,131,235,0.08)` → `var(--na-color-selected-bg)`

**操作 - StatusCheckbox.svelte**：

1. `#3498db` → `var(--na-color-doing)`
2. `#5dade2` → `var(--na-color-waiting)`
3. `#27ae60` → `var(--na-color-done)`
4. `#95a5a6` → `var(--na-color-blocked)`
5. `#fff`（done 勾号色）→ `var(--b3-theme-on-primary)`

**操作 - PriorityDot.svelte**：

1. 删除组件内的 scoped `<style>` 块（与全局 `.na-priority-dot` 重复）
2. 硬编码 `#666` → `var(--b3-theme-on-surface-tertiary)`

**验证**：
- 三个文件中无硬编码颜色（`#3498db`、`#5dade2`、`#27ae60`、`#95a5a6`、`#666`）
- PriorityDot 无 scoped style
- `pnpm run build:app` 成功

---

### Task 17：迁移 ProjectView + NextActionView + AllTasksView

**目标**：三个视图组件的迁移，涉及 NaProgressBar、NaEmpty 的替换。

**操作 - ProjectView.svelte**：

1. `na-project-progress` 三层 div → `<NaProgressBar percent={...} label={...}>`
2. 更新 CSS 类引用 `na-progress*`（与 NaProgressBar 一致）
3. 确认 `na-project-item__header` 正常显示（Task 13 已修复 CSS）

**操作 - NextActionView.svelte**：

1. `na-view__loading` → `<NaEmpty loading={true}>`
2. `na-view__empty` → `<NaEmpty text={...}>`

**操作 - AllTasksView.svelte**：

1. `na-view__loading` → `<NaEmpty loading={true}>`
2. `na-view__empty` → `<NaEmpty text={...}>`

**验证**：
- 三个文件中无 `na-project-progress` 残留
- 无 `na-view__loading` / `na-view__empty` 残留
- `pnpm run build:app` 成功

---

## 阶段 4：收尾验证

### Task 18：迁移编辑器覆盖样式

**目标**：替换 protyle 编辑器内任务标记样式中的硬编码颜色。

**操作**：

1. 在 index.scss 中找到所有 protyle-wysiwyg 相关的硬编码颜色
2. 替换对照：
   - `#3498db`（doing 标记）→ `var(--na-color-doing)`
   - `#5dade2`（waiting 标记）→ `var(--na-color-waiting)`
   - `#27ae60`（done 标记）→ `var(--na-color-done)`
   - `#fff`（done 勾号文字）→ `var(--b3-theme-on-primary)`

**验证**：index.scss 中 protyle 相关样式无硬编码颜色

---

### Task 19：构建验证与最终清理

**目标**：端到端验证整个迁移无遗漏。

**操作**：

1. 运行 `pnpm run build`（完整构建 kernel + app）
2. 全局搜索确认无遗漏：
   - `grep -r "b3-select\|b3-button\|b3-text-field\|b3-chip\|b3-list-item\|fn__a\|fn__ellipsis" src/frontend/` → 应为 0 结果
   - `grep -r "style=\"width:100%\"" src/frontend/` → 应为 0 结果
   - `grep -r "#3498db\|#5dade2\|#27ae60\|#95a5a6" src/` → 应仅在 `constants.ts` 的 `PRIORITY_HEX_COLORS` 中出现
   - `grep -r "prefers-color-scheme" src/` → 应为 0 结果
3. 标记 `utils.ts` 中 `priorityRgba` 函数为废弃（NaBadge 已内聚该逻辑）
4. 确认 `constants.ts` 中 `PRIORITY_HEX_COLORS` 仍保留（其他地方可能引用）
5. 最终 git commit

**验证**：
- `pnpm run build` 成功
- 所有 grep 检查通过
- 无编译警告或错误

---

## 并行策略

```
阶段 1：Task 1 → Task 2（顺序，primitives 依赖 tokens 中的变量名）
阶段 2：Task 3-12（全部并行，组件间无依赖）
阶段 3：Task 13 可先执行（为后续迁移提供 CSS 基础）
         Task 14-17 可并行（迁移不同文件）
         Task 18 依赖 Task 13（修改同一文件 index.scss）
阶段 4：Task 19（必须最后执行，全局验证）
```

建议使用 subagent 并行处理阶段 2 和阶段 3 的独立任务。

## 风险与回退

| 风险 | 应对 |
|------|------|
| primitives.scss 样式与思源主题变量不兼容 | 逐步调试，用浏览器 DevTools 对比 b3-* 的计算值 |
| NaSearchSelect 重构引入行为回归 | 逐项对比原 SearchSelect 的交互行为，确保搜索/选择/关闭逻辑一致 |
| token 变量名在浅色主题下对比度不足 | 在深浅两种模式下逐个检查，调整浅色 token 的亮度值 |
| Vite SCSS @use 路径解析问题 | 检查 vite.config.ts 的 css.preprocessorOptions，必要时添加 includePaths |

## 工作量估算

| 阶段 | 任务数 | 复杂度 |
|------|--------|--------|
| 阶段 1：基础设施 | 2 | 中（大量变量定义，但结构固定） |
| 阶段 2：Svelte 组件 | 10 | 中（单个组件简单，总量大） |
| 阶段 3：业务迁移 | 5 | 高（TaskDetail 改动量大，需仔细替换） |
| 阶段 4：收尾验证 | 2 | 低（搜索+验证） |
