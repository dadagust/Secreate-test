// The SQL unfinished predicate includes every row without an external execution.
export function classifyExecutionCounts(accepted, externallyExecuted, unfinished) {
  if (![accepted, externallyExecuted, unfinished].every(Number.isSafeInteger) ||
      accepted < 0 || externallyExecuted < 0 || externallyExecuted > accepted ||
      unfinished < accepted - externallyExecuted || unfinished > accepted) {
    throw new Error('Inconsistent NF08 execution snapshot')
  }
  const externallyNotExecuted = accepted - externallyExecuted
  return { accepted, externallyExecuted, unfinished, externallyNotExecuted, executedButLocallyUnfinished: unfinished - externallyNotExecuted }
}

export function parseExecutionSnapshot(row) {
  const counts = classifyExecutionCounts(Number(row.accepted), Number(row.externallyExecuted), Number(row.unfinished))
  if (!Array.isArray(row.externalLatencyMs)) throw new Error('Missing NF08 latency samples')
  const externalLatencyMs = row.externalLatencyMs.map(Number)
  if (externalLatencyMs.length !== counts.externallyExecuted || !externalLatencyMs.every(Number.isFinite)) {
    throw new Error('NF08 latency samples do not match executed operations')
  }
  return { ...counts, externalLatencyMs }
}
