# Kestrel Agent 部署模式

Kestrel Agent 支持三种运行模式，适应不同的使用场景。

## 模式对比

| 特性 | CLI 模式 | Gateway 模式 | Web Console 模式 |
|------|:--:|:--:|:--:|
| 交互方式 | 终端 REPL | HTTP/SSE/WS API | 浏览器 UI |
| 多用户 | ❌ | ✅ | ✅ |
| 权限审批 | 终端弹窗 | API 端点 | Web UI |
| 后台运行 | ❌ | ✅ | ✅ |
| 适用场景 | 个人开发者 | 团队/自动化 | 团队/管理 |

---

## 1. CLI 模式 (默认)

直接终端交互，适合个人开发使用。

```powershell
# 启动
pnpm dev
# 或
node packages/cli/bin/kestrel.js
```

**架构**:
```
终端 → Ink REPL (app.tsx) → ConversationLoop → DeepSeek API
                                    ↓
                             Tool Executor (文件系统/Shell/Git/...)
```

**特点**:
- 单用户、单会话
- 所有工具输出直接显示在终端
- 权限审批弹窗在终端内交互
- 配置文件: `.env` + `.kestrel/`

---

## 2. Gateway 模式

以 API 服务形式运行，支持多客户端接入。

```powershell
# 启动
kestrel gateway start
# 或
node packages/gateway/dist/bin.js --port 3100
```

**架构**:
```
客户端 (CLI/Frontend/Bot) → HTTP/WS/SSE → Gateway (Fastify)
                                              ↓
                                     ConversationLoop (per-request)
                                              ↓
                                        DeepSeek API
```

**端点**:

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 (无需认证) |
| `/status` | GET | 服务状态 (需认证) |
| `/rpc` | POST | JSON-RPC (ping/chat/status) |
| `/sse` | GET | SSE 状态流 |
| `/sse/chat` | POST | SSE 流式聊天 |
| `/ws` | GET | WebSocket 聊天 |
| `/confirm` | POST | 创建权限审批 |
| `/confirm/:id` | POST | 审批决定 |
| `/sessions` | GET | 活跃会话列表 |

**认证**: 所有端点 (除 `/health`) 需要 `Authorization: Bearer <token>`。Token 自动生成或通过 `KESTREL_TOKEN` 设置。

**环境变量**:
```env
KESTREL_PORT=3100
KESTREL_TOKEN=your-secret-token
KESTREL_GATEWAY_TOKEN=your-secret-token  # 优先于 KESTREL_TOKEN
KESTREL_API_KEY=你的API密钥
KESTREL_MODEL=deepseek-v4-pro
```

---

## 3. Web Console 模式

基于 React + Vite 的 Web 管理面板。

```powershell
# 构建
pnpm build

# 启动 Gateway (API 服务)
kestrel gateway start

# 启动 Web Console 前端 (独立 Vite dev server 或 preview)
cd packages/web-console/frontend
npx vite --port 5173
# 或生产模式: npx vite preview --port 5173
```

**架构**:
```
浏览器 → http://localhost:5173 (Vite) → Web Console UI
              ↓ (fetch /status, /sessions, /confirm)
         http://127.0.0.1:3100 (Gateway API)
```

**访问**: 浏览器打开 `http://localhost:5173`，在设置中输入 Gateway Token。

---

## 开发模式

所有模式支持开发热加载:

```powershell
# CLI 开发模式
node --conditions development --import tsx packages/cli/bin/kestrel.js

# Gateway 开发模式
node --conditions development --import tsx packages/gateway/dist/bin.js

# 运行全部测试
pnpm test

# 运行验证流水线
.\scripts\verify.ps1
```
