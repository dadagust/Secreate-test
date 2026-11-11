param(
    [Parameter(Mandatory = $true)][ValidatePattern('^nf08-[a-z0-9-]+$')][string]$ProjectName,
    [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot 'backend/target/performance/nf08-fixtures.tsv'
}
$OutputPath = [IO.Path]::GetFullPath($OutputPath)

Push-Location $repoRoot
try {
    $containerId = (& docker compose --project-name $ProjectName -f compose.yaml -f compose.performance.yaml ps -q postgres).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($containerId)) {
        throw "PostgreSQL container for Compose project '$ProjectName' is not running."
    }

    $sql = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'performance/seed-nf08.sql')
    & docker exec $containerId psql -U exchange -d exchange -v ON_ERROR_STOP=1 -c $sql
    if ($LASTEXITCODE -ne 0) { throw 'NF08 seed transaction failed.' }

    $verificationSql = @'
SELECT count(*) || '|' || count(*) FILTER (WHERE owner_name='alice') || '|' || count(*) FILTER (WHERE owner_name='bob') || '|' || count(*) FILTER (WHERE status='SUCCEEDED') || '|' || count(*) FILTER (WHERE status='FAILED')
FROM tasks WHERE request_key LIKE 'nf08-fixture-%';
'@
    $verification = (& docker exec $containerId psql -U exchange -d exchange -A -t -F '|' -c $verificationSql).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'NF08 seed verification query failed.' }
    $counts = $verification.Split('|') | ForEach-Object { [int]$_ }
    if ($counts.Count -ne 5 -or $counts[0] -ne 5000 -or $counts[1] -ne 2500 -or $counts[2] -ne 2500 -or $counts[3] -ne 2500 -or $counts[4] -ne 2500) {
        throw "Unexpected NF08 task distribution: $verification"
    }

    $integritySql = @'
SELECT count(*) || '|' || count(*) FILTER (WHERE o.state='DONE' AND o.attempts=1 AND o.lease_token IS NULL) || '|' || count(*) FILTER (WHERE e.executions=1 AND e.result_version=t.result_version AND e.result_status=t.status) || '|' || count(*) FILTER (WHERE event_count.total=3) || '|' || count(*) FILTER (WHERE s.operator_name='operator' AND s.owner_name='alice') || '|' || count(*) FILTER (WHERE t.owner_name='bob' AND s.operator_name='operator')
FROM tasks t
JOIN outbox o ON o.task_id=t.id
JOIN executor.executions e ON e.id=t.id
LEFT JOIN operator_scope s ON s.owner_name=t.owner_name AND s.operator_name='operator'
LEFT JOIN (SELECT task_id, count(*) AS total FROM exchange_events GROUP BY task_id) event_count ON event_count.task_id=t.id
WHERE t.request_key LIKE 'nf08-fixture-%';
'@
    $integrity = (& docker exec $containerId psql -U exchange -d exchange -A -t -F '|' -c $integritySql).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'NF08 related-data verification query failed.' }
    $integrityCounts = $integrity.Split('|') | ForEach-Object { [int]$_ }
    if ($integrityCounts.Count -ne 6 -or $integrityCounts[0] -ne 5000 -or $integrityCounts[1] -ne 5000 -or $integrityCounts[2] -ne 5000 -or $integrityCounts[3] -ne 5000 -or $integrityCounts[4] -ne 2500 -or $integrityCounts[5] -ne 0) {
        throw "Unexpected NF08 related-data integrity: $integrity"
    }

    $fixtureSql = @'
SELECT id, owner_name, title, status, local_version, assignee
FROM tasks WHERE request_key LIKE 'nf08-fixture-%'
ORDER BY owner_name, id;
'@
    $fixtures = & docker exec $containerId psql -U exchange -d exchange -A -t -F '|' -c $fixtureSql
    if ($LASTEXITCODE -ne 0 -or $fixtures.Count -ne 5000) { throw 'Could not export all NF08 fixtures.' }
    $directory = Split-Path -Parent $OutputPath
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    [IO.File]::WriteAllLines($OutputPath, [string[]]$fixtures, [Text.UTF8Encoding]::new($false))

    [pscustomobject]@{
        tasks = $counts[0]
        alice = $counts[1]
        bob = $counts[2]
        succeeded = $counts[3]
        failed = $counts[4]
        outboxDoneAndUnleased = $integrityCounts[1]
        externalExecutions = $integrityCounts[2]
        threeHistoryEvents = $integrityCounts[3]
        operatorAliceScopeRows = $integrityCounts[4]
        operatorBobScopeRows = $integrityCounts[5]
        fixtureFile = $OutputPath
    } | ConvertTo-Json -Depth 3
}
finally {
    Pop-Location
}
