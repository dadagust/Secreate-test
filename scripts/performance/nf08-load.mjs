import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const config = {
  api: process.env.NF08_API_URL,
  project: process.env.NF08_PROJECT,
  postgresContainer: process.env.NF08_POSTGRES_CONTAINER,
  runId: process.env.NF08_RUN_ID,
  fixtureFile: process.env.NF08_FIXTURE_FILE,
  drainSeconds: Number(process.env.NF08_DRAIN_SECONDS ?? '180'),
  outputFile: process.argv[process.argv.indexOf('--output') + 1],
};

for (const [name, value] of Object.entries(config)) {
  if (name !== 'drainSeconds' && name !== 'outputFile' && !value) throw new Error(`Missing NF08 setting: ${name}`);
}
if (!/^[a-zA-Z0-9_-]+$/.test(config.runId)) throw new Error('NF08_RUN_ID contains unsupported characters.');
if (!Number.isInteger(config.drainSeconds) || config.drainSeconds < 0 || config.drainSeconds > 900) throw new Error('NF08_DRAIN_SECONDS must be 0..900.');
if (!config.outputFile) throw new Error('Pass --output <report-path>.');

const fixtureText = await readFile(config.fixtureFile, 'utf8');
const fixtures = fixtureText.trim().split(/\r?\n/).map((line) => {
  const [id, owner, title, status, version, assignee] = line.split('|');
  if (!id || !owner || !title || !status || !version || !assignee) throw new Error(`Invalid fixture row: ${line}`);
  return { id, owner, title, status, version: Number(version), assignee };
});
if (fixtures.length !== 5000) throw new Error(`Expected 5000 fixtures, received ${fixtures.length}.`);
const aliceFixtures = fixtures.filter((fixture) => fixture.owner === 'alice');
const bobFixtures = fixtures.filter((fixture) => fixture.owner === 'bob');
if (aliceFixtures.length !== 2500 || bobFixtures.length !== 2500) throw new Error('Fixture ownership distribution is invalid.');

