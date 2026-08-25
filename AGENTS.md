# Repository Guidelines

## 项目结构与模块组织

`src/frontend/` 包含 Svelte 组件、`Na*` 通用 UI、stores 与 RPC 桥接；`src/kernel/` 负责缓存、任务写入、同步、重复规则和 MCP；跨端类型、常量与设置放在 `src/shared/`。翻译位于 `src/i18n/`，测试位于 `tests/*.test.ts`，发布脚本位于 `scripts/`。`docs/` 只存放仓库必需的按需规范，本地归档资料放在被忽略的 `.doc/`。`dist/`、`dev/`、根目录 `kernel.js` 和 `package.zip` 均为生成物，不要手工修改或提交。

## 双 Bundle 架构

- **前端 Bundle**：入口 `src/index.ts`，由 Vite 构建为 CJS；开发输出到 `dev/index.js`，生产输出到 `dist/index.js`。运行在浏览器上下文，负责 Svelte UI、DOM 和 `KernelBridge`。
- **内核 Bundle**：入口 `src/kernel.ts`，由 Webpack 构建为 ESM；开发输出根目录 `kernel.js`，生产输出 `dist/kernel.js`。运行在思源内核进程，负责 SiYuan API、缓存和业务写入。
- 两端通过 `kernel.rpc` 通信。前端不得直接写思源数据；交互写入必须通过内核 RPC 或 capability 进入 `TaskService` 或对应领域服务。任务属性写入由 `TaskRepository` 使用共享 `Mutex` 串行化，并在权威回读、缓存和登记变更后广播；My Day 等独立状态由对应管理器保护。新增 RPC 时同步修改 `src/shared/rpc-methods.ts`、`src/kernel/rpc-server.ts` 和 `src/frontend/kernel-bridge.ts`。RPC 错误返回 `{ _rpcError: { code, message } }`。任务属性统一使用 `src/shared/constants.ts` 中的 `custom-na-*` 常量。

## 构建、测试与部署

- `pnpm install --frozen-lockfile`：按锁文件安装依赖（CI 使用 Node 22）。
- `pnpm test`：运行 Node 内置测试运行器下的全部测试。
- `pnpm run check`：运行测试、类型、Svelte、ESLint、Prettier、架构、主题、生产构建和空白检查；提交或交付前必须通过。
- `pnpm run build`：单独生成生产 bundle；完整质量门禁已包含此步骤。
- `pnpm run check:theme`：检查主题适配；修改 Svelte 或 SCSS 时执行。
- `pnpm run release:package`：构建并生成发布用 `package.zip`，仅用于发布验证。
- `pnpm run release`：构建并部署到本机思源插件目录。凡改动需要用户在思源中人工验证，交付验证前必须运行此命令并确认部署成功。

## 编码风格与命名

TypeScript 开启 `strict`。沿用现有格式：4 空格缩进、双引号、分号和尾随逗号；仓库使用 Prettier 自动格式化（`pnpm run format`），ESLint 不含格式规则。完整质量门禁会运行 `pnpm run format:check`。Svelte 组件、类和类型使用 `PascalCase`，函数与变量使用 `camelCase`，工具文件使用 `kebab-case.ts`。CSS 采用 `.na-` 前缀的 BEM 命名，并优先使用 `--b3-*`、`--na-*` 主题变量。共享契约放入 `src/shared/`，避免前端直接依赖内核实现。

## 前端组件复用

实现或调整界面前，必须先检查 `src/frontend/ui/` 中的 `Na*` 公共组件，以及 `tokens.scss`、`primitives.scss` 中的设计令牌和基础样式。已有组件能满足需求时直接复用，不得在业务组件中重复实现同类控件或样式。没有合适组件时，优先扩展现有组件的通用能力；无法合理扩展时，在 `src/frontend/ui/` 新建 `Na*.svelte` 公共组件，再由业务组件使用。公共组件应提供清晰的 props/events，覆盖 disabled、loading、empty、键盘操作等适用状态，并保持主题、响应式和无障碍行为一致。修改公共组件后检查现有调用方，避免引入跨视图回归。

When reviewing UI/UX designs, follow the design review process defined in:
- `.design-rules/SKILL.md` — Main review methodology
- `.design-rules/references/hig-lookup.md` — Topic-to-file mapping
- `.design-rules/references/hig/` — 53 design guideline documents

Always load the relevant guideline files before providing design feedback.

## 国际化

界面文案通过插件的 `this.i18n` 或组件注入的 `i18n` 获取。新增或修改 key 时，必须同时更新 `src/i18n/en.json` 与 `src/i18n/zh-CN.json`，并保持键集合一致；不要新增仅支持一种语言的可见文案。Vite 会将两份资源复制到构建目录，发布包也要求二者同时存在。

## 测试规范

使用 `node:test` 与 `node:assert/strict`，文件命名为 `<feature>.test.ts`。优先覆盖纯逻辑和用户可见回归；需要保护组件或 RPC 接线时，可沿用现有源码断言测试。项目暂无覆盖率阈值，但每个修复应附能复现旧行为并验证新行为的测试。

### 回归测试纪律

修复 bug 时，必须在最相关的测试文件中附一个复现原始场景的回归测试。回归测试应：

- 构造触发原始 bug 的输入条件
- 断言修复后的正确行为（在修复前会失败）
- 以 `// Regression: <bug 简述>` 注释标记，便于追溯

如果现有测试文件都不合适，可新建 `tests/<feature>-regression.test.ts`。回归测试与行为测试使用相同的断言风格——直接调用函数、传入数据、断言结果，不用源码字符串匹配。

提交或交付前运行 `pnpm run check`；需要人工验收时，随后必须运行 `pnpm run release`，并在交付说明中告知用户已部署、可以开始验证。

## 提交与 Pull Request

仅在用户明确要求创建 Git commit，或需要编写、更新 Pull Request 时，读取并遵循 `docs/GIT_CONVENTIONS.md`；其他任务不要读取该文档。

## Vendor 参考项目

`vendor/` 不参与构建，仅用于查证和借鉴。后端 API 优先查阅 `vendor/siyuan/docs/API.zh-CN.md`，需要确认底层行为时再查看思源源码；前端插件 API 和类型查阅 `vendor/petal/siyuan.d.ts`、`vendor/petal/kernel.d.ts`。`vendor/plugin-sample*` 用于参考插件生命周期和构建方式；`siyuan-plugin-task-note-management`、`orca-plugin-task-planner`、`tasknotes`、`siyuan-plugin-task-horizon` 仅用于任务模型与交互研究，不得直接当作本项目依赖或照搬实现。

## 本地配置与安全

属性 SQL 索引可能异步刷新，写入后的权威状态应通过 `getBlockAttrs` 获取。`scripts/deploy.js` 的思源工作区路径为本机配置；运行部署或发布命令前先确认目标，禁止提交个人路径、令牌或工作区数据。

## Agent 工作流

根目录存在 `.codegraph/`。定位符号、调用链或影响范围时，先运行 `codegraph explore "问题或符号"`，再按需使用 `rg` 和直接读取文件。不要覆盖用户已有的未提交改动。

## Agent skills

### Issue tracker

问题与规格通过 GitHub Issues 管理。详见 `docs/agents/issue-tracker.md`。

### Domain docs

采用单上下文领域文档布局。详见 `docs/agents/domain.md`。
