# Git 提交与 Pull Request 规范

## Commit message 规范

除自动生成的合并提交和版本发布提交外，所有新提交必须使用英文 Conventional Commits 标题和结构化正文。Commit message 应让未查看 diff 的维护者也能理解提交目的、主要行为变化、影响范围和验证情况；禁止仅使用一行笼统 message。

### 标题

- 格式为 `<type>(<scope>): <imperative summary>`；没有明确 scope 时使用 `<type>: <imperative summary>`。
- 破坏性变更在 type 或 scope 后添加 `!`，例如 `feat(api)!: remove legacy fields`。
- `type` 按改动的主要意图选择：
  - `feat`：新增用户可见能力或对外行为。
  - `fix`：修复缺陷、回归或错误行为。
  - `refactor`：不改变预期外部行为的内部重构。
  - `perf`：以性能改善为主要目的。
  - `docs`：仅文档、许可或说明材料。
  - `test`：仅测试或测试基础设施。
  - `build`：构建系统、依赖或打包流程。
  - `ci`：持续集成、发布工作流或自动化。
  - `chore`：无法归入以上类别的维护工作。
- `scope` 使用简短、稳定、可复用的模块或领域名，如 `ui`、`mcp`、`kernel`、`settings`、`release`；不要使用临时任务名、文件名或 issue 编号作为 scope。
- summary 使用英文现在时或祈使语气，直接描述主要结果；首字母小写，不加句号，避免 `update stuff`、`misc fixes`、`changes` 等模糊措辞。
- 一个提交只表达一个主要意图；如果标题需要使用 `and` 连接无关行为，应先考虑拆分提交。

### 正文

- 标题后空一行，再使用 `- ` 开头的英文 bullet；除固定版本提交外，正文至少包含一个顶层 bullet。
- 正文优先描述“为什么”和“产生了什么行为变化”，再说明重要实现方式；不要按文件路径机械罗列 diff。
- 根据实际改动选择覆盖以下内容，不要求无关项强行出现：
  - 用户可见结果、缺陷根因或业务动机。
  - 主要子系统、数据流、协议、存储或 UI 行为变化。
  - 向后兼容、迁移、回滚、安全、性能或错误处理影响。
  - 新增或调整的测试、文档、构建、发布和部署验证。
- 简单且单一的改动可使用 1–2 个顶层 bullet；复杂改动使用 2–5 个顶层 bullet。
- 一个顶层主题包含多项具体变化时，使用两个空格缩进的嵌套 bullet；嵌套层级通常不超过一层。
- 只陈述实际完成的内容。未运行的测试、未验证的兼容性和未执行的部署不得写成已完成。
- 避免重复标题、记录无关探索过程、粘贴终端输出或描述显而易见的语法改动。

### Footer 与特殊提交

- 破坏性变更除标题中的 `!` 外，必须在正文后空一行添加 `BREAKING CHANGE: <migration or impact>`。
- 关联 issue 时在正文后空一行使用标准 footer，如 `Refs: #123`、`Closes: #123`；只有确实解决 issue 时才使用 `Closes`。
- `Co-authored-by`、`Signed-off-by` 等 trailer 放在 message 最后，并与正文空一行。
- 版本提交保持固定格式 `chore: release vX.Y.Z`，不强制添加正文。
- Revert 提交使用 `revert: <original summary>`，正文说明被回退的提交及原因。
- 不手工改写 Git 自动生成的 merge commit message，除非用户明确要求。

### 提交前检查

- 创建 message 前检查 `git diff --cached` 和暂存文件列表，确保 message 只描述实际暂存内容。
- 确认 type、scope、标题和正文与主要意图一致，并说明重要兼容性与验证结果。
- 确认没有把生成物、个人路径、凭据或无关改动混入提交。

标准模板：

```text
<type>(<scope>): <imperative summary>

- <Primary outcome, motivation, or defect addressed>
- <Important implementation or affected subsystem>:
  - <Specific behavior, data-flow, protocol, or UI change>
  - <Compatibility, migration, rollback, security, or performance detail>
- <Tests, documentation, build, release, or deployment work actually completed>
```

简单改动模板：

```text
<type>(<scope>): <imperative summary>

- <Outcome and reason>
- <Verification actually completed>
```

破坏性变更模板：

```text
<type>(<scope>)!: <imperative summary>

- <Primary outcome and reason for the incompatible change>
- <New behavior and migration path>
- <Verification actually completed>

BREAKING CHANGE: <Describe affected users or integrations and required migration>
```

## Pull Request 规范

保持一次提交聚焦一个行为。PR 应说明动机、实现影响和验证命令，关联相关 issue；UI 变更附前后截图，数据属性、RPC 或设置变更说明兼容性或迁移影响，并确认双语文案已同步。
