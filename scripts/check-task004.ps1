[CmdletBinding()]
param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$BrowserPath = $env:TASK3_BROWSER
)

$ErrorActionPreference = 'Stop'
if (-not $JavaHome -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin\java.exe'))) {
    throw 'Задайте JAVA_HOME с Java 21 перед запуском check-task004.ps1.'
}

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$seedScript = Join-Path $PSScriptRoot 'demo-seed.ps1'
$modeScript = Join-Path $PSScriptRoot 'emulator-mode.ps1'
$BrowserPath = if ($BrowserPath) { $BrowserPath } else { 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
if (-not (Test-Path -LiteralPath $BrowserPath)) { throw "Браузер для smoke-проверки не найден: $BrowserPath. Передайте -BrowserPath." }
$project = 'secreate-task004-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$temporary = Join-Path ([IO.Path]::GetTempPath()) $project
$null = New-Item -ItemType Directory -Path $temporary
$postgresContainer = $null
$apiProcess = $null
$emulatorProcess = $null
$viteProcess = $null
$ownedIds = [System.Collections.Generic.List[string]]::new()
$composeStarted = $false
$processSequence = 0
$pushCount = 0
$envBefore = @{}
foreach ($name in @('SPRING_DATASOURCE_URL','SPRING_DATASOURCE_USERNAME','SPRING_DATASOURCE_PASSWORD','EXCHANGE_EXECUTOR','JAVA_HOME','PATH','TASK3_POSTGRES_CONTAINER','TASK3_BROWSER')) {
    $entry = Get-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    $envBefore[$name] = if ($entry) { [pscustomobject]@{ exists = $true; value = $entry.Value } } else { [pscustomobject]@{ exists = $false; value = $null } }
}

function Invoke-Sql([string]$Sql) {
    $output = & docker exec $postgresContainer psql -U exchange -d exchange -At -c $Sql
    if ($LASTEXITCODE -ne 0) { throw "PostgreSQL-команда завершилась с кодом $LASTEXITCODE." }
    return ($output -join "`n").Trim()
}

function Get-OutboxSnapshot([string]$Id) {
    $json = Invoke-Sql "select json_build_object('state',state,'attempts',attempts,'lease_token',lease_token::text,'lease_until',lease_until::text,'failure_reason',failure_reason)::text from outbox where task_id='$Id'"
    return ($json | ConvertFrom-Json)
}

function Get-TaskHistorySignature([string]$Id) {
    return Invoke-Sql "select coalesce(string_agg(id::text || '|' || event || '|' || actor || '|' || created_at::text || '|' || details::text, ';' order by id),'') from exchange_events where task_id='$Id'"
}

function Get-TaskAuditSignature([string]$Id) {
    return Invoke-Sql "select coalesce(string_agg(id::text || '|' || actor || '|' || coalesce(old_assignee,'<null>') || '|' || new_assignee || '|' || old_version::text || '|' || new_version::text || '|' || created_at::text, ';' order by id),'') from assignment_audit where task_id='$Id'"
}

function Start-JavaProcess([string]$Name, [string[]]$Arguments, [hashtable]$Environment) {
    $script:processSequence++
    $saved = @{}
    foreach ($key in $Environment.Keys) {
        $existing = Get-Item -Path "Env:$key" -ErrorAction SilentlyContinue
        $saved[$key] = if ($existing) { [pscustomobject]@{ exists = $true; value = $existing.Value } } else { [pscustomobject]@{ exists = $false; value = $null } }
        Set-Item -Path "Env:$key" -Value ([string]$Environment[$key])
    }
    $stdoutPath = Join-Path $temporary "$Name-$script:processSequence.out.log"
    $stderrPath = Join-Path $temporary "$Name-$script:processSequence.err.log"
    try {
        $javaArguments = @()
        for ($index = 0; $index -lt $Arguments.Count; $index++) {
            if ($Arguments[$index] -eq '-cp' -and ($index + 1) -lt $Arguments.Count) {
                $javaArguments += '-cp'
                $index++
                $javaArguments += ('"' + $Arguments[$index] + '"')
            } else { $javaArguments += $Arguments[$index] }
        }
        $process = Start-Process -FilePath (Join-Path $JavaHome 'bin\java.exe') -ArgumentList $javaArguments -WorkingDirectory $backend -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    } finally {
        foreach ($key in $saved.Keys) {
            if ($saved[$key].exists) { Set-Item -Path "Env:$key" -Value $saved[$key].value }
            else { Remove-Item -Path "Env:$key" -ErrorAction SilentlyContinue }
        }
    }
    return [pscustomobject]@{
        name = $Name
        process = $process
        stdoutPath = $stdoutPath
        stderrPath = $stderrPath
    }
}

function Stop-JavaProcess($Instance) {
    if (-not $Instance) { return }
    if (-not $Instance.process.HasExited) {
        Stop-Process -Id $Instance.process.Id -Force
        $Instance.process.WaitForExit()
    }
    $Instance.process.Dispose()
}

function Start-Emulator {
    $dependencies = (Get-Content -Raw (Join-Path $backend 'target\classpath.txt')).Trim()
    $classpath = (Join-Path $backend 'target\classes') + ';' + $dependencies
    $env = @{
        EXECUTOR_DB_URL = 'jdbc:postgresql://127.0.0.1:5432/exchange'
        EXECUTOR_DB_USER = 'exchange'
        EXECUTOR_DB_PASSWORD = 'local-demo-only'
    }
    $script:emulatorProcess = Start-JavaProcess 'emulator' @('-cp', $classpath, 'ru.secreate.exchange.emulator.EmulatorMain', '9090') $env
    Wait-Http 'http://127.0.0.1:9090/fault-modes' $null
}

function Start-Api {
    $env = @{
        SPRING_DATASOURCE_URL = 'jdbc:postgresql://127.0.0.1:5432/exchange'
        SPRING_DATASOURCE_USERNAME = 'exchange'
        SPRING_DATASOURCE_PASSWORD = 'local-demo-only'
        EXCHANGE_EXECUTOR = 'http://127.0.0.1:9090'
    }
    $script:apiProcess = Start-JavaProcess 'api' @('-jar', 'target\exchange-0.0.1-SNAPSHOT.jar') $env
    Wait-Http 'http://127.0.0.1:8080/api/tasks?page=0' @{ Authorization = Get-Auth 'alice' 'demo-alice' }
}

function Start-Vite {
    $node = (Get-Command node.exe).Source
    $viteOut = Join-Path $temporary 'vite.out.log'
    $viteErr = Join-Path $temporary 'vite.err.log'
    $process = Start-Process -FilePath $node -ArgumentList @('node_modules/vite/bin/vite.js','--host','127.0.0.1') -WorkingDirectory $frontend -PassThru -WindowStyle Hidden -RedirectStandardOutput $viteOut -RedirectStandardError $viteErr
    $script:viteProcess = [pscustomobject]@{ process = $process }
    $until = [DateTimeOffset]::UtcNow.AddSeconds(30)
    do {
        if ($process.HasExited) { throw "Vite завершился преждевременно; журнал: $viteErr" }
        try { $null = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 2; return }
        catch { Start-Sleep -Milliseconds 250 }
    } while ([DateTimeOffset]::UtcNow -lt $until)
    throw "Vite не открыл HTTP; журнал: $viteErr"
}

function Wait-Http([string]$Url, $Headers) {
    $until = [DateTimeOffset]::UtcNow.AddSeconds(40)
    do {
        if (($apiProcess -and $apiProcess.process.HasExited) -or ($emulatorProcess -and $emulatorProcess.process.HasExited)) {
            throw 'Backend или эмулятор завершился до открытия HTTP.'
        }
        try {
            if ($Headers) { $null = Invoke-RestMethod -Method Get -Uri $Url -Headers $Headers -TimeoutSec 2 }
            else { $null = Invoke-RestMethod -Method Get -Uri $Url -TimeoutSec 2 }
            return
        } catch { Start-Sleep -Milliseconds 250 }
    } while ([DateTimeOffset]::UtcNow -lt $until)
    throw "HTTP-сервис не открылся: $Url."
}

function Get-Auth([string]$User, [string]$Password) {
    return 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(('{0}:{1}' -f $User, $Password)))
}

