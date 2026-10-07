# Build the Elinks Windows installer. Writes only under this repo.

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RootFull = [IO.Path]::GetFullPath($Root)

function Assert-InsideRepo([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  $prefix = $RootFull.TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
  if (-not ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $full.Equals($RootFull, [StringComparison]::OrdinalIgnoreCase))) {
    throw "Refusing path outside repo: $full"
  }
  return $full
}

Assert-InsideRepo $RootFull
if ([IO.Path]::GetFileName($RootFull) -ne "links") {
  throw "Unexpected repo folder name: $RootFull"
}

$cache = Assert-InsideRepo (Join-Path $RootFull ".cache")
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$env:ELECTRON_BUILDER_CACHE = Assert-InsideRepo (Join-Path $cache "electron-builder")
$env:ELECTRON_CACHE = Assert-InsideRepo (Join-Path $cache "electron")
New-Item -ItemType Directory -Force -Path $env:ELECTRON_BUILDER_CACHE | Out-Null
New-Item -ItemType Directory -Force -Path $env:ELECTRON_CACHE | Out-Null
# Nearest package.json wins. Without this, icon-tool.js is loaded as ESM and require() crashes.
Set-Content -LiteralPath (Assert-InsideRepo (Join-Path $cache "package.json")) -Value '{"type":"commonjs"}' -Encoding ascii
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
# GitHub releases time out on this network. The mirror still serves the NSIS tools.
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://cdn.npmmirror.com/binaries/electron-builder-binaries/"

$builder = Join-Path $RootFull "node_modules\electron-builder\cli.js"
if (-not (Test-Path -LiteralPath $builder)) {
  throw "electron-builder missing; run npm install"
}

Push-Location $RootFull
try {
  & node $builder --win nsis --publish never
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed: $LASTEXITCODE" }
} finally {
  Pop-Location
}

$dist = Assert-InsideRepo (Join-Path $RootFull "dist")
$pkg = Get-Content -LiteralPath (Join-Path $RootFull "package.json") -Raw | ConvertFrom-Json
$setup = Get-ChildItem -LiteralPath $dist -Filter "*-Setup-$($pkg.version).exe" -File | Select-Object -First 1
if (-not $setup) { throw "installer exe missing for version $($pkg.version)" }
$min = 30MB
if ($setup.Length -lt $min) { throw "installer looks truncated: $($setup.Length) bytes" }

$unpacked = Assert-InsideRepo (Join-Path $dist "win-unpacked")
$exe = Join-Path $unpacked "Elinks.exe"
if (-not (Test-Path -LiteralPath $exe)) { throw "unpacked Elinks.exe missing" }
foreach ($name in @("make-tls.ps1", "allow-lan.ps1", "allow-lan.cmd")) {
  $script = Join-Path $unpacked "resources\app.asar.unpacked\scripts\$name"
  if (-not (Test-Path -LiteralPath $script)) { throw "unpacked script missing: $name" }
}

Write-Output "PACK_OK $($setup.FullName) bytes=$($setup.Length)"
