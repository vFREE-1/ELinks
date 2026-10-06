# Links verify — only touches this repo.

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

$Received = Assert-InsideRepo (Join-Path $RootFull "received")
New-Item -ItemType Directory -Force -Path $Received | Out-Null

$health = $null
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/health" -TimeoutSec 2
} catch {
  $health = $null
}

function Stop-RepoReceiver {
  $owns = @()
  try {
    $owns = @(Get-NetTCPConnection -LocalPort 8730 -State Listen -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    $owns = @()
  }
  foreach ($procId in $owns) {
    $p = Get-CimInstance Win32_Process -Filter "ProcessId = $procId"
    if ($p -and ($p.Name -match 'node|electron')) {
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match 'electron' -and $_.CommandLine -match 'H:\\links|electron \.'
  } | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 400
}

$started = $false
$proc = $null
$needStart = -not $health -or -not $health.ok -or $health.runtime -ne "node" -or $health.parallel -ne $true -or $health.lanes -ne 6
try {
  $peek = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info" -TimeoutSec 2
  if ($null -eq $peek.linkMps) { $needStart = $true }
} catch {
  $needStart = $true
}
if ($needStart) {
  Stop-RepoReceiver
  $proc = Start-Process -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $RootFull -PassThru -WindowStyle Hidden
  $started = $true
  $ok = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/health" -TimeoutSec 1
      if ($health.ok) { $ok = $true; break }
    } catch {}
  }
  if (-not $ok) { throw "Server did not become healthy" }
}

try {
  $info = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info"
  if ($health.runtime -and $health.runtime -ne "node") { throw "expected node runtime, got $($health.runtime)" }
  if ($info.host -match '^169\.254\.') { throw "link-local IP is not usable: $($info.host)" }
  if (-not $info.host) { throw "info.host missing" }
  if (-not $info.token) { throw "info.token missing" }
  if ($null -eq $info.linkMps) { throw "info.linkMps missing" }

  $index = Get-Content -LiteralPath (Join-Path $RootFull "index.html") -Raw
  if ($index -notmatch 'Elinks') { throw "brand should be Elinks" }
  if ($index -notmatch 'Power by EndLessGo - vFREE') { throw "footer credit missing" }
  if ($index -match '千兆局域网') { throw "header still uses a marketing link label" }

  $pair = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/pair" -Method POST -ContentType "application/json" -Body (@{ token = $info.token } | ConvertTo-Json)
  if (-not $pair.ok) { throw "pair failed: $($pair | ConvertTo-Json)" }

  $payload = [byte[]](1..64)
  $name = "verify-upload.bin"
  $dest = Assert-InsideRepo (Join-Path $Received $name)
  $uri = "http://127.0.0.1:8730/api/upload?session=$($pair.session)&name=$name&size=$($payload.Length)&offset=0"
  Invoke-RestMethod -Uri $uri -Method PUT -ContentType "application/octet-stream" -Body $payload | Out-Null

  if (-not (Test-Path -LiteralPath $dest)) { throw "uploaded file missing: $dest" }
  $got = [IO.File]::ReadAllBytes($dest)
  if ($got.Length -ne $payload.Length) { throw "size mismatch $($got.Length)" }

  $leaf = [IO.Path]::GetFileName($dest)
  if ($leaf -ne $name) { throw "unexpected file name $leaf" }
  Remove-Item -LiteralPath $dest

  if (Test-Path -LiteralPath $dest) { throw "failed to remove verify fixture" }

  node (Join-Path $RootFull "scripts\verify-parallel.mjs")
  if ($LASTEXITCODE -ne 0) { throw "parallel verify failed" }

  $pkg = Get-Content -LiteralPath (Join-Path $RootFull "package.json") -Raw | ConvertFrom-Json
  if ($pkg.scripts.dev -notmatch 'electron') { throw "package.json scripts.dev must start Electron" }
  if ($pkg.main -ne "desktop/main.mjs") { throw "package.json main must be desktop/main.mjs" }
  $main = Get-Content -LiteralPath (Join-Path $RootFull "desktop\main.mjs") -Raw
  if ($main -notmatch 'titleBarStyle:\s*"hidden"') { throw "desktop window must hide the native caption and overlay it" }
  $mark = Assert-InsideRepo (Join-Path $RootFull "assets\mark.svg")
  $icon = Assert-InsideRepo (Join-Path $RootFull "assets\icon.png")
  if (-not (Test-Path -LiteralPath $mark)) { throw "missing brand mark" }
  if (-not (Test-Path -LiteralPath $icon)) { throw "missing window icon" }
  $index = Get-Content -LiteralPath (Join-Path $RootFull "index.html") -Raw
  if (($index | Select-String -Pattern '<div class="ripples"' -Context 0,1) -and ($index -notmatch '<i></i><i></i><i></i><i></i><i></i><i></i>')) {
    throw "waiting ripples should keep six rings"
  }
  if ($index -notmatch 'is-desktop') { throw "desktop chrome class missing" }
  $electron = Join-Path $RootFull "node_modules\.bin\electron.cmd"
  if (-not (Test-Path -LiteralPath $electron)) { throw "electron binary missing; run npm install" }
  Push-Location $RootFull
  try {
    $env:LINKS_SMOKE = "1"
    & $electron "."
    if ($LASTEXITCODE -ne 0) { throw "desktop smoke failed" }
  } finally {
    Remove-Item Env:LINKS_SMOKE -ErrorAction SilentlyContinue
    Pop-Location
  }

  Write-Output "VERIFY_OK host=$($info.host) file=$name parallel=6 desktop=dev linkMps=$($info.linkMps)"
} finally {
  if ($started -and $proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
