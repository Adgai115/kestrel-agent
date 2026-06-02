# Docker sandbox test runner
# Use: .\scripts\test-docker.ps1
# Skips gracefully when Docker is unavailable (no error exit).

$ErrorActionPreference = "Continue"

Write-Host "=== Docker Sandbox CI Tests ===" -ForegroundColor Cyan

function Resolve-DockerCommand {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }

  $knownPaths = @(
    "C:\Program Files\Docker\Docker\resources\bin\docker.exe"
  )
  foreach ($path in $knownPaths) {
    if (Test-Path $path) {
      $dockerDir = Split-Path -Parent $path
      $env:PATH = "$dockerDir;$env:PATH"
      return $path
    }
  }

  return $null
}

# Check Docker availability. Docker Desktop can be installed even when docker.exe
# is not present in the current shell PATH, so also probe its default Windows path.
$docker = Resolve-DockerCommand
if (-not $docker) {
  Write-Host "[SKIP] Docker CLI not found — integration tests will be skipped" -ForegroundColor Yellow
  Write-Host "  Install Docker Desktop or add Docker resources\bin to PATH, then retry." -ForegroundColor Yellow
  exit 0
}

$dockerCheck = & $docker info 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "[SKIP] Docker daemon not running — 3 integration tests will be skipped" -ForegroundColor Yellow
  Write-Host "  Start Docker Desktop and retry to run full sandbox tests." -ForegroundColor Yellow
  exit 0
}

Write-Host "[OK] Docker available" -ForegroundColor Green

# Run sandbox tests (Docker integration tests will auto-detect)
Set-Location (Split-Path $PSScriptRoot -Parent)
pnpm --filter @kestrel/sandbox test

if ($LASTEXITCODE -eq 0) {
  Write-Host "`n[PASS] Docker sandbox tests completed" -ForegroundColor Green
} else {
  Write-Host "`n[FAIL] Some sandbox tests failed" -ForegroundColor Red
  exit 1
}
