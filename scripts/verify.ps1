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
$needStart = -not $health -or -not $health.ok -or $health.runtime -ne "node" -or $health.parallel -ne $true -or $health.adaptive -ne $true
try {
  $peek = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info" -TimeoutSec 2
  if ($null -eq $peek.linkMps -or $null -eq $peek.wifiJoin) { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'rings') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'version') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'needAllow') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'open') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'path') { $needStart = $true }
  if ($peek.phoneUrl -notmatch 'phone.html') { $needStart = $true }
  $page = Invoke-WebRequest -Uri "http://127.0.0.1:8730/" -UseBasicParsing -TimeoutSec 2
  if ($page.Headers["Cache-Control"] -ne "no-store") { $needStart = $true }
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
  if ($info.phoneUrl -notmatch 'phone=1') { throw "phoneUrl must be an explicit GET link" }
  if ($info.phoneUrl -notmatch '/phone.html') { throw "phoneUrl must open the dedicated phone page" }
  if ($info.PSObject.Properties.Name -notcontains 'rings') { throw "info.rings missing" }
  if (-not $info.version) { throw "info.version missing" }
  if ($info.ssid -isnot [string]) { throw "info.ssid must be a string" }
  if ($info.wifiJoin -isnot [bool]) { throw "info.wifiJoin must be a boolean" }
  if ($info.needAllow -isnot [bool]) { throw "info.needAllow must be a boolean" }
  if ($info.open -isnot [bool]) { throw "info.open must be a boolean" }
  if ($info.needAllow -eq $info.open) { throw "needAllow should be the opposite of open" }
  if ($info.usb -isnot [bool]) { throw "info.usb must be a boolean" }
  if ($info.path -ne "usb" -and $info.path -ne "wifi") { throw "info.path must be usb or wifi" }
  $rawInfo = (Invoke-WebRequest -Uri "http://127.0.0.1:8730/api/info" -UseBasicParsing).Content
  if ($rawInfo -match "WIFI:") { throw "wifi payload leaked in info" }

  node (Join-Path $RootFull "scripts\verify-lanes.mjs")
  if ($LASTEXITCODE -ne 0) { throw "lanes verify failed" }
  node (Join-Path $RootFull "scripts\verify-net.mjs")
  if ($LASTEXITCODE -ne 0) { throw "net verify failed" }
  $laneMod = ($RootFull -replace '\\', '/') + '/lanes.mjs'
  $expectLanes = node --input-type=module -e "import { lanesForLink } from 'file:///$laneMod'; process.stdout.write(String(lanesForLink($($info.linkMps))));"
  if ($LASTEXITCODE -ne 0) { throw "could not compute expected lanes" }
  if ([int]$health.lanes -ne [int]$expectLanes) { throw "health.lanes $($health.lanes) should be $expectLanes for linkMps=$($info.linkMps)" }
  if ([int]$info.lanes -ne [int]$expectLanes) { throw "info.lanes $($info.lanes) should be $expectLanes for linkMps=$($info.linkMps)" }

  $qrPage = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/qr-matrix?kind=page"
  if (-not $qrPage.matrix -or $qrPage.matrix.Count -lt 21) { throw "page qr missing" }
  if ($info.wifiJoin) {
    $qrWifi = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/qr-matrix?kind=wifi"
    if (-not $qrWifi.matrix -or $qrWifi.matrix.Count -lt 21) { throw "wifi join qr missing" }
  } else {
    $wifiDenied = $false
    try { Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/qr-matrix?kind=wifi" | Out-Null } catch { $wifiDenied = $true }
    if (-not $wifiDenied) { throw "wifi join qr should be absent when wifiJoin is false" }
  }

  node (Join-Path $RootFull "scripts\verify-wifi.mjs")
  if ($LASTEXITCODE -ne 0) { throw "wifi verify failed" }

  node (Join-Path $RootFull "scripts\verify-phone.mjs")
  if ($LASTEXITCODE -ne 0) { throw "phone verify failed" }

  node (Join-Path $RootFull "scripts\verify-update.mjs")
  if ($LASTEXITCODE -ne 0) { throw "update verify failed" }
  $updSrc = Get-Content -LiteralPath (Join-Path $RootFull "update.mjs") -Raw
  if ($updSrc -notmatch 'vFREE-1/ELinks') { throw "github update source missing" }
  if ($updSrc -notmatch 'WHOAME/ELinks') { throw "gitee update source missing" }
  if ($updSrc -match 'gitcode') { throw "gitcode should stay out of update sources" }
  $upd = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/update?local=1"
  if (-not $upd.ok) { throw "local update probe failed" }
  if ($upd.current -ne $info.version) { throw "update current mismatch $($upd.current)" }
  if ($upd.source -ne "local") { throw "local update probe should skip remotes" }

  $page = Invoke-WebRequest -Uri "http://127.0.0.1:8730/" -UseBasicParsing
  if ($page.Headers["Cache-Control"] -ne "no-store") { throw "waiting page must not be cached" }
  if ($page.Content -match 'id="join-net"|id="wifi-qr"') { throw "served page still has a second qr" }
  if ($page.Content -notmatch 'id="allow-lan"') { throw "served page is missing allow-lan" }
  if ($page.Content -notmatch 'id="join-wifi"') { throw "served page is missing the wifi join control" }
  if ($page.Content -notmatch 'join-wifi-title') { throw "served page still has the old wifi hint" }
  if ($page.Content -notmatch 'path-mark') { throw "served page is missing the folder icon" }

  $phonePage = Invoke-WebRequest -Uri "http://127.0.0.1:8730/phone.html" -UseBasicParsing
  if ($phonePage.Headers["Cache-Control"] -ne "no-store") { throw "phone page must not be cached" }
  if ($phonePage.Content -notmatch 'id="file-input"') { throw "phone page must expose the file input" }
  if ($phonePage.Content -notmatch 'pick-entry') { throw "phone page must use a dedicated upload entry" }
  if ($phonePage.Content -notmatch 'id="file-more"') { throw "phone page must keep a second pick entry after sending" }
  if ($phonePage.Content -match 'id="qr"') { throw "phone page must not include the waiting qr" }
  if ($phonePage.Content -match 'id="allow-lan"') { throw "phone page must not include allow-lan" }
  if ($phonePage.Content -match 'id="join-wifi"') { throw "phone page must not include wifi join" }
  if ($phonePage.Content -match 'id="desk-host"') { throw "phone page must not include the desktop address field" }
  if ($phonePage.Content -match 'id="host"') { throw "phone page should not ask for a host" }
  $sendMod = Invoke-WebRequest -Uri "http://127.0.0.1:8730/send.mjs" -UseBasicParsing
  if ($sendMod.StatusCode -ne 200) { throw "send.mjs must be reachable from the phone page" }
  if ($sendMod.Content -notmatch 'XMLHttpRequest') { throw "phone upload must use XHR so progress can move while sending" }
  if ($sendMod.Content -notmatch 'upload.onprogress') { throw "phone upload must listen to upload progress" }
  $blockedMjs = $false
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:8730/server.mjs" -UseBasicParsing | Out-Null
  } catch {
    $blockedMjs = $true
  }
  if (-not $blockedMjs) { throw "server.mjs must not be served to the phone" }

  $index = Get-Content -LiteralPath (Join-Path $RootFull "index.html") -Raw
  if ($index -notmatch 'Elinks') { throw "brand should be Elinks" }
  if ($index -notmatch 'Power by EndLessGo - vFREE') { throw "footer credit missing" }
  if ($index -match '千兆局域网') { throw "header still uses a marketing link label" }

  $clear = @{ savePath = $info.savePath; password = ""; rings = $true } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/config" -Method POST -ContentType "application/json; charset=utf-8" -Body ([Text.Encoding]::UTF8.GetBytes($clear)) | Out-Null
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

  $passCfg = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/config" -Method POST -ContentType "application/json" -Body (@{ savePath = $Received; password = "vtest"; rings = $false } | ConvertTo-Json)
  if (-not $passCfg.passwordSet) { throw "passwordSet should be true after setting a password" }
  if ($passCfg.rings -ne $false) { throw "rings off should persist" }
  $infoPass = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info"
  if ($infoPass.phoneUrl -notmatch '[?&]p=vtest') { throw "QR and copied link should carry the password in GET" }
  $needPass = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/pair" -Method POST -ContentType "application/json" -Body (@{ token = $info.token } | ConvertTo-Json)
  if (-not $needPass.needPassword) { throw "pair without password should ask" }
  $withPass = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/pair" -Method POST -ContentType "application/json" -Body (@{ token = $info.token; password = "vtest" } | ConvertTo-Json)
  if (-not $withPass.ok) { throw "pair with GET password failed" }

  $openDir = Assert-InsideRepo (Join-Path $Received ".verify-open-dir")
  New-Item -ItemType Directory -Force -Path $openDir | Out-Null
  Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/config" -Method POST -ContentType "application/json" -Body (@{ savePath = $openDir; password = ""; rings = $true } | ConvertTo-Json) | Out-Null
  $opened = Invoke-RestMethod -Uri ("http://127.0.0.1:8730/api/open-dir?path=" + [Uri]::EscapeDataString($openDir))
  $infoOpen = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info"
  $gotSave = [IO.Path]::GetFullPath($infoOpen.savePath)
  $wantSave = [IO.Path]::GetFullPath($openDir)
  if ($gotSave -ne $wantSave) { throw "open-dir did not keep the new save path: $gotSave" }
  Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/config" -Method POST -ContentType "application/json" -Body (@{ savePath = $Received; password = ""; rings = $true } | ConvertTo-Json) | Out-Null
  $openDir = Assert-InsideRepo $openDir
  if (Test-Path -LiteralPath $openDir) { Remove-Item -LiteralPath $openDir -Force -Recurse -ErrorAction SilentlyContinue }

  $pkg = Get-Content -LiteralPath (Join-Path $RootFull "package.json") -Raw | ConvertFrom-Json
  if ($pkg.scripts.dev -notmatch 'electron') { throw "package.json scripts.dev must start Electron" }
  if ($pkg.main -ne "desktop/main.mjs") { throw "package.json main must be desktop/main.mjs" }
  $main = Get-Content -LiteralPath (Join-Path $RootFull "desktop\main.mjs") -Raw
  if ($main -notmatch 'titleBarStyle:\s*"hidden"') { throw "desktop window must hide the native caption and overlay it" }
  if ($main -notmatch 'TITLEBAR = 40') { throw "title overlay should stay one toolbar row" }
  if ($main -notmatch 'function fitWindow') { throw "desktop window must fit waiting copy" }
  if ($main -notmatch 'DEFAULT_W = 1280') { throw "default window width should be 1280" }
  if ($main -notmatch 'DEFAULT_H = 840') { throw "default window height should be 840" }
  $mark = Assert-InsideRepo (Join-Path $RootFull "assets\mark.svg")
  $icon = Assert-InsideRepo (Join-Path $RootFull "assets\icon.png")
  if (-not (Test-Path -LiteralPath $mark)) { throw "missing brand mark" }
  if (-not (Test-Path -LiteralPath $icon)) { throw "missing window icon" }
  $index = Get-Content -LiteralPath (Join-Path $RootFull "index.html") -Raw
  if (($index | Select-String -Pattern '<div class="ripples"' -Context 0,1) -and ($index -notmatch '<i></i><i></i><i></i><i></i><i></i><i></i>')) {
    throw "waiting ripples should keep six rings"
  }
  if ($index -match 'demo-list|海岸延时|#busy') { throw "demo waiting/transfer mock still in index.html" }
  if ($index -notmatch 'id="tab-scan"') { throw "scan tab missing" }
  if ($index -notmatch 'id="tab-addr"') { throw "address tab missing" }
  if ($index -notmatch 'id="panel-scan"') { throw "scan panel missing" }
  if ($index -notmatch 'id="panel-addr"') { throw "address panel missing" }
  if ($index -notmatch 'stage-extra') { throw "wifi and allow-lan should stay below the tabs" }
  if ($index -notmatch '要连这个 Wi-Fi') { throw "wifi join should stay a separate action" }
  $live = Get-Content -LiteralPath (Join-Path $RootFull "live.js") -Raw
  if ($live -notmatch 'function setWaitTab') { throw "waiting tabs need a switch helper" }
  if ($live -match 'hidden = Boolean\(info && info.needAllow\)') { throw "wifi join must stay visible when allow-lan is shown" }
  $mainSrv = Get-Content -LiteralPath (Join-Path $RootFull "server.mjs") -Raw
  if ($mainSrv -notmatch 'async function allowLan') { throw "allow-lan must not freeze the waiting window" }
  if ($mainSrv -match 'Verb RunAs -Wait -WindowStyle Hidden') { throw "hidden RunAs swallows the confirm prompt" }
  if ($index -notmatch 'id="allow-lan"') { throw "allow-lan control missing" }
  if ($index -notmatch 'id="open-hotspot"') { throw "hotspot settings control missing" }
  $allow = Get-Content -LiteralPath (Join-Path $RootFull "scripts\allow-lan.ps1") -Raw
  if ($allow -notmatch 'Elinks receiver 8730') { throw "allow-lan script must name the firewall rule" }
  if ($allow -notmatch '-Profile Any') { throw "allow-lan script must cover public profiles" }
  if ($allow -notmatch 'allow-lan.result') { throw "allow-lan script must write a result file" }
  if ($allow -match 'Enabled -eq "True"') { throw "Enabled -eq True misses firewall enum values" }
  $allowCmd = Get-Content -LiteralPath (Join-Path $RootFull "scripts\allow-lan.cmd") -Raw
  if ($allowCmd -notmatch 'ExecutionPolicy Bypass') { throw "elevated allow-lan must bypass execution policy" }
  if ($mainSrv -notmatch 'allow-lan.cmd') { throw "allow-lan must launch the cmd wrapper so RunAs keeps the script path" }
  if ($mainSrv -notmatch 'allow-lan.result') { throw "allow-lan must read the elevated result file" }
  if ($index -notmatch 'join-wifi-title') { throw "wifi join copy should explain why the receive code fails" }
  if ($index -notmatch 'path-mark') { throw "save path should use a folder icon" }
  if ($index -match '<i class=.path-mark') { throw "save path mark is still a square" }
  if ($index -match 'lane-count">6') { throw "lane count should not be hardcoded" }
  if ($index -match 'id="join-net"|id="wifi-qr"') { throw "waiting screen should keep a single qr" }
  if ($index -notmatch 'id="copy-host"') { throw "copy address button missing" }
  if ($index -notmatch 'id="rings-toggle"') { throw "animation switch missing" }
  if ($index -notmatch 'id="random-password"') { throw "random password button missing" }
  if ($index -notmatch 'id="check-update"') { throw "update check missing" }
  if ($index -notmatch 'class="brand-name">Elinks</div>\s*<span class="brand-sub">桌面接收</span>') { throw "Elinks and 桌面接收 must stay on one toolbar row" }
  if ($index -match '<div>\s*<div class="brand-name">') { throw "brand subtitle must not wrap under the name" }
  if (Test-Path -LiteralPath (Join-Path $RootFull "busy.html")) { throw "demo busy.html should be removed" }
  $css = Get-Content -LiteralPath (Join-Path $RootFull "styles.css") -Raw
  if ($css -notmatch '--tracking-display') { throw "display tracking token missing" }
  if ($css -match 'letter-spacing:\s*-0\.0') { throw "negative headline tracking crowds CJK" }
  if ($css -notmatch '\.stage \{[\s\S]{0,280}justify-content:\s*center') { throw "QR and caption should sit together in the center" }
  if ($css -match '\.stage-main \{[\s\S]{0,80}flex:\s*1') { throw "QR block should not stretch away from the caption" }
  if ($css -notmatch 'html, body \{[\s\S]{0,120}overflow:\s*hidden') { throw "page must clip the native window scrollbar" }
  if ($css -notmatch '::-webkit-scrollbar') { throw "custom scrollbar missing" }
  if ($css -notmatch '\.brand \{[\s\S]{0,180}white-space:\s*nowrap') { throw "toolbar brand must stay on one row" }
  if ($css -match '\.ripples i \{[\s\S]{0,500}animation:\s*none') { throw "ripple rings must keep moving" }
  if ($css -notmatch 'ring-out 8\.8s') { throw "waiting rings should run at half speed" }
  if ($css -notmatch '--sky') { throw "sky blue token missing" }
  if ($css -notmatch 'scale\(var\(--ring-scale') { throw "waiting rings must reach the window edges" }
  if ($css -match 'scale\(3\.5\)') { throw "waiting rings still stop short of the window" }
  if ($css -notmatch '87,\s*199,\s*255|#57c7ff') { throw "waiting rings should be sky blue" }
  if ($index -notmatch '<div class="app">[\s\S]{0,160}<div class="ripples"') { throw "waiting rings must sit behind the whole window" }
  if ($css -notmatch '\.switch\.on') { throw "animation switch style missing" }
  if ($css -notmatch 'rings-off') { throw "animation off class missing" }
  if ($css -notmatch 'html.phone-page') { throw "phone page must override the desktop overflow clip" }
  if ($css -notmatch '\.pick-entry') { throw "phone upload entry style missing" }
  $live = Get-Content -LiteralPath (Join-Path $RootFull "live.js") -Raw
  if ($live -notmatch 'open-dir\?path=') { throw "open-dir must send the current save path" }
  if ($live -notmatch 'phone.html') { throw "scanned phone=1 links must open the phone page" }
  $phoneJs = Get-Content -LiteralPath (Join-Path $RootFull "phone.js") -Raw
  if ($phoneJs -notmatch 'get\(.p.\)') { throw "phone page must read the GET password" }
  if ($phoneJs -notmatch 'sendFiles') { throw "phone page must send through the shared uploader" }
  $sliceSrc = Get-Content -LiteralPath (Join-Path $RootFull "slice.mjs") -Raw
  if ($sliceSrc -notmatch '512 \* 1024') { throw "iphone slices must stay small so the first bytes leave sooner" }
  if ($mainSrv -match 'write\(Buffer.alloc\(1\)') { throw "part file must not punch a byte at EOF" }
  if ($mainSrv -notmatch 'created.truncate\(size\)') { throw "part file should truncate to size" }
  if ($mainSrv -notmatch 'item.received = Math.min\(size, item.received \+ n\)') { throw "received must move as bytes arrive" }
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

  Write-Output "VERIFY_OK host=$($info.host) file=$name parallel=$($info.lanes) desktop=dev linkMps=$($info.linkMps) wifiJoin=$($info.wifiJoin) needAllow=$($info.needAllow) open=$($info.open) usb=$($info.usb)"
} finally {
  if ($started -and $proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
