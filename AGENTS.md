# Repository Guidelines

## 项目结构与模块组织

`src/frontend/` 包含 Svelte 组件、`Na*` 通用 UI、stores 与 RPC 桥接；`src/kernel/` 负责缓存、任务写入、同步、重复规则和 MCP；跨端类型、常量与设置放在 `src/shared/`。翻译位于 `src/i18n/`，测试位于 `tests/*.test.ts`，发布脚本位于 `scripts/`，详细架构说明位于 `docs/`。`dist/`、`dev/`、根目录 `kernel.js` 和 `package.zip` 均为生成物，不要手工修改或提交。

## 双 Bundle 架构

- **前端 Bundle**：入口 `src/index.ts`，由 Vite 构建为 CJS；开发输出到 `dev/index.js`，生产输出到 `dist/index.js`。运行在浏览器上下文，负责 Svelte UI、DOM 和 `KernelBridge`。
- **内核 Bundle**：入口 `src/kernel.ts`，由 Webpack 构建为 ESM；开发输出根目录 `kernel.js`，生产输出 `dist/kernel.js`。运行在思源内核进程，负责 SiYuan API、缓存和业务写入。
- 两端通过 `kernel.rpc` 通信。前端不得直接写思源数据；所有写入必须经过 `TaskService` 并由 `Mutex` 串行化。新增 RPC 时同步修改 `src/kernel/rpc-server.ts`、`src/frontend/kernel-bridge.ts` 和共享类型。RPC 错误返回 `{ _rpcError: { code, message } }`；写操作先登记变更，再广播通知。任务属性统一使用 `src/shared/constants.ts` 中的 `custom-na-*` 常量。

## 构建、测试与本地开发

- `pnpm install --frozen-lockfile`：按锁文件安装依赖（CI 使用 Node 22）。
- `pnpm test`：运行 Node 内置测试运行器下的全部测试。
- `pnpm run dev`：并行构建开发版内核和前端；本地复制路径依赖 `scripts/` 中的工作区配置。
- `pnpm run build`：生成生产 bundle，提交前至少执行一次。
- `pnpm run check:theme`：检查主题适配；修改 Svelte 或 SCSS 时执行。
- `pnpm run release:package`：构建并生成发布用 `package.zip`，仅用于发布验证。
- `pnpm run release`：构建并部署到本机思源插件目录。凡改动需要用户在思源中人工验证，交付验证前必须运行此命令并确认部署成功。

## 编码风格与命名

TypeScript 开启 `strict`。沿用现有格式：4 空格缩进、双引号、分号和尾随逗号；仓库未配置独立 formatter/linter，请保持相邻代码风格。Svelte 组件、类和类型使用 `PascalCase`，函数与变量使用 `camelCase`，工具文件使用 `kebab-case.ts`。CSS 采用 `.na-` 前缀的 BEM 命名，并优先使用 `--b3-*`、`--na-*` 主题变量。共享契约放入 `src/shared/`，避免前端直接依赖内核实现。

## 前端组件复用

实现或调整界面前，必须先检查 `src/frontend/ui/` 中的 `Na*` 公共组件，以及 `tokens.scss`、`primitives.scss` 中的设计令牌和基础样式。已有组件能满足需求时直接复用，不得在业务组件中重复实现同类控件或样式。没有合适组件时，优先扩展现有组件的通用能力；无法合理扩展时，在 `src/frontend/ui/` 新建 `Na*.svelte` 公共组件，再由业务组件使用。公共组件应提供清晰的 props/events，覆盖 disabled、loading、empty、键盘操作等适用状态，并保持主题、响应式和无障碍行为一致。修改公共组件后检查现有调用方，避免引入跨视图回归。

## 国际化

界面文案通过插件的 `this.i18n` 或组件注入的 `i18n` 获取。新增或修改 key 时，必须同时更新 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`，并保持键集合一致；不要新增仅支持一种语言的可见文案。Vite 会将两份资源复制到构建目录，发布包也要求二者同时存在。

## 测试规范

使用 `node:test` 与 `node:assert/strict`，文件命名为 `<feature>.test.ts`。优先覆盖纯逻辑和用户可见回归；需要保护组件或 RPC 接线时，可沿用现有源码断言测试。项目暂无覆盖率阈值，但每个修复应附能复现旧行为并验证新行为的测试。提交前运行 `pnpm test && pnpm run build`；需要人工验收时，随后必须运行 `pnpm run release`，并在交付说明中告知用户已部署、可以开始验证。

## 提交与 Pull Request

### Commit message 规范

除自动生成的合并提交和版本发布提交外，所有新提交必须使用英文 Conventional Commits 标题和结构化正文。Commit message 应让未查看 diff 的维护者也能理解提交目的、主要行为变化、影响范围和验证情况；禁止仅使用一行笼统 message。

#### 标题

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

#### 正文

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

#### Footer 与特殊提交

- 破坏性变更除标题中的 `!` 外，必须在正文后空一行添加 `BREAKING CHANGE: <migration or impact>`。
- 关联 issue 时在正文后空一行使用标准 footer，如 `Refs: #123`、`Closes: #123`；只有确实解决 issue 时才使用 `Closes`。
- `Co-authored-by`、`Signed-off-by` 等 trailer 放在 message 最后，并与正文空一行。
- 版本提交保持固定格式 `chore: release vX.Y.Z`，不强制添加正文。
- Revert 提交使用 `revert: <original summary>`，正文说明被回退的提交及原因。
- 不手工改写 Git 自动生成的 merge commit message，除非用户明确要求。

#### 提交前检查

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

保持一次提交聚焦一个行为。PR 应说明动机、实现影响和验证命令，关联相关 issue；UI 变更附前后截图，数据属性、RPC 或设置变更说明兼容性/迁移影响，并确认双语文案已同步。

## Vendor 参考项目

`vendor/` 不参与构建，仅用于查证和借鉴。后端 API 优先查阅 `vendor/siyuan/docs/API.zh-CN.md`，需要确认底层行为时再查看思源源码；前端插件 API 和类型查阅 `vendor/petal/siyuan.d.ts`、`vendor/petal/kernel.d.ts`。`vendor/plugin-sample*` 用于参考插件生命周期和构建方式；`siyuan-plugin-task-note-management`、`orca-plugin-task-planner`、`tasknotes`、`siyuan-plugin-task-horizon` 仅用于任务模型与交互研究，不得直接当作本项目依赖或照搬实现。

## 本地配置与安全

属性 SQL 索引可能异步刷新，写入后的权威状态应通过 `getBlockAttrs` 获取。`scripts/deploy.js` 的思源工作区路径为本机配置；运行部署或发布命令前先确认目标，禁止提交个人路径、令牌或工作区数据。

## Agent 工作流

根目录存在 `.codegraph/`。定位符号、调用链或影响范围时，先运行 `codegraph explore "问题或符号"`，再按需使用 `rg` 和直接读取文件。不要覆盖用户已有的未提交改动。

涉及大范围前端界面的新增或改动时，完成构建并通过 `pnpm run release` 部署后，必须打开浏览器访问 `http://127.0.0.1:6806` 进行实际样式与交互验收。验收前先重载插件或页面以加载最新 Bundle，再关闭所有已打开的任务管理面板并重新打开，避免旧组件实例和缓存状态影响结果；发现布局、主题、响应式或交互问题后应修正并重复上述流程。
