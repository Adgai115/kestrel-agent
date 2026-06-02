# Kestrel Agent — Verify Pipeline
# Usage: .\scripts\verify.ps1
# Runs check -> typecheck -> test -> test:security, stopping at first failure.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $repoRoot

$phases = @(
  @{ Name = "check"; Command = "pnpm check" },
  @{ Name = "typecheck"; Command = "pnpm typecheck" }
)

$parallelPhases = @(
  @{ Name = "test"; Command = "pnpm test" },
  @{ Name = "test:security"; Command = "pnpm test:security" }
)

$total = $phases.Count + $parallelPhases.Count
$passed = 0
$startTime = Get-Date

function Run-Phase($phase) {
  Write-Host "[$($phase.Name)] Running..." -ForegroundColor Yellow
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $result = [PSCustomObject]@{ Name = $phase.Name; Passed = $false; Time = 0; Error = "" }
  try {
    Invoke-Expression $phase.Command 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
    $sw.Stop()
    $result.Passed = $true
    $result.Time = $sw.Elapsed.TotalSeconds
  } catch {
    $sw.Stop()
    $result.Time = $sw.Elapsed.TotalSeconds
    $result.Error = $_.Exception.Message
  }
  return $result
}

Write-Host "=== Kestrel Verify Pipeline ===" -ForegroundColor Cyan
Write-Host ""

# Sequential phases
foreach ($phase in $phases) {
  $r = Run-Phase $phase
  if ($r.Passed) {
    Write-Host "[$($r.Name)] PASS ($($r.Time.ToString('0.0'))s)" -ForegroundColor Green
    $passed++
  } else {
    Write-Host "[$($r.Name)] FAIL ($($r.Time.ToString('0.0'))s)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pipeline stopped at $($r.Name). Fix errors and re-run." -ForegroundColor Red
    Write-Host "To see the full error output, run: $($phase.Command)" -ForegroundColor Yellow
    exit 1
  }
}

# Parallel phases (test + test:security)
Write-Host "[test + test:security] Running in parallel..." -ForegroundColor Yellow
$jobs = $parallelPhases | ForEach-Object {
  $p = $_
  Start-Job -ScriptBlock {
    param($name, $cmd)
    Set-Location $using:repoRoot
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      Invoke-Expression $cmd 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "exit code $LASTEXITCODE" }
      $sw.Stop()
      return @{ Name = $name; Passed = $true; Time = $sw.Elapsed.TotalSeconds }
    } catch {
      $sw.Stop()
      return @{ Name = $name; Passed = $false; Time = $sw.Elapsed.TotalSeconds; Error = $_.Exception.Message }
    }
  } -ArgumentList $p.Name, $p.Command
}

$parallelResults = $jobs | ForEach-Object {
  $job = $_
  $result = $job | Receive-Job -Wait -AutoRemoveJob
  [PSCustomObject]$result
}

foreach ($r in $parallelResults) {
  if ($r.Passed) {
    Write-Host "[$($r.Name)] PASS ($($r.Time.ToString('0.0'))s)" -ForegroundColor Green
    $passed++
  } else {
    Write-Host "[$($r.Name)] FAIL ($($r.Time.ToString('0.0'))s)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Pipeline stopped at $($r.Name). Fix errors and re-run." -ForegroundColor Red
    Write-Host "To see the full error output, run: pnpm $($r.Name.ToLower())" -ForegroundColor Yellow
    exit 1
  }
}

$elapsed = (Get-Date) - $startTime
Write-Host ""
Write-Host "=== All $passed/$total phases passed in $($elapsed.TotalSeconds.ToString('0.0'))s ===" -ForegroundColor Green
