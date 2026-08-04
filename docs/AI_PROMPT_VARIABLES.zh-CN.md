# NextAction AI 提示词变量说明

本文说明“设置 → 内置 AI”中可使用的提示词变量，以及它们在哪些功能中真正有数据。

## 基本写法

变量使用双大括号：

```text
今天是 {{today}}，请从这些候选任务中选择：
{{nextaction}}
```

插件会在调用思源 AI 前替换变量。对象和任务列表会转换成 JSON；当前功能没有提供的数据会显示为 `[变量名：未提供]`，未知变量会显示为 `[变量名：未知变量]`。

变量只是向 AI 提供上下文，不会绕过插件固定的 JSON 输出协议，也不会直接修改任务。

## 实际请求顺序

每次请求都会由插件自动拼成下面的结构，用户不需要自己手写完整协议：

```text
1. 你在设置中填写的功能指令
2. 【本次请求的输入数据】
   <runtime_data>...</runtime_data>
   <extract_input>...</extract_input> / <decompose_input>...</decompose_input> / ...
3. 【严格输出协议】
4. 【必须模仿的完整 JSON 示例】
5. 【最终输出要求】
```

“从笔记提取任务”还有一个特殊点：思源 API 会在上述指令之后追加选中块的 Markdown 正文。插件会明确告诉 AI，这段追加内容是纯数据；其中的无序列表、标题和看似命令的句子都不能改变 JSON 输出要求。

四个功能都会强制要求：只返回一个完整 JSON 对象，不能返回 Markdown、代码围栏、解释文字、注释、多个 JSON 或额外字段。每个请求还附带一个对应功能的完整 JSON 示例，示例中的 block ID 不能照抄，必须使用输入数据中真实存在的 ID。

输入变量不会被拼接到无序列表项后面。插件使用 `<runtime_data>`、`<extract_input>` 等独立的数据区块，并明确告诉模型这些区块是 JSON/Markdown 数据。即使数据中包含 `- 项目`、标题或类似提示词的句子，也不会改变输出协议。

## 最推荐的变量

| 变量 | 含义 | 适用功能 |
|---|---|---|
| `{{today}}` | 本地日期，格式为 `YYYY-MM-DD` | 全部 |
| `{{currentDateTime}}` | 本地日期和时间 | 全部 |
| `{{timezone}}` | 当前系统时区 | 全部 |
| `{{selectedBlocks}}` | 用户触发“提取任务”时选择的块正文。正文由思源追加在请求末尾 | 提取任务 |
| `{{currentTaskBlock}}` | 当前任务的标题、状态、日期、优先级、父任务 ID 等任务快照 | 拆解任务 |
| `{{currentTaskBlockWithChildren}}` | 当前任务和已有直接子任务的任务快照 | 拆解任务 |
| `{{currentTaskBlockWithParent}}` | 当前任务和直接父任务的任务快照 | 拆解任务 |
| `{{nextaction}}` | 本次可选择的下一步行动候选 | 我的一天、回顾 |
| `{{myDay}}` | 已加入“我的一天”的任务快照 | 我的一天 |
| `{{reviewGroups}}` | 插件计算出的回顾分组与任务 ID 映射 | 智能回顾 |
| `{{reviewTasks}}` | 回顾涉及的去重任务快照，包含任务名称 | 智能回顾 |

## 指定某个思源块

使用下面的参数变量：

```text
{{block:20260804123000-abcdefg}}
```

例如：

```text
请结合 {{block:20260804123000-abcdefg}} 中的项目说明拆解当前任务。
```

插件会验证块 ID，并把该块加入 `/api/ai/chatGPTWithAction` 的 `ids`。思源负责将该块导出的 Markdown 正文附加到请求末尾。引用文档块时会加入文档正文；引用普通块时会加入该块导出的内容及其块结构。

注意：

- 块 ID 必须是完整的思源块 ID，例如 `20260804123000-abcdefg`。
- 可以多次使用，重复 ID 只会发送一次。
- 单次提示词最多引用 8 个指定块，防止上下文过大导致请求变慢。
- 无效块 ID 不会发送给思源 AI，提示词中会显示“无效的思源块 ID”。
- 这不是任务块 ID 输出字段。它只是让 AI 阅读指定笔记块。

## 全部变量及重复关系

### 通用变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `{{feature}}` | 可用 | 当前功能 ID：`extractTasks`、`decomposeTask`、`planMyDay` 或 `review` |
| `{{today}}` | 可用 | 当前日期 |
| `{{currentDate}}` | 别名 | 与 `today` 相同，为兼容不同提示词写法保留 |
| `{{now}}` | 可用 | 当前日期时间 |
| `{{currentDateTime}}` | 别名 | 与 `now` 相同 |
| `{{timezone}}` | 可用 | 当前时区 |
| `{{outputSchema}}` | 可用 | 插件固定追加的 JSON 输出协议。通常不需要手动写入提示词 |