const authorization = (username, password) => `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
const authByOwner = {
  alice: authorization('alice', 'demo-alice'),
  bob: authorization('bob', 'demo-bob'),
  operator: authorization('operator', 'demo-operator'),
};
const assignedFixtures = new Map(aliceFixtures.map((fixture) => [fixture.id, { ...fixture }]));

function createMetrics() {
  return { samples: [], successfulSamples: [], success: 0, errors: 0, timeouts: 0, errorReasons: {}, statusCodes: {} };
}

const metricBuckets = {
  warmup: Object.fromEntries(['list', 'detail', 'create', 'patch'].map((name) => [name, createMetrics()])),
  measurement: Object.fromEntries(['list', 'detail', 'create', 'patch'].map((name) => [name, createMetrics()])),
};

function addMetric(phase, operation, sample) {
  const metric = metricBuckets[phase][operation];
  metric.samples.push(sample.elapsedMs);
  if (sample.ok) {
    metric.success += 1;
    metric.successfulSamples.push(sample.elapsedMs);
    metric.statusCodes[sample.status] = (metric.statusCodes[sample.status] ?? 0) + 1;
    return;
  }
  metric.errors += 1;
  if (sample.timeout) metric.timeouts += 1;
  metric.errorReasons[sample.reason] = (metric.errorReasons[sample.reason] ?? 0) + 1;
  if (sample.status) metric.statusCodes[sample.status] = (metric.statusCodes[sample.status] ?? 0) + 1;
}

function percentile(values, percent = 0.95) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(percent * sorted.length) - 1)];
}

async function request(operation, phase, clientId, sequence) {
  const start = performance.now();
  const owner = clientId % 2 === 0 ? 'alice' : 'bob';
  const fixturesForOwner = owner === 'alice' ? aliceFixtures : bobFixtures;
  const headers = { authorization: authByOwner[owner] };
  let url = config.api;
  let method = 'GET';
  let body;

  if (operation === 'list') {
    const status = clientId % 2 === 0 ? 'SUCCEEDED' : 'FAILED';
    const page = (clientId * 17 + sequence) % 125;
    url += `/api/tasks?status=${status}&page=${page}`;
  } else if (operation === 'detail') {
    const fixture = fixturesForOwner[(clientId * 101 + sequence) % fixturesForOwner.length];
    url += `/api/tasks/${fixture.id}`;
  } else if (operation === 'create') {
    method = 'POST';
    headers.authorization = authByOwner[owner];
    headers['idempotency-key'] = `nf08-${config.runId}-${phase}-${clientId}-${sequence}`;
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ title: `NF08 ${phase} client ${clientId} request ${sequence}` });
    url += '/api/tasks';
  } else {
    method = 'PATCH';
    const fixture = assignedFixtures.get(aliceFixtures[clientId % aliceFixtures.length].id);
    headers.authorization = authByOwner.operator;
    headers['content-type'] = 'application/json';
    const nextAssignee = fixture.assignee === 'operator' ? 'alice' : 'operator';
    body = JSON.stringify({ assignee: nextAssignee, version: fixture.version });
    url += `/api/tasks/${fixture.id}/assignee`;
  }

  try {
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(5000) });
    const responseBody = await response.text();
    const elapsedMs = performance.now() - start;
    const ok = response.status >= 200 && response.status < 300;
    if (!ok) {
      let reason = `http_${response.status}`;
      try {
        const parsed = JSON.parse(responseBody);
        reason += `:${String(parsed.detail ?? parsed.message ?? parsed.title ?? '').slice(0, 120)}`;
      } catch {
        reason += `:${responseBody.slice(0, 120)}`;
      }
      return { elapsedMs, ok, status: response.status, reason, timeout: false };
    }
    if (operation === 'patch') {
      const result = JSON.parse(responseBody);
      const fixture = assignedFixtures.get(aliceFixtures[clientId % aliceFixtures.length].id);
      fixture.version = Number(result.version);
      fixture.assignee = result.assignee;
    }
    return { elapsedMs, ok, status: response.status, timeout: false };
  } catch (error) {
    const elapsedMs = performance.now() - start;
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const reason = timeout ? 'timeout_5s' : `${error?.name ?? 'Error'}:${String(error?.message ?? '').slice(0, 120)}`;
    return { elapsedMs, ok: false, status: null, reason, timeout };
  }
}

async function runPhase(phase, durationSeconds) {
  const operations = ['list', 'detail', 'create', 'patch'];
  const deadline = performance.now() + durationSeconds * 1000;
  let requestCount = 0;
  await Promise.all(Array.from({ length: 20 }, async (_, clientId) => {
    let sequence = 0;
    while (performance.now() < deadline) {
      const operation = operations[(clientId + sequence) % operations.length];
      const result = await request(operation, phase, clientId, sequence);
      addMetric(phase, operation, result);
      requestCount += 1;
      sequence += 1;
    }
  }));
  return { requestedSeconds: durationSeconds, requestCount };
}

function psql(sql) {
  const result = spawnSync('docker', [
    'exec', config.postgresContainer, 'psql', '-U', 'exchange', '-d', 'exchange', '-A', '-t', '-F', '|', '-c', sql,
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`psql failed (${result.status}): ${result.stderr}`);
  return result.stdout.trim();
}

function executionSnapshot() {
  const prefix = `nf08-${config.runId}-measurement-%`;
  const sql = `SELECT count(*) || '|' || count(*) FILTER (WHERE e.id IS NOT NULL) || '|' || count(*) FILTER (WHERE o.state <> 'DONE' OR t.status='PENDING' OR e.id IS NULL) FROM tasks t JOIN outbox o ON o.task_id=t.id LEFT JOIN executor.executions e ON e.id=t.id WHERE t.request_key LIKE '${prefix}';`;
  const [accepted, externallyExecuted, unfinished] = psql(sql).split('|').map(Number);
  const latencySql = `SELECT round((extract(epoch from (e.executed_at-t.created_at))*1000)::numeric, 3) FROM tasks t JOIN executor.executions e ON e.id=t.id WHERE t.request_key LIKE '${prefix}' ORDER BY t.created_at;`;
  const externalLatencyMs = psql(latencySql).split(/\r?\n/).filter(Boolean).map(Number);
  return { accepted, externallyExecuted, unfinished, externalLatencyMs };
}

function summarizeMetric(metric) {
  return {
    requests: metric.samples.length,
    successful: metric.success,
    errors: metric.errors,
    timeouts: metric.timeouts,
    p50MsAllAttempts: percentile(metric.samples, 0.5),
    p95MsAllAttempts: percentile(metric.samples),
    p95MsSuccessful: percentile(metric.successfulSamples),
    p99MsAllAttempts: percentile(metric.samples, 0.99),
    meanMsAllAttempts: metric.samples.length ? metric.samples.reduce((sum, value) => sum + value, 0) / metric.samples.length : null,
    maxMsAllAttempts: metric.samples.length ? Math.max(...metric.samples) : null,
    statusCodes: metric.statusCodes,
    errorReasons: metric.errorReasons,
  };
}

console.log(`NF08 warm-up: 20 clients for 30 seconds; API ${config.api}`);
const warmup = await runPhase('warmup', 30);
console.log(`Warm-up finished: ${warmup.requestCount} completed requests.`);

console.log('NF08 measurement: 20 sequential clients for 120 seconds.');
const measuredStart = new Date().toISOString();
const measurement = await runPhase('measurement', 120);
const measuredEnd = new Date().toISOString();
const atProfileEnd = executionSnapshot();
console.log(`Measurement finished: ${measurement.requestCount} completed requests; ${atProfileEnd.unfinished} created operations unfinished at the 120-second boundary.`);

const drainDeadline = Date.now() + config.drainSeconds * 1000;
let afterDrain = atProfileEnd;
while (Date.now() < drainDeadline && afterDrain.unfinished > 0) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  afterDrain = executionSnapshot();
  console.log(`External delivery drain: ${afterDrain.externallyExecuted}/${afterDrain.accepted} executed, ${afterDrain.unfinished} unfinished.`);
}

const operations = Object.fromEntries(Object.entries(metricBuckets.measurement).map(([name, metric]) => [name, summarizeMetric(metric)]));
const readMetrics = ['list', 'detail'].flatMap((name) => metricBuckets.measurement[name].samples);
const writeMetrics = ['create', 'patch'].flatMap((name) => metricBuckets.measurement[name].samples);
const readSuccessful = ['list', 'detail'].flatMap((name) => metricBuckets.measurement[name].successfulSamples);
const writeSuccessful = ['create', 'patch'].flatMap((name) => metricBuckets.measurement[name].successfulSamples);
const combined = {
  reads: {
    requests: readMetrics.length,
    successful: metricBuckets.measurement.list.success + metricBuckets.measurement.detail.success,
    errors: metricBuckets.measurement.list.errors + metricBuckets.measurement.detail.errors,
    timeouts: metricBuckets.measurement.list.timeouts + metricBuckets.measurement.detail.timeouts,
    p50MsAllAttempts: percentile(readMetrics, 0.5),
    p95MsAllAttempts: percentile(readMetrics),
    p95MsSuccessful: percentile(readSuccessful),
    p99MsAllAttempts: percentile(readMetrics, 0.99),
    meanMsAllAttempts: readMetrics.length ? readMetrics.reduce((sum, value) => sum + value, 0) / readMetrics.length : null,
  },
  changes: {
    requests: writeMetrics.length,
    successful: metricBuckets.measurement.create.success + metricBuckets.measurement.patch.success,
    errors: metricBuckets.measurement.create.errors + metricBuckets.measurement.patch.errors,
    timeouts: metricBuckets.measurement.create.timeouts + metricBuckets.measurement.patch.timeouts,
    p50MsAllAttempts: percentile(writeMetrics, 0.5),
    p95MsAllAttempts: percentile(writeMetrics),
    p95MsSuccessful: percentile(writeSuccessful),
    p99MsAllAttempts: percentile(writeMetrics, 0.99),
    meanMsAllAttempts: writeMetrics.length ? writeMetrics.reduce((sum, value) => sum + value, 0) / writeMetrics.length : null,
  },
};

const report = {
  profile: { warmupSeconds: 30, measurementSeconds: 120, clients: 20, requestDeadlineSeconds: 5, clientBehavior: 'one request in flight per client; next request starts after prior completion', measuredStart, measuredEnd, warmup, measurement },
  operations,
  combined,
  externalExecution: {
    measurementBoundary: { accepted: atProfileEnd.accepted, externallyExecuted: atProfileEnd.externallyExecuted, unfinished: atProfileEnd.unfinished },
    afterDrain: { accepted: afterDrain.accepted, externallyExecuted: afterDrain.externallyExecuted, unfinished: afterDrain.unfinished, drainSeconds: config.drainSeconds },
    latencyFromTaskCreatedToExecutorCommitMs: {
      samples: afterDrain.externalLatencyMs.length,
      p50: percentile(afterDrain.externalLatencyMs, 0.5),
      p95: percentile(afterDrain.externalLatencyMs, 0.95),
      mean: afterDrain.externalLatencyMs.length ? afterDrain.externalLatencyMs.reduce((sum, value) => sum + value, 0) / afterDrain.externalLatencyMs.length : null,
    },
  },
};

await writeFile(config.outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Report written to ${config.outputFile}`);
console.log(JSON.stringify({ combined, operations, externalExecution: report.externalExecution }, null, 2));

if (combined.reads.p95MsAllAttempts > 2000 || combined.changes.p95MsAllAttempts > 3000) {
  console.error('NF08 latency threshold exceeded: reads must be <= 2000ms and changes <= 3000ms.');
  process.exitCode = 2;
}
