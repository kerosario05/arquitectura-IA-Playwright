import { getConnection } from "./sql-connection";
import type { DbConnection as Connection } from "./db-connection";
import { placeholders, toIso, toIsoOrNull } from "./row-utils";

/**
 * Persistence for execution jobs.
 *
 * The job store keeps its in-memory map as the hot path (SSE emitters and child
 * process handles cannot be serialized); this module is the write-behind copy
 * that lets a run survive a restart of the service.
 */

export type PersistedJob = {
  id: string;
  type: string;
  status: string;
  params: Record<string, unknown>;
  issueKey?: string;
  checklistUrl?: string;
  defectCount?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  summary?: unknown;
  currentCase?: string | null;
  currentCaseId?: string | null;
  currentCaseTitle?: string | null;
  errorMessage?: string;
};

type JobRow = {
  id: string;
  type: string;
  status: string;
  paramsJson: string | null;
  issueKey: string | null;
  checklistUrl: string | null;
  defectCount: number | null;
  createdAt: unknown;
  startedAt: unknown;
  completedAt: unknown;
  durationMs: number | null;
  exitCode: number | null;
  summaryJson: string | null;
  currentCase: string | null;
  currentCaseId: string | null;
  currentCaseTitle: string | null;
  errorMessage: string | null;
};

const COLUMNS = `id, type, status, paramsJson, issueKey, checklistUrl, defectCount,
       createdAt, startedAt, completedAt, durationMs, exitCode, summaryJson,
       currentCase, currentCaseId, currentCaseTitle, errorMessage`;

function parseJson(value: string | null): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function mapRow(row: JobRow): PersistedJob {
  const job: PersistedJob = {
    id: row.id,
    type: row.type,
    status: row.status,
    params: parseJson(row.paramsJson) ?? {},
    createdAt: toIso(row.createdAt),
  };
  if (row.issueKey) job.issueKey = row.issueKey;
  if (row.checklistUrl) job.checklistUrl = row.checklistUrl;
  if (row.defectCount !== null) job.defectCount = Number(row.defectCount);
  const startedAt = toIsoOrNull(row.startedAt);
  if (startedAt) job.startedAt = startedAt;
  const completedAt = toIsoOrNull(row.completedAt);
  if (completedAt) job.completedAt = completedAt;
  if (row.durationMs !== null) job.durationMs = Number(row.durationMs);
  if (row.exitCode !== null) job.exitCode = Number(row.exitCode);
  const summary = parseJson(row.summaryJson);
  if (summary !== undefined) job.summary = summary;
  if (row.currentCase !== null) job.currentCase = row.currentCase;
  if (row.currentCaseId !== null) job.currentCaseId = row.currentCaseId;
  if (row.currentCaseTitle !== null) job.currentCaseTitle = row.currentCaseTitle;
  if (row.errorMessage) job.errorMessage = row.errorMessage;
  return job;
}

async function resolve(conn?: Connection): Promise<Connection> {
  return conn ?? (await getConnection());
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function insertJob(job: PersistedJob, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `INSERT INTO dbo.Jobs (id, type, status, paramsJson, createdAt)
     VALUES (?, ?, ?, ?, ?)`,
    [job.id, job.type, job.status, JSON.stringify(job.params ?? {}), job.createdAt],
  );
}

/**
 * Writes the current snapshot of a job. The store always has the authoritative
 * value in memory, so a full overwrite is simpler — and safer under concurrent
 * updates — than diffing which fields changed.
 */
export async function saveJob(job: PersistedJob, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query(
    `UPDATE dbo.Jobs
        SET status = ?, paramsJson = ?, issueKey = ?, checklistUrl = ?, defectCount = ?,
            startedAt = ?, completedAt = ?, durationMs = ?, exitCode = ?, summaryJson = ?,
            currentCase = ?, currentCaseId = ?, currentCaseTitle = ?, errorMessage = ?,
            updatedAt = SYSUTCDATETIME()
      WHERE id = ?`,
    [
      job.status,
      JSON.stringify(job.params ?? {}),
      job.issueKey ?? null,
      job.checklistUrl ?? null,
      job.defectCount ?? null,
      job.startedAt ?? null,
      job.completedAt ?? null,
      job.durationMs ?? null,
      job.exitCode ?? null,
      job.summary === undefined ? null : JSON.stringify(job.summary),
      job.currentCase ?? null,
      job.currentCaseId ?? null,
      job.currentCaseTitle ?? null,
      job.errorMessage ?? null,
      job.id,
    ],
  );
}

