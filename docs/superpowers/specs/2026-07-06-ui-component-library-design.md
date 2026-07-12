# NextAction UI 组件库设计

日期：2026-07-06

## 背景

当前项目的样式系统存在两个核心问题：

1. **两套样式混用**：自定义 `na-*` 类和思源 `b3-*` 类同时使用，三个组件（FilterBar、SearchSelect、TaskDetail）显式混用两套，视觉风格不统一
2. **硬编码泛滥**：9 处 inline `style="width:100%"`，6+ 处硬编码颜色值重复出现，PriorityDot 的 scoped style 和全局 style 重复定义，`na-detail__dropdown` 是死代码

## 设计决策

| 决策 | 选项 | 结论 | 理由 |
|------|------|------|------|
| 替换策略 | A) 完全自建 / B) 封装层包装 / C) 混合 | **A) 完全自建** | 停靠面板内紧凑 UI，思源控件尺寸偏大，需频繁 inline 覆盖 |
| 封装形式 | A) Svelte 组件 / B) 纯 CSS 类 / C) 混合 | **C) 混合** | 复杂交互（Select、Chip）用 Svelte 组件，简单元素（Button、Input）用 CSS 类 |
| Token 组织 | A) 语义化 / B) 两层 / C) 最小化 | **A) 语义化** | 每个变量用途一目了然，项目规模不需要两层 |
| 状态色配色 | A) 保留现有 / B) 思源对齐 / C) 语义色+主题感知 | **C) 语义色+主题感知** | 保留语义直觉（绿=完成），深浅主题下调整对比度 |
| 目录结构 | A) 集中式 / B) 按组件拆分 / C) 混合拆分 | **C) 混合拆分** | Token 和 primitives 集中管理，Svelte 组件扁平放置 |
| 主题检测 | `@media (prefers-color-scheme)` / CSS 属性选择器 | **`:root[data-theme-mode]` 选择器** | 思源不通过 media query 切换主题，用 `data-theme-mode` 属性标记当前主题 |

## 文件结构

```
src/frontend/
├── ui/
│   ├── tokens.scss              # 所有 --na-* 变量 + 深浅主题覆盖
│   ├── primitives.scss          # na-select, na-button, na-input 等纯 CSS 类
│   ├── NaChip.svelte            # 标签芯片
│   ├── NaChipGroup.svelte       # 芯片容器
│   ├── NaSearchSelect.svelte    # 搜索选择器（重构现有 SearchSelect）
│   ├── NaSegmentControl.svelte  # 分段选择器
│   ├── NaToggle.svelte          # 开关
│   ├── NaBadge.svelte           # 优先级药丸标签
│   ├── NaDotRating.svelte       # 圆点评分
│   ├── NaProgressBar.svelte     # 进度条
│   ├── NaTooltip.svelte         # 悬浮提示
│   └── NaEmpty.svelte           # 空状态/加载状态
└── index.scss                   # 入口文件（import + 业务样式）
```

## 设计 Token

定义在 `src/frontend/ui/tokens.scss`，所有变量挂在 `.nextaction` 选择器下。深色主题为默认值，浅色主题通过 `:root[data-theme-mode="light"] .nextaction` 覆盖。

### 完整 Token 定义

