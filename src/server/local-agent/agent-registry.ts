import { randomBytes, randomUUID } from "node:crypto";
import type WebSocket from "ws";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentHello,
  type AgentToServer,
  type ChromiumStatus,
  type ServerToAgent,
} from "../../local-agent/protocol";
import { ChromiumPackage } from "./chromium-package";

/**
 * Agentes locales conectados (uno por usuario de Windows y PC) y lo que el
 * servidor les ha pedido.
 *
 * Emparejar el usuario del panel con SU agente: el agente y el navegador del
 * panel salen del mismo PC, así que llegan desde la misma IP. Si en esa IP hay
 * varios agentes (servidor de terminales, NAT), desempata el usuario de Windows
 * igual al del panel, y si aún hay duda el panel pide elegir el equipo
 * (`select`). Nunca se abre un navegador en un agente de otra IP.
 */

export type ControlSocket = { send(data: string): void; close(code?: number, reason?: string): void };

export type ConnectedAgent = {
  agentId: string;
  ip: string;
  machine: string;
  windowsUser: string;
  agentVersion: string;
  protocol: number;
  chromium: ChromiumStatus[];
  connectedAt: string;
  lastSeenAt: number;
};

export type InstallState = {
  requestId: string;
  revision: string;
  state: "preparing" | "download" | "extract" | "done" | "error";
  /** Avance total 0-100 (descarga hasta 90, descompresión hasta 99). */
  percent: number;
  receivedBytes?: number;
  totalBytes?: number;
  message?: string;
  startedAt: string;
  updatedAt: string;
};

export type PanelUser = { userId: string | null; username: string };

export type PairingResult =
  | { status: "found"; agent: ConnectedAgent }
  | { status: "none" }
  | { status: "ambiguous"; candidates: ConnectedAgent[] };

export type BrowserCloseReason = Extract<AgentToServer, { t: "browser_closed" }>["reason"];

export type AgentDataChannel = {
  sessionId: string;
  agentId: string;
  socket: WebSocket;
  /** El agente informó que su navegador se cerró (o se perdió el agente). */
  onAgentClosed(listener: (reason: BrowserCloseReason) => void): void;
  /** Pide al agente cerrar el navegador y corta el canal de datos. */
  close(): void;
};

type AgentEntry = ConnectedAgent & { socket: ControlSocket; install?: InstallState };

type PendingBrowser = {
  agentId: string;
  token: string;
  resolve: (channel: AgentDataChannel) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type OpenSession = {
  agentId: string;
  listeners: Array<(reason: BrowserCloseReason) => void>;
  closedByServer: boolean;
  notified: boolean;
};

const OPEN_BROWSER_TIMEOUT_MS = 60_000;

export class LocalAgentError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "LocalAgentError";
  }
}

/** "DOMINIO\\usuario" o "usuario@dominio" → "usuario", sin mayúsculas. */
export function normalizeAccountName(name: string | undefined | null): string {
  const raw = String(name ?? "").trim().toLowerCase();
  const afterSlash = raw.includes("\\") ? raw.slice(raw.lastIndexOf("\\") + 1) : raw;
  return afterSlash.includes("@") ? afterSlash.slice(0, afterSlash.indexOf("@")) : afterSlash;
}

export class LocalAgentRegistry {
  private readonly agents = new Map<string, AgentEntry>();
  /** Elección explícita del panel cuando había varios agentes en la IP: userId → agentId. */
  private readonly selections = new Map<string, string>();
  private readonly pending = new Map<string, PendingBrowser>();
  private readonly sessions = new Map<string, OpenSession>();

  constructor(
    readonly chromiumPackage: ChromiumPackage = new ChromiumPackage(),
    private readonly log: (line: string) => void = (line) => console.log(line),
  ) {}

  // --- canal de control -----------------------------------------------------