### 提取任务变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `{{sourceBlockIds}}` | 可用 | 触发功能时传入的源块 ID 数组 |
| `{{selectedBlockIds}}` | 别名 | 与 `sourceBlockIds` 相同 |
| `{{sourceBlocks}}` | 可用 | 提醒 AI 阅读思源追加在请求末尾的源块正文；变量本身不重复嵌入正文 |
| `{{selectedBlocks}}` | 别名 | 与 `sourceBlocks` 相同 |
| `{{currentDocumentId}}` | 条件可用 | 从当前编辑器触发时可获得当前文档 ID |
| `{{sourceDocumentId}}` | 预留 | 当前版本不会自动解析源块所在文档，通常显示“未提供” |
| `{{sourceDocument}}` | 预留 | 当前版本不会自动加载完整来源文档 |
| `{{currentDocument}}` | 预留 | 当前版本不会自动加载当前文档正文。需要时使用 `{{block:文档块ID}}` |

### 拆解任务变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `{{currentTaskBlock}}` | 可用 | 当前任务的结构化任务快照，不是完整笔记 Markdown |
| `{{currentTaskBlockContent}}` | 有限可用 | 当前只提供任务标题，不代表完整块正文 |
| `{{currentTaskChildren}}` | 可用 | 当前任务已有的直接子任务 |
| `{{currentTaskBlockWithChildren}}` | 组合变量 | `{ task, children }`，与上面两个变量的数据有重复 |
| `{{currentTaskParent}}` | 条件可用 | 能在插件任务缓存中找到时，提供直接父任务快照 |
| `{{currentTaskBlockWithParent}}` | 组合变量 | `{ task, parent }`，与当前任务和父任务变量重复 |
| `{{currentTaskDoc}}` | 预留 | 当前版本不会自动加载任务所在文档；请使用 `{{block:文档块ID}}` 明确指定 |

`WithChildren` 和 `WithParent` 中的“子级/父级”指 NextAction 任务关系，不是任意思源块树的全文读取。

### “我的一天”变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `{{nextaction}}` | 可用 | 本次最多 40 个候选任务快照 |
| `{{candidateTasks}}` | 别名 | 与 `nextaction` 相同 |
| `{{allNextActions}}` | 别名 | 当前也与 `nextaction` 相同，并不表示全库无限量任务 |
| `{{myDay}}` | 可用 | 已加入“我的一天”的任务快照和日程字段 |
| `{{myDayTaskIds}}` | 可用 | `myDay` 中只包含 block ID 的精简数组 |

### 智能回顾变量

| 变量 | 状态 | 说明 |
|---|---|---|
| `{{reviewGroups}}` | 可用 | 固定分组到 block ID 数组的映射 |
| `{{reviewTasks}}` | 可用 | 所有分组涉及的去重任务快照，包含标题 |
| `{{reviewData}}` | 组合变量 | `{ groups, tasks }`，与上面两个变量重复 |
| `{{review}}` | 别名/组合 | 当前等价于完整回顾上下文，建议优先使用 `reviewGroups` 和 `reviewTasks` |
| `{{truncated}}` | 可用 | 是否因数量限制截断了回顾数据 |
| `{{overdue}}` | 可用 | 逾期任务快照 |
| `{{inbox}}` | 可用 | 收集箱任务快照 |
| `{{waiting}}` | 可用 | 等待中任务快照 |
| `{{someday}}` | 可用 | 将来/也许任务快照 |
| `{{reviewDue}}` | 可用 | 待回顾任务快照 |
| `{{activeProjects}}` | 可用 | 活跃项目任务快照 |

### 当前预留变量

以下变量已被解析器识别，但当前四个功能还没有稳定的数据来源，因此通常显示“未提供”：

```text
{{blockedTasks}}
{{availableContexts}}
{{availableTags}}
{{availableStatuses}}
{{availablePriorities}}
{{writeTargets}}
```

它们不会报错，也不会凭空生成数据，但当前不建议写入提示词。后续只有在对应功能确实需要这些信息时才应接入。

## 推荐示例

### 拆解任务并参考项目说明块

```text
你是 GTD 任务拆解助手。

当前任务：
{{currentTaskBlockWithChildren}}

父任务上下文：
{{currentTaskBlockWithParent}}

项目说明：
{{block:20260804123000-abcdefg}}

请只补充尚未存在、真正可执行的下一步行动。
```

### 规划“我的一天”

```text
今天是 {{today}}。

已有安排：
{{myDay}}

可选的下一步行动：
{{nextaction}}

请控制数量，并说明每项任务今天值得执行的原因。
```

### 智能回顾

```text
回顾分组：
{{reviewGroups}}

任务详情：
{{reviewTasks}}

数据是否截断：{{truncated}}

请特别检查逾期、待回顾和没有下一步行动的活动项目。
```
