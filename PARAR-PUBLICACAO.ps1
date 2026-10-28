$ErrorActionPreference = 'Stop'
$publisherPidFile = Join-Path $PSScriptRoot '.auto-publish\pid'
$publisherScript = Join-Path $PSScriptRoot 'auto-publish.py'
$publisherProcesses = @(Get-CimInstance Win32_Process -Filter "Name='pythonw.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($publisherScript) })
foreach ($publisherProcess in $publisherProcesses) {
    Stop-Process -Id $publisherProcess.ProcessId -ErrorAction SilentlyContinue
}
if (Test-Path -LiteralPath $publisherPidFile) {
    Remove-Item -LiteralPath $publisherPidFile
}
Write-Output 'Publicacao automatica parada.'