  /**
   * Un agente abrió su canal de control. Hasta que manda `hello` no cuenta como
   * conectado. Devuelve los manejadores que el endpoint conecta al socket.
   */
  attachControl(socket: ControlSocket, meta: { agentId: string; ip: string }): { onMessage(text: string): void; onClose(): void; onPing(): void } {
    let registered = false;
    return {
      onMessage: (text) => {
        let msg: AgentToServer;
        try { msg = JSON.parse(text) as AgentToServer; } catch { return; }
        if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return;
        if (msg.t === "hello") {
          this.onHello(socket, meta, msg);
          registered = true;
          return;
        }
        if (!registered) return;
        this.onAgentMessage(meta.agentId, msg);
      },
      onPing: () => {
        const entry = this.agents.get(meta.agentId);
        if (entry?.socket === socket) entry.lastSeenAt = Date.now();
      },
      onClose: () => {
        const entry = this.agents.get(meta.agentId);
        if (!entry || entry.socket !== socket) return;
        this.agents.delete(meta.agentId);
        if (entry.install && entry.install.state !== "done" && entry.install.state !== "error") {
          this.updateInstall(entry, { state: "error", message: "El agente se desconectó durante la instalación" });
        }
        this.log(`[agente-local] desconectado ${describe(entry)}`);
      },
    };
  }

  private onHello(socket: ControlSocket, meta: { agentId: string; ip: string }, hello: AgentHello): void {
    const previous = this.agents.get(meta.agentId);
    if (previous && previous.socket !== socket) {
      // Reconexión con el canal viejo aún abierto (corte a medias): manda el nuevo.
      try { previous.socket.close(4000, "replaced"); } catch { /* ya cerrado */ }
    }
    const entry: AgentEntry = {
      agentId: meta.agentId,
      ip: meta.ip,
      machine: String(hello.machine ?? "").slice(0, 128),
      windowsUser: String(hello.windowsUser ?? "").slice(0, 128),
      agentVersion: String(hello.agentVersion ?? "").slice(0, 32),
      protocol: Number(hello.protocol) || 0,
      chromium: Array.isArray(hello.chromium) ? hello.chromium : [],
      connectedAt: previous?.connectedAt ?? new Date().toISOString(),
      lastSeenAt: Date.now(),
      socket,
      install: previous?.install,
    };
    this.agents.set(meta.agentId, entry);
    if (!previous) this.log(`[agente-local] conectado ${describe(entry)}`);
    if (entry.protocol !== AGENT_PROTOCOL_VERSION) {
      this.log(`[agente-local] ${describe(entry)} usa el protocolo ${entry.protocol} (servidor ${AGENT_PROTOCOL_VERSION})`);
    }
    this.send(entry, { t: "welcome", requiredRevision: this.chromiumPackage.requiredRevision() });
  }

