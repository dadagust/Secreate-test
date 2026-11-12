import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { parseExecutionSnapshot } from './nf08-counts.mjs';
import { summarizeRuntimeMetrics } from './runtime-metrics.mjs';
import { writeNf08Report } from './nf08-report.mjs';
import { validateNf08ApiResponse } from './nf08-response-validation.mjs';
import { classifyNf08HttpFailure } from './nf08-http-errors.mjs';
import { addNf08Metric, createNf08Metrics, summarizeNf08OperationBuckets } from './nf08-metrics.mjs';

const config = {
  api: process.env.NF08_API_URL,
  project: process.env.NF08_PROJECT,
  postgresContainer: process.env.NF08_POSTGRES_CONTAINER,
  runId: process.env.NF08_RUN_ID,
  fixtureFile: process.env.NF08_FIXTURE_FILE,
  drainSeconds: Number(process.env.NF08_DRAIN_SECONDS ?? '180'),
  maxBusinessRejectionRate: Number(process.env.NF08_MAX_BUSINESS_REJECTION_RATE ?? '0.01'),
  workerPollIntervalMs: Number(process.env.NF08_WORKER_POLL_MS ?? '1000'),
  workerMaxItemsPerTick: Number(process.env.NF08_WORKER_MAX_ITEMS_PER_TICK ?? '16'),
  outputFile: process.argv[process.argv.indexOf('--output') + 1],
};

for (const [name, value] of Object.entries(config)) {
  if (name !== 'drainSeconds' && name !== 'outputFile' && !value) throw new Error(`Missing NF08 setting: ${name}`);
}
if (!/^[a-zA-Z0-9_-]+$/.test(config.runId)) throw new Error('NF08_RUN_ID contains unsupported characters.');
if (!Number.isInteger(config.drainSeconds) || config.drainSeconds < 0 || config.drainSeconds > 900) throw new Error('NF08_DRAIN_SECONDS must be 0..900.');
if (!Number.isFinite(config.maxBusinessRejectionRate) || config.maxBusinessRejectionRate < 0 || config.maxBusinessRejectionRate > 1) throw new Error('NF08_MAX_BUSINESS_REJECTION_RATE must be 0..1.');
if (!Number.isInteger(config.workerPollIntervalMs) || config.workerPollIntervalMs < 1 || !Number.isInteger(config.workerMaxItemsPerTick) || config.workerMaxItemsPerTick < 1 || config.workerMaxItemsPerTick > 256) throw new Error('Invalid worker profile configuration.');
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

