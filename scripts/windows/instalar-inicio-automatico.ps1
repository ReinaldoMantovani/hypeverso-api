<#
  Hypeverso — inicia a IA local (e opcionalmente o CMS) quando você entra no Windows.

  Uso (PowerShell, na pasta hypeverso-api):
    .\scripts\windows\instalar-inicio-automatico.ps1                 # modo Docker (recomendado)
    .\scripts\windows\instalar-inicio-automatico.ps1 -Modo nativo    # Ollama do Windows + npm run worker:local
    .\scripts\windows\instalar-inicio-automatico.ps1 -ComCms -PastaCms "C:\caminho\hypeverso-cms"

  Remover: .\scripts\windows\remover-inicio-automatico.ps1
#>
param(
  [ValidateSet('docker', 'nativo')] [string]$Modo = 'docker',
  [switch]$ComCms,
  [string]$PastaCms = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) '..\hypeverso-cms'),
  [int]$AtrasoSegundos = 90
)
$ErrorActionPreference = 'Stop'
$api = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $api '.env.worker'))) {
  Write-Host 'Crie primeiro o arquivo .env.worker (copie de .env.worker.example).' -ForegroundColor Yellow
  exit 1
}

$logs = Join-Path $api 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

if ($Modo -eq 'docker') {
  # Docker Desktop precisa iniciar com o Windows (Settings > General > Start Docker Desktop when you sign in).
  $cmd = "Set-Location '$api'; for (`$i=0; `$i -lt 30; `$i++) { docker info *> `$null; if (`$LASTEXITCODE -eq 0) { break }; Start-Sleep 10 }; docker compose -f docker-compose.local-ai.yml --env-file .env.worker up -d *>> '$logs\ia.log'"
} else {
  $cmd = "Set-Location '$api'; npm run worker:local *>> '$logs\ia.log'"
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = "PT$($AtrasoSegundos)S"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmd`""
Register-ScheduledTask -TaskName 'Hypeverso IA' -Trigger $trigger -Action $action -Settings $settings -Description 'Inicia a IA local do Hypeverso (LLMs, Shop, moderação, backup).' -Force | Out-Null
Write-Host "OK: tarefa 'Hypeverso IA' criada (modo $Modo)." -ForegroundColor Green

if ($ComCms) {
  $cms = (Resolve-Path $PastaCms).Path
  if (-not (Test-Path (Join-Path $cms '.env.local'))) { Write-Host 'O CMS ainda não tem .env.local; rode iniciar-cms.bat uma vez.' -ForegroundColor Yellow; exit 1 }
  $cmsCmd = "Set-Location '$cms'; if (-not (Test-Path '.next\BUILD_ID')) { npm run build }; npm run start *>> '$logs\cms.log'"
  $cmsAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command `"$cmsCmd`""
  $cmsTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $cmsTrigger.Delay = "PT$($AtrasoSegundos + 30)S"
  Register-ScheduledTask -TaskName 'Hypeverso CMS' -Trigger $cmsTrigger -Action $cmsAction -Settings $settings -Description 'Inicia o CMS do Hypeverso em http://localhost:3001.' -Force | Out-Null
  Write-Host "OK: tarefa 'Hypeverso CMS' criada (http://localhost:3001)." -ForegroundColor Green
}
Write-Host "Logs em $logs. Para testar agora: Start-ScheduledTask -TaskName 'Hypeverso IA'"
