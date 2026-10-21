import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { withTransaction, withConnection, resolveDriverName } from '../db/sql-connection';
import type { DbConnection } from '../db/db-connection';

export type JiraLearnedAction = { action: 'navigate' | 'click' | 'fill' | 'select' | 'press'; field?: string; dataRef?: string; key?: string };
export type JiraLearnedRoute = {
  schemaVersion: 1; engine: 'jira_semantic'; appSlug: string; id: string;
  profileRevision: string; sourceIssueKey: string; scenarioId: string; jobId: string;
  validatedAt: string; startsFrom: 'project_entry' | 'authenticated_state';
  actions: JiraLearnedAction[]; evidenceRefs: string[];
  invalidatedAt?: string;
};

/** A failed Jira journey can invalidate learned navigation only when execution
 * proves that a target/action in that route no longer works. Assertion, input,
 * and business-outcome failures say nothing about route freshness. */
export function shouldInvalidateJiraLearnedRoute(failureCode: string): boolean {
  return new Set([
    'JIRA_DURABLE_TARGET_UNRESOLVED',
    'JIRA_ACTION_DISPATCH_FAILED',
    'JIRA_FILL_NOT_CONFIRMED',
    'JIRA_SELECTION_FIELD_OPEN_FAILED',
    'JIRA_SELECTION_OPTION_AMBIGUOUS',
    'JIRA_SELECTION_OPTION_NOT_UNIQUE',
    'JIRA_SELECTION_OPTION_CLICK_FAILED',
    'JIRA_SELECTION_STATE_UNCONFIRMED',
    'JIRA_SELECTION_OPTION_NOT_FOUND',
    'JIRA_SELECTION_NOT_CONFIRMED',
    'JIRA_ROUTE_NOT_DECLARED',
    'JIRA_ROUTE_OUTSIDE_APP_ORIGIN',
    'JIRA_ROUTE_NAVIGATION_UNAVAILABLE',
    'JIRA_AUTH_FLOW_UNAVAILABLE',
    'JIRA_AUTHENTICATION_FAILED',
    'JIRA_AUTH_GATE_NOT_OBSERVED',
  ]).has(failureCode);
}

