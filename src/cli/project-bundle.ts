/**
 * Move ONE project's database rows between QA Lab instances (SQLite driver).
 *
 *   npx tsx src/cli/project-bundle.ts export --slug portal-comercial-dev [--db data/qa-lab.db] [--out <file>]
 *   npx tsx src/cli/project-bundle.ts import --file <bundle.json> [--slug <target-slug>] [--db data/qa-lab.db] [--dry-run]
 *
 * Export reads only. Import needs the project to already exist on the target (created from the UI), maps the
 * source project id to the target id, copies a backup of the database file first and runs in one transaction.
 * It only deletes/replaces rows that belong to this project. Never touched: users, roles, access, jobs, other
 * projects, shared Jira/TestRail connections (their ids are instance specific).
 * The bundle holds runtime values: keep it out of git (default path is under the ignored .artifacts/).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;
type Bundle = { version: 1; slug: string; sourceProjectId: string; exportedAt: string; tables: Record<string, Row[]> };

/** Replaced wholesale on import (delete by project, insert remapped). */
const REPLACE_BY_PROJECT_ID = [
  "ProjectKnowledge",
  "ProjectCaseInputRequirement",
  "ProjectCaseRuntimeValue",
  "ProjectServiceConfiguration",
  "ServiceBinding",
  "ProjectRepositoryConfiguration",
] as const;
/** Inserted only when the target has none (the target's own UI configuration wins). */
const INSERT_IF_ABSENT_BY_PROJECT_ID = ["WebProjectConfiguration", "MobileProjectConfiguration", "ProjectOtpConfiguration"] as const;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function openDb(readOnly: boolean): { db: DatabaseSync; file: string } {
  const file = path.resolve(arg("db") ?? process.env.SQLITE_DB_PATH?.trim() ?? "data/qa-lab.db");
  if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
  return { db: new DatabaseSync(file, { readOnly }), file };
}

const tableExists = (db: DatabaseSync, table: string) =>
  Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(table));
const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`pragma table_info(${table})`).all() as Row[]).map(column => String(column.name));
const plain = (row: Row): Row => ({ ...row });
const quote = (name: string) => `[${name}]`;

function selectRows(db: DatabaseSync, table: string, where: string, ...params: string[]): Row[] {
  if (!tableExists(db, table)) return [];
  return (db.prepare(`select * from ${table} where ${where}`).all(...params) as Row[]).map(plain);
}

