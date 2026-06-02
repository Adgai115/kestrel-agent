# Kestrel Agent / 红隼 — 一键启动
# 用法: .\scripts\start.ps1 [-Port 3100] [-Dev] [-Web] [-All]

param(
  [string]$Port = "3100",
  [switch]$Dev,
  [switch]$Web,
  [switch]$All
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║           Kestrel Agent / 红隼 CLI            ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Dependency checks
Write-Host "[1/4] 检查环境..." -ForegroundColor Yellow

$nodeVersion = node --version 2>$null
if (-not $nodeVersion) {
  Write-Host "错误: 未找到 Node.js，请安装 Node.js >= 24" -ForegroundColor Red
  exit 1
}
Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green

$pnpmVersion = pnpm --version 2>$null
if (-not $pnpmVersion) {
  Write-Host "错误: 未找到 pnpm，请运行: npm install -g pnpm" -ForegroundColor Red
  exit 1
}
Write-Host "  pnpm: $pnpmVersion" -ForegroundColor Green

# .env validation
Write-Host "[2/4] 检查配置..." -ForegroundColor Yellow
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
  Write-Host "警告: 未找到 .env 文件，创建默认配置..." -ForegroundColor Yellow
  @"
# Kestrel Agent Configuration
KESTREL_API_KEY=sk-your-api-key-here
KESTREL_MODEL=deepseek-v4-pro
KESTREL_GATEWAY_TOKEN=dev-token-change-me
"@ | Out-File -FilePath $envFile -Encoding utf8
  Write-Host "  已创建 $envFile — 请编辑填入 API Key 后重试" -ForegroundColor Yellow
  exit 1
}

$envContent = Get-Content $envFile -Raw
if ($envContent -notmatch 'KESTREL_API_KEY=\s*sk-') {
  Write-Host "错误: .env 中的 KESTREL_API_KEY 未设置或无效" -ForegroundColor Red
  Write-Host "  请在 $envFile 中设置有效的 API Key" -ForegroundColor Yellow
  exit 1
}
Write-Host "  .env: OK" -ForegroundColor Green

# Load .env
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]*?)\s*=\s*(.*)\s*$') {
    $key = $matches[1].Trim()
    $value = $matches[2].Trim()
    if ($key -and $value) {
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
    }
  }
}

foreach ($tokenKey in @("KESTREL_GATEWAY_TOKEN", "KESTREL_TOKEN")) {
  $tokenValue = [Environment]::GetEnvironmentVariable($tokenKey, 'Process')
  if ([string]::IsNullOrWhiteSpace($tokenValue)) {
    [Environment]::SetEnvironmentVariable($tokenKey, $null, 'Process')
  }
}
if ([string]::IsNullOrWhiteSpace($env:KESTREL_GATEWAY_TOKEN) -and [string]::IsNullOrWhiteSpace($env:KESTREL_TOKEN)) {
  $env:KESTREL_GATEWAY_TOKEN = [guid]::NewGuid().ToString()
}

$env:KESTREL_PORT = $Port
$env:KESTREL_GATEWAY_PORT = $Port

# Start services
Write-Host "[3/4] 启动服务..." -ForegroundColor Yellow

if ($All -or $Web) {
  Write-Host "  启动 Web Console (Vite dev)..." -ForegroundColor Cyan
  $pnpmCmd = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if (-not $pnpmCmd) {
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
  }
  if (-not $pnpmCmd) {
    Write-Host "错误: 未找到 pnpm，无法启动 Web Console" -ForegroundColor Red
    exit 1
  }
  $webProcess = Start-Process `
    -FilePath $pnpmCmd.Source `
    -ArgumentList @("--filter", "@kestrel/web-console", "exec", "vite", "frontend", "--host", "127.0.0.1", "--port", "5173") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru
  Write-Host "  Web Console: http://localhost:5173" -ForegroundColor Green
}

if ($All -or -not $Web) {
  Write-Host "[4/4] 启动 Gateway..." -ForegroundColor Yellow

  if ($Dev) {
    Write-Host "  开发模式 (直接加载 TS 源码)..." -ForegroundColor Cyan
    node --no-warnings --conditions development --import tsx packages/gateway/src/bin.ts --port $Port
  } else {
    Write-Host "  构建中..." -ForegroundColor Yellow
    pnpm build 2>&1 | Out-Null
    Write-Host "  生产模式启动..." -ForegroundColor Green
    node packages/gateway/dist/bin.js --port $Port
  }
}

if ($Web -or $All) {
  Write-Host ""
  Write-Host "服务已启动:" -ForegroundColor Cyan
  Write-Host "  Gateway:      http://localhost:$Port" -ForegroundColor Green
  Write-Host "  Web Console:  http://localhost:5173" -ForegroundColor Green
  Write-Host "  Token 文件:   .kestrel/gateway-token" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "按 Ctrl+C 停止所有服务" -ForegroundColor Yellow

  try {
    while ($true) { Start-Sleep -Seconds 1 }
  } finally {
    if ($webProcess -and -not $webProcess.HasExited) {
      Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
}
