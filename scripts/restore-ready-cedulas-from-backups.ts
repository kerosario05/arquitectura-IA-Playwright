import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import sql from "mssql";
import { withPortalSession } from "../src/server/services/data-cedulas-reuse";
import { ficoApprovesLoan } from "../src/server/services/fico-engine-probe";
import { prepareCedulaRecord, type SqlRunner } from "../src/server/services/data-cedulas-prepare";

// Portal sign-in. Newer code resolves it from the Catálogo de servicios; an older server has no such module, so fall back to
// RESTORE_PORTAL_USERNAME / RESTORE_PORTAL_PASSWORD / RESTORE_PORTAL_BASE_URL set in the shell (never written to disk or logged).
async function resolveLogin(): Promise<{ login: { baseUrl: string; username: string; password: string }; source: string } | undefined> {
  const username = process.env.RESTORE_PORTAL_USERNAME?.trim();
  const password = process.env.RESTORE_PORTAL_PASSWORD;
  const baseUrl = process.env.RESTORE_PORTAL_BASE_URL?.trim();
  if (username && password && baseUrl) return { login: { baseUrl, username, password }, source: "restore_env" };
  try {
    const modulePath = "../src/server/services/portal-login-resolver";
    const { resolvePortalLogin } = await import(modulePath);
    return await resolvePortalLogin("portal-comercial");
  } catch { return undefined; }
}

// Usage: npx tsx scripts/restore-ready-cedulas-from-backups.ts [limit]
// Rebuilds stock from the cédulas that were prepared before (one backup file each in .artifacts/data-cedulas-backups):
// refreshes the master date (rows backed up first, like a normal run), asks the credit engine again and ADDS the approved
// ones to .artifacts/data-cedulas-ready.json. Nothing is removed. Lexis is not repeated; hand-out still drops any cédula that
// is a customer now or on a PLAFT list. Resumable: ids already approved or rejected in the state file are skipped.
const STATE = path.join(process.cwd(), ".artifacts", "data-cedulas-ready.json");
const BACKUPS = path.join(process.cwd(), ".artifacts", "data-cedulas-backups");
type State = { approved: string[]; approvedAt?: Record<string, string>; rejected: Record<string, string>; startedAt: string; finishedAt?: string };

const log = (line: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);
// Read-modify-write so a concurrent writer is never overwritten with stale data.
const load = (): State => fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { approved: [], rejected: {}, startedAt: new Date().toISOString() };
const update = (change: (state: State) => void) => {
  const state = load();
  delete state.finishedAt;
  change(state);
  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify(state));
};

(async () => {
  const limit = Number(process.argv[2] ?? 0) || Infinity;
  const ids = [...new Set(fs.readdirSync(BACKUPS).filter((name) => name.endsWith(".json")).map((name) => name.split("-")[0]).filter((id) => /^\d+$/.test(id)))];
  log(`respaldos=${ids.length} limite=${Number.isFinite(limit) ? limit : "ninguno"}`);

  const pool = await new sql.ConnectionPool({
    server: process.env.DATA_CEDULAS_SQL_SERVER!, database: process.env.DATA_CEDULAS_SQL_DATABASE!,
    user: process.env.DATA_CEDULAS_SQL_USER!, password: process.env.DATA_CEDULAS_SQL_PASSWORD!,
    requestTimeout: 60000, options: { encrypt: false, trustServerCertificate: true },
  }).connect();
  const run: SqlRunner = async (text, params) => {
    const request = pool.request();
    for (const [name, value] of Object.entries(params)) request.input(name, sql.VarChar, value);
    const result = await request.query(text);
    return { rows: result.recordset ?? [], rowsAffected: result.rowsAffected[0] ?? 0 };
  };

  const resolved = await resolveLogin();
  if (!resolved?.login) throw new Error("No hay usuario y contraseña del Portal: define RESTORE_PORTAL_USERNAME, RESTORE_PORTAL_PASSWORD y RESTORE_PORTAL_BASE_URL en la consola, o guárdalos en el Catálogo de servicios si este servidor lo tiene");
  log(`login del Portal: ${resolved.source}`);

  let checked = 0, added = 0;
  await withPortalSession(resolved.login, async (http) => {
    for (const id of ids) {
      if (checked >= limit) break;
      const known = load();
      if (known.approved.includes(id) || id in known.rejected) continue;
      checked += 1;
      try {
        const prepared = await prepareCedulaRecord(run, id, { freshDays: 30, backupDir: BACKUPS });
        if (prepared.status === "missing") { update((s) => { s.rejected[id] = "missing"; }); continue; }
        const verdict = await ficoApprovesLoan(http as any, id);
        if (verdict.approved) { update((s) => { if (!s.approved.includes(id)) s.approved.push(id); (s.approvedAt ??= {})[id] = new Date().toISOString(); }); added += 1; }
        else update((s) => { s.rejected[id] = verdict.detail.slice(0, 120); });
      } catch (error: any) {
        update((s) => { s.rejected[id] = `error:${String(error?.message ?? error).slice(0, 100)}`; });
      }
      if (checked % 10 === 0) log(`revisadas ${checked} | recuperadas ${added} | stock ${load().approved.length}`);
    }
  });
  update((s) => { s.finishedAt = new Date().toISOString(); });
  log(`FINrevisadas=${checked} recuperadas=${added} stock=${load().approved.length}`);
  await pool.close();
})().catch((error) => {
  process.stdout.write(error?.name === "PortalLoginRejectedError"
    ? "RESTORE_READY_ERR credentials_rejected: el Portal rechazó las credenciales guardadas\n"
    : `RESTORE_READY_ERR ${error?.message}\n`);
  process.exit(1);
}).then(() => process.exit(0));
