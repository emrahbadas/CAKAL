$ErrorActionPreference = "Stop"

$taskName = "CakalKapFinancialSync"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

if ($existingTask) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Output "Scheduled task removed: $taskName"
} else {
  Write-Output "Scheduled task not found: $taskName"
}
