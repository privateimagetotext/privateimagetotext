[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = $PSScriptRoot
$bundledRuntime = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$bundledPnpm = Join-Path $bundledRuntime "bin\fallback\pnpm.cmd"
$bundledNodeDirectory = Join-Path $bundledRuntime "node\bin"

$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if ($pnpmCommand) {
  $pnpm = $pnpmCommand.Source
} elseif (Test-Path -LiteralPath $bundledPnpm) {
  $pnpm = $bundledPnpm
} else {
  throw "pnpm was not found. Install Node.js 22.22 or newer with pnpm, then run this script again."
}

if (-not (Get-Command node -ErrorAction SilentlyContinue) -and
    (Test-Path -LiteralPath $bundledNodeDirectory)) {
  $env:Path = "$bundledNodeDirectory;$env:Path"
}

# Package lifecycle scripts resolve `pnpm` through PATH even when this launcher
# invokes pnpm.cmd by its absolute fallback path.
$pnpmDirectory = Split-Path -Parent $pnpm
$pathDirectories = @(
  $env:Path -split ";" |
    Where-Object { $_ } |
    ForEach-Object { $_.TrimEnd("\") }
)
if ($pathDirectories -notcontains $pnpmDirectory.TrimEnd("\")) {
  $env:Path = "$pnpmDirectory;$env:Path"
}

Set-Location -LiteralPath $projectRoot

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
  & $pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed."
  }
}

Write-Host ""
Write-Host "Preparing the current Private Image to Text build..." -ForegroundColor White
Write-Host ""

& $pnpm run build
if ($LASTEXITCODE -ne 0) {
  throw "Private Image to Text could not create its local build."
}

Write-Host ""
Write-Host "Private Image to Text is ready at http://127.0.0.1:5173/" -ForegroundColor White
Write-Host "Keep this window open while using the site. Press Ctrl+C to stop it." -ForegroundColor DarkGray
Write-Host ""

& $pnpm run serve:local
exit $LASTEXITCODE