  private onAgentMessage(agentId: string, msg: AgentToServer): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    entry.lastSeenAt = Date.now();
    switch (msg.t) {
      case "install_progress": {
        if (entry.install?.requestId !== msg.requestId) return;
        const percent = msg.phase === "download" ? Math.floor((msg.percent ?? 0) * 0.9) : 95;
        this.updateInstall(entry, { state: msg.phase, percent: Math.max(entry.install.percent, percent), receivedBytes: msg.receivedBytes, totalBytes: msg.totalBytes });
        return;
      }
      case "install_done":
        entry.chromium = [...entry.chromium.filter((c) => c.revision !== msg.chromium.revision), msg.chromium];
        if (entry.install?.requestId === msg.requestId) this.updateInstall(entry, { state: "done", percent: 100 });
        this.log(`[agente-local] Chromium ${msg.chromium.revision} instalado en ${describe(entry)}`);
        return;
      case "install_error":
        if (entry.install?.requestId === msg.requestId) this.updateInstall(entry, { state: "error", message: msg.message });
        this.log(`[agente-local] falló la instalación en ${describe(entry)}: ${msg.message}`);
        return;
      case "browser_opened":
        return; // el canal de datos es la confirmación que importa
      case "browser_error": {
        const pending = this.pending.get(msg.sessionId);
        if (pending?.agentId === agentId) {
          this.pending.delete(msg.sessionId);
          clearTimeout(pending.timer);
          pending.reject(new LocalAgentError("LOCAL_AGENT_BROWSER_FAILED", `El agente no pudo abrir Chromium: ${msg.message}`));
        }
        return;
      }
      case "browser_closed":
        this.notifySessionClosed(msg.sessionId, agentId, msg.reason);
        return;
    }
  }

  private send(entry: AgentEntry, msg: ServerToAgent): void {
    try { entry.socket.send(JSON.stringify(msg)); } catch { /* el cierre lo limpia */ }
  }

  /** Cierra los canales de control que llevan `maxSilenceMs` sin ping ni mensajes. */
  sweepSilent(maxSilenceMs: number): void {
    const limit = Date.now() - maxSilenceMs;
    for (const entry of this.agents.values()) {
      if (entry.lastSeenAt < limit) {
        this.log(`[agente-local] sin noticias de ${describe(entry)}; se cierra su canal`);
        try { entry.socket.close(4008, "silent"); } catch { /* ya cerrado */ }
      }
    }
  }

  // --- emparejamiento con el panel ------------------------------------------

  list(): ConnectedAgent[] {
    return [...this.agents.values()].map(publicView);
  }

  get(agentId: string): ConnectedAgent | undefined {
    const entry = this.agents.get(agentId);
    return entry ? publicView(entry) : undefined;
  }

  findForUser(user: PanelUser, ip: string): PairingResult {
    const sameIp = [...this.agents.values()].filter((a) => a.ip === ip);
    if (sameIp.length === 0) return { status: "none" };
    if (sameIp.length === 1) return { status: "found", agent: publicView(sameIp[0]) };

    const selected = user.userId ? this.selections.get(user.userId) : undefined;
    const bySelection = sameIp.find((a) => a.agentId === selected);
    if (bySelection) return { status: "found", agent: publicView(bySelection) };

    const account = normalizeAccountName(user.username);
    const byUser = sameIp.filter((a) => account && normalizeAccountName(a.windowsUser) === account);
    if (byUser.length === 1) return { status: "found", agent: publicView(byUser[0]) };

    return { status: "ambiguous", candidates: sameIp.map(publicView) };
  }

  /** El panel eligió equipo entre varios de su misma IP. */
  select(user: PanelUser, ip: string, agentId: string): ConnectedAgent {
    const entry = this.agents.get(agentId);
    if (!entry || entry.ip !== ip) {
      throw new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "Ese equipo no está conectado desde tu red");
    }
    if (user.userId) this.selections.set(user.userId, agentId);
    return publicView(entry);
  }

  hasChromium(agent: ConnectedAgent, revision = this.chromiumPackage.requiredRevision()): boolean {
    return Boolean(revision && agent.chromium.some((c) => c.revision === revision && c.installed));
  }

  // --- instalación de Chromium ----------------------------------------------

  installState(agentId: string): InstallState | undefined {
    const install = this.agents.get(agentId)?.install;
    return install ? { ...install } : undefined;
  }

  /**
   * Pide al agente instalar la revisión exigida. Idempotente: si ya hay una en
   * curso devuelve esa. El zip se arma primero en el servidor si aún no existe
   * (estado "preparing").
   */
  requestInstall(agentId: string): InstallState {
    const entry = this.agents.get(agentId);
    if (!entry) throw new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente no está conectado");
    const revision = this.chromiumPackage.requiredRevision();
    if (!revision) throw new LocalAgentError("SERVER_CHROMIUM_MISSING", "El servidor no tiene Chromium de Playwright para entregar");
    const current = entry.install;
    if (current && current.revision === revision && current.state !== "error" && current.state !== "done") return { ...current };
    if (this.hasChromium(publicView(entry), revision)) {
      const now = new Date().toISOString();
      entry.install = { requestId: randomUUID(), revision, state: "done", percent: 100, startedAt: now, updatedAt: now };
      return { ...entry.install };
    }

    const now = new Date().toISOString();
    const install: InstallState = { requestId: randomUUID(), revision, state: "preparing", percent: 0, startedAt: now, updatedAt: now };
    entry.install = install;
    this.log(`[agente-local] instalando Chromium ${revision} en ${describe(entry)}`);
    void this.chromiumPackage.ensure(this.log).then(
      (pkg) => {
        const live = this.agents.get(agentId);
        if (!live || live.install?.requestId !== install.requestId) return;
        this.send(live, { t: "install_chromium", requestId: install.requestId, revision: pkg.revision, url: pkg.url, sha256: pkg.sha256, sizeBytes: pkg.sizeBytes });
      },
      (err) => {
        const live = this.agents.get(agentId);
        if (live?.install?.requestId !== install.requestId) return;
        this.updateInstall(live, { state: "error", message: err instanceof Error ? err.message : String(err) });
      },
    );
    return { ...install };
  }

  private updateInstall(entry: AgentEntry, patch: Partial<InstallState>): void {
    if (!entry.install) return;
    entry.install = { ...entry.install, ...patch, updatedAt: new Date().toISOString() };
  }

  // --- navegador en el PC ---------------------------------------------------

  /**
   * Pide al agente abrir Chromium y espera a que su canal de datos (CDP del
   * navegador) llegue al servidor.
   */
  openBrowser(agentId: string, timeoutMs = OPEN_BROWSER_TIMEOUT_MS): Promise<AgentDataChannel> {
    const entry = this.agents.get(agentId);
    if (!entry) return Promise.reject(new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente de tu equipo no está conectado"));
    const revision = this.chromiumPackage.requiredRevision();
    if (!revision || !this.hasChromium(publicView(entry), revision)) {
      return Promise.reject(new LocalAgentError("LOCAL_AGENT_CHROMIUM_MISSING", "Tu equipo aún no tiene instalado el Chromium de grabación"));
    }
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("hex");
    return new Promise<AgentDataChannel>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(sessionId);
        this.send(entry, { t: "close_browser", sessionId });
        reject(new LocalAgentError("LOCAL_AGENT_TIMEOUT", `Chromium no se abrió en tu equipo en ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(sessionId, { agentId, token, resolve, reject, timer });
      this.send(entry, { t: "open_browser", sessionId, revision, dataToken: token });
      this.log(`[agente-local] abriendo Chromium en ${describe(entry)} (sesión ${sessionId})`);
    });
  }

  /**
   * Llegó un canal de datos. Solo se acepta si corresponde a una apertura
   * pendiente, del mismo agente y con su token de un solo uso.
   */
  acceptDataChannel(params: { sessionId: string; token: string; agentId: string }): ((socket: WebSocket) => void) | undefined {
    const pending = this.pending.get(params.sessionId);
    if (!pending || pending.agentId !== params.agentId || !safeEqual(pending.token, params.token)) return undefined;
    this.pending.delete(params.sessionId);
    clearTimeout(pending.timer);
    return (socket) => {
      const session: OpenSession = { agentId: params.agentId, listeners: [], closedByServer: false, notified: false };
      this.sessions.set(params.sessionId, session);
      socket.on("close", () => this.notifySessionClosed(params.sessionId, params.agentId, "data_channel_lost"));
      pending.resolve({
        sessionId: params.sessionId,
        agentId: params.agentId,
        socket,
        onAgentClosed: (listener) => session.listeners.push(listener),
        close: () => {
          session.closedByServer = true;
          const entry = this.agents.get(params.agentId);
          if (entry) this.send(entry, { t: "close_browser", sessionId: params.sessionId });
          try { socket.close(); } catch { /* ya cerrado */ }
        },
      });
    };
  }

  private notifySessionClosed(sessionId: string, agentId: string, reason: BrowserCloseReason): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.agentId !== agentId || session.notified) return;
    session.notified = true;
    this.sessions.delete(sessionId);
    // Tras un cierre pedido por el servidor el agente puede informar "user_closed"
    // (el grabador cierra la pestaña antes): no es un cierre del usuario.
    if (session.closedByServer) return;
    for (const listener of session.listeners) {
      try { listener(reason); } catch (err) { this.log(`[agente-local] error notificando cierre: ${err instanceof Error ? err.message : String(err)}`); }
    }
  }
}

function publicView(entry: AgentEntry | ConnectedAgent): ConnectedAgent {
  return {
    agentId: entry.agentId,
    ip: entry.ip,
    machine: entry.machine,
    windowsUser: entry.windowsUser,
    agentVersion: entry.agentVersion,
    protocol: entry.protocol,
    chromium: entry.chromium.map((c) => ({ revision: c.revision, installed: c.installed })),
    connectedAt: entry.connectedAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

function describe(entry: ConnectedAgent): string {
  return `${entry.windowsUser || "?"}@${entry.machine || "?"} (${entry.ip}, agente ${entry.agentVersion || "?"})`;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Instancia del proceso del motor. */
export const localAgentRegistry = new LocalAgentRegistry();
