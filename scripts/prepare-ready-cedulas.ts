import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import sql from "mssql";
import { loadScenarios } from "../src/recording/recording-store";
import { loadPromotedAppConfigSync } from "../src/automations/app-profile";
import { materializeRuntimeInputRequirements } from "../src/recording/canonical-recording-contract";
import { portalLoginFromRequirements, withPortalSession } from "../src/server/services/data-cedulas-reuse";
import { ficoApprovesLoan } from "../src/server/services/fico-engine-probe";
import { findNextDataCedulasCustomers } from "../src/server/services/data-cedulas-new-customer";
import { prepareCedulaRecord, type SqlRunner } from "../src/server/services/data-cedulas-prepare";
import { resolvePortalLogin } from "../src/server/services/portal-login-resolver";

// Usage: npx tsx scripts/prepare-ready-cedulas.ts <recordingId|-> <target> [db=QA1]
// "-" (or a recording without login values) signs in with the project's saved login: DATA_CEDULAS_LEXIS_PORTAL_USERNAME/_PASSWORD
// when set, otherwise the usuario/contrasena last confirmed when a portal-comercial case was launched.
// Leaves <target> cédulas with a current master date (FechaProceso = now, rows backed up first) and an
// engine "approved" verdict. Resumable: progress lives in .artifacts/data-cedulas-ready.json.
// Every engine verdict is a real consultation, so the loop is sequential.
const STATE = path.join(process.cwd(), ".artifacts", "data-cedulas-ready.json");
const BACKUPS = path.join(process.cwd(), ".artifacts", "data-cedulas-backups");
type State = { approved: string[]; approvedAt?: Record<string, string>; rejected: Record<string, string>; startedAt: string; finishedAt?: string };

(async () => {
  const [recordingId, targetRaw, database = "QA1"] = process.argv.slice(2);
  const target = Number(targetRaw);
  if (!recordingId || !Number.isInteger(target) || target <= 0) throw new Error("Uso: prepare-ready-cedulas <recordingId|-> <target> [db]");
  // This run's own filters: the engine, not the utilization proxy, decides.
  Object.assign(process.env, {
    DATA_CEDULAS_SCORE_MAX_AGE_DAYS: "0", DATA_CEDULAS_MAX_UTILIZATION: "0", DATA_CEDULAS_PREPARE: "false",
    DATA_CEDULAS_ENGINE_CHECK: "false", DATA_CEDULAS_FORCED_IDS: "", DATA_CEDULAS_RANDOM_POOL_SIZE: "200",
  });
  const log = (line: string) => process.stdout.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`);
  const e = process.env;
  log(`env lexis transport=${JSON.stringify(e.DATA_CEDULAS_LEXIS_TRANSPORT)} mdwDb=${e.DATA_CEDULAS_LEXIS_MDW_DATABASE} mdwUrl=${Boolean(e.DATA_CEDULAS_LEXIS_MDW_URL)} clientId=${Boolean(e.DATA_CEDULAS_LEXIS_MDW_CLIENT_ID)} plaft=${JSON.stringify(e.DATA_CEDULAS_PLAFT_MODE)} timeoutMs=${e.DATA_CEDULAS_LEXIS_TIMEOUT_MS} maxBatches=${e.DATA_CEDULAS_MAX_BATCHES}`);
  const state: State =fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, "utf8")) : { approved: [], rejected: {}, startedAt: new Date().toISOString() };
  delete state.finishedAt; // a run in progress is never "finished"; the panel reads this to tell a running job from a done one
  const save = () => { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); };

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

  const portalBaseUrl = (loadPromotedAppConfigSync({ appSlug: "portal-comercial" }) as any)?.baseUrl;
  let login: ReturnType<typeof portalLoginFromRequirements>;
  if (recordingId !== "-") {
    const [scenario] = loadScenarios("portal-comercial", recordingId) as any[];
    const requirements = scenario?.runtimeInputRequirements?.length ? scenario.runtimeInputRequirements : scenario ? materializeRuntimeInputRequirements(scenario) : [];
    login = portalLoginFromRequirements(requirements, portalBaseUrl);
  }
  if (!login) {
    const resolved = await resolvePortalLogin("portal-comercial");
    login = resolved?.login;
    if (login) log(`login del Portal: ${resolved!.source}`);
  }
  if (!login) throw new Error("No hay usuario y contraseña: ni en la grabación, ni en DATA_CEDULAS_LEXIS_PORTAL_*, ni guardados al lanzar un caso de portal-comercial");
  const quiet = console.log;
  let outages = 0;
  while (state.approved.length < target) {
    const seen = [...state.approved, ...Object.keys(state.rejected)];
    let batch: string[] = [];
    let screeningDown = false;
    let lastError = "";
    console.log = () => undefined; console.info = () => undefined; console.warn = () => undefined;
    try {
      for (let ask = 10; ask >= 1 && batch.length === 0; ask = Math.floor(ask / 2)) {
        try {
          const found = await findNextDataCedulasCustomers(database, ask, seen, { release: null });
          batch = (found?.customers ?? []).map((customer) => String(customer.Cedula).trim());
        } catch (error: any) {
          // PLAFT/Lexis outage is not "no candidates": keep what is approved and try again later.
          // Asking for fewer cédulas needs fewer clear Lexis answers within the screening window, so a
          // smaller ask can succeed where a large one ran out of time: keep halving before giving up.
          if (/PLAFT/i.test(String(error?.message))) screeningDown = true;
          lastError = `ask=${ask}: ${String(error?.message ?? error).slice(0, 140)}`;
          /* fewer eligible than asked: retry smaller */
        }
      }
    } finally { console.log = quiet; }
    if (batch.length === 0 && screeningDown) {
      outages += 1;
      if (outages > 30) { log("Lexis/PLAFT no responde tras 30 reintentos (1 h): se detiene, lo aprobado queda guardado"); break; }
      log(`Lexis/PLAFT no disponible (intento ${outages}/30; ${lastError}); reintento en 2 min`);
      await new Promise((resolve) => setTimeout(resolve, 120000));
      continue;
    }
    outages = 0;
    if (batch.length === 0) { log("sin mas candidatas elegibles"); break; }
    await withPortalSession(login, async (http) => {
      for (const id of batch) {
        if (state.approved.length >= target) return;
        try {
          const prepared = await prepareCedulaRecord(run, id, { freshDays: 30, backupDir: BACKUPS });
          if (prepared.status === "missing") { state.rejected[id] = "missing"; continue; }
          const verdict = await ficoApprovesLoan(http as any, id);
          if (verdict.approved) { state.approved.push(id); (state.approvedAt ??= {})[id] = new Date().toISOString(); } else state.rejected[id] = verdict.detail.slice(0, 120);
        } catch (error: any) { state.rejected[id] = `error:${String(error?.message ?? error).slice(0, 100)}`; }
        save();
      }
    });
    log(`aprobadas ${state.approved.length}/${target} | rechazadas ${Object.keys(state.rejected).length}`);
  }
  state.finishedAt = new Date().toISOString();
  save();
  log(`FINaprobadas=${state.approved.length} rechazadas=${Object.keys(state.rejected).length} lista=${STATE}`);
  await pool.close();
})().catch((error) => {
  process.stdout.write(error?.name === "PortalLoginRejectedError"
    ? "PREPARE_READY_ERR credentials_rejected: el Portal rechazó las credenciales guardadas; vuelve a escribirlas en el Catálogo de servicios\n"
    : `PREPARE_READY_ERR ${error?.message}\n`);
  process.exit(1);
}).then(() => process.exit(0));