```scss
.nextaction {
  // ===== 状态色 =====
  --na-color-doing: #5dade2;
  --na-color-waiting: #85c1e9;
  --na-color-done: #2ecc71;
  --na-color-blocked: #aab7b8;

  // ===== 优先级色 =====
  --na-priority-critical: #e74c3c;
  --na-priority-high: #e67e22;
  --na-priority-medium: #5dade2;
  --na-priority-low: #aab7b8;
  --na-priority-none: transparent;

  // ===== 语义色 =====
  --na-color-project: #5dade2;
  --na-color-project-bg: rgba(93, 173, 226, 0.08);
  --na-color-project-bg-hover: rgba(93, 173, 226, 0.15);
  --na-color-selected-bg: rgba(93, 173, 226, 0.10);
  --na-color-overdue-bg: #2a1a1a;
  --na-color-overdue-text: var(--na-priority-critical);
  --na-color-drag-indicator: var(--na-color-project);

  // ===== 表面与交互 =====
  --na-color-hover-bg: rgba(255, 255, 255, 0.05);
  --na-color-chip-bg: rgba(255, 255, 255, 0.08);
  --na-color-chip-hover-bg: rgba(255, 255, 255, 0.12);
  --na-color-divider: var(--b3-border-color);

  // ===== 反馈色（第二档预留）=====
  --na-color-success: #2ecc71;
  --na-color-warning: #f39c12;
  --na-color-error: #e74c3c;
  --na-color-info: #5dade2;

  // ===== 尺寸 =====
  --na-radius-sm: 3px;
  --na-radius-md: 6px;
  --na-radius-pill: 10px;
  --na-control-height: 28px;
  --na-control-height-sm: 24px;
  --na-font-size-sm: 11px;
  --na-font-size-md: 12px;
  --na-font-size-lg: 13px;

  // ===== 间距 =====
  --na-space-xs: 2px;
  --na-space-sm: 4px;
  --na-space-md: 6px;
  --na-space-lg: 8px;
  --na-space-xl: 12px;

  // ===== 预留（第二档）=====
  --na-color-overlay-bg: rgba(0, 0, 0, 0.5);
  --na-shadow-dialog: 0 8px 32px rgba(0, 0, 0, 0.3);
  --na-shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.2);
  --na-drawer-width: 320px;
}

// ===== 浅色主题覆盖 =====
:root[data-theme-mode="light"] .nextaction {
  // 状态色
  --na-color-doing: #2e86c1;
  --na-color-waiting: #5499c7;
  --na-color-done: #1e8449;
  --na-color-blocked: #95a5a6;

  // 优先级色
  --na-priority-critical: #cb4335;
  --na-priority-high: #ca6f1e;
  --na-priority-medium: #2e86c1;
  --na-priority-low: #95a5a6;
  --na-priority-none: transparent;

  // 语义色
  --na-color-project: #2e86c1;
  --na-color-project-bg: rgba(46, 134, 193, 0.06);
  --na-color-project-bg-hover: rgba(46, 134, 193, 0.12);
  --na-color-selected-bg: rgba(46, 134, 193, 0.06);
  --na-color-overdue-bg: #fef2f2;
  --na-color-overdue-text: var(--na-priority-critical);
  --na-color-drag-indicator: var(--na-color-project);

  // 表面与交互
  --na-color-hover-bg: rgba(0, 0, 0, 0.04);
  --na-color-chip-bg: rgba(0, 0, 0, 0.06);
  --na-color-chip-hover-bg: rgba(0, 0, 0, 0.10);
  --na-color-divider: var(--b3-border-color);

  // 反馈色
  --na-color-success: #1e8449;
  --na-color-warning: #d4ac0d;
  --na-color-error: #cb4335;
  --na-color-info: #2e86c1;

  // 预留
  --na-color-overlay-bg: rgba(0, 0, 0, 0.3);
  --na-shadow-dialog: 0 8px 32px rgba(0, 0, 0, 0.15);
  --na-shadow-toast: 0 4px 12px rgba(0, 0, 0, 0.1);
}
```

### 深浅适配原则

- 深色底用更亮的色值（高亮度高饱和度），浅色底用更暗更饱和的色值
- 透明度适配：深色用白底透明度，浅色用黑底透明度
- 阴影深浅有别：深色模式阴影更重
- 语义关系保持一致：doing=蓝、done=绿，不管深浅

### 主题检测机制

思源通过 `<html data-theme-mode="dark|light">` 标记当前主题，不使用 `prefers-color-scheme`。插件应使用 `:root[data-theme-mode]` CSS 选择器做主题适配。当前 `index.scss` 中已有的 `@media (prefers-color-scheme: light)` 需要修正为 `:root[data-theme-mode="light"] .nextaction`。

运行时检测当前主题：

```typescript
// 读取 HTML 属性（最简单）
const themeMode = document.documentElement.getAttribute("data-theme-mode"); // "light" 或 "dark"

// 读取思源配置（更可靠）
const isDark = window.siyuan.config.appearance.mode === 1;
```

