$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$publisherPython = Join-Path $projectRoot '.venv\Scripts\pythonw.exe'
$publisherScript = Join-Path $projectRoot 'auto-publish.py'
$publisherState = Join-Path $projectRoot '.auto-publish'
$publisherPidFile = Join-Path $publisherState 'pid'
if (Test-Path -LiteralPath $publisherPidFile) {
    $publisherProcess = Get-Process -Id ([int](Get-Content -LiteralPath $publisherPidFile)) -ErrorAction SilentlyContinue
    if ($publisherProcess -and $publisherProcess.Path -eq $publisherPython) {
        Write-Output 'A publicacao automatica ja esta funcionando.'
        exit 0
    }
}
if (-not (Test-Path -LiteralPath $publisherPython)) {
    throw 'Python do projeto nao encontrado em .venv\Scripts\pythonw.exe.'
}
New-Item -ItemType Directory -Path $publisherState -Force | Out-Null
$publisherProcess = Start-Process -FilePath $publisherPython -ArgumentList @('"' + $publisherScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $publisherPidFile -Value $publisherProcess.Id
Write-Output 'Publicacao automatica iniciada. Consulte .auto-publish\status.json.'
