# 思源笔记内置 UI 组件参考

本文件列出思源笔记提供的内置 CSS 组件类，供插件开发时优先复用，确保与思源界面风格一致。

源码位置：`vendor/siyuan/app/src/assets/scss/component/` 和 `util/_function.scss`

## 使用原则

1. **优先使用内置类**：需要按钮、输入框、选择器、标签、列表项等 UI 元素时，先查找本文件中是否有对应的 `b3-*` 类可用
2. **不重复造轮子**：使用 `b3-select`、`b3-text-field`、`b3-button` 等替代自定义样式，保证主题切换、圆角、阴影、间距等与思源一致
3. **主题变量**：颜色、圆角、阴影等一律使用 `--b3-*` CSS 变量，不硬编码具体值
4. **自定义仅用于业务组件**：只有当内置类无法满足需求时（如 TaskCard、PriorityDot），才用 `na-` 前缀的自定义类

## 表单组件

| 类名 | 用途 | 常用变体 |
|------|------|---------|
| `b3-text-field` | 文本输入框 | `b3-text-field--small`（小号）、`b3-text-field--text`（仅下划线） |
| `b3-select` | 下拉选择框 | 无 |
| `b3-button` | 按钮 | `b3-button--text`（文字按钮）、`b3-button--cancel`（取消）、`b3-button--remove`（危险）、`b3-button--small`（小号）、`b3-button--icon`（图标按钮）、`b3-button--outline`（描边） |
| `b3-switch` | 开关切换 | `b3-switch--menu`（菜单行内） |
| `b3-slider` | 滑块 | 无 |
| `b3-form__icon` | 带前置图标的输入框 | 配合 `b3-form__icon-icon`（图标）+ `b3-form__icon-input`（输入框） |
| `b3-form__icona` | 带后置图标的输入框 | 配合 `b3-form__icona-icon` + `b3-form__icona-input` |

## 标签/徽章组件

| 类名 | 用途 | 常用变体 |
|------|------|---------|
| `b3-chip` | 标签/药丸 | `b3-chip--small`、`b3-chip--middle`（中号）、`b3-chip--primary`（主题色）、`b3-chip--hover`（可交互）、`b3-chip--error`/`--warning`/`--info`/`--success`（语义色） |
| `b3-chip__close` | 标签关闭按钮（放在 `b3-chip` 内部） | 使用 `#iconClose` SVG 图标 |
| `b3-chips` | 标签容器（flex wrap） | `b3-chips__doctag`（文档标签） |

## 列表/菜单组件

| 类名 | 用途 | 常用变体 |
|------|------|---------|
| `b3-list` | 列表容器 | `b3-list--background`（带悬停背景） |
| `b3-list-item` | 列表项 | `b3-list-item--narrow`（窄边距）、`b3-list-item--focus`（聚焦）、`b3-list-item--hide-action`（悬停显示操作） |
| `b3-list-item__text` | 列表项文字 | 自动 `fn__ellipsis` 单行截断 |
| `b3-list-item__icon` | 列表项图标 | 22px |
| `b3-list-item__action` | 列表项操作按钮 | 悬停时高亮 |
| `b3-list-item__meta` | 列表项次要文字 | 12px，次要色 |
| `b3-menu` | 右键/弹出菜单 | `b3-menu--list`（滚动列表） |
| `b3-menu__item` | 菜单项 | `b3-menu__item--current`（高亮）、`b3-menu__item--selected`（选中）、`b3-menu__item--disabled`（禁用）、`b3-menu__item--warning`（危险） |
| `b3-menu__separator` | 菜单分隔线 | 无 |

## 对话框组件

| 类名 | 用途 |
|------|------|
| `b3-dialog` + `b3-dialog__container` | 模态对话框 |
| `b3-dialog__header` | 对话框标题栏 |
| `b3-dialog__body` | 对话框内容区（可滚动） |
| `b3-dialog__action` | 对话框底部操作栏 |

JS API：`new Dialog({ title, content, width, height })`

## 提示组件

