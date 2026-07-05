# Send WOL magic packet (local test). Usage: .\send-wol-magic-packet.ps1 [-Mac A8-A1-59-BF-42-CC]
param(
  [string]$Mac = 'A8-A1-59-BF-42-CC',
  [string]$Broadcast = '',
  [int[]]$Ports = @(7, 9)
)

function Normalize-Mac([string]$m) { ($m -replace '[^0-9A-Fa-f]', '').ToUpper() }

$hex = Normalize-Mac $Mac
if ($hex.Length -ne 12) { throw "Bad MAC: $Mac" }

$macBytes = for ($i = 0; $i -lt 12; $i += 2) { [Convert]::ToByte($hex.Substring($i, 2), 16) }
$payload = [byte[]](,0xFF * 6)
for ($r = 0; $r -lt 16; $r++) { $payload += $macBytes }

if (-not $Broadcast) {
  $Broadcast = '255.255.255.255'
  $ad = Get-NetAdapter | Where-Object { (Normalize-Mac $_.MacAddress) -eq $hex -and $_.Status -eq 'Up' } | Select-Object -First 1
  if ($ad) {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $ad.ifIndex -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '169.*' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1
    if ($ip) {
      $mask = $ip.PrefixLength
      $ipBytes = [System.Net.IPAddress]::Parse($ip.IPAddress).GetAddressBytes()
      $maskBytes = [uint32]0
      for ($i = 0; $i -lt $mask; $i++) { $maskBytes = ($maskBytes -shl 1) -bor 1 }
      $maskArr = [BitConverter]::GetBytes([uint32]$maskBytes)
      if ([BitConverter]::IsLittleEndian) { [array]::Reverse($maskArr) }
      $bcast = New-Object byte[] 4
      for ($i = 0; $i -lt 4; $i++) { $bcast[$i] = [byte]($ipBytes[$i] -bor ($maskArr[$i] -bxor 255)) }
      $Broadcast = ([System.Net.IPAddress]::new($bcast)).ToString()
    }
  }
}

$udp = New-Object System.Net.Sockets.UdpClient
$udp.EnableBroadcast = $true
foreach ($port in $Ports) {
  $end = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Parse($Broadcast), $port)
  [void]$udp.Send($payload, $payload.Length, $end)
  Write-Host "[WOL send] -> $Broadcast`:$port  MAC=$Mac  len=$($payload.Length)"
}
$udp.Close()
