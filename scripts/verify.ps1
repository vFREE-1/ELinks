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

$started = $false
$proc = $null
if (-not $health) {
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
  Write-Output "VERIFY_OK host=$($info.host) file=$name"
} finally {
  if ($started -and $proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
