# Pre-commit hook — secret scanning
# Called from .git/hooks/pre-commit
# Scans staged files for secrets before allowing commit.

$ErrorActionPreference = "Stop"

# Navigate to repo root
$repoRoot = git rev-parse --show-toplevel 2>$null
if ($repoRoot) { Set-Location $repoRoot }

$exitCode = 0

# Patterns that suggest real secrets (not placeholders)
$secretPatterns = @(
  @{ Pattern = 'sk-[A-Za-z0-9]{20,}'; Desc = 'API key (sk-*)' },
  @{ Pattern = 'AKIA[0-9A-Z]{16}'; Desc = 'AWS Access Key' },
  @{ Pattern = 'ghp_[A-Za-z0-9]{36}'; Desc = 'GitHub PAT' },
  @{ Pattern = 'xox[bpras]-[A-Za-z0-9]+'; Desc = 'Slack token' },
  @{ Pattern = 'KESTREL_API_KEY=(?!.*placeholder)(?!.*your-key)(?!.*your-key-here)(?!.*sk-your-key-here)sk-'; Desc = 'Real KESTREL_API_KEY in .env' }
)

# Known safe files/patterns to exclude
$safePatterns = @(
  'sk-your-key-here',
  'your-api-key',
  'your-key-here',
  'placeholder',
  'auto-generated-if-empty'
)

function Is-SafeLine {
  param($line)
  foreach ($safe in $safePatterns) {
    if ($line -match [regex]::Escape($safe)) { return $true }
  }
  return $false
}

# Check staged files
$stagedFiles = git diff --cached --name-only --diff-filter=ACM 2>$null
if (-not $stagedFiles) {
  exit 0
}

Write-Host "[pre-commit] Scanning staged files for secrets..."

# 1. Block committing .env or .env.* (except .env.example)
$envFiles = $stagedFiles | Where-Object { $_ -match '(^|/)\.env$' -and $_ -notmatch '\.env\.example$' }
if ($envFiles) {
  Write-Host "`n[ERROR] .env file staged for commit:" -ForegroundColor Red
  $envFiles | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
  Write-Host "  .env is in .gitignore. Use 'git rm --cached <file>' to unstage." -ForegroundColor Yellow
  $exitCode = 1
}

# 2. Scan staged files for secret patterns
$stagedFiles | ForEach-Object {
  $file = $_
  # Skip binary files, node_modules, test files, dist, lock files
  if ($file -match 'node_modules|dist/|\.(test|spec)\.|\.(png|jpg|gif|ico|woff|woff2|ttf|eot|lock|sum)$') { return }

  $content = git show ":$file" 2>$null
  if (-not $content) { return }

  $lines = $content -split "`n"
  $lineNum = 0
  foreach ($line in $lines) {
    $lineNum++
    if (Is-SafeLine $line) { continue }
    foreach ($sp in $secretPatterns) {
      if ($line -match $sp.Pattern) {
        Write-Host "`n[SECRET DETECTED] $($sp.Desc)" -ForegroundColor Red
        Write-Host "  File: $file`:$lineNum" -ForegroundColor Red
        Write-Host "  Content: $($line.Trim())" -ForegroundColor Red
        $exitCode = 1
      }
    }
  }
}

# 3. Check .env.example for safe placeholders
if ($stagedFiles -match '\.env\.example$') {
  $envContent = git show ":.env.example" 2>$null
  if ($envContent) {
    $hasRealSecret = $false
    $envContent -split "`n" | ForEach-Object {
      if ($_ -match '^KESTREL_API_KEY=sk-(?!your-key-here)' -or
          $_ -match '^KESTREL_PROVIDER_API_KEY=sk-(?!your-key-here)') {
        Write-Host "[WARNING] .env.example may contain real API key" -ForegroundColor Yellow
        $hasRealSecret = $true
      }
    }
  }
}

if ($exitCode -ne 0) {
  Write-Host "`n[pre-commit] Commit blocked due to secrets. Fix and retry.`n" -ForegroundColor Red
} else {
  Write-Host "[pre-commit] Secret scan passed.`n" -ForegroundColor Green
}

exit $exitCode
