import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Router, Request, Response } from "express";
import {
  DataCedulasPlaftUnavailableError,
  findNextDataCedulasCustomer,
  listDataCedulasTnsAliases,
  validateDataCedulasDatabase,
} from "../services/data-cedulas-new-customer";
import type { NewCustomerResult, NewCustomersResult } from "../services/data-cedulas-new-customer";

const router = Router();

export function projectDataCedulasCustomer(
  result: Pick<NewCustomerResult, "customer">,
): { ok: true; cedula: string } {
  return { ok: true, cedula: result.customer.Cedula };
}

export function projectDataCedulasCustomers(
  result: Pick<NewCustomersResult, "customers">,
): { ok: true; cedula: string; cedulas: string[] } {
  const cedulas = result.customers
    .map((customer) => customer.Cedula)
    .filter((cedula): cedula is string => typeof cedula === "string" && cedula.trim().length > 0);
  return { ok: true, cedula: cedulas[0] ?? "", cedulas };
}

router.get("/api/data-cedulas/databases", (_req: Request, res: Response) => {
  return res.json({ ok: true, databases: listDataCedulasTnsAliases() });
});

// --- "Generar cédulas": prepares a stock of cédulas the engine approves (scripts/prepare-ready-cedulas.ts) ---
const READY_STATE = path.join(process.cwd(), ".artifacts", "data-cedulas-ready.json");
const READY_LOG = path.join(process.cwd(), ".artifacts", "data-cedulas-ready.log");
let readyJob: { child: ChildProcess; target: number; database: string; startedAt: string } | null = null;

function readReadyState(): { approved: string[]; rejected: Record<string, string>; finishedAt?: string } {
  try { return JSON.parse(fs.readFileSync(READY_STATE, "utf8")); } catch { return { approved: [], rejected: {} }; }
}

// A run launched from a terminal is not this process's child; its state file keeps changing while it works.
function readyJobRunning(): boolean {
  if (readyJob && readyJob.child.exitCode === null && !readyJob.child.killed) return true;
  try { return !readReadyState().finishedAt && Date.now() - fs.statSync(READY_STATE).mtimeMs < 3 * 60 * 1000; } catch { return false; }
}

router.get("/api/data-cedulas/ready/status", (_req: Request, res: Response) => {
  const state = readReadyState();
  let lastLog = "";
  try { lastLog = fs.readFileSync(READY_LOG, "utf8").trim().split(/\r?\n/).slice(-1)[0] ?? ""; } catch { /* no log yet */ }
  return res.json({
    ok: true,
    running: readyJobRunning(),
    target: readyJob?.target ?? null,
    database: readyJob?.database ?? null,
    startedAt: readyJob?.startedAt ?? null,
    approved: state.approved.length,
    rejected: Object.keys(state.rejected).length,
    finishedAt: state.finishedAt ?? null,
    lastLog,
  });
});

router.post("/api/data-cedulas/ready/start", (req: Request, res: Response) => {
  try {
    if (readyJobRunning()) return res.status(409).json({ ok: false, error: "already_running" });
    const target = Number(req.body?.target);
    if (!Number.isInteger(target) || target < 1 || target > 5000) return res.status(400).json({ ok: false, error: "target debe ser un entero entre 1 y 5000" });
    const database = validateDataCedulasDatabase(req.body?.database ?? "QA1");
    const recordingId = String(req.body?.recordingId ?? process.env.DATA_CEDULAS_READY_RECORDING_ID ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return res.status(400).json({ ok: false, error: "recordingId (grabación de Portal con usuario y contraseña) es obligatorio" });
    // Renewing starts from zero: every cédula is prepared and checked again with a current master date.
    if (req.body?.renew === true) fs.rmSync(READY_STATE, { force: true });
    fs.mkdirSync(path.dirname(READY_LOG), { recursive: true });
    const log = fs.openSync(READY_LOG, "w");
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/prepare-ready-cedulas.ts", recordingId, String(target), database], {
      cwd: process.cwd(), detached: false, windowsHide: true, stdio: ["ignore", log, log],
    });
    readyJob = { child, target, database, startedAt: new Date().toISOString() };
    return res.status(202).json({ ok: true, target, database });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.post("/api/data-cedulas/ready/stop", (_req: Request, res: Response) => {
  if (readyJob && readyJob.child.exitCode === null) readyJob.child.kill();
  return res.json({ ok: true, running: false });
});

router.get("/api/data-cedulas/clientes/nuevo", async (req: Request, res: Response) => {
  try {
    const database = validateDataCedulasDatabase(req.query.db ?? req.query.database);
    const result = await findNextDataCedulasCustomer(database);
    if (!result) {
      return res.status(404).json({
        ok: false,
        error: "No se encontró un cliente nuevo dentro del límite de búsqueda",
        database,
      });
    }
    res.setHeader("X-Data-Cedulas-PLAFT", result.plaftStatus);
    return res.json(projectDataCedulasCustomer(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[data-cedulas] ${message}`);
    if (error instanceof DataCedulasPlaftUnavailableError) {
      return res.status(502).json({ ok: false, error: error.code, detail: message });
    }
    return res.status(502).json({ ok: false, error: "data_cedulas_unavailable", detail: message });
  }
});

export { router as dataCedulasRouter };
