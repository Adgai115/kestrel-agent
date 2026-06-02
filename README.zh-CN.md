# Kestrel Agent / 红隼

> 自托管 AI 编码助手 CLI。直连 DeepSeek API，快速、私有、独立。
>
> Fast eyes. Sharp actions. Reliable execution.

Kestrel（红隼）是一个自托管的 AI 编码助手 CLI。直连 DeepSeek API 实现快速、私密的代码辅助。

## 许可声明

Kestrel Agent 源码仅限非商业使用。

- 非商业使用采用 PolyForm Noncommercial License 1.0.0 许可。
- 商业使用需从项目所有者获取单独的书面商业许可。
- 详见 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md) 及 [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md)。

## 快速开始

```bash
# 安装依赖
pnpm install

# 配置 API Key
cp .env.example .env
# 编辑 .env — 填入你的 KESTREL_API_KEY

# 启动交互式 REPL
pnpm dev
```

更多部署方式（Windows/Docker/WSL/Web Console 分离部署）请见 [部署指南](docs/deployment.zh-CN.md)。

## 特性

- **交互式 REPL** — 与 AI 对话、执行工具、运行时切换模型
- **Gateway API** — HTTP/WebSocket/SSE 服务，支持外部工具集成
- **内置工具** — read、write、edit、bash、grep、find、lsp_diagnostics、memory_search、task_create
- **MCP 协议** — 接入任意 stdio MCP server，自动注册工具并进行 ABAC 权限检查
- **记忆引擎** — 持久化可搜索记忆，支持审计追踪
- **技能系统** — 可插拔技能，支持权限管控
- **多渠道** — 飞书、Slack、Telegram、WebChat 适配器
- **沙箱** — Docker 代码执行（可选）
- **速率限制** — 内置 Gateway 速率限制
- **密钥扫描** — pre-commit hook 防止意外提交密钥

## 命令

```
kestrel chat        启动交互式会话（默认）
kestrel gateway     启动 API 服务
kestrel task        管理任务
kestrel memory      搜索记忆
kestrel skill       列出技能
kestrel doctor      系统健康检查
```

## 开发

```bash
pnpm build           # 构建全部包
pnpm test            # 运行全部测试（约 230 项）
pnpm check           # Lint + 类型检查
pnpm run setup       # 安装 git hooks
.\scripts\verify.ps1 # 完整 CI 流水线
```

## 跨平台注意事项

`pnpm install --frozen-lockfile` 会安装 lockfile 中锁定的平台特定二进制包（如 `@biomejs/biome`）。在不同操作系统之间切换时（例如 macOS/Linux ↔ Windows），可能出现 "Cannot find module" 错误。

**解决方案**：

```bash
# 方法一：重新安装以匹配当前平台
pnpm add -D @biomejs/biome@1.9.4 -w

# 方法二：不使用 frozen lockfile（首次 clone 后）
pnpm install
```

建议在 CI/CD 中使用对应平台的 runner（`ubuntu-latest` / `windows-latest`），或多平台 lockfile。

## 架构

```
apps/bootstrap  →  连接 Gateway + ConversationLoop
packages/core   →  ConversationLoop、KestrelClient、配置
packages/cli    →  REPL、终端 UI、命令路由
packages/gateway → Fastify HTTP/WS/SSE 服务
packages/storage → SQLite (sql.js WASM) — 会话、任务、审计
packages/memory →  文件式记忆引擎
packages/mcp   →  MCP stdio 传输 + 工具桥接
packages/skills →  技能注册 + 权限引擎
packages/channels → 飞书/Slack/Telegram/WebChat 适配器
packages/permissions → ABAC 权限引擎
packages/sandbox → Docker 执行器
packages/tools  →  内置工具注册
```

## 项目结构

```
kestrel-agent/
├── apps/bootstrap/       # 应用引导
├── packages/             # monorepo 17 个包
│   ├── cli/              # CLI 入口 + Ink 终端 UI
│   ├── core/             # ConversationLoop + 配置
│   ├── gateway/          # Fastify HTTP/SSE/WS 网关
│   ├── storage/          # SQLite 存储层
│   ├── memory/           # 记忆引擎
│   ├── mcp/              # MCP 协议实现
│   ├── skills/           # 技能系统
│   ├── channels/         # 多渠道适配
│   ├── permissions/      # ABAC 权限
│   ├── sandbox/          # Docker 沙箱
│   ├── tools/            # 内置工具
│   ├── tasks/            # 任务管理
│   ├── lsp/              # LSP 集成
│   ├── observability/    # 可观测性
│   └── web-console/      # Web 控制台
├── docs/                 # 文档、审计报告
├── scripts/              # 验证与启动脚本
└── biome.json            # Lint + 格式化配置
```
