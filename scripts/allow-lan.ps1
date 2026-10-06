param(
  [string]$LanIp = ""
)

$ErrorActionPreference = "Stop"
$rule = "Elinks receiver 8730"
cmd.exe /c "netsh advfirewall firewall delete rule name=`"$rule`" >nul 2>&1"
$add = netsh advfirewall firewall add rule name="$rule" dir=in action=allow protocol=TCP localport=8730 profile=any
if ($LASTEXITCODE -ne 0) { throw "firewall add failed: $add" }

Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue |
  Where-Object { $_.Enabled -eq "True" -and $_.DisplayName -match "Node\.js|Electron|Elinks" } |
  Disable-NetFirewallRule -ErrorAction SilentlyContinue

if ($LanIp -match "^\d+\.\d+\.\d+\.\d+$") {
  $addr = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -eq $LanIp } |
    Select-Object -First 1
  if ($addr) {
    Set-NetConnectionProfile -InterfaceIndex $addr.InterfaceIndex -NetworkCategory Private -ErrorAction SilentlyContinue
  }
}

Write-Output "ALLOW_LAN_OK"