function exportBundle(): void {
  const slug = arg("slug");
  if (!slug) throw new Error("--slug is required");
  const { db, file } = openDb(true);
  const project = db.prepare("select * from Projects where slug = ? collate nocase").get(slug) as Row | undefined;
  if (!project) throw new Error(`Project '${slug}' not found in ${file}`);
  const id = String(project.id);
  const tables: Record<string, Row[]> = { Projects: [plain(project)] };
  for (const table of [...REPLACE_BY_PROJECT_ID, ...INSERT_IF_ABSENT_BY_PROJECT_ID]) tables[table] = selectRows(db, table, "projectId = ?", id);
  tables.ProjectConfigurationHistory = selectRows(db, "ProjectConfigurationHistory", "projectId = ?", id);
  const catalogs = selectRows(db, "ProjectDataCatalog", "projectId = ?", id);
  tables.ProjectDataCatalog = catalogs;
  tables.ProjectDataCatalogOption = catalogs.flatMap(catalog => selectRows(db, "ProjectDataCatalogOption", "catalogId = ?", String(catalog.id)));
  const drafts = selectRows(db, "TestDesignDraft", "projectSlug = ? collate nocase", slug);
  tables.TestDesignDraft = drafts;
  tables.TestDesignDraftStory = drafts.flatMap(draft => selectRows(db, "TestDesignDraftStory", "draftId = ?", String(draft.id)));
  tables.TestDesignPublishedCaseLink = selectRows(db, "TestDesignPublishedCaseLink", "projectSlug = ? collate nocase", slug);
  tables.TestPlanReview = selectRows(db, "TestPlanReview", "projectSlug = ? collate nocase", slug);
  const recordingsDir = path.resolve("automations", "apps", slug, "recordings");
  const recordingIds = fs.existsSync(recordingsDir) ? fs.readdirSync(recordingsDir, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name) : [];
  tables.RecordingRouteObservation = recordingIds.flatMap(recordingId => selectRows(db, "RecordingRouteObservation", "recordingId = ?", recordingId));
  const bundle: Bundle = { version: 1, slug, sourceProjectId: id, exportedAt: new Date().toISOString(), tables };
  const out = path.resolve(arg("out") ?? path.join(".artifacts", "project-bundles", `${slug}.bundle.json`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  console.log(`[project-bundle] exported ${slug} -> ${out}`);
  for (const [table, rows] of Object.entries(tables)) console.log(`  ${table.padEnd(32)} ${String(rows.length).padStart(6)}`);
  console.log("[project-bundle] the file contains runtime values: do not commit it.");
}

function insertRows(db: DatabaseSync, table: string, rows: Row[], overrides: Row = {}, dropColumns: string[] = []): number {
  if (!rows.length || !tableExists(db, table)) return 0;
  const target = new Set(columnsOf(db, table));
  let inserted = 0;
  for (const source of rows) {
    const row = { ...source, ...overrides };
    const columns = Object.keys(row).filter(column => target.has(column) && !dropColumns.includes(column));
    if (!columns.length) continue;
    db.prepare(`insert or replace into ${table} (${columns.map(quote).join(",")}) values (${columns.map(() => "?").join(",")})`)
      .run(...columns.map(column => row[column] as never));
    inserted += 1;
  }
  return inserted;
}

function importBundle(): void {
  const bundleFile = arg("file");
  if (!bundleFile) throw new Error("--file is required");
  const bundle = JSON.parse(fs.readFileSync(path.resolve(bundleFile), "utf8")) as Bundle;
  if (bundle.version !== 1 || !bundle.tables?.Projects?.length) throw new Error("Not a project bundle (version 1)");
  const slug = arg("slug") ?? bundle.slug;
  const dryRun = flag("dry-run");
  const { db, file } = openDb(false);
  const project = db.prepare("select id, slug from Projects where slug = ? collate nocase").get(slug) as Row | undefined;
  if (!project) throw new Error(`Project '${slug}' does not exist on the target. Create it from the UI first (same slug).`);
  const targetId = String(project.id);
  const sourceId = bundle.sourceProjectId;
  const sourceSlug = bundle.slug;
  if (!dryRun) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    db.exec("pragma wal_checkpoint(truncate)");
    fs.copyFileSync(file, backup);
    console.log(`[project-bundle] backup: ${backup}`);
  }
  const report: Array<[string, string]> = [];
  db.exec("begin");
  try {
    const t = bundle.tables;
    for (const table of REPLACE_BY_PROJECT_ID) {
      if (!tableExists(db, table)) { report.push([table, "table missing on target, skipped"]); continue; }
      db.prepare(`delete from ${table} where projectId = ?`).run(targetId);
      report.push([table, `${insertRows(db, table, t[table] ?? [], { projectId: targetId })} rows`]);
    }
    for (const table of INSERT_IF_ABSENT_BY_PROJECT_ID) {
      if (!tableExists(db, table)) continue;
      const existing = db.prepare(`select 1 from ${table} where projectId = ?`).get(targetId);
      report.push([table, existing ? "kept the target's own" : `${insertRows(db, table, t[table] ?? [], { projectId: targetId })} rows`]);
    }
    report.push(["ProjectConfigurationHistory", `${insertRows(db, "ProjectConfigurationHistory", t.ProjectConfigurationHistory ?? [], { projectId: targetId }, ["id"])} rows`]);
    // Data catalogs keep their ids (options point to them); replace this project's catalogs.
    if (tableExists(db, "ProjectDataCatalog")) {
      const old = db.prepare("select id from ProjectDataCatalog where projectId = ?").all(targetId) as Row[];
      for (const catalog of old) db.prepare("delete from ProjectDataCatalogOption where catalogId = ?").run(String(catalog.id));
      db.prepare("delete from ProjectDataCatalog where projectId = ?").run(targetId);
      report.push(["ProjectDataCatalog", `${insertRows(db, "ProjectDataCatalog", t.ProjectDataCatalog ?? [], { projectId: targetId })} rows`]);
      report.push(["ProjectDataCatalogOption", `${insertRows(db, "ProjectDataCatalogOption", t.ProjectDataCatalogOption ?? [])} rows`]);
    }
    // Test design: ids are uuids, so they are kept; the slug is re-pointed to the target slug.
    if (tableExists(db, "TestDesignDraft")) {
      const drafts = db.prepare("select id from TestDesignDraft where projectSlug = ? collate nocase").all(slug) as Row[];
      for (const draft of drafts) db.prepare("delete from TestDesignDraftStory where draftId = ?").run(String(draft.id));
      db.prepare("delete from TestDesignDraft where projectSlug = ? collate nocase").run(slug);
      report.push(["TestDesignDraft", `${insertRows(db, "TestDesignDraft", t.TestDesignDraft ?? [], { projectSlug: slug })} rows`]);
      report.push(["TestDesignDraftStory", `${insertRows(db, "TestDesignDraftStory", t.TestDesignDraftStory ?? [])} rows`]);
    }
    if (tableExists(db, "TestDesignPublishedCaseLink")) {
      db.prepare("delete from TestDesignPublishedCaseLink where projectSlug = ? collate nocase").run(slug);
      report.push(["TestDesignPublishedCaseLink", `${insertRows(db, "TestDesignPublishedCaseLink", t.TestDesignPublishedCaseLink ?? [], { projectSlug: slug })} rows`]);
    }
    if (tableExists(db, "TestPlanReview")) {
      db.prepare("delete from TestPlanReview where projectSlug = ? collate nocase").run(slug);
      report.push(["TestPlanReview", `${insertRows(db, "TestPlanReview", t.TestPlanReview ?? [], { projectSlug: slug }, ["id"])} rows`]);
    }
    if (tableExists(db, "RecordingRouteObservation")) {
      for (const row of t.RecordingRouteObservation ?? []) db.prepare("delete from RecordingRouteObservation where id = ?").run(row.id as never);
      report.push(["RecordingRouteObservation", `${insertRows(db, "RecordingRouteObservation", t.RecordingRouteObservation ?? [])} rows`]);
    }
    if (dryRun) { db.exec("rollback"); console.log("[project-bundle] dry run: nothing was written"); }
    else db.exec("commit");
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
  console.log(`[project-bundle] ${dryRun ? "would import" : "imported"} '${sourceSlug}' (${sourceId}) -> '${slug}' (${targetId})`);
  for (const [table, result] of report) console.log(`  ${table.padEnd(32)} ${result}`);
}

const command = process.argv[2];
try {
  if (command === "export") exportBundle();
  else if (command === "import") importBundle();
  else { console.log("Usage: project-bundle.ts export --slug <slug> | import --file <bundle.json> [--slug <slug>] [--dry-run] [--db <path>]"); process.exitCode = 1; }
} catch (error) {
  console.error(`[project-bundle] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
