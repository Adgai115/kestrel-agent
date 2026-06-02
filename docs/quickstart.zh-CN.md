# Kestrel Agent 快速开始 (Windows)

> 红隼 AI 编码助手 — 直连 DeepSeek API，快速、私有、独立。

## 环境要求

- **Node.js** 24+ ([下载](https://nodejs.org/))
- **pnpm** 10+ (`npm install -g pnpm`)
- **Windows 11** / Windows 10 22H2+
- **PowerShell 7+** (推荐) 或 Windows Terminal

## 安装

```powershell
# 1. 克隆项目
git clone <your-repo-url> kestrel-agent
cd kestrel-agent

# 2. 安装依赖
pnpm install

# 3. 设置 API Key
copy .env.example .env
# 编辑 .env 文件，填入你的 DeepSeek API Key:
#   KESTREL_API_KEY=sk-your-key-here
#   KESTREL_MODEL=deepseek-v4-pro

# 4. 构建项目
pnpm build

# 5. 验证安装
node packages\cli\bin\kestrel.js doctor
```

## 启动交互对话

```powershell
# 开发模式 (TSX 热加载)
pnpm dev

# 或构建后运行
node packages/cli/bin/kestrel.js
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `kestrel chat` | 启动交互对话 (默认) |
| `kestrel doctor` | 系统健康检查 |
| `kestrel version` | 查看版本 |
| `kestrel gateway start` | 启动 Gateway API 服务 |
| `kestrel task list` | 查看待处理任务 |
| `kestrel memory search <关键词>` | 搜索记忆 |
| `kestrel help` | 查看帮助 |

## REPL 快捷键

| 快捷键 | 功能 |
|------|------|
| `Ctrl+C` | 取消当前回复 / 退出 |
| `Tab` | 切换任务面板 |
| `/help` | 查看命令列表 |
| `/model` | 查看/切换模型 |
| `/history` | 查看对话历史 |
| `/permissions` | 查看权限状态 |
| `/quit` | 退出 |

## 环境变量

| 变量 | 默认值 | 说明 |
|------|------|------|
| `KESTREL_PROVIDER` | `deepseek` | LLM 供应商 (deepseek/openai/anthropic/google) |
| `KESTREL_MODEL` | `deepseek-v4-pro` | 模型 ID |
| `KESTREL_API_KEY` | — | API 密钥 (必填) |
| `KESTREL_HOME` | `.kestrel` | 数据目录 |
| `KESTREL_PORT` | `3100` | Gateway 端口 |

## 常见问题

### `'pnpm' is not recognized`
以管理员身份运行 `npm install -g pnpm`，或使用 `corepack enable`。

### `KESTREL_API_KEY` 未设置
复制 `.env.example` 为 `.env`，填入你的 API Key。支持 DeepSeek、OpenAI、Anthropic、Google 供应商。

### 首次启动慢
首次 `pnpm build` 需要编译全部 17 个包 (~30s)。后续构建使用增量编译，秒级完成。

### 终端乱码
使用 Windows Terminal 或 PowerShell 7+，不要用旧版 cmd.exe。推荐安装 [Cascadia Code](https://github.com/microsoft/cascadia-code) 字体。
