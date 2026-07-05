# WOL wake test — sleep (not shutdown), then you send WOL to turn PC back ON.
param(
  [string]$Mac = 'A8-A1-59-BF-42-CC',
  [int]$Countdown = 10
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

Write-Host ''
Write-Host '========================================'
Write-Host ' WOL WAKE TEST (sleep, not shutdown)'
Write-Host '========================================'
Write-Host ''
Write-Host 'Goal: test turning PC ON via WOL.'
Write-Host "Target MAC: $Mac"
Write-Host ''
Write-Host 'Steps:'
Write-Host '  1) This PC will SLEEP in countdown seconds'
Write-Host '  2) Right after screen off -> router [PC 켜기] OR phone WOL app'
Write-Host '  3) PC wakes up = WOL works'
Write-Host ''
Write-Host 'Router button often works only while PC looks offline (sleep/shutdown).'
Write-Host 'Save all work. Ctrl+C to cancel.'
Write-Host ''

for ($i = $Countdown; $i -ge 1; $i--) {
  Write-Host "  Sleep in $i ..."
  Start-Sleep -Seconds 1
}

Write-Host ''
Write-Host '>>> SLEEP NOW — send WOL from router/phone! <<<'
Write-Host ''

Start-Sleep -Seconds 1
[void][System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)

# If we reach here, sleep failed or was interrupted
Write-Host '[WOL wake test] Sleep did not start (policy or user cancel).'
Write-Host 'Run as admin or use: Settings > System > Power > Sleep allowed.'
