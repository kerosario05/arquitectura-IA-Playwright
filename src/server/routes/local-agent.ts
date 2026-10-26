import fs from "node:fs";
import path from "node:path";
import { Router, type Request, type Response } from "express";
import { clientIpOf } from "../local-agent/agent-endpoint";
import { localAgentRegistry, LocalAgentError, type ConnectedAgent, type PairingResult } from "../local-agent/agent-registry";
import { DOWNLOADS_URL_PREFIX } from "../local-agent/chromium-package";
import { AGENT_DOWNLOADS, AGENT_INSTALLER, agentPackage } from "../local-agent/agent-package";

/**
 * Lo que el panel consulta del agente de SU equipo (`/api/local-agent/*`) y las
 * descargas públicas que usan los agentes y el instalador de TI (`/descargas/*`).
 *
 * El panel nunca habla con el agente: pregunta aquí, y el servidor busca el
 * agente que llega desde la misma IP que el navegador del panel.
 */

export const localAgentRouter = Router();
export const downloadsRouter = Router();

function panelUser(req: Request) {
  return { userId: req.principal?.userId ?? null, username: req.principal?.username ?? "" };
}

function agentView(agent: ConnectedAgent, requiredRevision: string | undefined) {
  return {
    agentId: agent.agentId,
    machine: agent.machine,
    windowsUser: agent.windowsUser,
    agentVersion: agent.agentVersion,
    chromiumInstalled: localAgentRegistry.hasChromium(agent, requiredRevision),
  };
}

export function describePairing(pairing: PairingResult, requiredRevision: string | undefined) {
  if (pairing.status === "found") {
    const agent = agentView(pairing.agent, requiredRevision);
    return {
      pairing: "found" as const,
      agent,
      install: localAgentRegistry.installState(pairing.agent.agentId) ?? null,
      ready: Boolean(requiredRevision) && agent.chromiumInstalled,
    };
  }
  return {
    pairing: pairing.status,
    agent: null,
    candidates: pairing.status === "ambiguous" ? pairing.candidates.map((a) => agentView(a, requiredRevision)) : undefined,
    install: null,
    ready: false,
  };
}

function sendError(res: Response, err: unknown): void {
  if (err instanceof LocalAgentError) {
    const status = err.code === "LOCAL_AGENT_NOT_FOUND" ? 404 : 409;
    res.status(status).json({ ok: false, error: err.code, errorCode: err.code, message: err.message });
    return;
  }
  res.status(500).json({ ok: false, error: "LOCAL_AGENT_ERROR", errorCode: "LOCAL_AGENT_ERROR", message: err instanceof Error ? err.message : String(err) });
}

// GET /api/local-agent/status — ¿tiene mi equipo agente y Chromium listos para grabar?
localAgentRouter.get("/status", (req, res) => {
  const requiredRevision = localAgentRegistry.chromiumPackage.requiredRevision();
  const pairing = localAgentRegistry.findForUser(panelUser(req), clientIpOf(req));
  res.json({ ok: true, requiredRevision: requiredRevision ?? null, ...describePairing(pairing, requiredRevision) });
});

// POST /api/local-agent/install — instala (o sigue instalando) Chromium en mi equipo.
localAgentRouter.post("/install", (req, res) => {
  try {
    const pairing = localAgentRegistry.findForUser(panelUser(req), clientIpOf(req));
    if (pairing.status !== "found") {
      throw new LocalAgentError(
        pairing.status === "none" ? "LOCAL_AGENT_NOT_FOUND" : "LOCAL_AGENT_AMBIGUOUS",
        pairing.status === "none" ? "No hay un agente de QA Lab conectado desde tu equipo" : "Hay varios equipos en tu red: elige el tuyo",
      );
    }
    const install = localAgentRegistry.requestInstall(pairing.agent.agentId);
    res.status(202).json({ ok: true, install });
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/local-agent/select { agentId } — elegir equipo cuando hay varios en la misma IP.
localAgentRouter.post("/select", (req, res) => {
  try {
    const agentId = String(req.body?.agentId ?? "").trim();
    const agent = localAgentRegistry.select(panelUser(req), clientIpOf(req), agentId);
    const requiredRevision = localAgentRegistry.chromiumPackage.requiredRevision();
    res.json({ ok: true, ...describePairing({ status: "found", agent }, requiredRevision) });
  } catch (err) {
    sendError(res, err);
  }
});

const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// GET /descargas/:file — Chromium y el agente (se arman la primera vez) y el instalador de TI.
downloadsRouter.get("/:file", async (req, res) => {
  const file = req.params.file;
  if (!SAFE_FILE.test(file) || file.endsWith(".tmp.zip")) {
    res.status(404).end();
    return;
  }
  const pkg = localAgentRegistry.chromiumPackage;
  const revision = pkg.requiredRevision();
  try {
    if (revision && file === `chromium-${revision}.zip`) await pkg.ensure();
    if (AGENT_DOWNLOADS.has(file)) await agentPackage.ensure();
  } catch (err) {
    res.status(503).json({ ok: false, errorCode: "SERVER_CHROMIUM_MISSING", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const full = path.join(pkg.dir, file);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.status(404).end();
    return;
  }
  res.setHeader(
    "Content-Type",
    file.endsWith(".zip") ? "application/zip"
      : file.endsWith(".json") ? "application/json; charset=utf-8"
        : file === AGENT_INSTALLER ? "text/plain; charset=utf-8"
          : "application/octet-stream",
  );
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(full, { dotfiles: "deny" });
});

export { DOWNLOADS_URL_PREFIX };
