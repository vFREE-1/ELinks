param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$Dns = "localhost,127.0.0.1"
)

$ErrorActionPreference = "Stop"
$full = [IO.Path]::GetFullPath($OutDir)
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$prefix = $root.TrimEnd("\", "/") + [IO.Path]::DirectorySeparatorChar
if (-not ($full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or $full.Equals($root, [StringComparison]::OrdinalIgnoreCase))) {
  throw "Refusing path outside repo: $full"
}
New-Item -ItemType Directory -Force -Path $full | Out-Null

$names = @($Dns.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($names.Count -lt 1) { $names = @("localhost") }

$cert = New-SelfSignedCertificate -Subject "CN=Elinks" -DnsName $names -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(5) -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable -FriendlyName "Elinks"
try {
  $pwd = ConvertTo-SecureString -String "elinks-tls" -Force -AsPlainText
  Export-PfxCertificate -Cert $cert -FilePath (Join-Path $full "cert.pfx") -Password $pwd | Out-Null
} finally {
  Remove-Item -LiteralPath ("Cert:\CurrentUser\My\" + $cert.Thumbprint) -Force -ErrorAction SilentlyContinue
}
