param(
    [string]$JavaHome = $env:JAVA_HOME,
    [ValidateRange(0, 900)][int]$DrainSeconds = 180,
    [string]$ReportPath = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$backendRoot = Join-Path $repoRoot 'backend'
$artifactRoot = Join-Path $backendRoot 'target/performance'
if ([string]::IsNullOrWhiteSpace($JavaHome) -or -not (Test-Path -LiteralPath (Join-Path $JavaHome 'bin/java.exe'))) {
    throw 'Укажите Java 21 через JAVA_HOME или параметр -JavaHome.'
}
$javaHomeWasSet = Test-Path Env:JAVA_HOME
$previousJavaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    [IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
    $ReportPath = Join-Path $artifactRoot 'nf08-report.json'
}
$ReportPath = [IO.Path]::GetFullPath($ReportPath)
[IO.Directory]::CreateDirectory((Split-Path -Parent $ReportPath)) | Out-Null
$runId = [guid]::NewGuid().ToString('N')
$projectName = 'nf08-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $runId.Substring(0, 6)

function Get-FreeTcpPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port }
    finally { $listener.Stop() }
}

function Invoke-Docker {
    param([string[]]$Arguments)
    $output = & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE`n$($output -join "`n")" }
    return $output
}

function Get-ContainerLimits {
    param([string]$Service, [string]$ContainerId)
    $inspect = (Invoke-Docker @('inspect', '--format', '{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}', $ContainerId)).Trim().Split('|')
    $cgroup = (Invoke-Docker @('exec', $ContainerId, 'sh', '-c', 'cat /sys/fs/cgroup/cpu.max && cat /sys/fs/cgroup/memory.max')).Trim() -split "`r?`n"
    $cpuLimit = $cgroup[0].Trim().Split(' ')[0..1]
    [pscustomobject]@{
        service = $Service
        containerId = $ContainerId
        hostNanoCpus = [long]$inspect[0]
        hostCpuCores = [double]$inspect[0] / 1000000000
        hostMemoryBytes = [long]$inspect[1]
        hostMemoryMiB = [math]::Round(([double]$inspect[1] / 1MB), 2)
        cgroupCpuMax = $cgroup[0].Trim()
        cgroupCpuCores = [double]$cpuLimit[0] / [double]$cpuLimit[1]
        cgroupMemoryMaxBytes = [long]$cgroup[1].Trim()
    }
}

