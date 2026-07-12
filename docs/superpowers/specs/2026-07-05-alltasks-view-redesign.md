# 全部任务视图 UI 重设计

## 目标

改善 AllTasksView 的视觉质量，解决层级显示不清晰、信息密度杂乱、折叠按钮不显眼等问题。

## 改动范围

仅涉及前端样式和组件模板，不改变数据模型或内核逻辑。

### 涉及文件

- `src/frontend/components/TaskCard.svelte` — 模板和 props
- `src/frontend/components/AllTasksView.svelte` — 层级缩进结构
- `src/index.scss` — 全部相关样式

## 设计决策

### 1. 折叠按钮：圆形 +/− 按钮（优先级颜色）

- 20px 圆形按钮，背景用任务优先级颜色半透明（如 `rgba(231,76,60,0.2)`）
- 展开状态显示 `−`，折叠状态显示 `+`
- 折叠时在 meta 行追加 "▸ N 个子任务" 文字提示
- 替代当前的 18×18 纯文字三角 ▾

### 2. 优先级标签：彩色药丸标签

- 去掉 emoji 前缀（🔴紧急 → 紧急）
- 用彩色半透明背景 + 圆角 pill badge：`background: rgba(color, 0.15); color: color; padding: 1px 6px; border-radius: 10px;`
- 颜色沿用现有优先级色彩映射

### 3. 树形层级引导：虚线边框

- 替代当前 `::before` 伪元素垂直线
- 子任务容器使用 `border-left: 1px dashed var(--b3-border-color)` + `margin-left` + `padding-left`
- 位置随缩进自然对齐，不再硬编码 `left: 9px`

### 4. 统计信息：淡色符号

- 保留 importance/effort 数值
- 去掉 emoji（⭐📊），改用淡色符号 ★（importance）和 ◎（effort）
- 整体颜色用 `color: var(--b3-theme-on-surface-tertiary)` 降低视觉权重

### 5. 日期显示：自然语言

- 逾期任务：红色文字显示 "逾期 N 天"
- 未来截止日期：显示 "7月10日" 格式
- 去掉 📅 emoji 前缀

### 6. 状态标注：仅通过复选框

- meta 行不显示"进行中/等待中/已完成"文字
- 状态完全由复选框图标表达：空白方框（待办）、蓝色渐变（进行中）、浅蓝边框（等待中）、绿色✓（已完成）

### 7. 其他视觉优化

- 父任务标题 `font-weight: 500`
- 根任务有卡片底色 `background: var(--b3-theme-surface)`，子任务背景透明
- 筛选栏 select 改用圆角 `border-radius: 6px`，加大 padding
- 去掉冗余的 `na-task-card__color-bar` 绝对定位元素，`border-left` 已足够
- 复选框尺寸从 14×14 增大到 16×16，`border-radius` 从 3px 改为 4px
