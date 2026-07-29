# Install the HCHB dup agent as a Windows service via NSSM.
# Put nssm.exe in the hchb-dup-agent folder (same level as run_agent.py).
# Run PowerShell as Administrator:
#   cd C:\Users\User\Desktop\hchb-dup-agent
#   .\scripts\install-windows-service.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$ServiceName = 'WellboundHchbDupAgent'

$Nssm = Join-Path $Root 'nssm.exe'
if (-not (Test-Path $Nssm)) {
  $NssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
  if ($NssmCmd) { $Nssm = $NssmCmd.Source }
  else { Write-Error "nssm.exe not found in $Root (put nssm.exe next to run_agent.py)" }
}

# Prefer the venv python so dependencies resolve
$Python = Join-Path $Root '.venv\Scripts\python.exe'
if (-not (Test-Path $Python)) {
  $Python = (Get-Command python).Source
}
$App = Join-Path $Root 'run_agent.py'

Write-Host "Installing $ServiceName"
Write-Host "  nssm:   $Nssm"
Write-Host "  python: $Python"
Write-Host "  app:    $App"

# Remove old service if present
& $Nssm stop $ServiceName 2>$null
& $Nssm remove $ServiceName confirm 2>$null

& $Nssm install $ServiceName $Python "`"$App`" run"
& $Nssm set $ServiceName AppDirectory $Root
& $Nssm set $ServiceName DisplayName 'Wellbound HCHB Duplicate Agent'
& $Nssm set $ServiceName Description 'Polls AWS for hashed duplicate checks; queries on-prem logship; returns boolean only.'
& $Nssm set $ServiceName Start SERVICE_AUTO_START
& $Nssm set $ServiceName AppStdout (Join-Path $Root 'logs\agent.out.log')
& $Nssm set $ServiceName AppStderr (Join-Path $Root 'logs\agent.err.log')
& $Nssm set $ServiceName AppRotateFiles 1
& $Nssm set $ServiceName AppRotateBytes 2000000

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null

& $Nssm start $ServiceName
Write-Host "Started. Check with:"
Write-Host "  .\nssm.exe status $ServiceName"