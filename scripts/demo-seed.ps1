[CmdletBinding()]
param(
    [string]$ApiBaseUrl = 'http://127.0.0.1:8080',
    [string]$EmulatorBaseUrl = 'http://127.0.0.1:9090',
    [string]$OperatorPassword = 'demo-operator',
    [string]$AlicePassword = 'demo-alice',
    [string]$BobPassword = 'demo-bob'
)

$ErrorActionPreference = 'Stop'
$api = $ApiBaseUrl.TrimEnd('/')
$emulator = $EmulatorBaseUrl.TrimEnd('/')
$modeScript = Join-Path $PSScriptRoot 'emulator-mode.ps1'
$run = [Guid]::NewGuid().ToString('N').Substring(0, 8)

function Get-AuthHeader([string]$User, [string]$Password) {
    $bytes = [Text.Encoding]::ASCII.GetBytes(('{0}:{1}' -f $User, $Password))
    return 'Basic ' + [Convert]::ToBase64String($bytes)
}

function Set-EmulatorMode([string]$Value, [int]$Delay = 1800) {
    & $modeScript -Mode $Value -DelayMs $Delay -EmulatorBaseUrl $emulator | Out-Null
}

function New-DemoTask([string]$Owner, [string]$Password, [string]$Name) {
    $title = "TASK004 Demo $run - $Name"
    $headers = @{
        Authorization = Get-AuthHeader $Owner $Password
        'Idempotency-Key' = "task004-demo-$run-$Owner-$([Guid]::NewGuid().ToString('N'))"
    }
    $body = @{ title = $title } | ConvertTo-Json -Compress
    $created = Invoke-RestMethod -Method Post -Uri "$api/api/tasks" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 10
    return [pscustomobject]@{ id = [string]$created.id; owner = $Owner; title = $title }
}

function Get-OperatorTask([string]$Id) {
    return Invoke-RestMethod -Method Get -Uri "$api/api/operator/tasks/$Id" -Headers @{ Authorization = Get-AuthHeader 'operator' $OperatorPassword } -TimeoutSec 10
}

function Wait-OperatorTask([string]$Id, [scriptblock]$Condition, [int]$TimeoutSeconds = 30) {
    $until = [DateTimeOffset]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $state = Get-OperatorTask $Id
        if (& $Condition $state) { return $state }
        Start-Sleep -Milliseconds 150
    } while ([DateTimeOffset]::UtcNow -lt $until)
    throw "Истекло ожидание состояния задания $Id. Последнее состояние: $($state.delivery_state)/$($state.business_status)."
}

function Wait-Completed([string]$Id) {
    return Wait-OperatorTask $Id { param($state) $state.delivery_state -eq 'DONE' -and $state.business_status -in @('SUCCEEDED', 'FAILED') } 35
}

function Wait-Event([string]$Id, [string]$Event) {
    return Wait-OperatorTask $Id { param($state) @($state.history | Where-Object event -eq $Event).Count -gt 0 } 20
}

function Get-ExternalOperation([string]$Id) {
    return Invoke-RestMethod -Method Get -Uri "$emulator/operations/$Id" -TimeoutSec 5
}

function Assert-ExternalMissing([string]$Id) {
    $missing = $false
    try {
        $null = Get-ExternalOperation $Id
    } catch {
        if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { $missing = $true }
        else { throw }
    }
    if (-not $missing) { throw "Эмулятор уже хранит операцию $Id, хотя режим недоступности включён до исполнения." }
}

