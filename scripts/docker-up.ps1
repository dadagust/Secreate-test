[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location $root
try {
    & docker compose -f compose.app.yaml up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw "Compose startup failed: $LASTEXITCODE." }
    & docker compose -f compose.app.yaml run --rm --no-deps --build seed
    if ($LASTEXITCODE -ne 0) { throw "Demo seed failed: $LASTEXITCODE." }
    Write-Output 'Demo is ready at http://127.0.0.1:5173/ or APP_FRONTEND_PORT.'
} finally { Pop-Location }
