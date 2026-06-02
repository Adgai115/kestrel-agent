# Kestrel Agent 部署指南

本指南按常见用户场景列出部署方式。上线前建议至少验证“本地源码部署”和“Docker 部署”；Windows 用户建议优先使用 PowerShell 一键启动。

## 前置要求

- Node.js `>=22.19.0`
- pnpm `10.x`
- 已配置 `.env`
- 如使用 Docker：Docker Desktop / Docker Engine 已启动

> **跨平台提示**：`pnpm install --frozen-lockfile` 安装的 `@biomejs/biome` 等包是平台特定的。如果在 Windows/macOS/Linux 之间切换，出现 "Cannot find module @biomejs/biome" 错误，运行 `pnpm add -D @biomejs/biome@1.9.4 -w` 重新安装当前平台二进制，或使用 `pnpm install`（不带 `--frozen-lockfile`）。WSL 用户请注意：Windows 和 WSL 的 `node_modules` 不通用，应在各自环境内独立安装。

检查环境：

```powershell
node --version
pnpm --version
node packages\cli\bin\kestrel.js doctor
```

## 方式一：本地源码部署

适合开发者、审计人员、需要直接调试源码的用户。

```powershell
pnpm install --frozen-lockfile
pnpm build
node packages\cli\bin\kestrel.js doctor
node packages\cli\bin\kestrel.js gateway start
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/health
```

## 方式二：Windows PowerShell 一键启动

适合中文 Windows 用户快速启动。

只启动 Gateway：

```powershell
.\scripts\start.ps1 -Port 3100
```

同时启动 Gateway 和 Web Console：

```powershell
.\scripts\start.ps1 -Port 3100 -All
```

启动后：

- Gateway: `http://localhost:3100`
- Web Console: `http://localhost:5173`
- Token 文件：`.kestrel/gateway-token`

## 方式三：Docker 部署

适合生产、灰度、隔离环境。

如果 `docker` 命令不可用，但 Docker Desktop 已安装在默认位置，可先临时补充 PATH：

```powershell
$env:PATH = 'C:\Program Files\Docker\Docker\resources\bin;' + $env:PATH
```

构建镜像：

```powershell
docker build -t kestrel-agent .
```

运行容器：

```powershell
docker run --rm `
  -e KESTREL_API_KEY=<your-api-key> `
  -e KESTREL_GATEWAY_TOKEN=<your-token> `
  -p 3100:3100 `
  kestrel-agent
```

验证：

```powershell
Invoke-RestMethod http://127.0.0.1:3100/health
Invoke-RestMethod http://127.0.0.1:3100/status -Headers @{ Authorization = 'Bearer <your-token>' }
```

## 方式四：Gateway 与 Web Console 分离部署

适合把 API 服务和静态前端资源分别托管。

启动 Gateway：

```powershell
$env:KESTREL_GATEWAY_TOKEN = '<your-token>'
node packages\gateway\dist\bin.js --port 3100 --host 127.0.0.1
```

构建并托管 Web Console：

```powershell
pnpm build
npx --yes --package http-server http-server packages\web-console\frontend\dist -a 127.0.0.1 -p 5174 -c-1
```

验证 CORS：

```powershell
Invoke-WebRequest http://127.0.0.1:3100/status `
  -Headers @{ Authorization = 'Bearer <your-token>'; Origin = 'http://127.0.0.1:5174' }
```

## 方式五：WSL / Linux 源码部署

WSL / Linux 可按本地源码方式部署，但必须先安装 Node.js `>=22.19.0`。如果系统 Node 仍是 v18，`pnpm install` 会因为 `engine-strict=true` 被正确阻止。

检查：

```bash
command -v node
node --version
command -v pnpm
pnpm --version
```

如果 Windows 侧调用 WSL，建议使用登录式 shell，避免非登录脚本仍命中系统自带 Node：

```powershell
wsl.exe -d Ubuntu -e bash -lc 'command -v node; node --version; command -v pnpm; pnpm --version'
```

如果必须运行非登录脚本，在脚本开头显式加入：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

满足版本后：

```bash
pnpm install --frozen-lockfile
pnpm build
node packages/cli/bin/kestrel.js doctor
node packages/gateway/dist/bin.js --port 3100 --host 127.0.0.1
```

注意：`docker-desktop` WSL 发行版不是普通用户的源码部署入口。需要在 Ubuntu 等常规 WSL 发行版中部署，并启用 Docker Desktop WSL integration 后再使用 Docker CLI。
