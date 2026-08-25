# 参与贡献

感谢你帮助改进 NextAction。为减少重复沟通和回归风险，请按下面的流程提交问题或代码。

## 提交 Issue

- Bug 请使用 Bug 报告模板，提供最小复现步骤、预期结果、实际结果和环境信息。
- 功能建议请先描述真实使用问题，再说明建议方案和范围边界。
- 提交前先搜索已有 Issue；相同问题请补充信息，不要重复创建。
- 日志、截图和录屏中不得包含令牌、个人工作区路径、笔记正文或其他隐私信息。

安全漏洞不应作为普通公开 Issue 提交。仓库启用私密漏洞报告后，请通过仓库 Security 页面提交；在此之前请先通过维护者的 GitHub 主页联系维护者，避免公开利用细节。

## 本地开发

本项目要求 Node.js 22，并使用 pnpm。仓库只维护 `pnpm-lock.yaml`，不要提交 `package-lock.json` 或其他包管理器锁文件。

```bash
pnpm install --frozen-lockfile
pnpm run check
```

`pnpm run check` 会运行测试、类型检查、Svelte 检查、ESLint、格式检查、架构检查、主题检查、生产构建和空白检查。

## 开发流程

1. 从最新 `main` 创建短期分支，例如 `fix/42-reminder` 或 `feat/42-project-review`。
2. 一条分支聚焦一个 Issue 或一组不可拆分的关联变更。
3. Bug 修复必须在最相关的测试文件中添加回归测试，并使用 `// Regression: <问题简述>` 注释。
4. 界面文案必须同时更新 `src/i18n/en.json` 和 `src/i18n/zh-CN.json`。
5. 修改界面前先复用 `src/frontend/ui/` 中的 `Na*` 组件和现有设计令牌。
6. 提交 PR 前运行完整 `pnpm run check`。

涉及需要在思源中人工验收的改动时，还必须运行：

```bash
pnpm run release
```

运行前请确认 `scripts/deploy.js` 的部署目标是自己的测试工作区，不要提交个人路径、令牌或工作区数据。

## Pull Request

- PR 目标分支使用 `main`。
- 完整解决 Issue 时在 PR 正文写 `Closes #编号`；仅建立关联时写 `Refs #编号`。
- 清楚说明变更摘要、验证结果、人工验收步骤和潜在风险。
- 等待所有必需检查通过并处理完讨论后，使用 Squash merge。
- 合并后删除功能分支。

维护者可能要求缩小 PR 范围、补充测试或调整领域边界。涉及不可逆架构决策时，应先通过 Issue 或 ADR 达成共识。
