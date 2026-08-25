# 本地思源授权与验证

部署到本机思源、运行真实内核或 MCP 集成测试，以及浏览器被重定向到 `/check-auth` 时，按本文件操作。

## 准备本地配置

复制 `.env.example` 为被 Git 忽略的 `.env.local`，填写本机真实值：

- `SIYUAN_PLUGINS_DIR`：思源工作空间 `data/plugins` 的绝对路径，供 `pnpm run release` 使用。
- `SIYUAN_ACCESS_AUTH_CODE`：思源访问授权码（新版本称“锁屏密码”），供 Docker 启动或浏览器登录使用。
- `SIYUAN_API_TOKEN`：在思源“设置 - 鉴权 - API token”中查看，供 API、内核 RPC 和 MCP 集成测试使用。

访问授权码与 API token 是两套凭据。HTTP API 使用 `Authorization: Token <SIYUAN_API_TOKEN>`；浏览器 `/check-auth` 使用 `SIYUAN_ACCESS_AUTH_CODE`。两者不能互换。

## Agent 验证流程

1. 检查 `.env.local` 是否存在且所需变量为非空、非占位值；只报告“已配置/未配置”，不输出值。
2. 部署前确认 `SIYUAN_PLUGINS_DIR` 解析到明确的 `data/plugins` 目录，再运行 `pnpm run release`。
3. 部署成功后运行 `pnpm run test:integration:kernel`；需要验证 MCP 时再运行 `pnpm run test:integration:mcp`。两个命令会自动加载 `.env.local`。
4. 集成脚本只操作唯一命名的临时文档或任务，并在结束时清理；仍需核对脚本输出中的清理结果。
5. 遇到 HTTP 401 时，检查 `SIYUAN_API_TOKEN` 是否缺失、仍为占位值或已失效。遇到 `/check-auth` 时使用访问授权码完成浏览器会话，不把它当作 API token。

真实凭据只保存在 `.env.local` 或进程环境中。Agent 不读取思源配置文件提取秘密，不在命令输出、日志、提交、Issue 或交付说明中展示凭据。