$created = [System.Collections.Generic.List[object]]::new()
$leaveProblemMode = $false
try {
    Set-EmulatorMode 'Reset'

    $regular = New-DemoTask 'alice' $AlicePassword 'standard delivery Alice'
    $created.Add([pscustomobject]@{ task = $regular; outcome = 'обычная доставка' })
    Wait-Completed $regular.id | Out-Null

    $bob = New-DemoTask 'bob' $BobPassword 'second initiator Bob'
    $created.Add([pscustomobject]@{ task = $bob; outcome = 'доставка второго инициатора' })
    $bobAuth = @{ Authorization = Get-AuthHeader 'bob' $BobPassword }
    $bobUntil = [DateTimeOffset]::UtcNow.AddSeconds(20)
    do {
        $bobTask = Invoke-RestMethod -Method Get -Uri "$api/api/tasks/$($bob.id)" -Headers $bobAuth -TimeoutSec 10
        if ($bobTask.status -eq 'SUCCEEDED') { break }
        Start-Sleep -Milliseconds 150
    } while ([DateTimeOffset]::UtcNow -lt $bobUntil)
    if ($bobTask.status -ne 'SUCCEEDED') { throw "Задание инициатора Bob не завершилось: $($bobTask.status)." }

    Set-EmulatorMode 'Unavailable'
    $offline = New-DemoTask 'alice' $AlicePassword 'unavailable then recovery'
    $created.Add([pscustomobject]@{ task = $offline; outcome = '503 до внешнего исполнения, затем восстановление' })
    Wait-Event $offline.id 'AMBIGUOUS_RETRY' | Out-Null
    Assert-ExternalMissing $offline.id
    Set-EmulatorMode 'Reset'
    Wait-Completed $offline.id | Out-Null

    Set-EmulatorMode 'DropAfterSave'
    $lost = New-DemoTask 'alice' $AlicePassword 'reply lost after commit'
    $created.Add([pscustomobject]@{ task = $lost; outcome = 'потеря ответа, повтор с тем же operationId' })
    Wait-Event $lost.id 'AMBIGUOUS_RETRY' | Out-Null
    $afterLoss = Get-ExternalOperation $lost.id
    if ($afterLoss.executions -ne 1) { throw "После потери ответа executions=$($afterLoss.executions), ожидалось 1." }
    Wait-Completed $lost.id | Out-Null

    Set-EmulatorMode 'DuplicateResult'
    $duplicate = New-DemoTask 'alice' $AlicePassword 'duplicate result'
    $created.Add([pscustomobject]@{ task = $duplicate; outcome = 'повтор результата без повторного эффекта' })
    Wait-Completed $duplicate.id | Out-Null
    $duplicateResult = Get-ExternalOperation $duplicate.id
    if ($duplicateResult.executions -ne 1) { throw "Дубликат результата изменил executions: $($duplicateResult.executions)." }

    Set-EmulatorMode 'DelayedResult' 2200
    $delayed = New-DemoTask 'alice' $AlicePassword 'delayed result'
    $created.Add([pscustomobject]@{ task = $delayed; outcome = 'задержанная доставка, состояние видно оператору' })
    $inFlight = Wait-OperatorTask $delayed.id {
        param($state)
        $state.delivery_state -eq 'READY' -and $state.business_status -eq 'PENDING' -and
            $state.lease_until -and [DateTimeOffset]::Parse([string]$state.lease_until).ToUniversalTime() -gt [DateTimeOffset]::UtcNow
    } 12
    if (-not @($inFlight.history | Where-Object event -eq 'ATTEMPT_1').Count) { throw 'Карточка задержанной доставки не показывает первую попытку.' }
    Wait-Completed $delayed.id | Out-Null
    if ((Get-ExternalOperation $delayed.id).executions -ne 1) { throw 'Задержанная доставка должна исполниться один раз.' }

    $firstState = Get-OperatorTask $regular.id
    $patchHeaders = @{ Authorization = Get-AuthHeader 'operator' $OperatorPassword }
    $patch = @{ assignee = 'operator'; version = [long]$firstState.local_version } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri "$api/api/tasks/$($regular.id)/assignee" -Headers $patchHeaders -ContentType 'application/json' -Body $patch -TimeoutSec 10 | Out-Null
    $audited = Get-OperatorTask $regular.id
    if (-not @($audited.assignmentHistory | Where-Object { $_.actor -eq 'operator' -and $_.new_assignee -eq 'operator' }).Count) {
        throw 'Операторское назначение не появилось в истории аудита.'
    }

    $operatorItems = Invoke-RestMethod -Method Get -Uri "$api/api/tasks?page=0" -Headers $patchHeaders -TimeoutSec 10
    if (-not @($operatorItems.items | Where-Object { $_.owner_name -eq 'alice' }).Count) { throw 'У оператора нет задач в доступной области Alice.' }

    Set-EmulatorMode 'Unavailable'
    $problemTask = New-DemoTask 'alice' $AlicePassword 'unavailable; operator review'
    $created.Add([pscustomobject]@{ task = $problemTask; outcome = 'операторская проблема: внешняя система недоступна, исполнение отсутствует' })
    $problemState = Wait-OperatorTask $problemTask.id {
        param($state)
        $state.delivery_state -eq 'FAILED' -and $state.attempts -ge 5 -and $state.business_status -eq 'PENDING'
    } 45
    Assert-ExternalMissing $problemTask.id
    if (@($problemState.history | Where-Object event -eq 'AMBIGUOUS_RETRY').Count -lt 5) { throw 'История проблемы не содержит все пять неуспешных попыток.' }
    $problemCard = Get-OperatorTask $problemTask.id
    if ($problemCard.business_status -ne 'PENDING' -or $problemCard.delivery_state -ne 'FAILED') { throw "Демо-проблема недоступна в ожидаемом состоянии: $($problemCard.delivery_state)/$($problemCard.business_status)." }
    $problemList = Invoke-RestMethod -Method Get -Uri "$api/api/operator/tasks/problems?page=0" -Headers $patchHeaders -TimeoutSec 10
    if (-not @($problemList.items | Where-Object { $_.id -eq $problemTask.id }).Count) { throw 'Оператор не видит итоговое задание в списке проблем.' }
    $successfulTask = Get-OperatorTask $regular.id
    if ($successfulTask.delivery_state -ne 'DONE' -or $successfulTask.business_status -ne 'SUCCEEDED') { throw 'После загрузки seed отсутствует успешное завершённое задание.' }
    if ($created.Count -lt 6) { throw "Seed создал только $($created.Count) заданий; требуется минимум шесть." }
    $leaveProblemMode = $true

    Write-Output "Создано демо-заданий: $($created.Count)"
    foreach ($entry in $created) {
        [pscustomobject]@{ owner = $entry.task.owner; id = $entry.task.id; title = $entry.task.title; outcome = $entry.outcome }
    }
    Write-Output "Успешная карточка для проверки: $($regular.id) ($($regular.title))."
    Write-Output "Итоговая проблема для оператора: $($problemTask.id) ($($problemTask.title)); состояние FAILED/PENDING после пяти попыток, внешний GET возвращает 404."
    Write-Output 'Под operator откройте вкладку «Проблемы» и карточку итоговой проблемы; alice и bob видят только собственные задания. Сбросьте недоступность командой emulator-mode.ps1 -Mode Reset после проверки.'
} finally {
    if (-not $leaveProblemMode) { & $modeScript -Mode 'Reset' -EmulatorBaseUrl $emulator -ErrorAction SilentlyContinue | Out-Null }
}
