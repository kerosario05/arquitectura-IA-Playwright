import "../config/env"; // Load .env before touching the datasource
import { describeDatasource, getConnection, resolveDriverName } from "../db/sql-connection";

/**
 * Creates (idempotently) and reports the project-registry datastore.
 *
 * With DB_DRIVER=sqlite the schema is applied on connect, so this doubles as a
 * "did my configuration work?" check: it prints the file in use and row counts.
 */

const TABLES = [
  "Projects",
  "SharedConnection",
  "WebProjectConfiguration",
  "MobileProjectConfiguration",
  "ProjectOtpConfiguration",
  "ProjectJiraConfiguration",
  "ProjectTestRailConfiguration",
  "ProjectKnowledge",
  "ProjectConfigurationHistory",
];

async function main(): Promise<void> {
  const driver = resolveDriverName();
  console.log(`\n[db] driver     : ${driver}`);
  console.log(`[db] datasource : ${describeDatasource()}\n`);

  const conn = await getConnection();
  const prefix = driver === "sqlserver" ? "dbo." : "";

  let widest = 0;
  for (const table of TABLES) widest = Math.max(widest, table.length);

  for (const table of TABLES) {
    try {
      const rows = await conn.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${prefix}${table}`);
      console.log(`  ${table.padEnd(widest)}  ${String(rows[0].n).padStart(5)} rows`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ${table.padEnd(widest)}  ERROR: ${message}`);
    }
  }

  const projects = await conn.query<{ slug: string; name: string; projectType: number; status: number; enabled: number }>(
    `SELECT slug, name, projectType, status, enabled FROM ${prefix}Projects ORDER BY slug`,
  );
  if (projects.length > 0) {
    console.log(`\n[db] projects:`);
    for (const p of projects) {
      const type = p.projectType === 1 ? "web" : "mobile";
      const status = p.status === 1 ? "READY" : p.status === 2 ? "INVALID" : "DRAFT";
      console.log(`  - ${p.slug} (${type}, ${status}, enabled=${p.enabled ? "yes" : "no"}) — ${p.name}`);
    }
  }
  console.log("");
}

main().catch((err) => {
  console.error(`[db] failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
