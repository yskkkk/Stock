# Cursor Agent/Composer 채팅 스크롤을 최하단으로 (Windows UI Automation)
$ErrorActionPreference = 'SilentlyContinue'
if ($env:STOCK_AGENT_AUTO_SCROLL -eq '0') { exit 0 }

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$proc = Get-Process -Name 'Cursor' -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } |
  Sort-Object -Property @{ Expression = { $_.MainWindowTitle.Length }; Descending = $true } |
  Select-Object -First 1
if (-not $proc) { exit 0 }

$root = [System.Windows.Automation.AutomationElement]::FromHandle($proc.MainWindowHandle)
if (-not $root) { exit 0 }

$winRect = $root.Current.BoundingRectangle
if ($winRect.Width -lt 200 -or $winRect.Height -lt 200) { exit 0 }
$midX = $winRect.X + ($winRect.Width * 0.32)

$scrollPatternId = [System.Windows.Automation.ScrollPattern]::Pattern
$trueCond = [System.Windows.Automation.Condition]::TrueCondition
$candidates = [System.Collections.Generic.List[object]]::new()

function Visit-Scrollables {
  param(
    [System.Windows.Automation.AutomationElement]$El,
    [int]$Depth
  )
  if ($Depth -gt 22) { return }
  try {
    $sp = $null
    if ($El.TryGetCurrentPattern($scrollPatternId, [ref]$sp)) {
      $cur = $sp.Current
      if ($cur.VerticallyScrollable -and $cur.VerticalViewSize -lt 99.5) {
        $rect = $El.Current.BoundingRectangle
        if ($rect.Width -gt 72 -and $rect.Height -gt 100 -and $rect.X -ge $midX) {
          $candidates.Add([pscustomobject]@{
              Sp   = $sp
              Area = $rect.Width * $rect.Height
              Pct  = $cur.VerticalScrollPercent
            })
        }
      }
    }
  } catch { }

  $children = $null
  try { $children = $El.FindAll([System.Windows.Automation.TreeScope]::Children, $trueCond) } catch { return }
  if (-not $children) { return }
  foreach ($child in $children) { Visit-Scrollables -El $child -Depth ($Depth + 1) }
}

Visit-Scrollables -El $root -Depth 0

$scrolled = $false
if ($candidates.Count -gt 0) {
  $best = $candidates | Sort-Object -Property Area -Descending | Select-Object -First 1
  try {
    if ($best.Pct -lt 98) {
      [void]$best.Sp.SetScrollPercent(-1, 100)
    }
    $scrolled = $true
  } catch { }
}

if (-not $scrolled) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public class StockCursorWin32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@ -ErrorAction SilentlyContinue
  [void][StockCursorWin32]::SetForegroundWindow($proc.MainWindowHandle)
  Start-Sleep -Milliseconds 60
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
  [System.Windows.Forms.SendKeys]::SendWait('{END}{END}')
}

exit 0
