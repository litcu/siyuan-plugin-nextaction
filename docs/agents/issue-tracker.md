# Issue Tracker：GitHub

本仓库的问题与规格通过 GitHub Issues 管理。所有操作均使用 `gh` CLI。

## 约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：`gh issue view <编号> --comments`，使用 `jq` 筛选评论，并同时获取标签。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，并按需添加 `--label` 和 `--state` 筛选条件。
- **评论 Issue**：`gh issue comment <编号> --body "..."`
- **添加或移除标签**：`gh issue edit <编号> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <编号> --comment "..."`

通过 `git remote -v` 推断仓库；在克隆仓库内运行时，`gh` 会自动完成此操作。

## 是否将 Pull Request 作为分诊入口

**不将 PR 作为请求入口。**（如果本仓库以后将外部 PR 视为功能请求，可将此项改为“是”；`/triage` 会读取该设置。）

改为“是”后，PR 将使用与 Issue 相同的标签和状态，并通过对应的 `gh pr` 命令处理：

- **读取 PR**：通过 `gh pr view <编号> --comments` 读取评论，通过 `gh pr diff <编号>` 读取差异。
- **列出待分诊的外部 PR**：运行 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `authorAssociation` 为 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE` 的条目，排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、标记或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`、`--remove-label` 和 `gh pr close`。

GitHub 的 Issue 与 PR 共用编号空间，因此单独的 `#42` 可能指任意一种对象。先运行 `gh pr view 42`；若失败，再运行 `gh issue view 42`。

## 当技能要求“发布到 Issue Tracker”

创建一个 GitHub Issue。

## 当技能要求“获取相关 Ticket”

运行 `gh issue view <编号> --comments`。

## Wayfinding 操作

供 `/wayfinder` 使用。一个 **map** 对应一个主 Issue，相关 **child ticket** 对应其子 Issue。

- **Map**：带有 `wayfinder:map` 标签的单个 Issue，正文包含 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map` 创建。
- **Child ticket**：通过 GitHub 子 Issue API（使用 `gh api` 调用 sub-issues 端点）关联至 map。若仓库未启用子 Issue，则将 child 添加到 map 正文的任务列表，并在 child 正文顶部添加 `Part of #<map>`。标签使用 `wayfinder:<类型>`，类型为 `research`、`prototype`、`grilling` 或 `task`。认领后，将 ticket 指派给负责推进的开发者。
- **阻塞关系**：以 GitHub 原生 Issue Dependencies 作为规范且在 UI 中可见的表示。使用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 添加关系，其中 `<blocker-db-id>` 是阻塞 Issue 的数字数据库 ID，可通过 `gh api repos/<owner>/<repo>/issues/<编号> --jq .id` 获取；不要使用 `#编号` 或 `node_id`。GitHub 通过 `issue_dependencies_summary.blocked_by` 返回仍处于打开状态的阻塞项。若依赖功能不可用，则在 child 正文顶部添加 `Blocked by: #<编号>, #<编号>`。所有 blocker 关闭后，ticket 才解除阻塞。
- **Frontier 查询**：列出 map 下仍打开的 child；排除存在打开 blocker 或已分配负责人的项目；按 map 中的顺序选择第一项。
- **认领**：运行 `gh issue edit <编号> --add-assignee @me`。这是会话中的第一次写操作。
- **解决**：运行 `gh issue comment <编号> --body "<答案>"`，随后运行 `gh issue close <编号>`，最后向 map 的 Decisions-so-far 添加上下文指针（gist 与链接）。
