$ErrorActionPreference = 'Stop'

$serverRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $serverRoot

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($null -ne $nodeCommand) {
  $nodeCommand.Source
} else {
  'C:\Program Files\Huawei\DevEco Studio\tools\node\node.exe'
}

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw 'Node.js was not found. Install Node.js 18+ or check the DevEco Studio path.'
}

$hdcPath = 'C:\Program Files\Huawei\DevEco Studio\sdk\default\openharmony\toolchains\hdc.exe'
if (Test-Path -LiteralPath $hdcPath) {
  $targets = & $hdcPath list targets 2>$null
  if ($LASTEXITCODE -eq 0 -and $targets -and ($targets -notmatch '\[Empty\]')) {
    & $hdcPath rport tcp:8787 tcp:8787 | Out-Host
    if ($LASTEXITCODE -eq 0) {
      Write-Host 'HDC reverse port 8787 -> 8787 is ready.' -ForegroundColor Green
    } else {
      Write-Warning 'HDC reverse port failed. The app can still use its on-device demo data.'
    }
  } else {
    Write-Warning 'No device/emulator found. Start one, then run this script again.'
  }
} else {
  Write-Warning 'HDC was not found. The app can still use its on-device demo data.'
}

Write-Host 'Local demo server: http://127.0.0.1:8787 (Ctrl+C to stop)' -ForegroundColor Cyan
& $nodePath "$serverRoot\src\server.js"
