# Listen for Wake-on-LAN magic packets while PC is ON.
# Run on PC, then press router WOL / phone app. No shutdown needed.
param(
  [string]$TargetMac = 'A8-A1-59-BF-42-CC',
  [int[]]$Ports = @(7, 9),
  [int]$Seconds = 120
)

$ErrorActionPreference = 'Stop'

function Normalize-Mac([string]$mac) {
  ($mac -replace '[^0-9A-Fa-f]', '').ToUpper()
}

function Test-MagicPayload([byte[]]$bytes, [string]$wantMac) {
  if ($bytes.Length -lt 102) { return $false }
  $sync = $true
  for ($i = 0; $i -lt 6; $i++) {
    if ($bytes[$i] -ne 0xFF) { $sync = $false; break }
  }
  if (-not $sync) { return $false }
  $macHex = Normalize-Mac $wantMac
  if ($macHex.Length -ne 12) { return $false }
  $macBytes = for ($i = 0; $i -lt 12; $i += 2) {
    [Convert]::ToByte($macHex.Substring($i, 2), 16)
  }
  for ($rep = 0; $rep -lt 16; $rep++) {
    $off = 6 + ($rep * 6)
    for ($j = 0; $j -lt 6; $j++) {
      if ($bytes[$off + $j] -ne $macBytes[$j]) { return $false }
    }
  }
  $true
}

$want = Normalize-Mac $TargetMac
$ad = Get-NetAdapter | Where-Object { (Normalize-Mac $_.MacAddress) -eq $want } | Select-Object -First 1
$ip = if ($ad) {
  (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $ad.ifIndex -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '169.*' } | Select-Object -First 1).IPAddress
} else { $null }

Write-Host ''
Write-Host '[WOL test] Magic packet listener (PC stays ON)'
Write-Host "[WOL test] Target MAC: $TargetMac"
if ($ad) { Write-Host "[WOL test] Adapter: $($ad.Name)  IP: $ip" }
Write-Host "[WOL test] Ports: $($Ports -join ', ')   Timeout: ${Seconds}s"
Write-Host ''
Write-Host 'Now on router/phone: WOL -> PC 켜기 (or send magic packet).'
Write-Host 'If packet arrives here, router+LAN path is OK.'
Write-Host 'If PC still wont wake from shutdown -> BIOS ErP / Wake on LAN.'
Write-Host ''

$clients = @()
foreach ($port in $Ports) {
  try {
    $c = New-Object System.Net.Sockets.UdpClient($port)
    $c.Client.SetSocketOption(
      [System.Net.Sockets.SocketOptionLevel]::Socket,
      [System.Net.Sockets.SocketOptionName]::ReuseAddress,
      $true
    ) | Out-Null
    $clients += [PSCustomObject]@{ Port = $port; Client = $c }
    Write-Host "[WOL test] Listening UDP :$port"
  } catch {
    Write-Host "[WOL test] WARN: cannot bind UDP :$port ($($_.Exception.Message))"
  }
}

if (-not $clients.Count) {
  Write-Host '[WOL test] ERROR: no ports open. Try: scripts\test-wol-packet-receive.cmd (admin)'
  exit 1
}

$deadline = (Get-Date).AddSeconds($Seconds)
$got = $false

while ((Get-Date) -lt $deadline -and -not $got) {
  foreach ($entry in $clients) {
    $client = $entry.Client
    if (-not $client.Available) { continue }
    $remote = New-Object System.Net.IPEndPoint([System.Net.IPAddress]::Any, 0)
    $data = $client.Receive([ref]$remote)
    $ts = Get-Date -Format 'HH:mm:ss'
    $hexLen = $data.Length
    $isMagic = Test-MagicPayload $data $want
    Write-Host "[$ts] UDP :$($entry.Port) from $($remote.Address):$($remote.Port)  len=$hexLen  magic=$isMagic"
    if ($isMagic) {
      Write-Host ''
      Write-Host '[WOL test] SUCCESS: magic packet received for your MAC.'
      Write-Host 'Router/LAN path works. Shutdown wake failure -> check BIOS Wake on LAN + disable ErP.'
      $got = $true
      break
    }
  }
  if (-not $got) { Start-Sleep -Milliseconds 200 }
}

foreach ($entry in $clients) { $entry.Client.Close() }

if (-not $got) {
  Write-Host ''
  Write-Host '[WOL test] TIMEOUT: no matching magic packet.'
  Write-Host 'Check: router WOL MAC, same LAN/Wi-Fi, AP isolation off, try phone WOL app.'
  exit 2
}

exit 0