function New-Task([string]$Title) {
    $idempotency = 'task004-check-' + [Guid]::NewGuid().ToString('N')
    $body = @{ title = $Title } | ConvertTo-Json -Compress
    $created = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8080/api/tasks' -Headers @{ Authorization = Get-Auth 'alice' 'demo-alice'; 'Idempotency-Key' = $idempotency } -ContentType 'application/json' -Body $body -TimeoutSec 10
    $script:ownedIds.Add([string]$created.id)
    return [string]$created.id
}

function Get-OperatorTask([string]$Id) {
    return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:8080/api/operator/tasks/$Id" -Headers @{ Authorization = Get-Auth 'operator' 'demo-operator' } -TimeoutSec 10
}

function Wait-Task([string]$Id, [scriptblock]$Condition, [int]$Timeout = 40) {
    $until = [DateTimeOffset]::UtcNow.AddSeconds($Timeout)
    do {
        $state = Get-OperatorTask $Id
        if (& $Condition $state) { return $state }
        Start-Sleep -Milliseconds 200
    } while ([DateTimeOffset]::UtcNow -lt $until)
    throw "Задание $Id не достигло ожидаемого состояния; сейчас $($state.delivery_state)/$($state.business_status)."
}

function Get-External([string]$Id) {
    return Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:9090/operations/$Id" -TimeoutSec 5
}