export function jiraProfileRevision(profile: unknown): string {
  const p = profile as Record<string, unknown>;
  // Configuration identity, not credentials/test data. Revalidation is also age-bounded.
  return createHash('sha256').update(JSON.stringify({ baseUrl: p.baseUrl, loginMode: p.loginMode,
    version: p.version, applicationVersion: p.applicationVersion })).digest('hex');
}
export function mergeJiraRoute(root: Record<string, unknown>, route: JiraLearnedRoute): Record<string, unknown> {
  const stored = Array.isArray(root.jiraRoutes) ? root.jiraRoutes : [];
  return { ...root, jiraRoutes: [...stored.filter(item => item && typeof item === 'object'
    && (item as JiraLearnedRoute).id !== route.id), route] };
}
function writeJiraKnowledgeProjection(appSlug: string, routes: unknown[], appsRoot: string): void {
  const resolvedRoot = path.resolve(appsRoot);
  const appDir = path.resolve(resolvedRoot, appSlug);
  const relativeDir = path.relative(resolvedRoot, appDir);
  if (!appSlug || path.isAbsolute(relativeDir) || relativeDir === '..' || relativeDir.startsWith(`..${path.sep}`)) {
    throw new Error('JIRA_KNOWLEDGE_APP_PATH_INVALID');
  }
  fs.mkdirSync(appDir, { recursive: true });
  const filePath = path.join(appDir, 'app.knowledge.json');
  let root: Record<string, unknown> = { version: 1, appSlug, createdAt: new Date().toISOString(), items: [] };
  if (fs.existsSync(filePath)) {
    root = parseRoot(fs.readFileSync(filePath, 'utf8'));
  }
  const next = { ...root, appSlug, updatedAt: new Date().toISOString(), jiraRoutes: routes };
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
}
function parseRoot(value: string | undefined): Record<string, unknown> {
  if (!value) return { items: [] };
  const root: unknown = JSON.parse(value);
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw new Error('JIRA_KNOWLEDGE_INVALID');
  return root as Record<string, unknown>;
}
function validRoutes(value: unknown, appSlug: string): JiraLearnedRoute[] {
  return Array.isArray(value) ? value.filter((r): r is JiraLearnedRoute =>
    r && typeof r === 'object' && r.engine === 'jira_semantic' && r.schemaVersion === 1 && r.appSlug === appSlug
    && Array.isArray(r.actions) && Array.isArray(r.evidenceRefs) && r.evidenceRefs.length > 0) : [];
}
function readJiraFileRoutes(appSlug: string, appsRoot: string): JiraLearnedRoute[] {
  const resolvedRoot = path.resolve(appsRoot);
  const appDir = path.resolve(resolvedRoot, appSlug);
  const relativeDir = path.relative(resolvedRoot, appDir);
  if (!appSlug || path.isAbsolute(relativeDir) || relativeDir === '..' || relativeDir.startsWith(`..${path.sep}`)) return [];
  const filePath = path.join(appDir, 'app.knowledge.json');
  if (!fs.existsSync(filePath)) return [];
  try { return validRoutes(parseRoot(fs.readFileSync(filePath, 'utf8')).jiraRoutes, appSlug); }
  catch { return []; }
}
export async function saveJiraRoute(route: JiraLearnedRoute,
  transaction: typeof withTransaction = withTransaction,
  appsRoot = path.resolve(process.cwd(), 'automations', 'apps')): Promise<void> {
  let mergedRoutes: unknown[] = [];
  await transaction(async conn => {
    const projects = await conn.query<{ id: string }>('SELECT id FROM dbo.Projects WHERE slug = ?', [route.appSlug]);
    if (projects.length !== 1) throw new Error('JIRA_KNOWLEDGE_PROJECT_MISSING');
    const projectId = projects[0].id;
    const lock = resolveDriverName() === 'sqlserver' ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
    const rows = await conn.query<{ knowledgeJson: string }>(`SELECT knowledgeJson FROM dbo.ProjectKnowledge${lock} WHERE projectId = ?`, [projectId]);
    const merged = mergeJiraRoute(parseRoot(rows[0]?.knowledgeJson), route);
    mergedRoutes = merged.jiraRoutes as unknown[];
    const json = resolveDriverName() === 'sqlserver' ? Buffer.from(JSON.stringify(merged), 'utf16le') : JSON.stringify(merged);
    if (rows.length) await conn.query('UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?', [json, projectId]);
    else await conn.query('INSERT INTO dbo.ProjectKnowledge (projectId, schemaVersion, knowledgeJson) VALUES (?, ?, ?)', [projectId, 1, json]);
  });
  writeJiraKnowledgeProjection(route.appSlug, mergedRoutes, appsRoot);
}
export async function loadJiraRoutes(appSlug: string,
  connection: <T>(fn: (conn: DbConnection) => Promise<T>) => Promise<T> = withConnection,
  appsRoot = path.resolve(process.cwd(), 'automations', 'apps')): Promise<JiraLearnedRoute[]> {
  let databaseRoutes: JiraLearnedRoute[] = [];
  try {
    databaseRoutes = await connection(async conn => {
      const rows = await conn.query<{ knowledgeJson: string }>('SELECT k.knowledgeJson FROM dbo.ProjectKnowledge k INNER JOIN dbo.Projects p ON p.id = k.projectId WHERE p.slug = ?', [appSlug]);
      return validRoutes(parseRoot(rows[0]?.knowledgeJson).jiraRoutes, appSlug);
    });
  } catch { /* The per-app projection is a deliberate offline fallback. */ }
  const merged = new Map<string, JiraLearnedRoute>();
  for (const route of [...readJiraFileRoutes(appSlug, appsRoot), ...databaseRoutes]) merged.set(route.id, route);
  return [...merged.values()];
}

export async function invalidateJiraRoute(appSlug: string, scenarioId: string,
  transaction: typeof withTransaction = withTransaction,
  appsRoot = path.resolve(process.cwd(), 'automations', 'apps')): Promise<void> {
  let projectionRoutes: unknown[] | undefined;
  await transaction(async conn => {
    const projects = await conn.query<{ id: string }>('SELECT id FROM dbo.Projects WHERE slug = ?', [appSlug]);
    if (projects.length !== 1) return;
    const lock = resolveDriverName() === 'sqlserver' ? ' WITH (UPDLOCK, HOLDLOCK)' : '';
    const rows = await conn.query<{ knowledgeJson: string }>(`SELECT knowledgeJson FROM dbo.ProjectKnowledge${lock} WHERE projectId = ?`, [projects[0].id]);
    if (!rows.length) return;
    const root = parseRoot(rows[0].knowledgeJson);
    if (!Array.isArray(root.jiraRoutes)) return;
    let changed = false;
    const jiraRoutes = root.jiraRoutes.map(route => {
      if (route?.engine !== 'jira_semantic' || route.appSlug !== appSlug || route.scenarioId !== scenarioId) return route;
      changed = true; return { ...route, invalidatedAt: new Date().toISOString() };
    });
    if (!changed) return;
    projectionRoutes = jiraRoutes;
    const json = JSON.stringify({ ...root, jiraRoutes });
    await conn.query('UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?',
      [resolveDriverName() === 'sqlserver' ? Buffer.from(json, 'utf16le') : json, projects[0].id]);
  });
  if (projectionRoutes) writeJiraKnowledgeProjection(appSlug, projectionRoutes, appsRoot);
}