| 类名/API | 用途 |
|----------|------|
| `showMessage(text, timeout?, type?)` | Toast 提示，type 为 `"info"` / `"error"` |
| `confirm(title, text, okCb?, cancelCb?)` | 确认对话框 |
| `b3-tooltips` + `b3-tooltips__s/n/e/w` | CSS 纯悬浮提示，通过 `aria-label` 属性设置内容 |

## 卡片组件

| 类名 | 用途 | 常用变体 |
|------|------|---------|
| `b3-card` | 卡片容器 | `b3-card--current`（选中）、`b3-card--disabled`（禁用） |
| `b3-cards` | 卡片网格布局 | 自动响应式网格 |

## 工具类

### 布局（fn-*）

| 类名 | 效果 |
|------|------|
| `fn__flex` | `display: flex` |
| `fn__flex-1` | `flex: 1` |
| `fn__flex-column` | `display: flex; flex-direction: column` |
| `fn__flex-shrink` | `flex-shrink: 0` |
| `fn__flex-wrap` | `flex-wrap: wrap` |
| `fn__flex-center` | `align-self: center` |
| `fn__block` | `width: 100%` |
| `fn__none` | `display: none !important` |
| `fn__space` | 8px 间距 |
| `fn__space--small` | 4px 间距 |
| `fn__hr` | 8px 垂直间距 |
| `fn__hr--small` | 4px 垂直间距 |

### 文字（ft-*）

| 类名 | 效果 |
|------|------|
| `ft__on-background` | 主题 on-background 色 |
| `ft__on-surface` | 主题 on-surface 色 |
| `ft__primary` | 主题 primary 色 |
| `ft__error` | 错误色 |
| `ft__smaller` | 12px 字号 |
| `ft__center` | 居中对齐 |
| `fn__a` | 主题色链接样式 |
| `fn__ellipsis` | 单行文本截断 |
| `fn__code` | 行内代码样式 |
| `fn__kbd` | 键盘按键样式 |

## 关键 CSS 变量

| 变量 | 用途 |
|------|------|
| `--b3-theme-primary` / `--light` / `--lighter` / `--lightest` | 主色系 |
| `--b3-theme-secondary` | 辅助色 |
| `--b3-theme-background` / `--light` | 背景色 |
| `--b3-theme-surface` / `--light` / `--lighter` | 表面色 |
| `--b3-theme-on-primary` / `--on-background` / `--on-surface` | 前景色 |
| `--b3-border-color` | 边框色 |
| `--b3-border-radius` (6px) / `--s` (3px) / `--b` (12px) | 圆角 |
| `--b3-dialog-shadow` / `--b3-button-shadow` | 阴影 |
| `--b3-list-hover` / `--b3-list-icon-hover` | 列表悬停色 |
| `--b3-card-error-color` / `--background` | 错误语义色 |
| `--b3-card-warning-color` / `--background` | 警告语义色 |
| `--b3-card-info-color` / `--background` | 信息语义色 |
| `--b3-card-success-color` / `--background` | 成功语义色 |
| `--b3-font-color1`~`--b3-font-color13` | 数据库标签色（文字） |
| `--b3-font-background1`~`--b3-font-background13` | 数据库标签色（背景） |
| `--b3-switch-*` | 开关组件色 |

## 本项目已使用的内置组件

| 组件 | 用途 | 所在文件 |
|------|------|---------|
| `b3-select` | 筛选栏/详情面板下拉框 | FilterBar.svelte, TaskDetail.svelte |
| `b3-text-field` | 日期/文本输入框 | TaskDetail.svelte |
| `b3-chips` + `b3-chip--middle` + `b3-chip__close` | 上下文多选标签 | TaskDetail.svelte |
| `b3-chip--middle` + `b3-chip__close` | 父任务标签 | TaskDetail.svelte |
| `b3-button--icon` | 关闭按钮 | TaskDetail.svelte |
| `b3-button--remove --small` | 移除任务按钮 | TaskDetail.svelte |
| `b3-list-item--narrow` | 下拉搜索选项 | TaskDetail.svelte |
| `fn__a` | 跳转链接 | TaskDetail.svelte |
| `fn__ellipsis` | 文本截断 | TaskDetail.svelte |