## 基础元素样式（primitives.scss）

定义在 `src/frontend/ui/primitives.scss`，纯 CSS 类，替代所有 `b3-select`、`b3-button`、`b3-text-field`、`fn__a`、`fn__ellipsis` 的使用。

### CSS 类清单

| CSS 类 | 替代目标 | 说明 |
|--------|----------|------|
| `.na-select` | `b3-select` | 下拉选择框，默认 `width: 100%` |
| `.na-select--sm` | — | 紧凑尺寸，高度 `--na-control-height-sm` |
| `.na-input` | `b3-text-field` | 文本/日期/数字输入，默认 `width: 100%` |
| `.na-button` | `b3-button` | 通用按钮 |
| `.na-button--primary` | `b3-button--primary` | 主要操作按钮 |
| `.na-button--danger` | `b3-button--remove` | 删除/危险操作 |
| `.na-button--icon` | `b3-button--icon` | 图标按钮 |
| `.na-button--sm` | `b3-button--small` | 小尺寸按钮 |
| `.na-link` | `fn__a` | 链接 |
| `.na-ellipsis` | `fn__ellipsis` | 文本溢出省略 |
| `.na-list-item` | `b3-list-item` | 下拉列表项 |
| `.na-list-item--sm` | `b3-list-item--narrow` | 紧凑列表项 |
| `.na-list-item--action` | — | 操作项（蓝色文字，用于"新增"选项） |

### 设计要点

- `.na-select` 和 `.na-input` 默认 `width: 100%`，消除所有 `style="width:100%"` inline 覆盖
- 聚焦时边框变 `--b3-theme-primary`
- 所有尺寸、间距、圆角使用 token 变量
- 配色使用思源的 `--b3-theme-*` 变量 + 自定义 `--na-*` 变量

## Svelte 组件设计

### 1. NaChip

标签芯片，用于 SearchSelect 中的已选项。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| label | string | 必填 | 芯片文字 |
| color | string | — | 可选，左侧色条或背景色 |
| onClose | (() => void) \| undefined | undefined | 有关闭按钮 |
| ellipsis | boolean | true | 文字超长时省略 |

**CSS 类**：`na-chip`，圆角药丸形，背景 `--na-color-chip-bg`，hover `--na-color-chip-hover-bg`。关闭按钮用 SVG icon。

### 2. NaChipGroup

管理多个 NaChip 的容器。

**Props：** 无（纯布局容器）

**CSS 类**：`na-chip-group`，flex wrap 布局，gap `--na-space-xs`。替代 `b3-chips`。

### 3. NaSearchSelect

重构现有 SearchSelect，移除所有 b3-* 依赖。

**Props：** 与现有 SearchSelect 完全一致（multi, selected, selectedLabel, searchFn, allOptions, placeholder），行为不变。

**内部改动：**
- `b3-chips` → `<NaChipGroup>`
- `b3-chip` → `<NaChip>`
- `b3-list-item` → `.na-list-item`
- `fn__ellipsis` → `.na-ellipsis`
- 所有 inline style 移入 CSS 类

### 4. NaSegmentControl

分段选择器，如 TaskDetail 中的"任务/项目"切换。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| options | { value: string, label: string }[] | 必填 | 选项列表 |
| value | string | "" | 当前选中值，双向绑定 |

**CSS 类**：`na-segment-control`。选中态 `--b3-theme-primary` 背景 + `--b3-theme-on-primary` 文字，未选态 `--na-color-chip-bg` 背景。

### 5. NaToggle

开关切换，如 Sequential、Repeat 的启用/禁用。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| checked | boolean | false | 开关状态，双向绑定 |
| disabled | boolean | false | 禁用态 |

**Dispatch 事件**：`change`

**视觉**：轨道（圆角矩形，约 36×20px）+ 滑块（圆形）。开启态轨道 `--b3-theme-primary`，关闭态 `--b3-border-color`，滑块白色。

### 6. NaBadge

优先级药丸标签，如 TaskCard 上的"高"、"紧急"。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| text | string | 必填 | 标签文字 |
| color | string | — | 语义色变量或 hex 值 |

