[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Unavailable', 'DropAfterSave', 'DuplicateResult', 'DelayedResult', 'Reset')]
    [string]$Mode,

    [ValidateRange(1, 2500)]
    [int]$DelayMs = 1800,

    [string]$EmulatorBaseUrl = 'http://127.0.0.1:9090'
)

$ErrorActionPreference = 'Stop'
$base = $EmulatorBaseUrl.TrimEnd('/')

if ($Mode -eq 'Reset') {
    $response = Invoke-WebRequest -UseBasicParsing -Method Delete -Uri "$base/fault-modes" -TimeoutSec 5
} else {
    $path = switch ($Mode) {
        'Unavailable' { 'unavailable' }
        'DropAfterSave' { 'drop-after-save' }
        'DuplicateResult' { 'duplicate-result' }
        'DelayedResult' { "delayed-result?delayMs=$DelayMs" }
    }
    $response = Invoke-WebRequest -UseBasicParsing -Method Put -Uri "$base/fault-modes/$path" -TimeoutSec 5
}

if ([int]$response.StatusCode -ne 204) {
    throw "Эмулятор вернул HTTP $($response.StatusCode) при переключении режима $Mode."
}

$state = Invoke-RestMethod -Method Get -Uri "$base/fault-modes" -TimeoutSec 5
Write-Output ($state | ConvertTo-Json -Compress)
