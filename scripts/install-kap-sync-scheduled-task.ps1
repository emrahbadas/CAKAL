$ErrorActionPreference = "Stop"

$taskName = "CakalKapFinancialSync"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runner = Resolve-Path (Join-Path $PSScriptRoot "run-kap-sync-task.ps1")
$startAt = (Get-Date).AddMinutes(5)

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`"" `
  -WorkingDirectory "$projectRoot"

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At $startAt `
  -RepetitionInterval (New-TimeSpan -Minutes 30) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

$principal = New-ScheduledTaskPrincipal `
  -UserId "$env:USERDOMAIN\$env:USERNAME" `
  -LogonType Interactive `
  -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Cakal KAP financial report cache sync. Runs every 30 minutes and uses DB cache policy before touching KAP." `
  -Force | Out-Null

Write-Output "Scheduled task installed: $taskName"
Write-Output "Project root: $projectRoot"
Write-Output "Runner: $runner"
Write-Output "First run: $startAt"