/** Appends a batch of log lines. `startSeq` is the index of the first line. */
export async function appendJobLogs(
  jobId: string,
  startSeq: number,
  lines: string[],
  conn?: Connection,
): Promise<void> {
  if (lines.length === 0) return;
  const c = await resolve(conn);
  // One multi-row INSERT: a chatty run would otherwise mean thousands of writes.
  const values = lines.map(() => "(?, ?, ?)").join(", ");
  const params: unknown[] = [];
  lines.forEach((line, index) => {
    params.push(jobId, startSeq + index, line);
  });
  await c.query(`INSERT INTO dbo.JobLogs (jobId, seq, line) VALUES ${values}`, params);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listRecentJobs(limit: number, conn?: Connection): Promise<PersistedJob[]> {
  const c = await resolve(conn);
  const rows = await c.query<JobRow>(
    `SELECT ${COLUMNS} FROM dbo.Jobs ORDER BY createdAt DESC`,
  );
  return rows.slice(0, Math.max(0, limit)).map(mapRow);
}

export async function loadJobLogs(
  jobId: string,
  maxLines: number,
  conn?: Connection,
): Promise<string[]> {
  const c = await resolve(conn);
  const rows = await c.query<{ line: string }>(
    "SELECT line FROM dbo.JobLogs WHERE jobId = ? ORDER BY seq",
    [jobId],
  );
  // Keep the tail: the end of a run is what explains how it finished.
  return rows.slice(-Math.max(0, maxLines)).map((row) => row.line);
}

export async function loadLogsForJobs(
  jobIds: string[],
  maxLinesPerJob: number,
  conn?: Connection,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (jobIds.length === 0) return result;
  const c = await resolve(conn);
  const rows = await c.query<{ jobId: string; line: string }>(
    `SELECT jobId, line FROM dbo.JobLogs
      WHERE jobId IN (${placeholders(jobIds.length)})
      ORDER BY jobId, seq`,
    jobIds,
  );
  for (const row of rows) {
    const list = result.get(row.jobId) ?? [];
    list.push(row.line);
    result.set(row.jobId, list);
  }
  for (const [jobId, lines] of result) {
    if (lines.length > maxLinesPerJob) result.set(jobId, lines.slice(-maxLinesPerJob));
  }
  return result;
}

export async function countJobLogLines(jobId: string, conn?: Connection): Promise<number> {
  const c = await resolve(conn);
  const rows = await c.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.JobLogs WHERE jobId = ?",
    [jobId],
  );
  return Number(rows[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Recovery and housekeeping
// ---------------------------------------------------------------------------

export const INTERRUPTED_MESSAGE = "Interrumpido por un reinicio del servidor";

/**
 * Closes out jobs that were still queued or running when the process died.
 *
 * They are marked `failed` rather than given a status of their own: 54 places
 * across the engine and the UI branch on JobStatus, and every one of them
 * already handles `failed`. The reason lives in errorMessage instead.
 */
export async function markInterruptedJobs(conn?: Connection): Promise<number> {
  const c = await resolve(conn);
  const rows = await c.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.Jobs WHERE status = 'queued' OR status = 'running'",
  );
  const affected = Number(rows[0]?.n ?? 0);
  if (affected === 0) return 0;

  await c.query(
    `UPDATE dbo.Jobs
        SET status = 'failed',
            errorMessage = COALESCE(errorMessage, ?),
            completedAt = COALESCE(completedAt, SYSUTCDATETIME()),
            updatedAt = SYSUTCDATETIME()
      WHERE status = 'queued' OR status = 'running'`,
    [INTERRUPTED_MESSAGE],
  );
  return affected;
}

/** Drops jobs older than `retentionDays`; their log rows cascade. */
export async function pruneOldJobs(retentionDays: number, conn?: Connection): Promise<number> {
  const c = await resolve(conn);
  const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 86_400_000).toISOString();
  const rows = await c.query<{ n: number }>(
    "SELECT COUNT(*) AS n FROM dbo.Jobs WHERE createdAt < ?",
    [cutoff],
  );
  const affected = Number(rows[0]?.n ?? 0);
  if (affected === 0) return 0;
  // JobLogs has ON DELETE CASCADE, but SQL Server needs foreign keys enabled to
  // honour it and SQLite needs the pragma; delete explicitly to be certain.
  await c.query(
    "DELETE FROM dbo.JobLogs WHERE jobId IN (SELECT id FROM dbo.Jobs WHERE createdAt < ?)",
    [cutoff],
  );
  await c.query("DELETE FROM dbo.Jobs WHERE createdAt < ?", [cutoff]);
  return affected;
}

export async function deleteJob(id: string, conn?: Connection): Promise<void> {
  const c = await resolve(conn);
  await c.query("DELETE FROM dbo.JobLogs WHERE jobId = ?", [id]);
  await c.query("DELETE FROM dbo.Jobs WHERE id = ?", [id]);
}
