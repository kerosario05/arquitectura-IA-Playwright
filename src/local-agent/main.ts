import fs from "node:fs";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadAgentConfig } from "./agent-config";
import { LocalAgent } from "./local-agent";
import { AGENT_VERSION } from "./version";

/**
 * Punto de entrada del agente local de QA Lab.
 *
 *   qalab-agente.exe qalab-agente.cjs [--segundo-plano]
 *
 * Lo arranca Windows al iniciar sesión (lo registra el instalador de TI). No
 * tiene ventana: todo va al log de %LOCALAPPDATA%\QALab\agente\logs.
 */

const LOG_RETENTION_DAYS = 7;

function createLogger(logsDir: string): (line: string) => void {
  fs.mkdirSync(logsDir, { recursive: true });
  const cutoff = Date.now() - LOG_RETENTION_DAYS * 86_400_000;
  for (const name of fs.readdirSync(logsDir)) {
    const file = path.join(logsDir, name);
    try {
      if (/^agente-\d{8}\.log$/.test(name) && fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file);
    } catch { /* en uso: se borrará otro día */ }
  }
  return (line: string) => {
    const now = new Date();
    const day = now.toISOString().slice(0, 10).replace(/-/g, "");
    const text = `${now.toISOString()} ${line}${os.EOL}`;
    try { fs.appendFileSync(path.join(logsDir, `agente-${day}.log`), text); } catch { /* disco lleno o bloqueado */ }
    if (process.stdout.isTTY) process.stdout.write(text);
  };
}

/**
 * Una instancia por usuario de Windows: si el inicio de sesión lo arranca dos
 * veces (GPO + acceso directo), la segunda sale sin hacer nada.
 */
function acquireSingleInstance(): Promise<net.Server | undefined> {
  const pipe = `\\\\.\\pipe\\qalab-agente-${os.userInfo().username.replace(/[^\w.-]/g, "_")}`;
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    server.once("error", () => resolve(undefined));
    server.listen(pipe, () => resolve(server));
  });
}

/**
 * `--segundo-plano`: lo usa el acceso directo de inicio de sesión. Relanza el
 * agente desacoplado y sin consola, y esta copia termina enseguida, así la
 * ventana (minimizada) del acceso directo desaparece sin que el usuario la use.
 */
function relaunchHidden(): void {
  const child = spawn(process.execPath, [process.argv[1]], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

async function main(): Promise<void> {
  if (process.argv.includes("--segundo-plano")) {
    relaunchHidden();
    return;
  }
  const config = loadAgentConfig();
  const log = createLogger(config.logsDir);

  const lock = await acquireSingleInstance();
  if (!lock) {
    log("[agente] ya hay un agente en marcha para este usuario; esta copia termina");
    return;
  }

  log(`[agente] QA Lab agente ${AGENT_VERSION} (node ${process.version}) en ${os.hostname()} para ${os.userInfo().username}`);
  const agent = new LocalAgent({ config, version: AGENT_VERSION, log });
  agent.start();

  const shutdown = async (signal: string) => {
    log(`[agente] ${signal}: cerrando navegadores abiertos`);
    await agent.stop();
    lock.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("uncaughtException", (err) => log(`[agente] excepción no controlada: ${err.stack ?? err.message}`));
  process.on("unhandledRejection", (err) => log(`[agente] promesa rechazada: ${err instanceof Error ? err.stack : String(err)}`));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
