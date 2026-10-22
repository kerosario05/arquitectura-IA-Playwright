import os from "node:os";
import WebSocket from "ws";
import type { AgentConfig } from "./agent-config";
import { BrowserSession } from "./browser-session";
import { ChromiumInstaller } from "./chromium-installer";
import {
  AGENT_CDP_PATH,
  AGENT_CONTROL_PATH,
  AGENT_PROTOCOL_VERSION,
  parseServerMessage,
  toWebSocketUrl,
  type AgentToServer,
  type ServerToAgent,
} from "./protocol";

/**
 * Agente local: mantiene un canal de control con el servidor y ejecuta sus
 * órdenes (instalar Chromium, abrir y cerrar navegadores). No decide nada por
 * su cuenta salvo reconectar: qué revisión hace falta y cuándo grabar lo
 * decide el servidor, así una actualización del servidor no exige tocar los PCs.
 */

export const AGENT_HEADER_KEY = "x-qalab-agent-key";
export const AGENT_HEADER_ID = "x-qalab-agent-id";

const RECONNECT_MIN_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const HEARTBEAT_MS = 25000;

export type LocalAgentOptions = {
  config: AgentConfig;
  version: string;
  log?: (line: string) => void;
  /** Revisiones que el agente informa aunque aún no estén instaladas. */
  knownRevisions?: string[];
};

export class LocalAgent {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly installer: ChromiumInstaller;
  private readonly log: (line: string) => void;
  private connectedOnce?: () => void;
  readonly connected: Promise<void>;

  constructor(private readonly options: LocalAgentOptions) {
    this.log = options.log ?? ((line) => console.log(line));
    this.installer = new ChromiumInstaller(options.config.browsersDir, options.config.serverUrl, this.authHeaders());
    this.connected = new Promise((resolve) => (this.connectedOnce = resolve));
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.heartbeat);
    await Promise.all([...this.sessions.values()].map((s) => s.close("server_closed")));
    this.socket?.close();
  }

  get openSessions(): number {
    return this.sessions.size;
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { [AGENT_HEADER_ID]: this.options.config.agentId };
    if (this.options.config.agentKey) headers[AGENT_HEADER_KEY] = this.options.config.agentKey;
    return headers;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = toWebSocketUrl(this.options.config.serverUrl, AGENT_CONTROL_PATH);
    const socket = new WebSocket(url, { headers: this.authHeaders(), handshakeTimeout: 15000 });
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.log(`[agente] conectado a ${this.options.config.serverUrl}`);
      this.send(this.hello());
      clearInterval(this.heartbeat);
      // ping de WebSocket: mantiene viva la conexión a través de proxies y
      // detecta cortes que el sistema operativo tarda minutos en informar.
      let alive = true;
      socket.on("pong", () => (alive = true));
      this.heartbeat = setInterval(() => {
        if (!alive) {
          this.log("[agente] el servidor no responde; reconectando");
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, HEARTBEAT_MS);
      this.connectedOnce?.();
    });

    socket.on("message", (raw) => {
      const msg = parseServerMessage(String(raw));
      if (!msg) return;
      void this.handle(msg).catch((err) => this.log(`[agente] error atendiendo ${msg.t}: ${err?.message ?? err}`));
    });

    socket.on("unexpected-response", (_req, res) => {
      this.log(`[agente] el servidor rechazó la conexión: HTTP ${res.statusCode}`);
      socket.terminate();
    });
    socket.on("error", (err) => this.log(`[agente] error de conexión: ${err.message}`));
    socket.on("close", () => {
      clearInterval(this.heartbeat);
      if (this.socket !== socket || this.stopped) return;
      // Los navegadores abiertos siguen: su canal de datos es independiente y la
      // grabación puede continuar aunque el control se reconecte.
      const delay = this.reconnectDelay;
      this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
      this.log(`[agente] desconectado; reintento en ${Math.round(delay / 1000)} s`);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    });
  }

  private send(message: AgentToServer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private hello(): AgentToServer {
    const installed = this.installer.installedRevisions();
    const extra = (this.options.knownRevisions ?? [])
      .filter((rev) => !installed.some((s) => s.revision === rev))
      .map((rev) => this.installer.status(rev));
    return {
      t: "hello",
      protocol: AGENT_PROTOCOL_VERSION,
      agentVersion: this.options.version,
      agentId: this.options.config.agentId,
      machine: os.hostname(),
      windowsUser: os.userInfo().username,
      chromium: [...installed, ...extra],
    };
  }

  private async handle(msg: ServerToAgent): Promise<void> {
    switch (msg.t) {
      case "welcome":
        if (msg.requiredRevision && this.sessions.size === 0) {
          const removed = this.installer.pruneExcept(msg.requiredRevision);
          if (removed.length > 0) this.log(`[agente] revisiones antiguas borradas: ${removed.join(", ")}`);
        }
        return;

      case "status_request":
        this.send(this.hello());
        return;

      case "install_chromium": {
        this.log(`[agente] instalando Chromium ${msg.revision}`);
        try {
          const status = await this.installer.install(msg, (p) =>
            this.send({ t: "install_progress", requestId: msg.requestId, revision: msg.revision, ...p }),
          );
          this.log(`[agente] Chromium ${msg.revision} instalado`);
          this.send({ t: "install_done", requestId: msg.requestId, chromium: status });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`[agente] falló la instalación de Chromium ${msg.revision}: ${message}`);
          this.send({ t: "install_error", requestId: msg.requestId, revision: msg.revision, message });
        }
        return;
      }

      case "open_browser": {
        const status = this.installer.status(msg.revision);
        if (!status.installed || !status.executablePath) {
          this.send({ t: "browser_error", sessionId: msg.sessionId, message: `Chromium ${msg.revision} no está instalado` });
          return;
        }
        if (this.sessions.has(msg.sessionId)) return;
        const session = new BrowserSession({
          sessionId: msg.sessionId,
          executablePath: status.executablePath,
          dataChannelUrl: toWebSocketUrl(this.options.config.serverUrl, AGENT_CDP_PATH, {
            session: msg.sessionId,
            token: msg.dataToken,
          }),
          headers: this.authHeaders(),
          log: this.log,
        });
        this.sessions.set(msg.sessionId, session);
        let opened = false;
        session.onClosed((reason) => {
          this.sessions.delete(msg.sessionId);
          // Un fallo al abrir ya se informa como browser_error.
          if (opened) this.send({ t: "browser_closed", sessionId: msg.sessionId, reason });
        });
        try {
          await session.open();
          opened = true;
          this.send({ t: "browser_opened", sessionId: msg.sessionId, revision: msg.revision });
        } catch (err) {
          this.sessions.delete(msg.sessionId);
          this.send({ t: "browser_error", sessionId: msg.sessionId, message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }

      case "close_browser":
        await this.sessions.get(msg.sessionId)?.close("server_closed");
        return;
    }
  }
}
