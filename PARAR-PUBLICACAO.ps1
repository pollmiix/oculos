$ErrorActionPreference = 'Stop'
$publisherPidFile = Join-Path $PSScriptRoot '.auto-publish\pid'
if (Test-Path -LiteralPath $publisherPidFile) {
    $publisherProcess = Get-Process -Id ([int](Get-Content -LiteralPath $publisherPidFile)) -ErrorAction SilentlyContinue
    $publisherPython = Join-Path $PSScriptRoot '.venv\Scripts\pythonw.exe'
    if ($publisherProcess -and $publisherProcess.Path -eq $publisherPython) {
        Stop-Process -Id $publisherProcess.Id
    }
    Remove-Item -LiteralPath $publisherPidFile
}
Write-Output 'Publicacao automatica parada.'
