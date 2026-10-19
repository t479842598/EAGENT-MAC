# run.ps1 - Run an NX Open VB journal headlessly and report result.
# Usage:  powershell -ExecutionPolicy Bypass -File run.ps1 -Journal .\templates\NxKit.vb -Out .\part.prt
param(
  [Parameter(Mandatory=$true)][string]$Journal,
  [string]$Out = ""
)
$ErrorActionPreference = 'Stop'

$base = [Environment]::GetEnvironmentVariable('UGII_BASE_DIR')
if (-not $base) { Write-Error "UGII_BASE_DIR not set - is NX installed?"; exit 1 }
$rj = Join-Path $base 'UGII\run_journal.exe'
if (-not (Test-Path $rj)) { Write-Error "run_journal.exe not found at $rj"; exit 1 }

if ($Out -and (Test-Path $Out)) { Remove-Item $Out -Force }

Write-Host "Running journal: $Journal"
$out = & $rj $Journal 2>&1 | Out-String
Write-Host $out
Write-Host ("EXIT: " + $LASTEXITCODE)

if ($Out) {
  if (Test-Path $Out) { Write-Host ("PRT_OK: " + (Get-Item $Out).Length + " bytes") }
  else { Write-Host "PRT_MISSING"; exit 1 }
}