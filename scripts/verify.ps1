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
  $ids = @()
  try {
    $lines = @(netstat -ano | Select-String ':8730')
    foreach ($line in $lines) {
      if ($line.Line -match '\sLISTENING\s+(\d+)\s*$') { $ids += [int]$Matches[1] }
    }
  } catch {
    $ids = @()
  }
  foreach ($procId in ($ids | Select-Object -Unique)) {
    try {
      $p = Get-Process -Id $procId -ErrorAction Stop
      if ($p.ProcessName -match 'node|electron') {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  Start-Sleep -Milliseconds 400
}

$started = $false
$proc = $null
$needStart = -not $health -or -not $health.ok -or $health.runtime -ne "node" -or $health.parallel -ne $true -or $health.adaptive -ne $true -or $health.tls -ne $true -or $health.discover -ne $true -or $health.clearDone -ne $true -or $health.sessionHold -ne $true -or $health.sessionDrain -ne $true -or $health.linkExtend -ne $true -or $health.hostIcon -ne $true -or $health.hostHistory -ne $true -or $health.hostForget -ne $true
try {
  $peek = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/info" -TimeoutSec 2
  if ($null -eq $peek.linkMps -or $null -eq $peek.wifiJoin) { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'rings') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'version') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'needAllow') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'open') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'path') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'usbHost') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'wifiHost') { $needStart = $true }
  if ($peek.phoneUrl -notmatch 'phone.html') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'httpsPort') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'discoverPort') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'alias') { $needStart = $true }
  if ($peek.PSObject.Properties.Name -notcontains 'discoverable') { $needStart = $true }
  if ($peek.link -ne $true) { $needStart = $true }
  if ($peek.openDir -ne $true) { $needStart = $true }
  $page = Invoke-WebRequest -Uri "http://127.0.0.1:8730/" -UseBasicParsing -TimeoutSec 2
  if ($page.Headers["Cache-Control"] -ne "no-store") { $needStart = $true }
  if ($page.Content -match 'id="open-phone"') { $needStart = $true }
  if ($page.Content -match 'id="peer-modal-status"') { $needStart = $true }
  if ($page.Content -notmatch 'id="busy-pick-more"') { $needStart = $true }
  if ($page.Content -notmatch 'busy-hero') { $needStart = $true }
  if ($page.Content -notmatch 'id="recv-universe"') { $needStart = $true }
  if ($page.Content -notmatch 'id="peer-modal-drop"') { $needStart = $true }
  if ($page.Content -notmatch 'id="peer-modal-extend"') { $needStart = $true }
  if ($page.Content -notmatch 'id="peer-modal-forget"') { $needStart = $true }
  if ($page.Content -notmatch 'id="clear-done"') { $needStart = $true }
  if ($page.Content -notmatch 'id="wifi-modal"') { $needStart = $true }
  if ($page.Content -notmatch 'class="qr-slot"') { $needStart = $true }
  if ($page.Content -notmatch 'id="link-queue"') { $needStart = $true }
  $xferPeek = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/transfers" -TimeoutSec 2
  if ($xferPeek.PSObject.Properties.Name -notcontains 'bonds') { $needStart = $true }
  if ($xferPeek.PSObject.Properties.Name -notcontains 'history') { $needStart = $true }
  $sendPeek = Invoke-WebRequest -Uri "http://127.0.0.1:8730/send.mjs" -UseBasicParsing -TimeoutSec 2
  if ($sendPeek.Content -notmatch 'function packSlices') { $needStart = $true }
  $phonePeek = Invoke-WebRequest -Uri "http://127.0.0.1:8730/phone.html" -UseBasicParsing -TimeoutSec 2
  if ($phonePeek.Content -match 'id="file-more"') { $needStart = $true }
  if ($phonePeek.Content -notmatch 'id="pick-label"') { $needStart = $true }
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
  if ($info.usbHost -isnot [string]) { throw "info.usbHost must be a string" }
  if ($info.wifiHost -isnot [string]) { throw "info.wifiHost must be a string" }
  if ($info.tls -isnot [bool]) { throw "info.tls must be a boolean" }
  if ([int]$info.httpsPort -ne 8731) { throw "https port should be 8731" }
  if ([int]$info.discoverPort -ne 8732) { throw "discover port should be 8732" }
  if (-not $info.alias) { throw "info.alias missing" }
  if ($info.discoverable -isnot [bool]) { throw "info.discoverable must be a boolean" }
  if ($info.link -ne $true) { throw "info.link handshake missing" }
  if ($info.httpsUrl -notmatch '^https://') { throw "httpsUrl must be https" }
  if ($info.path -ne "usb" -and $info.path -ne "wifi") { throw "info.path must be usb or wifi" }
  if ($info.usb -and $info.path -ne "usb") { throw "usb linked must prefer the usb path" }
  if (-not $info.usb -and $info.path -ne "wifi") { throw "no usb must stay on wifi path" }
  if ($info.usb -and $info.host -notlike "$($info.usbHost):*") { throw "preferred host must be the usb address" }
  if (-not $info.usb -and $info.wifiHost -and $info.host -notlike "$($info.wifiHost):*") { throw "preferred host must be the wifi address when usb is down" }
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

  node (Join-Path $RootFull "scripts\verify-resume.mjs")
  if ($LASTEXITCODE -ne 0) { throw "resume verify failed" }

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
  if ($page.Content -notmatch 'id="wifi-modal"' -or $page.Content -notmatch 'id="wifi-join-canvas"') { throw "wifi join must open a floating qr" }
  if ($page.Content -notmatch 'id="allow-lan"') { throw "served page is missing allow-lan" }
  if ($page.Content -notmatch 'id="join-wifi"') { throw "served page is missing the wifi join control" }
  if ($page.Content -notmatch 'join-wifi-title') { throw "served page still has the old wifi hint" }
  if ($page.Content -notmatch 'path-mark') { throw "served page is missing the folder icon" }

  $phonePage = Invoke-WebRequest -Uri "http://127.0.0.1:8730/phone.html" -UseBasicParsing
  if ($phonePage.Headers["Cache-Control"] -ne "no-store") { throw "phone page must not be cached" }
  if ($phonePage.Content -notmatch 'id="file-input"') { throw "phone page must expose the file input" }
  if ($phonePage.Content -notmatch 'pick-entry') { throw "phone page must use a dedicated upload entry" }
  if ($phonePage.Content -match 'id="file-more"') { throw "phone page must not keep a second pick entry under the list" }
  if ($phonePage.Content -notmatch 'id="pick-label"') { throw "phone pick button must switch to pick-more after the first batch" }
  if ($phonePage.Content -notmatch 'id="send-stop"') { throw "phone page must be able to cancel the session" }
  if ($phonePage.Content -notmatch 'id="send-list"') { throw "phone page must show the upload list" }
  if ($phonePage.Content -notmatch 'id="send-pct"') { throw "phone page must show overall upload percent" }
  if ($phonePage.Content -notmatch 'id="send-fill"') { throw "phone page must show overall upload progress" }
  if ($phonePage.Content -notmatch 'id="send-count"') { throw "phone page must show uploaded file counts" }
  if ($phonePage.Content -notmatch 'id="wechat-hint"') { throw "phone page must explain WeChat picker limits" }
  if ($phonePage.Content -notmatch 'mix-hint') { throw "phone page must explain WeChat cannot mix photos and videos in the album" }
  if ($phonePage.Content -match 'id="qr"') { throw "phone page must not include the waiting qr" }
  if ($phonePage.Content -match 'id="allow-lan"') { throw "phone page must not include allow-lan" }
  if ($phonePage.Content -match 'id="join-wifi"') { throw "phone page must not include wifi join" }
  if ($phonePage.Content -match 'id="desk-host"') { throw "phone page must not include the desktop address field" }
  if ($phonePage.Content -match 'id="host"') { throw "phone page should not ask for a host" }
  $sendMod = Invoke-WebRequest -Uri "http://127.0.0.1:8730/send.mjs" -UseBasicParsing
  if ($sendMod.StatusCode -ne 200) { throw "send.mjs must be reachable from the phone page" }
  $usbMod = Invoke-WebRequest -Uri "http://127.0.0.1:8730/usb-path.mjs" -UseBasicParsing
  if ($usbMod.StatusCode -ne 200) { throw "usb-path.mjs must be reachable from the phone page" }
  if ($usbMod.Content -notmatch 'shouldSwitchToUsb') { throw "usb-path.mjs must decide when to leave wifi" }
  if ($sendMod.Content -notmatch 'XMLHttpRequest') { throw "phone upload must use XHR so progress can move while sending" }
  if ($sendMod.Content -notmatch 'upload.onprogress') { throw "phone upload must listen to upload progress" }
  if ($sendMod.Content -notmatch 'missingSlices') { throw "uploader must skip slices already on disk" }
  $resumeMod = Invoke-WebRequest -Uri "http://127.0.0.1:8730/resume.mjs" -UseBasicParsing
  if ($resumeMod.StatusCode -ne 200) { throw "resume.mjs must be reachable from the phone page" }
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
  $listedDone = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/transfers"
  if (-not (@($listedDone.done) | Where-Object { $_.name -eq $name })) { throw "done list should include the upload before clear" }
  $cleared = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/transfers-clear" -Method POST -ContentType "application/json" -Body "{}"
  if (-not $cleared.ok) { throw "transfers-clear should succeed" }
  $afterClear = Invoke-RestMethod -Uri "http://127.0.0.1:8730/api/transfers"
  if (@($afterClear.done) | Where-Object { $_.name -eq $name }) { throw "clear must drop the display record" }
  if (-not (Test-Path -LiteralPath $dest)) { throw "clear must not delete the saved file" }
  Remove-Item -LiteralPath $dest

  if (Test-Path -LiteralPath $dest) { throw "failed to remove verify fixture" }

  node (Join-Path $RootFull "scripts\verify-parallel.mjs")
  if ($LASTEXITCODE -ne 0) { throw "parallel verify failed" }

  node (Join-Path $RootFull "scripts\verify-protocol.mjs")
  if ($LASTEXITCODE -ne 0) { throw "protocol verify failed" }

  node (Join-Path $RootFull "scripts\verify-send.mjs")
  if ($LASTEXITCODE -ne 0) { throw "send/discover ui verify failed" }

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
  if ($index -notmatch 'id="net-path"') { throw "transfer path must sit beside the speed chip" }
  if ($index -notmatch 'id="tab-recv"') { throw "receive tab missing" }
  if ($index -notmatch 'id="tab-send"') { throw "send tab missing" }
  if ($index -notmatch 'id="tab-link"') { throw "incoming link tab missing" }
  if ($index -notmatch 'id="peer-modal"') { throw "peer confirm modal missing" }
  if ($index -notmatch 'id="peer-modal-link"') { throw "send link button missing" }
  if ($index -notmatch 'id="link-allow"') { throw "allow link button missing" }
  if ($index -notmatch 'id="universe"') { throw "send universe missing" }
  if ($index -notmatch 'id="recv-universe"') { throw "receive QR universe missing" }
  if ($index -notmatch 'id="send-lines"' -or $index -notmatch 'id="recv-lines"') { throw "orb state lines missing" }
  if ($index -notmatch 'id="peer-modal-drop"') { throw "receiver disconnect button missing" }
  if ($index -notmatch 'id="alias-name"') { throw "alias setting missing" }
  if ($index -notmatch 'id="discover-toggle"') { throw "discover toggle missing" }
  if ($index -notmatch 'id="tab-scan"') { throw "scan tab missing" }
  if ($index -notmatch 'id="tab-addr"') { throw "address tab missing" }
  if ($index -notmatch 'id="panel-scan"') { throw "scan panel missing" }
  if ($index -notmatch 'id="panel-addr"') { throw "address panel missing" }
  if ($index -notmatch 'stage-extra') { throw "wifi and allow-lan should stay below the tabs" }
  if ($index -match 'id="allow-lan" hidden') { throw "allow-lan must stay on the waiting page" }
  if ($index -notmatch 'id="nav-allow-lan"') { throw "allow-lan must stay in the top bar" }
  if ($index -notmatch 'id="settings-allow-lan"') { throw "allow-lan must stay in settings" }
  if ($index -notmatch '允许防火墙通过') { throw "allow-lan must keep a visible firewall entry" }
  if ($index -notmatch 'id="wifi-modal"') { throw "wifi join must open a floating qr modal" }
  if ($index -notmatch 'id="wifi-join-canvas"') { throw "wifi join modal must show a qr" }
  if ($index -match 'id="open-phone"') { throw "desktop waiting chrome must not include a phone-page entry" }
  $live = Get-Content -LiteralPath (Join-Path $RootFull "live.js") -Raw
  if ($live -notmatch 'function hideSettings') { throw "settings must close when clicking outside the sheet" }
  if ($live -notmatch 'sheet\.contains\(e\.target\)') { throw "outside click must ignore presses inside the settings sheet" }
  if ($live -notmatch 'open-settings"\)[\s\S]{0,80}contains\(e\.target\)') { throw "outside click must ignore the settings button itself" }
  if ($live -notmatch 'function setWaitTab') { throw "waiting tabs need a switch helper" }
  if ($live -notmatch 'function setDeskMode') { throw "receive/send tabs need a desk mode switch" }
  if ($live -notmatch 'function requestLink') { throw "send page must request a link before picking files" }
  if ($live -notmatch 'function drawLines') { throw "orb lines must be drawn between machines" }
  if ($live -notmatch 'function renderRecvOrbs') { throw "receive QR page must show bonded orbs" }
  if ($live -notmatch 'function dropBond') { throw "receiver must be able to drop a live bond" }
  if ($live -notmatch 'function setLinkButton') { throw "link handshake status must appear on the send button" }
  if ($live -notmatch 'function rememberOutbound') { throw "send progress must keep completed files after the batch" }
  if ($live -notmatch 'busy-pick-more') { throw "send progress must offer pick more files" }
  if ($index -notmatch 'id="busy-pick-more"') { throw "progress list must include a pick-more control" }
  if ($index -notmatch 'busy-hero') { throw "progress page must put speed and percent in a hero" }
  if ($index -notmatch 'busy-boards') { throw "progress page must split live and done into two boards" }
  if ($index -notmatch 'id="live-empty"') { throw "progress page must explain the empty live list" }
  if ($index -notmatch 'id="clear-done"') { throw "completed list must offer to clear display records" }
  $appJs = Get-Content -LiteralPath (Join-Path $RootFull "app.js") -Raw
  if ($appJs -match '返回等待') { throw "busy nav must say 返回接收, not 返回等待" }
  if ($appJs -notmatch '返回接收') { throw "busy nav must say 返回接收" }
  if ($appJs -notmatch 'nav-back') { throw "return-to-receive must be highlighted" }
  if ($live -notmatch 'function clearDoneRecords') { throw "completed list clear must only wipe display records" }
  if ($live -notmatch 'function syncBusyEmpty') { throw "empty hints must hide when files arrive" }
  if ($index -match 'id="peer-modal-status"') { throw "waiting copy must not sit on a faint line above the button" }
  if ($live -notmatch 'function showNetPath') { throw "toolbar must show whether the path is usb or wifi" }
  if ($live -notmatch 'path === "usb"') { throw "path chip must light up when usb is the transfer path" }
  if ($live -match 'hidden = Boolean\(info && info.needAllow\)') { throw "wifi join must stay visible when allow-lan is shown" }
  if ($live -match 'qrMode !== "page" \|\| !info \|\| !info.needAllow') { throw "allow-lan must stay visible after the probe" }
  if ($live -notmatch 'function requestAllowLan') { throw "allow-lan click must be reusable from the top bar" }
  if ($live -match 'function showWifiQr' -or $live -match 'qrMode = "wifi"') { throw "wifi join must not replace the receive qr" }
  if ($live -notmatch 'function openWifiModal' -or $live -notmatch 'function paintWifiModal') { throw "wifi join must open a floating qr" }
  if ($live -match 'info.linkMps \? String') { throw "zero linkMps must not hide the cap as a dash" }
  if ($live -notmatch 'Number.isFinite\(cap\)') { throw "speed chip must show when the link rate is still being measured" }
  $mainSrv = Get-Content -LiteralPath (Join-Path $RootFull "server.mjs") -Raw
  if ($mainSrv -notmatch '/api/transfers-clear') { throw "clearing completed records must not touch saved files" }
  if ($mainSrv -notmatch 'function voidSession') { throw "phone cancel must still abort the session" }
  if ($mainSrv -notmatch 'function closeSession') { throw "drop and expiry must close the link without killing the current upload" }
  if ($mainSrv -notmatch 'rec.closed && !transfers.has\(key\)') { throw "closed sessions must reject new files only" }
  if ($mainSrv -notmatch 'LINK_HOLD_MS = 60 \* 60 \* 1000') { throw "accepted links must persist for one hour" }
  if ($mainSrv -notmatch 'LINK_EXTEND_MS = 2 \* 60 \* 60 \* 1000') { throw "extend must add two hours" }
  if ($mainSrv -notmatch '/api/link-extend') { throw "receiver must be able to extend a live bond" }
  if ($live -notmatch 'function formatHold') { throw "bond countdown must show hours minutes and seconds" }
  if ($live -notmatch 'function ballPoint') { throw "orb lines must meet the center of the ball" }
  if ($index -notmatch 'id="peer-modal-extend"') { throw "extend connection button missing" }
  if ($mainSrv -notmatch 'reuseAccepted' -or $mainSrv -notmatch '/api/link-drop') { throw "accepted links must reuse and allow receiver drop" }
  if ($mainSrv -notmatch 'function rememberHost' -or $mainSrv -notmatch 'function historyHosts') { throw "receiver must keep past hosts after a drop" }
  if ($mainSrv -notmatch '/api/host-forget' -or $mainSrv -notmatch 'function forgetHost') { throw "past hosts must be removable from the receive page" }
  if ($index -notmatch 'id="peer-modal-forget"') { throw "history host modal must offer 移除" }
  if ($index -notmatch 'class="modal-actions"') { throw "peer modal actions must sit on one row" }
  if ($live -notmatch 'function forgetBond') { throw "remove must take a past host off the receive page" }
  if ($live -notmatch 'data.history') { throw "receive page must render past hosts" }
  if ($mainSrv -notmatch 'async function allowLan') { throw "allow-lan must not freeze the waiting window" }
  if ($mainSrv -match 'Verb RunAs -Wait -WindowStyle Hidden') { throw "hidden RunAs swallows the confirm prompt" }
  if ($index -notmatch 'id="allow-lan"') { throw "allow-lan control missing" }
  if ($index -notmatch 'id="open-hotspot"') { throw "hotspot settings control missing" }
  if ($index -notmatch 'id="close-settings"[\s\S]{0,400}id="app-version"') { throw "settings version must sit at the bottom of the sheet" }
  if ($index -notmatch 'class="sheet-hint"') { throw "usb hint in settings must use the quieter caption style" }
  $allow = Get-Content -LiteralPath (Join-Path $RootFull "scripts\allow-lan.ps1") -Raw
  if ($allow -notmatch 'Elinks receiver 8730') { throw "allow-lan script must name the firewall rule" }
  if ($allow -notmatch '-Profile Any') { throw "allow-lan script must cover public profiles" }
  if ($allow -notmatch 'allow-lan.result') { throw "allow-lan script must write a result file" }
  if ($allow -match 'Enabled -eq "True"') { throw "Enabled -eq True misses firewall enum values" }
  $allowCmd = Get-Content -LiteralPath (Join-Path $RootFull "scripts\allow-lan.cmd") -Raw
  if ($allowCmd -notmatch 'ExecutionPolicy Bypass') { throw "elevated allow-lan must bypass execution policy" }
  if ($mainSrv -notmatch 'allow-lan.cmd') { throw "allow-lan must launch the cmd wrapper so RunAs keeps the script path" }
  if ($mainSrv -notmatch 'allow-lan.result') { throw "allow-lan must read the elevated result file" }
  if ($mainSrv -notmatch 'scriptFile\("allow-lan.cmd"\)') { throw "allow-lan must run the unpacked script" }
  if ($mainSrv -notmatch 'appHome\(\)') { throw "packaged app must keep config and photos outside the install folder" }
  if ($mainSrv -notmatch 'psQuote\(DATA\)') { throw "allow-lan must pass the writable data directory" }
  if ($allow -notmatch '\$DataDir') { throw "allow-lan must accept a data directory so the installer can write outside Program Files" }
  if ($allowCmd -notmatch 'DataDir') { throw "allow-lan cmd must forward the data directory" }
  if ($index -notmatch 'join-wifi-title') { throw "wifi join copy should explain why the receive code fails" }
  if ($index -notmatch 'path-mark') { throw "save path should use a folder icon" }
  if ($index -match '<i class=.path-mark') { throw "save path mark is still a square" }
  if ($index -match 'lane-count">6') { throw "lane count should not be hardcoded" }
  if ($index -match 'id="join-net"|id="wifi-qr"') { throw "waiting screen should keep a single qr" }
  if ($index -notmatch 'id="copy-host"') { throw "copy address button missing" }
  if ($index -notmatch 'id="rings-toggle"') { throw "animation switch missing" }
  if ($index -notmatch 'id="random-password"') { throw "random password button missing" }
  if ($index -notmatch 'id="check-update"') { throw "update check missing" }
  if ($index -notmatch 'class="brand-name">Elinks</div>\s*<span class="brand-sub"[^>]*>局域网文件互传</span>') { throw "Elinks and brand-sub must stay on one toolbar row" }
  if ($index -match '<div>\s*<div class="brand-name">') { throw "brand subtitle must not wrap under the name" }
  if (Test-Path -LiteralPath (Join-Path $RootFull "busy.html")) { throw "demo busy.html should be removed" }
  $css = Get-Content -LiteralPath (Join-Path $RootFull "styles.css") -Raw
  if ($css -notmatch '\.modal-facts \{[\s\S]{0,180}grid-template-columns:\s*1fr 1fr') { throw "peer facts should sit two-up" }
  if ($css -notmatch '\.modal-actions') { throw "peer modal 移除 and 取消 must sit on one row" }
  if ($css -notmatch '\.sheet-hint \{[\s\S]{0,120}font-size:\s*11px') { throw "settings usb hint must stay smaller than body copy" }
  if ($css -notmatch '\.sheet-extra \.text \{[\s\S]{0,160}font-size:\s*12px') { throw "settings extra links must stay at 12px" }
  if ($css -notmatch '\.update-row \{[\s\S]{0,220}font-size:\s*11px') { throw "settings version footer must stay small" }
  if ($css -match 'html\.is-busy #mode[\s\S]{0,160}background:\s*#1f6feb') { throw "return-to-receive should use text color, not a filled background" }
  if ($css -notmatch '--tracking-display') { throw "display tracking token missing" }
  if ($css -match 'letter-spacing:\s*-0\.0') { throw "negative headline tracking crowds CJK" }
  if ($css -notmatch '\.stage \{[\s\S]{0,280}justify-content:\s*center') { throw "QR and caption should sit together in the center" }
  if ($css -match '\.stage-main \{[\s\S]{0,80}flex:\s*1') { throw "QR block should not stretch away from the caption" }
  if ($css -match 'recv-universe\.has-orbs') { throw "receive orbs must not resize the QR layout" }
  if ($css -match '\.recv-universe \{[\s\S]{0,220}z-index:\s*[3-9]') { throw "receive orbs must sit behind the QR, not cover it" }
  if ($css -notmatch 'html\.is-desktop #qr \{[\s\S]{0,40}width:\s*248px') { throw "desktop receive QR must stay 248px" }
  if ($css -notmatch '\.recv-universe \.orb i \{[\s\S]{0,80}width:\s*32px') { throw "receive host icons must stay smaller than the send-page icons" }
  if ($css -notmatch '\.orb-line\.linked,[\s\S]{0,40}\.orb-line\.live \{ stroke:\s*#34c759') { throw "connected host lines must be green" }
  if ($css -notmatch 'host-bezel') { throw "hosts must use the computer icon, not a solid orb" }
  if ($css -notmatch '\.orb\.self \.host-bezel,[\s\S]{0,80}fill:\s*#34c759') { throw "this-computer icon must be green" }
  if ($live -notmatch 'ballPoint\(field, \$\("orb-self"\)') { throw "send lines must meet the center of this computer" }
  if ($live -notmatch 'const HOST_ICON') { throw "host icon mark missing" }
  if ($live -notmatch 'function recvOrbPoint') { throw "receive hosts must sit farther from the QR" }
  if ($live -notmatch 'id="link-queue"' -and $index -notmatch 'id="link-queue"') { throw "queued authorizations must show a remaining count" }
  if ($index -notmatch 'id="link-queue"') { throw "authorization queue copy missing" }
  if ($live -match 'function respondLink[\s\S]{0,500}setMode\(true\)') { throw "allowing one host must not jump away while others are still waiting" }
  if ($css -notmatch 'vector-effect:\s*non-scaling-stroke') { throw "orb lines must stay thin" }
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
  if ($css -notmatch '\.net-path') { throw "speed chip must leave room for the transfer path" }
  $live = Get-Content -LiteralPath (Join-Path $RootFull "live.js") -Raw
  if ($live -notmatch 'open-dir\?path=') { throw "open-dir must send the current save path" }
  if ($live -match 'persistConfig\(\)\.then\(function \(\) \{\s*fetch\("/api/open-dir') { throw "open-dir must not wait on config before opening explorer" }
  if ($mainSrv -match 'execFile\("explorer.exe"') { throw "explorer.exe must be started detached so the folder window is visible" }
  if ($mainSrv -notmatch 'start"", "explorer.exe"' -and $mainSrv -notmatch 'start", "", "explorer.exe"') { throw "open-dir must launch explorer via start" }
  if ($live -notmatch 'phone.html') { throw "scanned phone=1 links must open the phone page" }
  $phoneJs = Get-Content -LiteralPath (Join-Path $RootFull "phone.js") -Raw
  if ($phoneJs -notmatch 'get\(.p.\)') { throw "phone page must read the GET password" }
  if ($phoneJs -notmatch 'sendFiles') { throw "phone page must send through the shared uploader" }
  if ($phoneJs -match '" B"' -or $phoneJs -match '" MB"') { throw "phone sizes must use M, not B" }
  if ($live -match 'return bytes \+ " B"' -or $live -match '" MB"') { throw "desktop sizes must use M, not B" }
  $sendJs = Get-Content -LiteralPath (Join-Path $RootFull "send.mjs") -Raw
  if ($sendJs -match 'activeVideo') { throw "send lanes must spread across files" }
  if ($sendJs -notmatch 'pick.inflight') { throw "send must keep several files in flight" }
  if ($phoneJs -notmatch 'shouldSwitchToUsb') { throw "phone page must follow the usb address when the cable is up" }
  if ($phoneJs -notmatch 'usb-path') { throw "phone page must load the usb switch helper" }
  if ($phoneJs -notmatch 'cancelSend') { throw "phone page must cancel in-flight uploads" }
  if ($phoneJs -notmatch '/api/cancel') { throw "phone page must tell the receiver to drop the session" }
  if ($phoneJs -notmatch 'MicroMessenger') { throw "phone page must detect WeChat in-app browser" }
  if ($phoneJs -notmatch 'function takeInputFiles') { throw "phone page must copy the FileList before clearing the input" }
  if ($phoneJs -notmatch 'send-pct') { throw "phone page must update overall upload percent" }
  if ($phoneJs -notmatch 'AbortController') { throw "phone page must not wait forever on info" }
  if ($phoneJs -notmatch 'function unlockWeChatPicker') { throw "WeChat picker must drop accept so photos and videos can mix" }
  if ($phoneJs -notmatch 'function setPickLabel') { throw "after the first batch the top pick must become pick-more" }
  if ($phoneJs -notmatch 'setPickLabel\(true\)') { throw "started uploads must relabel the top pick instead of adding a second button" }
  if ($phoneJs -notmatch 'removeAttribute\(.accept.\)') { throw "WeChat file input must not keep an accept filter" }
  if ($phoneJs -match 'const files = \$\("file-input"\)\.files;\s*\$\("file-input"\)\.value') { throw "clearing the live FileList drops the selection on Android" }
  if ($sendMod.Content -notmatch 'slices: null') { throw "uploader must not wait to resume every file before the first PUT" }
  if ($sendMod.Content -notmatch 'function packSlices') { throw "uploader must grow slices when the link is fast" }
  if ($sendMod.Content -notmatch 'function retuneItem') { throw "uploader must auto-detect slice size from transfer rate" }
  if ($mainSrv -match '\}; else \{') { throw "nic speed probe must keep a real powershell if/else" }
  if ($mainSrv -notmatch 'measuredMps') { throw "receiver must learn transfer rate from live uploads" }
  if ($mainSrv -notmatch 'pickHosts') { throw "receiver must pick usb over wifi" }
  if ($mainSrv -notmatch 'usb-path.mjs') { throw "usb-path.mjs must be on the client allow list" }
  $sliceSrc = Get-Content -LiteralPath (Join-Path $RootFull "slice.mjs") -Raw
  if ($sliceSrc -notmatch '512 \* 1024') { throw "iphone slices must stay small so the first bytes leave sooner" }
  if ($mainSrv -match 'write\(Buffer.alloc\(1\)') { throw "part file must not punch a byte at EOF" }
  if ($mainSrv -notmatch 'created.truncate\(size\)') { throw "part file should truncate to size" }
  if ($mainSrv -notmatch 'rangeBytes\(item.ranges\)') { throw "received must follow completed ranges" }
  if ($mainSrv -notmatch '/api/resume') { throw "receiver must answer resume queries" }
  if ($mainSrv -notmatch '/api/cancel') { throw "receiver must cancel a session" }
  if ($mainSrv -notmatch 'HTTPS_PORT') { throw "receiver must listen on https" }
  if ($mainSrv -notmatch 'startDiscover') { throw "receiver must announce itself on the lan" }
  $discoverSrc = Get-Content -LiteralPath (Join-Path $RootFull "discover.mjs") -Raw
  if ($discoverSrc -notmatch '255.255.255.255') { throw "discover must broadcast so wifi can see nearby pcs" }
  if ($discoverSrc -notmatch 'setMulticastInterface') { throw "discover must pick the lan nic instead of a vpn nic" }
  if ($discoverSrc -notmatch 'announce\(true\)') { throw "discover must probe nearby machines" }
  if ($mainSrv -match 'execFileSync') { throw "receiver must not freeze on sync powershell during info" }
  if ($mainSrv -notmatch 'peekLink') { throw "info must answer from cached wifi link" }
  node (Join-Path $RootFull "scripts\verify-pack.mjs")
  if ($LASTEXITCODE -ne 0) { throw "pack config verify failed" }

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
