/**
 * Repository telemetry.
 *
 * Cutover is a judgement call, and judgement needs evidence. This counts
 * every read, write, conflict, failure and retry the data layer performs
 * so the migration dashboard can show whether the relational path is
 * actually behaving, rather than us assuming it is.
 *
 * Deliberately in-memory and dependency-free: telemetry must never be
 * the thing that breaks a shop-floor session.
 */

const counters = () => ({
  reads: 0, writes: 0, staleConflicts: 0, failures: 0, retries: 0,
  readMs: 0, writeMs: 0, lastReadAt: null, lastWriteAt: null
});

let stats = {
  legacy: counters(),
  relational: counters(),
  byTable: {},          // table -> counters
  errors: [],           // recent failures, newest first
  startedAt: Date.now()
};

const MAX_ERRORS = 50;

function bucket(table){
  if(!stats.byTable[table]) stats.byTable[table] = counters();
  return stats.byTable[table];
}

/** path: 'relational' | 'legacy' */
export function recordRead(table, ms = 0, path = 'relational'){
  stats[path].reads++; stats[path].readMs += ms;
  stats[path].lastReadAt = Date.now();
  const b = bucket(table); b.reads++; b.readMs += ms;
}

export function recordWrite(table, ms = 0, path = 'relational'){
  stats[path].writes++; stats[path].writeMs += ms;
  stats[path].lastWriteAt = Date.now();
  const b = bucket(table); b.writes++; b.writeMs += ms;
}

/** A write rejected because the row moved underneath us. */
export function recordStaleConflict(table, detail){
  stats.relational.staleConflicts++;
  bucket(table).staleConflicts++;
  pushError('stale', table, detail);
}

export function recordFailure(table, error, path = 'relational'){
  stats[path].failures++;
  bucket(table).failures++;
  pushError('failure', table, error && error.message ? error.message : String(error));
}

export function recordRetry(table){
  stats.relational.retries++;
  bucket(table).retries++;
}

function pushError(kind, table, detail){
  stats.errors.unshift({ kind, table, detail, at: new Date().toISOString() });
  if(stats.errors.length > MAX_ERRORS) stats.errors.length = MAX_ERRORS;
}

/** Wraps an async repo call so timing + outcome are counted automatically. */
export async function tracked(table, kind, fn, path = 'relational'){
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    if(kind === 'read') recordRead(table, ms, path);
    else recordWrite(table, ms, path);
    return out;
  } catch (e) {
    if(e && e.isStale) recordStaleConflict(table, e.message);
    else recordFailure(table, e, path);
    throw e;
  }
}

export function getStats(){
  const uptimeMs = Date.now() - stats.startedAt;
  const avg = (total, n) => n ? Math.round(total / n) : 0;
  const summarize = c => ({
    ...c,
    avgReadMs: avg(c.readMs, c.reads),
    avgWriteMs: avg(c.writeMs, c.writes)
  });
  return {
    uptimeMs,
    legacy: summarize(stats.legacy),
    relational: summarize(stats.relational),
    byTable: Object.fromEntries(
      Object.entries(stats.byTable).map(([k, v]) => [k, summarize(v)])
    ),
    errors: stats.errors.slice(),
    /** Cheap health signal used by the dashboard's go/no-go. */
    health: {
      totalOps: stats.relational.reads + stats.relational.writes,
      failureRate: rate(stats.relational.failures,
                        stats.relational.reads + stats.relational.writes),
      conflictRate: rate(stats.relational.staleConflicts, stats.relational.writes)
    }
  };
}

function rate(n, d){ return d ? Number((n / d).toFixed(4)) : 0; }

export function resetStats(){
  stats = { legacy: counters(), relational: counters(), byTable: {}, errors: [], startedAt: Date.now() };
}
