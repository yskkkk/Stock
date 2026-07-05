# Enable Intel I219-V Wake-on-LAN (Windows). Run elevated.
#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'

$mac = 'A8-A1-59-BF-42-CC'
$adapter = Get-NetAdapter | Where-Object { $_.MacAddress -eq $mac } | Select-Object -First 1
if (-not $adapter) {
  Write-Host '[WOL] ERROR: Intel adapter not found'
  exit 1
}
$name = $adapter.Name
Write-Host "[WOL] Adapter: $name ($mac)"

# Device wake permission (Power tab)
$wake = Get-CimInstance MSPower_DeviceWakeEnable -Namespace root/wmi |
  Where-Object { $_.InstanceName -match '1A1D' } | Select-Object -First 1
if ($wake -and -not $wake.Enable) {
  Set-CimInstance -InputObject $wake -Property @{ Enable = $true } | Out-Null
  Write-Host '[WOL] DeviceWakeEnable -> True'
}

# powercfg wake
$devName = $adapter.InterfaceDescription
powercfg -deviceenablewake $devName 2>$null | Out-Null
Write-Host "[WOL] powercfg enable wake: $devName"

# Power management cmdlet (Allow computer to turn off device -> Disabled)
try {
  Set-NetAdapterPowerManagement -Name $name -AllowComputerToTurnOffDevice Disabled -WakeOnMagicPacket Enabled -ErrorAction Stop
  Write-Host '[WOL] Set-NetAdapterPowerManagement OK'
} catch {
  Write-Host "[WOL] Set-NetAdapterPowerManagement: $($_.Exception.Message)"
}

function Set-NicAdv($keyword, $value) {
  try {
    Set-NetAdapterAdvancedProperty -Name $name -RegistryKeyword $keyword -RegistryValue $value -ErrorAction Stop
    Write-Host "[WOL] $keyword -> $value"
  } catch {
    Write-Host "[WOL] WARN $keyword : $($_.Exception.Message)"
  }
}

Set-NicAdv '*WakeOnMagicPacket' 1
Set-NicAdv '*WakeOnPattern' 0
Set-NicAdv '*SelectiveSuspend' 0
Set-NicAdv 'EnablePME' 1
Set-NicAdv 'ULPMode' 0
Set-NicAdv 'ReduceSpeedOnPowerDown' 0
Set-NicAdv '*ModernStandbyWoLMagicPacket' 0
Set-NicAdv 'EEELinkAdvertisement' 0
Set-NicAdv 'WakeOnLink' 0
Set-NicAdv 'AutoPowerSaveModeEnabled' 0
Set-NicAdv 'SipsEnabled' 0

# ACPI S5 wake registry hints (Intel)
$cls = 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e972-e325-11ce-bfc1-08002be10318}'
Get-ChildItem $cls -ErrorAction SilentlyContinue | ForEach-Object {
  $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
  if ($p -and $p.DriverDesc -match 'I219') {
    New-ItemProperty -Path $_.PSPath -Name '*WakeOnMagicPacket' -Value '1' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $_.PSPath -Name 'EnablePME' -Value '1' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $_.PSPath -Name 'PnPCapabilities' -Value 0x118 -PropertyType DWord -Force | Out-Null
    Write-Host "[WOL] Registry: $($p.DriverDesc)"
  }
}
$fp = 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Power'
Set-ItemProperty -Path $fp -Name HiberbootEnabled -Value 0 -Type DWord -Force
Write-Host '[WOL] Fast startup (HiberbootEnabled) -> 0'

# Disable idle power-off on PCI device (Enum path)
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Enum\PCI' -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.PSChildName -match 'VEN_8086&DEV_1A1D' } |
  ForEach-Object {
    $dp = Join-Path $_.PSPath 'Device Parameters'
    if (Test-Path $dp) {
      New-ItemProperty -Path $dp -Name AllowIdleIrpInD3 -Value 0 -PropertyType DWord -Force | Out-Null
      New-ItemProperty -Path $dp -Name D3ColdSupported -Value 0 -PropertyType DWord -Force | Out-Null
      Write-Host "[WOL] Device Parameters: $($_.PSChildName)"
    }
  }

Write-Host ''
Write-Host '--- wake_armed ---'
powercfg /devicequery wake_armed
Write-Host ''
Write-Host '[WOL] Done. Reboot once, then shutdown and test router WOL.'
