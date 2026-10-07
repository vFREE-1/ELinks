param(
  [string]$LanIp = "",
  [string]$NodeExe = "",
  [string]$DataDir = ""
)

$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$data = Join-Path $root "data"
if ($DataDir) {
  $candidate = [IO.Path]::GetFullPath($DataDir)
  $repo = [IO.Path]::GetFullPath($root)
  $prefix = $repo.TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
  $underRepo = $candidate.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $candidate.Equals($repo, [StringComparison]::OrdinalIgnoreCase)
  $leafOk = $candidate -match '(?i)[\\/]Elinks[\\/]data$'
  if ($underRepo -or $leafOk) { $data = $candidate }
}
$result = Join-Path $data "allow-lan.result"
New-Item -ItemType Directory -Force -Path $data | Out-Null

function Finish([int]$code, [string]$msg) {
  Set-Content -LiteralPath $result -Value $msg -Encoding utf8
  exit $code
}

try {
  Get-NetFirewallRule -DisplayName "Elinks receiver 8730" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Elinks receiver 8730" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8730 -Profile Any -ErrorAction Stop | Out-Null
  Get-NetFirewallRule -DisplayName "Elinks receiver 8731" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Elinks receiver 8731" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8731 -Profile Any -ErrorAction SilentlyContinue | Out-Null
  Get-NetFirewallRule -DisplayName "Elinks discover 8732" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue
  New-NetFirewallRule -DisplayName "Elinks discover 8732" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 8732 -Profile Any -ErrorAction SilentlyContinue | Out-Null

  Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match "Node\.js|Electron|Elinks" } |
    Disable-NetFirewallRule -ErrorAction SilentlyContinue

  $electron = Join-Path $root "node_modules\electron\dist\electron.exe"
  foreach ($exe in @($NodeExe, $electron)) {
    if (-not $exe -or -not (Test-Path -LiteralPath $exe)) { continue }
    $leaf = [IO.Path]::GetFileNameWithoutExtension($exe)
    $name = "Elinks " + $leaf
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue |
      Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Program $exe -Profile Any -ErrorAction SilentlyContinue | Out-Null
  }

  if ($LanIp -match "^\d+\.\d+\.\d+\.\d+$") {
    $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -eq $LanIp } |
      Select-Object -First 1
    if ($addr) {
      Set-NetConnectionProfile -InterfaceIndex $addr.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
    }
  }

  $rule = Get-NetFirewallRule -DisplayName "Elinks receiver 8730" -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if (-not $rule) { throw "port rule missing after add" }

  $blocks = @(Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
    Where-Object {
      $_.DisplayName -match "Node\.js|Electron|Elinks" -and $_.Enabled.ToString() -eq "True"
    })
  if ($blocks.Count -gt 0) { throw ("still blocked: " + (($blocks | ForEach-Object { $_.DisplayName }) -join ", ")) }

  Finish 0 "ALLOW_LAN_OK"
} catch {
  Finish 1 ("ALLOW_LAN_ERR " + $_.Exception.Message)
}