Push-Location $repoRoot
$succeeded = $false
$createdProject = $false
try {
    $env:POSTGRES_PUBLISHED_PORT = [string](Get-FreeTcpPort)
    $env:NF08_API_PUBLISHED_PORT = [string](Get-FreeTcpPort)
    $env:NF08_EMULATOR_PUBLISHED_PORT = [string](Get-FreeTcpPort)
    $composeFiles = @('-f', 'compose.yaml', '-f', 'compose.performance.yaml')
    $projectArgs = @('compose', '--project-name', $projectName) + $composeFiles

    Push-Location $backendRoot
    try {
        $env:JAVA_HOME = $JavaHome
        $mavenOutput = & .\mvnw.cmd -B -ntp -DskipTests package dependency:copy-dependencies -DincludeScope=runtime -DoutputDirectory=target/dependency
        if ($LASTEXITCODE -ne 0) { throw "Maven performance image preparation failed.`n$($mavenOutput -join "`n")" }
    }
    finally { Pop-Location }

    Invoke-Docker ($projectArgs + @('up', '--detach', '--build', '--wait')) | Write-Output
    $createdProject = $true
    $apiPort = $env:NF08_API_PUBLISHED_PORT
    $emulatorPort = $env:NF08_EMULATOR_PUBLISHED_PORT
    $apiUrl = "http://127.0.0.1:$apiPort"
    $emulatorUrl = "http://127.0.0.1:$emulatorPort"
    $apiAuth = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('alice:demo-alice'))

    $ready = $false
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try {
            $status = & curl.exe -sS -o NUL -w '%{http_code}' -H "Authorization: $apiAuth" --max-time 2 "$apiUrl/api/tasks?status=SUCCEEDED&page=0" 2>$null
            if ($LASTEXITCODE -eq 0 -and $status.Trim() -eq '200') {
                $ready = $true
                break
            }
        }
        catch { Start-Sleep -Seconds 1 }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw "Backend did not become ready at $apiUrl." }

    $emulatorReady = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try {
            $modeJson = & curl.exe -fsS --max-time 2 "$emulatorUrl/fault-modes" 2>$null
            if ($LASTEXITCODE -eq 0) {
                $emulatorReady = $true
                break
            }
        }
        catch { Start-Sleep -Milliseconds 500 }
        Start-Sleep -Milliseconds 500
    }
    if (-not $emulatorReady) { throw "Emulator did not become ready at $emulatorUrl." }
    $null = & curl.exe -fsS -X DELETE --max-time 5 "$emulatorUrl/fault-modes" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not reset emulator fault modes.' }
    $faults = (($modeJson -join '') | ConvertFrom-Json)
    $faultText = & curl.exe -fsS --max-time 5 "$emulatorUrl/fault-modes" 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Could not read back emulator fault modes.' }
    $faults = (($faultText -join '') | ConvertFrom-Json)
    if ($faults.unavailable -or $faults.dropAfterSave -or $faults.duplicateResult -or $faults.delayMs -ne 0) {
        throw "Emulator artificial fault modes were not reset: $($faults | ConvertTo-Json -Compress)"
    }

    $postgresId = (Invoke-Docker ($projectArgs + @('ps', '-q', 'postgres'))).Trim()
    $backendId = (Invoke-Docker ($projectArgs + @('ps', '-q', 'backend'))).Trim()
    $emulatorId = (Invoke-Docker ($projectArgs + @('ps', '-q', 'emulator'))).Trim()
    $limits = @(
        (Get-ContainerLimits 'postgres' $postgresId),
        (Get-ContainerLimits 'backend' $backendId),
        (Get-ContainerLimits 'emulator' $emulatorId)
    )
    $totalCpu = ($limits | Measure-Object -Property hostCpuCores -Sum).Sum
    $totalMemory = ($limits | Measure-Object -Property hostMemoryBytes -Sum).Sum
    $totalCgroupCpu = ($limits | Measure-Object -Property cgroupCpuCores -Sum).Sum
    $totalCgroupMemory = ($limits | Measure-Object -Property cgroupMemoryMaxBytes -Sum).Sum
    foreach ($limit in $limits) {
        if ($limit.hostNanoCpus -le 0 -or $limit.hostMemoryBytes -le 0 -or $limit.cgroupMemoryMaxBytes -ne $limit.hostMemoryBytes) {
            throw "Container $($limit.service) does not have matching finite HostConfig and cgroup limits."
        }
    }
    if ($totalCpu -gt 2.0001 -or $totalCgroupCpu -gt 2.0001 -or $totalMemory -gt 4GB -or $totalCgroupMemory -gt 4GB) {
        throw "Resource limit exceeded: HostConfig $totalCpu CPU/$([math]::Round($totalMemory / 1GB, 3)) GiB; cgroup $totalCgroupCpu CPU/$([math]::Round($totalCgroupMemory / 1GB, 3)) GiB."
    }

    $fixturePath = Join-Path $artifactRoot 'nf08-fixtures.tsv'
    & (Join-Path $PSScriptRoot 'prepare-nf08.ps1') -ProjectName $projectName -OutputPath $fixturePath
    if ($LASTEXITCODE -ne 0) { throw 'NF08 fixture preparation failed.' }

    $env:NF08_API_URL = $apiUrl
    $env:NF08_PROJECT = $projectName
    $env:NF08_POSTGRES_CONTAINER = $postgresId
    $env:NF08_RUN_ID = $runId
    $env:NF08_FIXTURE_FILE = $fixturePath
    $env:NF08_DRAIN_SECONDS = [string]$DrainSeconds
    $loadOutput = Join-Path $artifactRoot 'nf08-load-results.json'
    & node (Join-Path $PSScriptRoot 'performance/nf08-load.mjs') --output $loadOutput
    $loadExit = $LASTEXITCODE
    if (-not (Test-Path -LiteralPath $loadOutput)) { throw "NF08 generator did not write its report (exit $loadExit)." }
    if ($loadExit -ne 0) { throw "NF08 latency profile failed with exit code $loadExit. Detailed report: $loadOutput" }

    $report = Get-Content -Raw -Encoding UTF8 $loadOutput | ConvertFrom-Json
    $dockerInfo = (Invoke-Docker @('info', '--format', '{{.NCPU}}|{{.MemTotal}}')).Trim().Split('|')
    $dockerVersions = (Invoke-Docker @('version', '--format', '{{.Client.Version}}|{{.Server.Version}}')).Trim().Split('|')
    $postgresVersion = (Invoke-Docker @('exec', $postgresId, 'psql', '-U', 'exchange', '-d', 'exchange', '-At', '-c', 'show server_version;')).Trim()
    $javaVersion = (& docker exec $backendId sh -c 'java -version 2>&1' | Out-String).Trim()
    Push-Location $backendRoot
    try { $mavenVersion = (& .\mvnw.cmd -version | Select-Object -First 1).Trim() }
    finally { Pop-Location }
    $hostOperatingSystem = (Get-CimInstance Win32_OperatingSystem).Caption
    $imageIds = @{
        postgres = (Invoke-Docker @('image', 'inspect', '--format', '{{.Id}}', 'postgres:17-alpine')).Trim()
        backend = (Invoke-Docker @('inspect', '--format', '{{.Image}}', $backendId)).Trim()
        emulator = (Invoke-Docker @('inspect', '--format', '{{.Image}}', $emulatorId)).Trim()
    }
    $report | Add-Member -NotePropertyName environment -NotePropertyValue ([pscustomobject]@{
        runId = $runId
        composeProject = $projectName
        timestamp = (Get-Date).ToString('o')
        node = (node --version).Trim()
        npm = (npm --version).Trim()
        java = $javaVersion
        maven = $mavenVersion
        springBoot = '4.1.2'
        postgres = $postgresVersion
        workerPollIntervalMs = 50
        dockerClient = $dockerVersions[0]
        dockerServer = $dockerVersions[1]
        compose = ((Invoke-Docker @('compose', 'version', '--short')).Trim())
        dockerEngineLogicalCpus = [int]$dockerInfo[0]
        dockerEngineMemoryBytes = [long]$dockerInfo[1]
        hostOperatingSystem = $hostOperatingSystem
        resourceLimits = $limits
        resourceTotals = [pscustomobject]@{ cpuCores = $totalCpu; cgroupCpuCores = $totalCgroupCpu; memoryBytes = $totalMemory; cgroupMemoryBytes = $totalCgroupMemory; memoryMiB = [math]::Round($totalMemory / 1MB, 2) }
        containerImageIds = $imageIds
        loadGenerator = 'Node.js on host; excluded from container quotas'
        browser = 'Not running during the measured profile'
        emulatorFaultModes = $faults
    })
    $report | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $ReportPath
    $succeeded = $true
    Write-Output "NF08 result: $ReportPath"
    Write-Output "Applied caps: $totalCpu CPU and $([math]::Round($totalMemory / 1GB, 3)) GiB; cgroup confirms $totalCgroupCpu CPU and $([math]::Round($totalCgroupMemory / 1GB, 3)) GiB."
    Write-Output "Temporary project: $projectName"
}
finally {
    if ($createdProject -and $succeeded) {
        Invoke-Docker ($projectArgs + @('down', '--volumes', '--remove-orphans')) | Write-Output
    }
    elseif ($createdProject) {
        Write-Warning "Performance environment retained for diagnosis. Stop it with: docker compose --project-name $projectName -f compose.yaml -f compose.performance.yaml down --volumes --remove-orphans"
    }
    Remove-Item Env:POSTGRES_PUBLISHED_PORT, Env:NF08_API_PUBLISHED_PORT, Env:NF08_EMULATOR_PUBLISHED_PORT, Env:NF08_API_URL, Env:NF08_PROJECT, Env:NF08_POSTGRES_CONTAINER, Env:NF08_RUN_ID, Env:NF08_FIXTURE_FILE, Env:NF08_DRAIN_SECONDS -ErrorAction SilentlyContinue
    if ($javaHomeWasSet) { $env:JAVA_HOME = $previousJavaHome }
    else { Remove-Item Env:JAVA_HOME -ErrorAction SilentlyContinue }
    Pop-Location
}
