$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$logRoot = Join-Path $projectRoot "logs\kap-sync-task"
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logFile = Join-Path $logRoot "kap-sync-$timestamp.log"

Set-Location $projectRoot

try {
  "[$(Get-Date -Format o)] Starting KAP sync task" | Out-File -FilePath $logFile -Encoding utf8
  $output = & npm.cmd run kap:sync-once -- --limit=25 2>&1
  $exitCode = $LASTEXITCODE
  $output | Out-File -FilePath $logFile -Append -Encoding utf8
  "[$(Get-Date -Format o)] Finished KAP sync task. ExitCode=$exitCode" | Out-File -FilePath $logFile -Append -Encoding utf8
  exit $exitCode
} catch {
  "[$(Get-Date -Format o)] KAP sync task failed: $($_.Exception.Message)" | Out-File -FilePath $logFile -Append -Encoding utf8
  exit 1
}
