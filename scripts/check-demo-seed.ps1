[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$project = 'task008-seed-' + [Guid]::NewGuid().ToString('N').Substring(0, 10)
$composeBase = @('compose', '--progress', 'quiet', '--project-name', $project, '-f', 'compose.app.yaml')
$apiPort = $null
$emulatorPort = $null
$frontendPort = $null
$previousPorts = @{
    APP_API_PORT = $env:APP_API_PORT
    APP_EMULATOR_PORT = $env:APP_EMULATOR_PORT
    APP_FRONTEND_PORT = $env:APP_FRONTEND_PORT
    DEMO_SEED_INTERRUPT_AFTER = $env:DEMO_SEED_INTERRUPT_AFTER
}
$started = $false

function Get-FreeTcpPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
}

function Invoke-Compose([string[]]$Arguments) {
    $output = & docker @($composeBase + $Arguments) 2>&1
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) { throw "docker compose $($Arguments -join ' ') failed ($exitCode):`n$($output -join "`n")" }
    return $output
}

function Get-AuthenticatedJson([string]$Uri, [string]$User, [string]$Password) {
    $bytes = [Text.Encoding]::ASCII.GetBytes("${User}:${Password}")
    return Invoke-RestMethod -Method Get -Uri $Uri -Headers @{ Authorization = 'Basic ' + [Convert]::ToBase64String($bytes) } -TimeoutSec 10
}

function Wait-Task([string]$Uri, [string]$User, [string]$Password, [scriptblock]$Predicate, [int]$TimeoutSeconds = 45) {
    $until = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $task = Get-AuthenticatedJson $Uri $User $Password
        if (& $Predicate $task) { return $task }
        Start-Sleep -Milliseconds 200
    } while ([DateTimeOffset]::UtcNow -lt $until)
    throw "Timed out waiting for $Uri. Last state: $($task.status)/$($task.delivery_state)."
}

try {
    Push-Location $repoRoot
    $existingContainers = & docker ps -aq --filter "label=com.docker.compose.project=$project"
    $existingVolumes = & docker volume ls -q --filter "label=com.docker.compose.project=$project"
    if ($existingContainers -or $existingVolumes) { throw "Refusing to use existing Compose project resources: $project" }

    $apiPort = Get-FreeTcpPort
    $emulatorPort = Get-FreeTcpPort
    $frontendPort = Get-FreeTcpPort
    $env:APP_API_PORT = [string]$apiPort
    $env:APP_EMULATOR_PORT = [string]$emulatorPort
    $env:APP_FRONTEND_PORT = [string]$frontendPort
    $apiBase = "http://127.0.0.1:$apiPort"

    $started = $true
    Invoke-Compose @('up', '-d', '--build', '--wait') | Out-Null

    $title = 'TASK006 Demo standard delivery Alice'
    $userKey = 'task008-user-collision-' + [Guid]::NewGuid().ToString('N')
    $userAuth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('alice:demo-alice'))
    $userTask = Invoke-RestMethod -Method Post -Uri "$apiBase/api/tasks" -Headers @{
        Authorization = $userAuth
        'Idempotency-Key' = $userKey
    } -ContentType 'application/json' -Body (@{ title = $title } | ConvertTo-Json -Compress) -TimeoutSec 10
    $null = Wait-Task "$apiBase/api/tasks/$($userTask.id)" 'alice' 'demo-alice' { param($task) $task.status -eq 'SUCCEEDED' }

    $env:DEMO_SEED_INTERRUPT_AFTER = 'regular-before-assignment'
    $savedErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $interruptedOutput = & docker @($composeBase + @('run', '--rm', '--no-deps', 'seed')) 2>&1
        $interruptedCode = $LASTEXITCODE
    } finally { $ErrorActionPreference = $savedErrorActionPreference }
    if ($interruptedCode -eq 0 -or ($interruptedOutput -join "`n") -notmatch 'Injected interruption after regular task delivery') {
        throw "Expected the deterministic seed interruption, received exit ${interruptedCode}:`n$($interruptedOutput -join "`n")"
    }
    Remove-Item Env:DEMO_SEED_INTERRUPT_AFTER -ErrorAction SilentlyContinue

    $userCard = Get-AuthenticatedJson "$apiBase/api/operator/tasks/$($userTask.id)" 'operator' 'demo-operator'
    if ($null -ne $userCard.assignee -or [int]$userCard.local_version -ne 0 -or @($userCard.assignmentHistory).Count -ne 0) {
        throw 'The user-created same-title task changed during the interrupted seed run.'
    }

    $alicePage = Get-AuthenticatedJson "$apiBase/api/tasks?status=SUCCEEDED&page=0" 'alice' 'demo-alice'
    $seedMatches = @($alicePage.items | Where-Object { $_.title -eq $title -and $_.id -ne $userTask.id })
    if ($seedMatches.Count -ne 1) { throw "Expected one separate seed record with the colliding title; found $($seedMatches.Count)." }
    $seedId = [string]$seedMatches[0].id
    $seedBeforeResume = Get-AuthenticatedJson "$apiBase/api/operator/tasks/$seedId" 'operator' 'demo-operator'
    if ($null -ne $seedBeforeResume.assignee -or [int]$seedBeforeResume.local_version -ne 0) {
        throw 'The failpoint did not stop between task delivery and assignment.'
    }

    Invoke-Compose @('run', '--rm', '--no-deps', 'seed') | Out-Null
    Invoke-Compose @('run', '--rm', '--no-deps', 'seed') | Out-Null

    $seedAfterResume = Get-AuthenticatedJson "$apiBase/api/operator/tasks/$seedId" 'operator' 'demo-operator'
    if ($seedAfterResume.assignee -ne 'operator' -or [int]$seedAfterResume.local_version -ne 1 -or @($seedAfterResume.assignmentHistory).Count -ne 1) {
        throw 'Seed resume did not finish the original assignment exactly once.'
    }
    $userAfterResume = Get-AuthenticatedJson "$apiBase/api/operator/tasks/$($userTask.id)" 'operator' 'demo-operator'
    if ($null -ne $userAfterResume.assignee -or [int]$userAfterResume.local_version -ne 0 -or @($userAfterResume.assignmentHistory).Count -ne 0) {
        throw 'The user-created same-title task changed after resume/repeat.'
    }

    $seedKeyCount = [int]((Invoke-Compose @('exec', '-T', 'postgres', 'psql', '-U', 'exchange', '-d', 'exchange', '-At', '-c', "select count(*) from tasks where request_key like 'secreate-demo-v1-%'") | Out-String).Trim())
    $matchingTitleCount = [int]((Invoke-Compose @('exec', '-T', 'postgres', 'psql', '-U', 'exchange', '-d', 'exchange', '-At', '-c', "select count(*) from tasks where owner_name='alice' and title='$title'") | Out-String).Trim())
    if ($seedKeyCount -ne 7 -or $matchingTitleCount -ne 2) {
        throw "Seed idempotency/collision count mismatch: seed keys=$seedKeyCount, same-title Alice tasks=$matchingTitleCount."
    }
    Write-Output "Demo seed regression passed in isolated project ${project}: interruption resumed id=$seedId; repeat kept 7 seed records; user task $($userTask.id) was unchanged."
}
finally {
    Remove-Item Env:DEMO_SEED_INTERRUPT_AFTER -ErrorAction SilentlyContinue
    if ($started) {
        try { Invoke-Compose @('down', '--volumes', '--remove-orphans') | Out-Null }
        catch { Write-Warning "Could not remove only the regression project $project`: $_" }
    }
    foreach ($name in @('APP_API_PORT', 'APP_EMULATOR_PORT', 'APP_FRONTEND_PORT', 'DEMO_SEED_INTERRUPT_AFTER')) {
        if ($null -eq $previousPorts[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $previousPorts[$name] }
    }
    Pop-Location
}