const metricBuckets = {
  warmup: Object.fromEntries(['list', 'detail', 'create', 'patch'].map((name) => [name, createNf08Metrics()])),
  measurement: Object.fromEntries(['list', 'detail', 'create', 'patch'].map((name) => [name, createNf08Metrics()])),
};


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
  let expected = {};

  if (operation === 'list') {
    const status = clientId % 2 === 0 ? 'SUCCEEDED' : 'FAILED';
    expected.status = status;
    const eligiblePages = fullListPages[`${owner}:${status}`];
    const page = eligiblePages[(clientId * 17 + sequence) % eligiblePages.length];
    expected.page = page;
    url += `/api/tasks?status=${status}&page=${page}`;
  } else if (operation === 'detail') {
    const fixture = fixturesForOwner[(clientId * 101 + sequence) % fixturesForOwner.length];
    expected.id = fixture.id;
    url += `/api/tasks/${fixture.id}`;
  } else if (operation === 'create') {
    method = 'POST';
    headers.authorization = authByOwner[owner];
    headers['idempotency-key'] = `nf08-${config.runId}-${phase}-${clientId}-${sequence}`;
    headers['content-type'] = 'application/json';
    body = JSON.stringify({ title: `NF08 ${phase} client ${clientId} request ${sequence}` });
    expected.title = `NF08 ${phase} client ${clientId} request ${sequence}`;
    url += '/api/tasks';
  } else {
    method = 'PATCH';
    const fixture = assignedFixtures.get(aliceFixtures[clientId % aliceFixtures.length].id);
    headers.authorization = authByOwner.operator;
    headers['content-type'] = 'application/json';
    const nextAssignee = fixture.assignee === 'operator' ? 'alice' : 'operator';
    expected.id = fixture.id;
    expected.assignee = nextAssignee;
    expected.version = fixture.version + 1;
    body = JSON.stringify({ assignee: nextAssignee, version: fixture.version });
    url += `/api/tasks/${fixture.id}/assignee`;
  }

  try {
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(5000) });
    const responseBody = await response.text();
    const elapsedMs = performance.now() - start;
    if (response.status < 200 || response.status >= 300) {
      return classifyNf08HttpFailure(response.status, responseBody, elapsedMs);
    }
    let parsed;
    try { parsed = JSON.parse(responseBody); } catch { parsed = null; }
    const validation = validateNf08ApiResponse(operation, response.status, parsed, expected);
    if (operation === 'patch' && validation.valid) {
      const result = parsed ?? {};
      const fixture = assignedFixtures.get(aliceFixtures[clientId % aliceFixtures.length].id);
      if (Number.isSafeInteger(Number(result.version)) && typeof result.assignee === 'string') {
        fixture.version = Number(result.version);
        fixture.assignee = result.assignee;
      }
    }
    return {
      elapsedMs,
      ok: validation.valid,
      status: response.status,
      timeout: false,
      contractError: !validation.valid,
      reason: validation.reason,
      businessRejected: false,
    };
  } catch (error) {
    const elapsedMs = performance.now() - start;
    const timeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    const reason = timeout ? 'timeout_5s' : `${error?.name ?? 'Error'}:${String(error?.message ?? '').slice(0, 120)}`;
    return { elapsedMs, ok: false, status: null, reason, timeout, businessRejected: false };
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
      addNf08Metric(metricBuckets[phase][operation], result);
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
  const warmupPrefix = `nf08-${config.runId}-warmup-%`;
  const measurementPrefix = `nf08-${config.runId}-measurement-%`;
  const phaseSnapshot = (prefix) => `SELECT json_build_object('accepted',count(*),'externallyExecuted',count(*) FILTER (WHERE e.id IS NOT NULL),'unfinished',count(*) FILTER (WHERE o.state <> 'DONE' OR t.status='PENDING' OR e.id IS NULL),'externalLatencyMs',coalesce(json_agg(round((extract(epoch from (e.executed_at-t.created_at))*1000)::numeric,3) ORDER BY t.created_at,t.id) FILTER (WHERE e.id IS NOT NULL),'[]'::json)) FROM tasks t JOIN outbox o ON o.task_id=t.id LEFT JOIN executor.executions e ON e.id=t.id WHERE t.request_key LIKE '${prefix}'`;
  const queueSnapshot = `SELECT json_build_object('totalReady',count(*) FILTER (WHERE o.state='READY'),'ready',count(*) FILTER (WHERE o.state='READY' AND o.next_attempt<=now() AND (o.lease_until IS NULL OR o.lease_until<=now())),'leased',count(*) FILTER (WHERE o.state='READY' AND o.lease_until>now()),'scheduled',count(*) FILTER (WHERE o.state='READY' AND o.next_attempt>now())) FROM tasks t JOIN outbox o ON o.task_id=t.id WHERE t.request_key LIKE '${warmupPrefix}' OR t.request_key LIKE '${measurementPrefix}'`;
  const row = JSON.parse(psql(`SELECT json_build_object('warmup',(${phaseSnapshot(warmupPrefix)}),'measurement',(${phaseSnapshot(measurementPrefix)}),'queue',(${queueSnapshot}))`));
  return {
    warmup: parseExecutionSnapshot(row.warmup),
    measurement: parseExecutionSnapshot(row.measurement),
    queue: row.queue,
  };
}

function totalUnfinished(snapshot) {
  return snapshot.warmup.unfinished + snapshot.measurement.unfinished;
}

function totalExternalExecutions(snapshot) {
  return snapshot.warmup.externallyExecuted + snapshot.measurement.externallyExecuted;
}

