# 标签页视图重设计

> 日期：2026-07-05
> 范围：将任务面板从侧边栏 Dock 迁移到自定义标签页，并重新设计为双栏布局

## 背景

当前任务面板以 `addDock` 注册在侧边栏，宽度受限（约 300px），交互空间局促。用户要求将面板迁移到独立标签页，获得更充裕的展示空间，同时重新设计 UI 使其更现代美观。

## 设计决策

1. **移除侧边栏 Dock，改用顶部栏按钮 + 自定义标签页** — `addTopBar` 注册按钮，`addTab` + `openTab({ custom })` 打开标签页
2. **主从双栏布局** — 左栏任务列表（占 60%），右栏选中任务的详情面板（占 40%，最大 480px），点击任务时右栏滑入展开，取消选中时滑出收起
3. **左侧竖向导航栏（NavRail）** — 48px 宽，图标+文字标签，替代原顶部 Tab，更现代且节省垂直空间
4. **详情面板替代弹窗编辑** — TaskEditPopup 的功能迁移到右栏 TaskDetail，防抖保存逻辑保留

## 架构变更

### 入口注册（src/index.ts）

```typescript
// 移除 addDock 调用

// onload 中注册 addTab
const TAB_TYPE = "nextaction_tab";
this.addTab({
    type: TAB_TYPE,
    init: (tab: any) => {
        const container = tab.element;
        container.classList.add("fn__flex");
        import("./frontend/components/NextActionApp.svelte").then(({ default: NextActionApp }) => {
            new NextActionApp({
                target: container,
                props: { bridge: this.bridge, i18n: this.i18n, tab },
            });
        });
    },
    destroy: (tab: any) => {
        // Svelte 组件 $destroy
    },
});

// addTopBar 注册按钮
this.addTopBar({
    icon: "iconNextAction",
    title: this.i18n.taskPanel,
    callback: () => {
        openTab({
            app: this.app,
            custom: {
                id: this.name + TAB_TYPE,
                icon: "iconNextAction",
                title: this.i18n.pluginName || "NextAction",
            },
        });
    },
});
```

### addTab init 回调中 tab 对象

`tab.element`：标签页内容的 HTMLElement，作为 Svelte 组件的挂载目标。
`tab.id`：标签页实例 ID，用于管理组件生命周期。

### 组件树

```
NextActionApp.svelte（标签页根组件）
├── NavRail.svelte（左侧竖向导航栏，48px）
├── TaskListPane.svelte（中栏任务列表）
│    ├── FilterBar.svelte（搜索 + 筛选）
│    ├── NextActionView / AllTasksView / ProjectView（复用现有视图组件）
│    └── 底部统计信息
└── DetailPane.svelte（右栏详情面板，选中时展开）
     └── TaskDetail.svelte（替代 TaskEditPopup，内嵌编辑）
```

### 废弃组件

- `TaskPanel.svelte` — 被 NextActionApp 替代
- `TaskEditPopup.svelte` — 逻辑迁移到 TaskDetail（弹窗改为内嵌面板）

## 组件详细设计

### NavRail.svelte

- 宽度 48px，flex-direction: column
- 三个导航项：下一步行动（⚡）、全部任务（📋）、按项目（📁）
- 每项：18px 图标 + 9px 文字标签，垂直居中排列
- 选中态：左侧 3px 主色调竖条 + 图标/文字变为主色调
- 底部：重算优先级按钮（↻）
- Props：`{ activeView, onSwitchView, onRecalc, i18n }`

### TaskListPane.svelte

- flex:1 自适应宽度
- 顶部 FilterBar：搜索框 + 上下文/优先级筛选下拉
- 主体复用现有 NextActionView / AllTasksView / ProjectView
- TaskCard 增加选中态：主色调左边框 + 浅色背景高亮
- 点击任务触发 `onSelectTask(task)` 回调
- 点击已选中任务触发 `onDeselectTask()` 关闭详情

### DetailPane.svelte

- CSS transition: `width 200ms ease`
- 收起时 width:0，展开时 width:420px（最大 480px）
- 内部 `.detail-pane__inner` 固定宽度，防止内容重排抖动
- Props：`{ task, onClose }`

### TaskDetail.svelte

替代 TaskEditPopup，改为内嵌面板布局：

- **头部**：状态复选框 + 标题（可编辑 input，18px 大字）+ 关闭按钮
- **头部元数据行**：优先级文字 · ⭐重要性 📊工作量
- **字段区**：两列网格（label 80px + value 自适应）
  - 状态、优先级：下拉选择
  - 重要性、工作量：7 圆点可点击
  - 截止日期、开始日期：日期选择器
  - 上下文：文本输入
  - 父任务：搜索选择（保留现有逻辑）
- **底部**：跳转到块链接 + 移除任务按钮
- **防抖保存**：500ms 防抖，与 TaskEditPopup 逻辑一致
- Props：`{ task, bridge, i18n, onSave, onRemove }`

## 交互流程

1. 用户点击顶部栏图标 → `openTab` 打开标签页 → `addTab.init` 挂载 NextActionApp
2. 默认显示"下一步行动"视图，右栏收起
3. 点击任务卡片 → 卡片高亮 + 右栏滑入展开 → 显示 TaskDetail
4. 修改字段 → 500ms 防抖 → 调用 `updateTask` → `applyUpdate` 更新 store
5. 点击已选中卡片或 Esc 或点关闭按钮 → 右栏滑出 → 取消高亮
6. 点击导航栏切换视图 → 右栏自动收起

## 样式要点

- NavRail 背景 `var(--b3-theme-surface)`，与中栏用 1px `var(--b3-border-color)` 分隔
- DetailPane 背景 `var(--b3-theme-surface)`，与中栏用 1px 分隔线
- TaskCard 选中态：`border-left-color: var(--b3-theme-primary)` + `background: rgba(53,131,235,0.08)`
- DetailPane 展开/收起动画：`transition: width 200ms ease`
- 所有颜色继续使用思源主题变量（`--b3-*`），适配亮暗主题

## 不在范围内

- 移动端适配（标签页 API 在移动端行为不同，后续单独处理）
- 侧边栏 Dock 保留（本次移除，后续按需重新添加不同内容）
- 数据层变更（store、kernel-bridge、kernel 全部复用）
- 编辑器内状态图标（::before 伪元素）不变