function Reset-Mode {
    & $modeScript -Mode Reset -EmulatorBaseUrl 'http://127.0.0.1:9090' | Out-Null
}

try {
    Push-Location $root
    $pushCount++
    $env:JAVA_HOME = $JavaHome
    $env:PATH = "$JavaHome\bin;$env:PATH"
    Push-Location $backend
    $pushCount++
    & .\mvnw.cmd -B -ntp package -DskipTests
    if ($LASTEXITCODE -ne 0) { throw "Maven package завершился с кодом $LASTEXITCODE." }
    & .\mvnw.cmd -B -ntp dependency:build-classpath '-Dmdep.outputFile=target/classpath.txt'
    if ($LASTEXITCODE -ne 0) { throw "Сборка classpath завершилась с кодом $LASTEXITCODE." }
    Pop-Location
    $pushCount--

    $script:composeStarted = $true
    & docker compose -p $project up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw "Compose PostgreSQL завершился с кодом $LASTEXITCODE." }
    $postgresContainer = (& docker compose -p $project ps -q postgres).Trim()
    if (-not $postgresContainer) { throw 'Compose не вернул id тестового PostgreSQL.' }

    Start-Emulator
    Start-Api
    $null = & $seedScript -ApiBaseUrl 'http://127.0.0.1:8080' -EmulatorBaseUrl 'http://127.0.0.1:9090'
    if ($LASTEXITCODE -ne 0) { throw 'Демонстрационная загрузка завершилась ошибкой.' }

    # Run both interactive suites against this same clean-volume PostgreSQL before lifecycle tests.
    Reset-Mode
    Start-Vite
    $env:TASK3_POSTGRES_CONTAINER = $postgresContainer
    $env:TASK3_BROWSER = $BrowserPath
    Push-Location $frontend
    $pushCount++
    try {
        & npm.cmd run test:browser
        if ($LASTEXITCODE -ne 0) { throw "Браузерный smoke завершился с кодом $LASTEXITCODE." }
        & npm.cmd run test:task004
        if ($LASTEXITCODE -ne 0) { throw "Браузерная проверка режимов завершилась с кодом $LASTEXITCODE." }
    } finally {
        Pop-Location
        $pushCount--
        Stop-JavaProcess $viteProcess
        $script:viteProcess = $null
    }
    Reset-Mode

    # Kill the real backend after the emulator committed, while PostgreSQL still holds the original live lease.
    & $modeScript -Mode DelayedResult -DelayMs 2400 -EmulatorBaseUrl 'http://127.0.0.1:9090' | Out-Null
    $backendInterrupted = New-Task 'TASK-004 backend restart during exchange'
    $inFlightUntil = [DateTimeOffset]::UtcNow.AddSeconds(15)
    $inFlight = $false
    do {
        try {
            $external = Get-External $backendInterrupted
            $local = Get-OperatorTask $backendInterrupted
            if ($external.executions -eq 1 -and $local.delivery_state -eq 'READY' -and $local.business_status -eq 'PENDING' -and $local.lease_until) { $inFlight = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 60
    } while ([DateTimeOffset]::UtcNow -lt $inFlightUntil)
    if (-not $inFlight) { throw 'Не удалось поймать активный обмен перед остановкой backend.' }
    $externalBeforeBackendRestart = Get-External $backendInterrupted
    $apiBeforeBackendRestart = Get-OperatorTask $backendInterrupted
    $dbBeforeBackendRestart = Get-OutboxSnapshot $backendInterrupted
    if ($externalBeforeBackendRestart.operationId -ne $backendInterrupted -or $externalBeforeBackendRestart.executions -ne 1) { throw 'Внешнее исполнение не зафиксировано ровно один раз перед остановкой backend.' }
    if ($apiBeforeBackendRestart.delivery_state -ne 'READY' -or $apiBeforeBackendRestart.business_status -ne 'PENDING' -or -not $apiBeforeBackendRestart.lease_until) { throw 'API не показывает активный lease до остановки backend.' }
    if ($dbBeforeBackendRestart.state -ne 'READY' -or [int]$dbBeforeBackendRestart.attempts -ne 1 -or -not $dbBeforeBackendRestart.lease_token -or -not $dbBeforeBackendRestart.lease_until) { throw 'PostgreSQL не показывает первую попытку с сохранённым lease.' }
    $backendLeaseToken = [string]$dbBeforeBackendRestart.lease_token
    $backendLeaseDeadline = [DateTimeOffset]::Parse([string]$dbBeforeBackendRestart.lease_until).ToUniversalTime()
    $apiLeaseDeadline = [DateTimeOffset]::Parse([string]$apiBeforeBackendRestart.lease_until).ToUniversalTime()
    if ([Math]::Abs(($backendLeaseDeadline - $apiLeaseDeadline).TotalSeconds) -gt 1) { throw 'Срок lease из API отличается от сохранённого срока в PostgreSQL.' }
    if ($backendLeaseDeadline -le [DateTimeOffset]::UtcNow) { throw 'Lease уже истёк до остановки backend.' }
    Stop-JavaProcess $apiProcess
    $script:apiProcess = $null
    Start-Sleep -Milliseconds 2600
    Start-Api
    while ([DateTimeOffset]::UtcNow -lt $backendLeaseDeadline) {
        $apiWhileLeased = Get-OperatorTask $backendInterrupted
        $dbWhileLeased = Get-OutboxSnapshot $backendInterrupted
        if ($apiWhileLeased.delivery_state -ne 'READY' -or $apiWhileLeased.business_status -ne 'PENDING' -or [int]$dbWhileLeased.attempts -ne 1 -or [string]$dbWhileLeased.lease_token -ne $backendLeaseToken) {
            throw 'Backend изменил захваченный outbox до штатного истечения сохранённого lease.'
        }
        if (@($apiWhileLeased.history | Where-Object event -eq 'ATTEMPT_2').Count) { throw 'Повторная попытка началась до истечения сохранённого lease.' }
        Start-Sleep -Milliseconds 250
    }
    $recovered = Wait-Task $backendInterrupted {
        param($state)
        $state.delivery_state -eq 'DONE' -and $state.business_status -eq 'SUCCEEDED' -and @($state.history | Where-Object event -eq 'ATTEMPT_2').Count -gt 0
    } 45
    $backendAttemptTwo = Invoke-Sql "select created_at::text from exchange_events where task_id='$backendInterrupted' and event='ATTEMPT_2' order by id limit 1"
    if (-not $backendAttemptTwo -or [DateTimeOffset]::Parse($backendAttemptTwo).ToUniversalTime() -lt $backendLeaseDeadline) { throw 'ATTEMPT_2 не началась после сохранённого срока lease.' }
    $dbAfterBackendRestart = Get-OutboxSnapshot $backendInterrupted
    if ($dbAfterBackendRestart.state -ne 'DONE' -or [int]$dbAfterBackendRestart.attempts -ne 2 -or $dbAfterBackendRestart.lease_token) { throw 'После автоматического повтора PostgreSQL не показывает завершённую вторую попытку.' }
    if (-not @($recovered.history | Where-Object event -eq 'ATTEMPT_1').Count) { throw 'После перезапуска потерялась история первой попытки.' }
    $attemptAfter = Invoke-Sql "select details->>'attemptsAfter' from exchange_events where task_id='$backendInterrupted' and event='ATTEMPT_2' order by id desc limit 1"
    $appliedStatus = Invoke-Sql "select details->>'newBusinessStatus' from exchange_events where task_id='$backendInterrupted' and event='RESULT_APPLY' order by id desc limit 1"
    if ($attemptAfter -ne '2' -or $appliedStatus -ne 'SUCCEEDED') { throw 'После backend restart в JSONB-аудите отсутствуют данные второй попытки или применённого результата.' }
    $externalAfterBackendRestart = Get-External $backendInterrupted
    if ($externalAfterBackendRestart.operationId -ne $backendInterrupted -or $externalAfterBackendRestart.executions -ne 1) { throw 'Независимый GET изменил operationId или показал больше одного исполнения после backend restart.' }
    Write-Output "Backend restart after lease expiry: operationId=$backendInterrupted, attempts=$($dbAfterBackendRestart.attempts), leaseExpired=$($backendLeaseDeadline.ToString('o')), executions=$($externalAfterBackendRestart.executions)"

    # Keep an unavailable operation in the durable outbox while PostgreSQL itself is stopped.
    & $modeScript -Mode Unavailable -EmulatorBaseUrl 'http://127.0.0.1:9090' | Out-Null
    $postgresInterrupted = New-Task 'TASK-004 PostgreSQL restart with pending delivery'
    $pending = Wait-Task $postgresInterrupted { param($state) @($state.history | Where-Object event -eq 'AMBIGUOUS_RETRY').Count -gt 0 } 15
    $patchBody = @{ assignee = 'operator'; version = [long]$pending.local_version } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Patch -Uri "http://127.0.0.1:8080/api/tasks/$postgresInterrupted/assignee" -Headers @{ Authorization = Get-Auth 'operator' 'demo-operator' } -ContentType 'application/json' -Body $patchBody -TimeoutSec 10 | Out-Null
    $historyBeforePostgresRestart = Get-TaskHistorySignature $postgresInterrupted
    $auditBeforePostgresRestart = Get-TaskAuditSignature $postgresInterrupted
    if (-not $historyBeforePostgresRestart.Contains('ATTEMPT_1') -or -not $historyBeforePostgresRestart.Contains('AMBIGUOUS_RETRY')) { throw 'До PostgreSQL restart не сохранены конкретные события первой попытки и временного сбоя.' }
    $retryReason = Invoke-Sql "select details->>'reason' from exchange_events where task_id='$postgresInterrupted' and event='AMBIGUOUS_RETRY' order by id desc limit 1"
    if ($retryReason -ne 'TEMPORARY_DELIVERY_FAILURE') { throw 'До PostgreSQL restart событие временного сбоя не содержит JSONB-причину.' }
    if (-not $auditBeforePostgresRestart.Contains('operator|')) { throw 'До PostgreSQL restart не сохранена конкретная запись назначения оператора.' }
    $beforeTasks = [int](Invoke-Sql 'select count(*) from tasks')
    $beforeEvents = [int](Invoke-Sql 'select count(*) from exchange_events')
    $beforeAudits = [int](Invoke-Sql 'select count(*) from assignment_audit')
    Stop-JavaProcess $apiProcess; $script:apiProcess = $null
    Stop-JavaProcess $emulatorProcess; $script:emulatorProcess = $null

    & docker compose -p $project restart postgres
    if ($LASTEXITCODE -ne 0) { throw 'Перезапуск PostgreSQL завершился ошибкой.' }
    $readyUntil = [DateTimeOffset]::UtcNow.AddSeconds(45)
    do {
        & docker exec $postgresContainer pg_isready -U exchange -d exchange | Out-Null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTimeOffset]::UtcNow -lt $readyUntil)
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL не восстановился с прежним Compose volume.' }

    Start-Emulator
    Reset-Mode
    Start-Api
    $resumed = Wait-Task $postgresInterrupted {
        param($state)
        $state.delivery_state -eq 'DONE' -and $state.business_status -eq 'SUCCEEDED' -and @($state.history | Where-Object event -eq 'ATTEMPT_2').Count -gt 0
    } 25
    $afterTasks = [int](Invoke-Sql 'select count(*) from tasks')
    $afterEvents = [int](Invoke-Sql 'select count(*) from exchange_events')
    $afterAudits = [int](Invoke-Sql 'select count(*) from assignment_audit')
    $historyAfterPostgresRestart = Get-TaskHistorySignature $postgresInterrupted
    $auditAfterPostgresRestart = Get-TaskAuditSignature $postgresInterrupted
    if ($afterTasks -ne $beforeTasks) { throw "После restart PostgreSQL число заданий изменилось: $beforeTasks -> $afterTasks." }
    if ($afterEvents -le $beforeEvents) { throw 'После restart PostgreSQL не сохранилась или не продолжилась история обмена.' }
    if ($afterAudits -lt $beforeAudits) { throw 'После restart PostgreSQL потерялась история назначения.' }
    if (-not $historyAfterPostgresRestart.StartsWith($historyBeforePostgresRestart,[StringComparison]::Ordinal)) { throw 'Конкретные строки истории до PostgreSQL restart не сохранились в прежнем порядке.' }
    if ($auditAfterPostgresRestart -ne $auditBeforePostgresRestart) { throw 'Конкретная запись аудита изменения ответственного изменилась или пропала после PostgreSQL restart.' }
    if (-not @($resumed.history | Where-Object event -eq 'ATTEMPT_1').Count -or -not @($resumed.history | Where-Object event -eq 'ATTEMPT_2').Count) { throw 'После PostgreSQL restart API не отдает сохранённую и новую попытки.' }
    $appliedStatusAfterDb = Invoke-Sql "select details->>'newBusinessStatus' from exchange_events where task_id='$postgresInterrupted' and event='RESULT_APPLY' order by id desc limit 1"
    if ($appliedStatusAfterDb -ne 'SUCCEEDED') { throw 'После PostgreSQL restart переход результата отсутствует в JSONB-аудите.' }
    if (-not @($resumed.assignmentHistory | Where-Object { $_.actor -eq 'operator' -and $_.new_assignee -eq 'operator' }).Count) { throw 'Аудит оператора не пережил restart PostgreSQL.' }
    $externalAfterDb = Get-External $postgresInterrupted
    if ($externalAfterDb.executions -ne 1 -or $externalAfterDb.operationId -ne $postgresInterrupted) { throw 'Внешний operationId/count изменился после восстановления PostgreSQL.' }
    $migrationVersion = Invoke-Sql "select max(version) from flyway_schema_history where success"
    if ([int]$migrationVersion -ne 9) { throw "На чистой БД применена неожиданная версия схемы: $migrationVersion." }
    Write-Output "PostgreSQL volume restart: operationId=$postgresInterrupted, tasks=$afterTasks, events=$afterEvents, assignmentAudits=$afterAudits, executions=$($externalAfterDb.executions)"

    Stop-JavaProcess $apiProcess; $script:apiProcess = $null
    Stop-JavaProcess $emulatorProcess; $script:emulatorProcess = $null
    $logs = @(Get-ChildItem -LiteralPath $temporary -Filter 'api-*.out.log' | Select-Object -ExpandProperty FullName)
    if ($logs.Count) {
        $diagnostics = Select-String -Path $logs -Pattern 'operationId=' | Where-Object { $ownedIds -contains ([regex]::Match($_.Line, 'operationId=([0-9a-f-]{36})').Groups[1].Value) }
        foreach ($id in $ownedIds) {
            $events = @($diagnostics | Where-Object { $_.Line.Contains("operationId=$id") -and $_.Line -match '\boutcome=[A-Z_]+' })
            if (-not $events.Count) { throw "Для операции $id отсутствует диагностическое событие NF10 с outcome." }
        }
        foreach ($line in $diagnostics) { Write-Output $line.Line.Trim() }
    } else {
        throw 'Backend не создал диагностических журналов с operationId/outcome (NF10).'
    }
    Write-Output "Создан изолированный Compose project $project; подтверждены seed, backend restart и PostgreSQL restart."
    Write-Output "Сохранённые диагностические журналы: $temporary"
} finally {
    Stop-JavaProcess $apiProcess
    Stop-JavaProcess $emulatorProcess
    Stop-JavaProcess $viteProcess
    foreach ($name in $envBefore.Keys) {
        if ($envBefore[$name].exists) { Set-Item -Path "Env:$name" -Value $envBefore[$name].value }
        else { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue }
    }
    while ($pushCount -gt 0) { Pop-Location -ErrorAction SilentlyContinue; $pushCount-- }
    if ($composeStarted) {
        & docker compose -p $project down --volumes --remove-orphans
    }
}
