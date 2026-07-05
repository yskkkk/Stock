# Listen for Wake-on-LAN magic packets while PC is ON.
# Run on PC, then press router WOL / phone app. No shutdown needed.
param(
  [string]$TargetMac = 'A8-A1-59-BF-42-CC',
  [int[]]$Ports = @(7, 9),
  [int]$Seconds = 120,
  [switch]$SelfTest
)

function New-WolUdpListener([int]$port) {
  $socket = New-Object System.Net.Sockets.Socket(
    [System.Net.Sockets.AddressFamily]::InterNetwork,
    [System.Net.Sockets.SocketType]::Dgram,
    [System.Net.Sockets.ProtocolType]::Udp
  )
  $socket.SetSocketOption(
    [System.Net.Sockets.SocketOptionLevel]::Socket,
    [System.Net.Sockets.SocketOptionName]::ReuseAddress,
    $true
  ) | Out-Null
  if ([System.Net.Sockets.Socket]::OSSupportsIPv4) {
    try {
      $socket.SetSocketOption(
        [System.Net.Sockets.SocketOptionLevel]::Socket,
        [System.Net.Sockets.SocketOptionName]::ExclusiveAddressUse,
        $false
      ) | Out-Null
    } catch { }
  }
  $socket.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any, $port))
  $client = New-Object System.Net.Sockets.UdpClient
  $client.Client = $socket
  $client
}

function Get-PortOwnerPid([int]$port) {
  $line = netstat -ano | Select-String "UDP\s+\S+:$port\s" | Select-Object -First 1
  if (-not $line) { return $null }
  ($line -split '\s+')[-1]
}

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
Write-Host 'IMPORTANT: Many routers (incl. LG U+) do NOT send WOL when PC is already online.'
Write-Host 'Router [PC 켜기] may do nothing while this test runs.'
Write-Host 'Use a phone WOL app on same Wi-Fi instead (always sends).'
Write-Host ''
Write-Host 'If packet arrives -> LAN path OK. Shutdown-only fail -> BIOS ErP/WOL.'
Write-Host ''

$clients = @()
foreach ($port in $Ports) {
  try {
    $owner = Get-PortOwnerPid $port
    if ($owner -and $owner -ne $PID) {
      $pname = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
      Write-Host "[WOL test] WARN: UDP :$port in use by PID $owner ($pname)"
      Write-Host "[WOL test]       Close other wol-test window or run: wol-test-stop"
    }
    $c = New-WolUdpListener $port
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

if ($SelfTest) {
  $sendScript = Join-Path $PSScriptRoot 'send-wol-magic-packet.ps1'
  $targets = @($ip, '127.0.0.1', '255.255.255.255') | Where-Object { $_ }
  Start-Job -ScriptBlock {
    param($Script, [string[]]$Targets)
    Start-Sleep -Seconds 2
    & $Script -Targets $Targets
  } -ArgumentList $sendScript, $targets | Out-Null
  Write-Host "[WOL test] SelfTest: magic packet to $($targets -join ', ') in ~2s..."
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
  Write-Host 'If you used router [PC 켜기]: retry with phone WOL app (same Wi-Fi).'
  Write-Host 'Router often skips send when PC IP responds on LAN.'
  Write-Host 'Phone app MAC: A8-A1-59-BF-42-CC  broadcast 255.255.255.255 port 9'
  exit 2
}

exit 0
