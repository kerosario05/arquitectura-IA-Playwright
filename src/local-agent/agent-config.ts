import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * Configuración del agente en el PC del usuario.
 *
 * Todo vive en %LOCALAPPDATA%\QALab\agente: el agente instala y actualiza
 * Chromium sin elevación (sin aviso de UAC), y cada usuario de Windows del
 * equipo tiene su propio agente, porque Chromium debe abrirse en SU sesión.
 *
 * agente.json lo escribe el instalador de TI:
 *   { "serverUrl": "http://SRVDEVQACA01:3003", "agentKey": "..." }
 */
export type AgentConfig = {
  serverUrl: string;
  /** Clave compartida opcional para que el servidor solo acepte agentes instalados por TI. */
  agentKey?: string;
  /** Identificador estable de esta instalación (se genera la primera vez). */
  agentId: string;
  rootDir: string;
  browsersDir: string;
  logsDir: string;
};

export function defaultRootDir(): string {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(base, "QALab", "agente");
}

export function loadAgentConfig(rootDir = process.env.QALAB_AGENT_HOME || defaultRootDir()): AgentConfig {
  const file = path.join(rootDir, "agente.json");
  let raw: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as Record<string, unknown>;
  }
  const serverUrl = String(process.env.QALAB_SERVER_URL || raw.serverUrl || "").trim();
  if (!/^https?:\/\//i.test(serverUrl)) {
    throw new Error(`Falta serverUrl (http://servidor:puerto) en ${file} o QALAB_SERVER_URL`);
  }

  let agentId = typeof raw.agentId === "string" && raw.agentId ? raw.agentId : "";
  if (!agentId) {
    agentId = randomUUID();
    fs.mkdirSync(rootDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ ...raw, serverUrl: raw.serverUrl ?? serverUrl, agentId }, null, 2));
  }

  return {
    serverUrl: serverUrl.replace(/\/+$/, ""),
    agentKey: (process.env.QALAB_AGENT_KEY || (typeof raw.agentKey === "string" ? raw.agentKey : "")) || undefined,
    agentId,
    rootDir,
    browsersDir: path.join(rootDir, "navegadores"),
    logsDir: path.join(rootDir, "logs"),
  };
}