**实现**：JS 内部计算 15% 透明度背景色（复用 priorityRgba 逻辑，内聚到组件内），文字色直接用传入的 `color`。消除 TaskCard 中的 inline style 和 utils.ts 中的 priorityRgba 函数。

### 7. NaDotRating

圆点评分，用于重要性/努力度的 1-7 评分。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| count | number | 7 | 圆点总数 |
| value | number | 0 | 当前选中数量，双向绑定 |
| color | string | "var(--b3-theme-primary)" | 选中态圆点颜色 |

**Dispatch 事件**：`change`

**视觉**：水平排列圆形 `<span>`。选中态填充 `color`，未选态空心 `--b3-border-color`。

### 8. NaProgressBar

项目完成进度条。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| percent | number | 0 | 进度百分比 0-100 |
| label | string | — | 可选，左侧文字说明 |
| color | string | "var(--na-color-done)" | 填充色 |

**CSS 类**：`na-progress`、`na-progress__bar`、`na-progress__fill`。从 `na-project-progress` 重命名为 `na-progress`，更通用。

### 9. NaTooltip

悬浮提示，替代原生 `title=""` 属性。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| text | string | 必填 | 提示文字 |
| position | "top" \| "bottom" \| "left" \| "right" | "top" | 出现方向 |
| delay | number | 300 | 出现延迟（ms） |

**视觉**：`position: absolute` 气泡。背景 `--b3-theme-surface`，边框 `--b3-border-color`，文字 `--b3-theme-on-background`。`pointer-events: none`。用 Svelte 的 `bind:clientWidth/clientHeight` + `requestAnimationFrame` 定位。

### 10. NaEmpty

空状态/加载状态占位。

**Props：**

| Prop | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| text | string | — | 说明文字 |
| icon | string | — | 可选，emoji 或 SVG icon |
| loading | boolean | false | 是否为加载态（旋转动画） |
| action | { label: string, onClick: () => void } | — | 可选操作按钮 |

**CSS 类**：`na-empty`。加载态显示 CSS 旋转动画小圆环。空态显示 icon + text + 可选按钮。替代 `na-view__loading` 和 `na-view__empty`。

## 第二档预留

现在不建 Svelte 组件，但在 tokens.scss 中预留设计 token 和 CSS 类名空间。

| 组件 | 预留 token | 预留类名空间 |
|------|-----------|-------------|
| NaDialog | `--na-color-overlay-bg`、`--na-shadow-dialog`、`--na-radius-lg` | `.na-dialog*` |
| NaToast | `--na-color-success/warning/error/info`、`--na-shadow-toast` | `.na-toast*` |
| NaDatePicker | — | `.na-date-picker*` |
| NaTabs | — | `.na-tabs*` |
| NaDropdown | — | `.na-dropdown*` |
| NaDrawer | `--na-drawer-width` | `.na-drawer*` |

## 业务组件改造要点

### FilterBar.svelte

- `class="b3-select"` → `class="na-select na-select--sm"`
- 移除 `na-filter-bar` 中 `select { flex: 1; ... }` 的 CSS 规则，改为 `.na-select--sm` 自带完整样式

### TaskDetail.svelte

- 6 个 `<select class="b3-select" style="width:100%">` → `<select class="na-select">`
- 3 个 `<input class="b3-text-field" style="width:100%">` → `<input class="na-input">`
- 关闭按钮 `class="b3-button b3-button--icon"` → `class="na-button na-button--icon"`
- 删除按钮 `class="b3-button b3-button--remove b3-button--small"` → `class="na-button na-button--danger na-button--sm"`
- 跳转链接 `class="fn__a" style="font-size:12px"` → `class="na-link"`
- `na-detail__segment-control` → `<NaSegmentControl>`
- `na-detail__toggle`（2 处）→ `<NaToggle>`
- `na-detail__dots`（2 处）→ `<NaDotRating>`
- SearchSelect → NaSearchSelect
- 删除 `na-detail__dropdown` CSS（死代码）

### SearchSelect.svelte → NaSearchSelect.svelte