function summarizeComposeTimings() {
  const result = spawnSync('docker', [
    'compose', '--project-name', config.project, '-f', 'compose.yaml', '-f', 'compose.performance.yaml',
    'logs', '--no-color', 'backend', 'emulator',
  ], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not read NF08 service timing logs (${result.status}): ${result.stderr}`);
  return summarizeRuntimeMetrics(result.stdout);
}


const listCounts = JSON.parse(psql("SELECT coalesce(json_object_agg(owner_name || ':' || status, records), '{}'::json) FROM (SELECT owner_name,status,count(*)::int AS records FROM tasks WHERE owner_name IN ('alice','bob') AND status IN ('SUCCEEDED','FAILED') GROUP BY owner_name,status) matching"));
const fullListPages = {};
for (const [owner, status] of [['alice', 'SUCCEEDED'], ['bob', 'FAILED']]) {
  const recordCount = Number(listCounts[`${owner}:${status}`] ?? 0);
  const pageCount = Math.floor(recordCount / 20);
  if (pageCount < 1) throw new Error(`NF08 requires at least one full ${owner}/${status} page; found ${recordCount} records.`);
  fullListPages[`${owner}:${status}`] = Array.from({ length: pageCount }, (_, page) => page);
}

console.log(`NF08 warm-up: 20 clients for 30 seconds; API ${config.api}`);
const initialSnapshot = executionSnapshot();
const warmup = await runPhase('warmup', 30);
console.log(`Warm-up finished: ${warmup.requestCount} completed requests.`);

const atMeasurementStart = executionSnapshot();
console.log('NF08 measurement: 20 sequential clients for 120 seconds.');
const measuredStart = new Date().toISOString();
const measurement = await runPhase('measurement', 120);
const measuredEnd = new Date().toISOString();
const atProfileEnd = executionSnapshot();
console.log(`Measurement finished: ${measurement.requestCount} completed requests; ${totalUnfinished(atProfileEnd)} warm-up and measurement operations unfinished at the 120-second boundary.`);

const drainDeadline = Date.now() + config.drainSeconds * 1000;
const drainStartedAt = Date.now();
let afterDrain = atProfileEnd;
while (Date.now() < drainDeadline && totalUnfinished(afterDrain) > 0) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  afterDrain = executionSnapshot();
  console.log(`External delivery drain: warm-up ${afterDrain.warmup.externallyExecuted}/${afterDrain.warmup.accepted}, measurement ${afterDrain.measurement.externallyExecuted}/${afterDrain.measurement.accepted}, ${totalUnfinished(afterDrain)} unfinished.`);
}
const drainElapsedSeconds = Math.max(0, (Date.now() - drainStartedAt) / 1000);

const operations = summarizeNf08OperationBuckets(metricBuckets.measurement);
let runtimeTimings = null;
let runtimeTimingsError = null;
try {
  runtimeTimings = summarizeComposeTimings();
} catch (error) {
  runtimeTimingsError = String(error?.message ?? error);
}
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
  profile: { warmupSeconds: 30, measurementSeconds: 120, clients: 20, requestDeadlineSeconds: 5, clientBehavior: 'one request in flight per client; next request starts after prior completion', measuredStart, measuredEnd, warmup, measurement, workerPollIntervalMs: config.workerPollIntervalMs, workerMaxItemsPerTick: config.workerMaxItemsPerTick },
  operations,
  listPageSelection: Object.fromEntries(Object.entries(fullListPages).map(([key, pages]) => [key, {
    matchingRecords: Number(listCounts[key]),
    eligiblePages: pages.length,
    pageRange: [pages[0], pages.at(-1)],
    itemsPerPage: 20,
  }])),
  warmupOperations: summarizeNf08OperationBuckets(metricBuckets.warmup),
  combined,
  externalExecution: {
    taskCreation: {
      warmupCreates: metricBuckets.warmup.create.success,
      measurementCreates: metricBuckets.measurement.create.success,
      warmupArrivalPerSecond: metricBuckets.warmup.create.success / 30,
      measurementArrivalPerSecond: metricBuckets.measurement.create.success / 120,
    },
    queue: {
      beforeWarmup: initialSnapshot.queue,
      atMeasurementStart: atMeasurementStart.queue,
      atMeasurementEnd: atProfileEnd.queue,
      afterDrain: afterDrain.queue,
    },
    measurementBoundary: { ...atProfileEnd.measurement },
    afterDrain: { ...afterDrain.measurement, drainSeconds: config.drainSeconds, actualDrainSeconds: drainElapsedSeconds },
    deliveryRates: {
      duringMeasurementPerSecond: (totalExternalExecutions(atProfileEnd) - totalExternalExecutions(atMeasurementStart)) / 120,
      duringDrainPerSecond: drainElapsedSeconds > 0 ? (totalExternalExecutions(afterDrain) - totalExternalExecutions(atProfileEnd)) / drainElapsedSeconds : null,
    },
    latencyFromTaskCreatedToExecutorCommitMs: {
      samples: afterDrain.measurement.externalLatencyMs.length,
      p50: percentile(afterDrain.measurement.externalLatencyMs, 0.5),
      p95: percentile(afterDrain.measurement.externalLatencyMs, 0.95),
      mean: afterDrain.measurement.externalLatencyMs.length ? afterDrain.measurement.externalLatencyMs.reduce((sum, value) => sum + value, 0) / afterDrain.measurement.externalLatencyMs.length : null,
    },
  },
  runtimeTimings,
  runtimeTimingsError,
};

report.validity = await writeNf08Report(config.outputFile, report, config.maxBusinessRejectionRate);
console.log(`Report written to ${config.outputFile}`);
console.log(JSON.stringify({ combined, operations, externalExecution: report.externalExecution }, null, 2));

if (combined.reads.p95MsAllAttempts > 2000 || combined.changes.p95MsAllAttempts > 3000) {
  console.error('NF08 latency threshold exceeded: reads must be <= 2000ms and changes <= 3000ms.');
  process.exitCode = 2;
}
if (!report.validity.passed) {
  console.error(`NF08 profile validity failed: ${report.validity.failures.join(', ')}. JSON was preserved.`);
  process.exitCode = 3;
}
