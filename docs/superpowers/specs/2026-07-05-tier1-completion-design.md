# Tier 1 补全设计：父子任务识别、手动设置父任务、状态图标

> 日期：2026-07-05
> 范围：Tier 1 MVP 剩余功能补全

## 背景

四个功能需要实现：
1. 列表项格式下父子任务识别不正确
2. 缺少手动设置父子任务的入口
3. 任务面板中缺少状态图标和快速切换
4. 编辑器中缺少任务块的状态视觉指示

## 思源列表项块结构

```
文档 (type="d")
  └─ NodeList (type="l")
       └─ 列表项A (type="i")
            ├─ 段落A (type="p") ← na-task="1"
            └─ NodeList (type="l")
                 └─ 列表项B (type="i")
                      └─ 段落B (type="p") ← na-task="1"
```

关键点：
- `na-task` 属性挂在段落块(type="p")上，不是列表项(type="i")上
- 列表项之间有 NodeList(type="l") 容器中间层
- 段落B的 parent_id 链：段落B → 列表项B → NodeList → 列表项A → NodeList(外) → 文档
- 列表项A本身没有 na-task，其子段落A才有

## 功能 1：列表项父子任务识别

### findAncestorTask 修复

当前逻辑沿 parent_id 向上走，只检查每个祖先块本身有没有 na-task。列表项块没有 na-task，所以永远找不到。

修复：当遇到 type="i" 的列表项时，查询其下的 type="p" 子段落是否是任务：

```
while 向上走 parent_id:
  if 当前块有 na-task → return 当前块
  if 当前块 type === "i":
    paragraphs = SQL("SELECT id FROM blocks WHERE parent_id = ? AND type = 'p'", 当前块.id)
    for p of paragraphs:
      attrs = getBlockAttrs(p.id)
      if attrs 有 na-task → return p.id
```

这保证：段落B → 列表项B(跳过) → NodeList(跳过) → 列表项A → 发现段落A有na-task → 返回段落A

### updateDescendantParents 修复

当前使用 getChildBlocks API，但该 API 在内核插件中可能不可用。改用 SQL 递归查询：

```
// 从当前块的列表项开始，找所有子孙段落块
1. 找到当前段落所属的列表项（向上走 parent_id 到 type="i"）
2. 查该列表项下所有 NodeList 子块
3. 查 NodeList 下的列表项
4. 查列表项下的段落块
5. 检查段落块是否有 na-task，如果有则更新其 na-parent
```

用一条 SQL 实现两层查找：

```sql
SELECT p.id, p.content
FROM blocks p
WHERE p.type = 'p'
  AND p.id IN (
    SELECT p2.id FROM blocks p2
    WHERE p2.type = 'p' AND p2.parent_id IN (
      SELECT li.id FROM blocks li
      WHERE li.type = 'i' AND li.parent_id IN (
        SELECT nl.id FROM blocks nl
        WHERE nl.type = 'l' AND nl.parent_id = ?
      )
    )
  )
  AND EXISTS (
    SELECT 1 FROM attributes a
    WHERE a.block_id = p.id AND a.name = 'custom-na-task' AND a.value IS NOT NULL AND a.value != ''
  )
```

其中 ? 是当前段落所属的列表项ID。这条SQL找到该列表项下嵌套一层 NodeList→列表项→段落 中有 na-task 的段落块。

### convertToTask 中自动查找所属列表项

当 convertToTask 被调用时，blockId 是段落块。需要先找到它所属的列表项，然后从列表项开始查找祖先任务。

## 功能 2：编辑弹窗中添加"父任务"字段

### UI 设计

在 TaskEditPopup.svelte 中，在"上下文"字段之后添加"父任务"字段：

- 文本输入框，placeholder："搜索父任务标题..."
- 输入时防抖 300ms，调用 bridge.getAllTasks() 搜索匹配标题的任务
- 下拉显示匹配结果（最多 10 条），每项显示标题和面包屑
- 选中后设置 na-parent 属性
- 已有父任务时显示当前父任务标题，带清除按钮（x）
- 清除后设 na-parent 为空字符串

### 数据流

- 选择父任务 → 调用 bridge.updateTask(blockId, { "na-parent": selectedBlockId })
- 清除父任务 → 调用 bridge.updateTask(blockId, { "na-parent": "" })
- 保存走现有防抖逻辑

## 功能 3：任务面板状态图标

### StatusCheckbox 组件

替换 PriorityDot，新建 StatusCheckbox.svelte：

- 14x14 圆角方框，根据 status 显示不同样式：
  - todo：空心方框，border #aaa
  - doing：半填充方框，border + 50% 蓝色填充
  - waiting：空心方框，border 蓝色
  - done：绿色填充 + 白色 ✓
- 点击触发 onStatusClick 回调

### TaskCard 布局调整

```
[状态复选框] 任务标题
             [优先级圆点] 📅截止日期 @上下文 ⭐重要性 📊工作量
```

- 第一行：状态复选框 + 标题
- 第二行：优先级圆点 + 元数据（缩进对齐到标题位置）

### 状态选择弹出框

点击状态复选框后，使用思源 Menu 组件弹出四个状态选项（与右键菜单中的状态项一致）。选中后调用 updateTask 更新状态。

## 功能 4：编辑器中任务块状态图标

### CSS 实现

为编辑器中有 custom-na-task 属性的块添加 ::before 伪元素：

```scss
.protyle-wysiwyg [data-node-id][custom-na-task]::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1.5px solid var(--b3-theme-on-surface-secondary);
  vertical-align: middle;
  margin-right: 4px;
  cursor: pointer;
}

// 各状态样式
.protyle-wysiwyg [data-node-id][custom-na-status="todo"]::before { border-color: var(--b3-theme-on-surface-secondary); }
.protyle-wysiwyg [data-node-id][custom-na-status="doing"]::before { border-color: #3498db; background: linear-gradient(135deg, #3498db 50%, transparent 50%); }
.protyle-wysiwyg [data-node-id][custom-na-status="waiting"]::before { border-color: #5dade2; }
.protyle-wysiwyg [data-node-id][custom-na-status="done"]::before { background: #27ae60; border-color: #27ae60; }
```

### JS 全局点击监听

在插件 onload 中注册 document 级别的 click 监听（capturing 阶段）：

1. 检测点击目标是否在 `[data-node-id][custom-na-task]` 块的 `::before` 区域
2. 通过 getBoundingClientRect 和点击坐标判断是否落在 ::before 区域（左侧 padding + 14px 宽度内）
3. 如果命中，读取 data-node-id 和 custom-na-status 属性
4. 弹出思源 Menu 组件显示四个状态选项
5. 选择后调用 bridge.updateTask 更新状态

### 属性变化后刷新

updateTask 成功后，SiYuan 会更新 DOM 上的 custom-* 属性，CSS ::before 样式自动更新。无需额外刷新逻辑。

### 已完成任务样式

done 状态的任务块文字加 line-through 和降低 opacity：

```scss
.protyle-wysiwyg [data-node-id][custom-na-status="done"] {
  opacity: 0.55;
  text-decoration: line-through;
}
```

## 不在范围内

- ProjectView 递归层级（后续再做）
- 编辑器中优先级颜色指示（仅状态图标）
- 拖拽设置父子任务