- 文件重命名
- `b3-chips` → `<NaChipGroup>`
- `b3-chip` → `<NaChip>`
- `b3-list-item b3-list-item--narrow` → `.na-list-item .na-list-item--sm`
- `fn__ellipsis` → `.na-ellipsis`
- 所有 inline style 移除
- 新增选项蓝色文字 → `.na-list-item--action`

### TaskCard.svelte

- `na-task-card__priority-badge` + inline style → `<NaBadge>`
- `na-task-card--project` 硬编码颜色 → `var(--na-color-project)` / `var(--na-color-project-bg)`
- `na-task-card.selected` 硬编码背景 → `var(--na-color-selected-bg)`

### StatusCheckbox.svelte

- `#3498db` → `var(--na-color-doing)`
- `#5dade2` → `var(--na-color-waiting)`
- `#27ae60` → `var(--na-color-done)`
- `#95a5a6` → `var(--na-color-blocked)`

### PriorityDot.svelte

- 删除 scoped `<style>` 块，使用全局 `.na-priority-dot`
- 硬编码 `#666` → `var(--b3-theme-on-surface-tertiary)`

### ProjectView.svelte

- `na-project-progress` 三层 div → `<NaProgressBar>`
- `na-project-item__header` 的 `display: none` → 修复为正常显示

### NextActionView.svelte / AllTasksView.svelte

- `na-view__loading` / `na-view__empty` → `<NaEmpty>`

### 编辑器覆盖样式（protyle-wysiwyg）

- `#3498db` → `var(--na-color-doing)`
- `#5dade2` → `var(--na-color-waiting)`
- `#27ae60` → `var(--na-color-done)`
- `#fff` → `var(--b3-theme-on-primary)`

## 需要清理的问题

| 问题 | 处理 |
|------|------|
| PriorityDot scoped style 和全局 style 重复 | 删除 PriorityDot.svelte 中的 scoped `<style>` |
| `na-detail__dropdown` 死代码 | 删除 index.scss 680-693 行 |
| `na-project-item__toggle` 未使用 | 删除 index.scss 513-518 行 |
| `na-project-item__header` 的 `display: none` | 修复为正常显示 |
| 9 处 `style="width:100%"` | 全部移除，由 CSS 类默认 width 覆盖 |
| SearchSelect inline style | 移入 CSS 类 |
| `@media (prefers-color-scheme: light)` | 修正为 `:root[data-theme-mode="light"] .nextaction` |
| `utils.ts` 中的 `priorityRgba` 函数 | 逻辑内聚到 NaBadge 组件，原函数标记废弃 |

## 硬编码颜色替换对照表

| 位置 | 当前值 | 替换为 |
|------|--------|--------|
| `.na-status-checkbox--doing` border/background | `#3498db` | `var(--na-color-doing)` |
| `.na-status-checkbox--waiting` border | `#5dade2` | `var(--na-color-waiting)` |
| `.na-status-checkbox--done` background/border | `#27ae60` | `var(--na-color-done)` |
| `.na-status-checkbox--blocked` border | `#95a5a6` | `var(--na-color-blocked)` |
| `.na-status-checkbox--done::after` color | `#fff` | `var(--b3-theme-on-primary)` |
| protyle `doing` | `#3498db` | `var(--na-color-doing)` |
| protyle `waiting` | `#5dade2` | `var(--na-color-waiting)` |
| protyle `done` | `#27ae60` | `var(--na-color-done)` |
| protyle `done` text | `#fff` | `var(--b3-theme-on-primary)` |
| `.na-task-card--project` border | `#3498db` | `var(--na-color-project)` |
| `.na-task-card--project` background | `rgba(52,152,219,0.05)` | `var(--na-color-project-bg)` |
| `.na-project-progress__fill` background | `#27ae60` | `var(--na-color-done)` |
| `.na-drop-target-*` border/outline | `#3498db` | `var(--na-color-drag-indicator)` |
| `.na-task-card.selected` background | `rgba(53,131,235,0.08)` | `var(--na-color-selected-bg)` |
| hover 背景（多处） | `rgba(255,255,255,0.05)` | `var(--na-color-hover-bg)` |
| `.na-status-checkbox--blocked::after` border | `#95a5a6` | `var(--na-color-blocked)` |
