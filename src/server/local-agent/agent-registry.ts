import { randomBytes, randomUUID } from "node:crypto";
import type WebSocket from "ws";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentHello,
  type AgentToServer,
  type AndroidStatus,
  type ChromiumStatus,
  type ServerToAgent,
  type StreamTarget,
} from "../../local-agent/protocol";
import { AppiumPackage, appiumPackage } from "./appium-package";
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
  /** Android Studio en el PC (agentes 0.2.0+). */
  android?: AndroidStatus;
  /** Appium que instaló el agente (0.3.0+); ausente si el agente no sabe instalarlo. */
  appium?: { installed: string[] };
  connectedAt: string;
  lastSeenAt: number;
};

/** Arranque de un emulador pedido desde el panel. */
export type EmulatorState = {
  requestId: string;
  avd: string;
  state: "starting" | "launched" | "booting" | "ready" | "error";
  serial?: string;
  message?: string;
  startedAt: string;
  updatedAt: string;
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

/** Instalación de Appium en el PC: la pide el servidor, no el panel. */
export type AppiumInstallState = Omit<InstallState, "revision"> & { version: string };

type AppiumWaiter = { resolve: () => void; reject: (err: Error) => void };

type AgentEntry = ConnectedAgent & {
  socket: ControlSocket;
  install?: InstallState;
  appiumInstall?: AppiumInstallState;
  emulator?: EmulatorState;
  statusRequestedAt?: number;
};

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

type PendingStream = {
  agentId: string;
  token: string;
  resolve: (socket: WebSocket) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

const OPEN_BROWSER_TIMEOUT_MS = 60_000;
const OPEN_STREAM_TIMEOUT_MS = 15_000;
/** La primera conexión a Appium lo arranca en el PC (unos 40 s la primera vez). */
const OPEN_APPIUM_STREAM_TIMEOUT_MS = 270_000;
const APPIUM_INSTALL_TIMEOUT_MS = 15 * 60_000;
/** adb y webdriverio abren pocas conexiones; un tope evita que un fallo las acumule. */
const MAX_STREAMS_PER_AGENT = 64;

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
  private readonly pendingStreams = new Map<string, PendingStream>();
  /** agentId → canales TCP abiertos ahora. */
  private readonly openStreams = new Map<string, Set<WebSocket>>();
  /** agentId → quienes esperan a que termine la instalación de Appium. */
  private readonly appiumWaiters = new Map<string, AppiumWaiter[]>();

  constructor(
    readonly chromiumPackage: ChromiumPackage = new ChromiumPackage(),
    private readonly log: (line: string) => void = (line) => console.log(line),
    readonly appiumPackage?: AppiumPackage,
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
        if (entry.appiumInstall && entry.appiumInstall.state !== "done" && entry.appiumInstall.state !== "error") {
          this.finishAppiumInstall(entry, "El agente se desconectó durante la instalación de Appium");
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
      android: sanitizeAndroid(hello.android),
      ...(hello.appium && Array.isArray(hello.appium.installed)
        ? { appium: { installed: hello.appium.installed.filter((v) => typeof v === "string").map((v) => v.slice(0, 64)).slice(0, 10) } }
        : {}),
      connectedAt: previous?.connectedAt ?? new Date().toISOString(),
      lastSeenAt: Date.now(),
      socket,
      install: previous?.install,
      appiumInstall: previous?.appiumInstall,
      emulator: previous?.emulator,
    };
    this.agents.set(meta.agentId, entry);
    if (!previous) this.log(`[agente-local] conectado ${describe(entry)}`);
    if (entry.protocol !== AGENT_PROTOCOL_VERSION) {
      this.log(`[agente-local] ${describe(entry)} usa el protocolo ${entry.protocol} (servidor ${AGENT_PROTOCOL_VERSION})`);
    }
    this.send(entry, { t: "welcome", requiredRevision: this.chromiumPackage.requiredRevision(), requiredAppium: this.appiumPackage?.requiredVersion() });
    // Con Android Studio en el PC, Appium se instala en segundo plano: así no hay que esperarlo al
    // ejecutar. Tras un fallo no se reintenta en cada hello (llegan cada pocos segundos): lo hace ensureAppium.
    const view = publicView(entry);
    if (this.hasAndroid(view) && this.appiumSupported(view) && !this.hasAppium(view) && entry.appiumInstall?.state !== "error") {
      try { this.requestAppiumInstall(meta.agentId); } catch { /* se informa al ejecutar */ }
    }
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
      case "stream_error": {
        const pending = this.pendingStreams.get(msg.streamId);
        if (pending?.agentId === agentId) {
          this.pendingStreams.delete(msg.streamId);
          clearTimeout(pending.timer);
          pending.reject(new LocalAgentError("LOCAL_AGENT_STREAM_FAILED", `El agente no pudo conectar: ${String(msg.message).slice(0, 300)}`));
        }
        return;
      }
      case "appium_install_progress": {
        if (entry.appiumInstall?.requestId !== msg.requestId) return;
        const percent = msg.phase === "download" ? Math.floor((msg.percent ?? 0) * 0.9) : 95;
        this.updateAppiumInstall(entry, { state: msg.phase, percent: Math.max(entry.appiumInstall.percent, percent), receivedBytes: msg.receivedBytes, totalBytes: msg.totalBytes });
        return;
      }
      case "appium_install_done":
        entry.appium = { installed: [...(entry.appium?.installed ?? []).filter((v) => v !== msg.version), String(msg.version).slice(0, 64)] };
        if (entry.appiumInstall?.requestId === msg.requestId) this.finishAppiumInstall(entry);
        this.log(`[agente-local] Appium ${msg.version} instalado en ${describe(entry)}`);
        return;
      case "appium_install_error":
        if (entry.appiumInstall?.requestId === msg.requestId) this.finishAppiumInstall(entry, String(msg.message).slice(0, 500));
        this.log(`[agente-local] falló la instalación de Appium en ${describe(entry)}: ${msg.message}`);
        return;
      case "emulator_progress":
        if (entry.emulator?.requestId === msg.requestId) this.updateEmulator(entry, { state: msg.phase === "launched" ? "launched" : "booting" });
        return;
      case "emulator_ready":
        if (entry.emulator?.requestId === msg.requestId) this.updateEmulator(entry, { state: "ready", serial: String(msg.serial).slice(0, 64) });
        this.log(`[agente-local] emulador ${msg.avd} listo en ${describe(entry)}`);
        return;
      case "emulator_error":
        if (entry.emulator?.requestId === msg.requestId) this.updateEmulator(entry, { state: "error", message: String(msg.message).slice(0, 500) });
        this.log(`[agente-local] falló el emulador ${msg.avd} en ${describe(entry)}: ${msg.message}`);
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

  // --- Appium en el PC --------------------------------------------------------

  /** El agente sabe instalar y arrancar Appium (0.3.0+) y el servidor tiene uno que darle. */
  appiumSupported(agent: ConnectedAgent): boolean {
    return Boolean(agent.appium && this.appiumPackage?.requiredVersion());
  }

  hasAppium(agent: ConnectedAgent, version = this.appiumPackage?.requiredVersion()): boolean {
    return Boolean(version && agent.appium?.installed.includes(version));
  }

  appiumInstallState(agentId: string): AppiumInstallState | undefined {
    const install = this.agents.get(agentId)?.appiumInstall;
    return install ? { ...install } : undefined;
  }

  /** Pide al agente instalar el Appium del servidor. Idempotente mientras hay una en curso. */
  requestAppiumInstall(agentId: string): AppiumInstallState {
    const entry = this.agents.get(agentId);
    if (!entry) throw new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente no está conectado");
    const pkg = this.appiumPackage;
    const version = pkg?.requiredVersion();
    if (!pkg || !version) throw new LocalAgentError("SERVER_APPIUM_MISSING", "El servidor no tiene Appium para entregar a los equipos");
    if (!this.appiumSupported(publicView(entry))) {
      throw new LocalAgentError("LOCAL_AGENT_OUTDATED", "El agente de tu equipo es anterior a 0.3.0 y no sabe instalar Appium: reinstálalo");
    }
    const current = entry.appiumInstall;
    if (current && current.version === version && current.state !== "error" && current.state !== "done") return { ...current };
    const now = new Date().toISOString();
    if (this.hasAppium(publicView(entry), version)) {
      entry.appiumInstall = { requestId: randomUUID(), version, state: "done", percent: 100, startedAt: now, updatedAt: now };
      return { ...entry.appiumInstall };
    }
    const install: AppiumInstallState = { requestId: randomUUID(), version, state: "preparing", percent: 0, startedAt: now, updatedAt: now };
    entry.appiumInstall = install;
    this.log(`[agente-local] instalando Appium ${version} en ${describe(entry)}`);
    void pkg.ensure(this.log).then(
      (info) => {
        const live = this.agents.get(agentId);
        if (!live || live.appiumInstall?.requestId !== install.requestId) return;
        this.send(live, { t: "install_appium", requestId: install.requestId, version: info.version, url: info.url, sha256: info.sha256, sizeBytes: info.sizeBytes });
      },
      (err) => {
        const live = this.agents.get(agentId);
        if (live?.appiumInstall?.requestId !== install.requestId) return;
        this.finishAppiumInstall(live, err instanceof Error ? err.message : String(err));
      },
    );
    return { ...install };
  }

  /**
   * Antes de ejecutar en el PC: espera a que el agente tenga el Appium del servidor,
   * pidiéndolo si hace falta. Con un agente anterior a 0.3.0 (o un servidor sin Appium)
   * no hace nada: vale un Appium que el usuario haya abierto a mano.
   */
  ensureAppium(agentId: string, timeoutMs = APPIUM_INSTALL_TIMEOUT_MS): Promise<void> {
    const entry = this.agents.get(agentId);
    if (!entry) return Promise.reject(new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente de tu equipo no está conectado"));
    if (!this.appiumSupported(publicView(entry)) || this.hasAppium(publicView(entry))) return Promise.resolve();
    let install: AppiumInstallState;
    try {
      install = this.requestAppiumInstall(agentId);
    } catch (err) {
      return Promise.reject(err);
    }
    if (install.state === "done") return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: AppiumWaiter = {
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      const timer = setTimeout(() => {
        this.appiumWaiters.set(agentId, (this.appiumWaiters.get(agentId) ?? []).filter((w) => w !== waiter));
        reject(new LocalAgentError("LOCAL_AGENT_TIMEOUT", `Appium no terminó de instalarse en tu equipo en ${Math.round(timeoutMs / 60_000)} min`));
      }, timeoutMs);
      this.appiumWaiters.set(agentId, [...(this.appiumWaiters.get(agentId) ?? []), waiter]);
    });
  }

  private updateAppiumInstall(entry: AgentEntry, patch: Partial<AppiumInstallState>): void {
    if (!entry.appiumInstall) return;
    entry.appiumInstall = { ...entry.appiumInstall, ...patch, updatedAt: new Date().toISOString() };
  }

  /** Termina la instalación (bien, o con `error`) y avisa a quienes la esperaban. */
  private finishAppiumInstall(entry: AgentEntry, error?: string): void {
    this.updateAppiumInstall(entry, error ? { state: "error", message: error } : { state: "done", percent: 100 });
    const waiters = this.appiumWaiters.get(entry.agentId) ?? [];
    this.appiumWaiters.delete(entry.agentId);
    for (const w of waiters) {
      if (error) w.reject(new LocalAgentError("LOCAL_AGENT_APPIUM_INSTALL_FAILED", `No se pudo instalar Appium en tu equipo: ${error}`));
      else w.resolve();
    }
  }

  // --- Android Studio en el PC ---------------------------------------------

  /** Android Studio usable: hay SDK con adb. Qué emuladores o teléfonos hay lo dice `android`. */
  hasAndroid(agent: ConnectedAgent): boolean {
    return Boolean(agent.android?.sdkFound && agent.android.adbVersion);
  }

  /**
   * Pide al agente un estado fresco si el que tenemos tiene más de `maxAgeMs`
   * (el usuario pudo abrir o cerrar un emulador por su cuenta). No espera: la
   * siguiente consulta del panel ya lo verá.
   */
  refreshStatus(agentId: string, maxAgeMs = 10_000): void {
    const entry = this.agents.get(agentId);
    if (!entry) return;
    const checkedAt = entry.android ? Date.parse(entry.android.checkedAt) : 0;
    const now = Date.now();
    if (now - (Number.isFinite(checkedAt) ? checkedAt : 0) < maxAgeMs) return;
    if (entry.statusRequestedAt && now - entry.statusRequestedAt < maxAgeMs) return;
    entry.statusRequestedAt = now;
    this.send(entry, { t: "status_request" });
  }

  emulatorState(agentId: string): EmulatorState | undefined {
    const emulator = this.agents.get(agentId)?.emulator;
    return emulator ? { ...emulator } : undefined;
  }

  /** Arranca un AVD del PC. Idempotente mientras ese mismo AVD está arrancando. */
  requestEmulator(agentId: string, avd: string): EmulatorState {
    const entry = this.agents.get(agentId);
    if (!entry) throw new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente no está conectado");
    if (!this.hasAndroid(publicView(entry))) {
      throw new LocalAgentError("LOCAL_AGENT_ANDROID_MISSING", "Tu equipo no tiene Android Studio (SDK con adb) o el agente es anterior a 0.2.0");
    }
    if (!entry.android?.avds.includes(avd)) {
      throw new LocalAgentError("LOCAL_AGENT_AVD_NOT_FOUND", `El emulador "${avd}" no existe en tu equipo`);
    }
    const current = entry.emulator;
    if (current && current.avd === avd && current.state !== "ready" && current.state !== "error") return { ...current };
    const now = new Date().toISOString();
    entry.emulator = { requestId: randomUUID(), avd, state: "starting", startedAt: now, updatedAt: now };
    this.send(entry, { t: "start_emulator", requestId: entry.emulator.requestId, avd });
    this.log(`[agente-local] arrancando el emulador ${avd} en ${describe(entry)}`);
    return { ...entry.emulator };
  }

  stopEmulator(agentId: string, serial: string): void {
    const entry = this.agents.get(agentId);
    if (!entry) throw new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente no está conectado");
    if (!entry.android?.devices.some((d) => d.serial === serial && d.kind === "emulator")) {
      throw new LocalAgentError("LOCAL_AGENT_DEVICE_NOT_FOUND", `El emulador ${serial} no está encendido en tu equipo`);
    }
    if (entry.emulator?.serial === serial) entry.emulator = undefined;
    this.send(entry, { t: "stop_emulator", serial });
  }

  private updateEmulator(entry: AgentEntry, patch: Partial<EmulatorState>): void {
    if (!entry.emulator) return;
    entry.emulator = { ...entry.emulator, ...patch, updatedAt: new Date().toISOString() };
  }

  // --- conexiones TCP al adb / Appium del PC --------------------------------

  /**
   * Pide al agente una conexión TCP a su servicio `target` y espera su canal de
   * datos: los bytes del WebSocket son los de esa conexión, sin interpretar.
   */
  openStream(agentId: string, target: StreamTarget, timeoutMs = target === "appium" ? OPEN_APPIUM_STREAM_TIMEOUT_MS : OPEN_STREAM_TIMEOUT_MS): Promise<WebSocket> {
    const entry = this.agents.get(agentId);
    if (!entry) return Promise.reject(new LocalAgentError("LOCAL_AGENT_NOT_FOUND", "El agente de tu equipo no está conectado"));
    if (target === "adb" && !this.hasAndroid(publicView(entry))) {
      return Promise.reject(new LocalAgentError("LOCAL_AGENT_ANDROID_MISSING", "Tu equipo no tiene Android Studio (SDK con adb) o el agente es anterior a 0.2.0"));
    }
    const busy = (this.openStreams.get(agentId)?.size ?? 0) + [...this.pendingStreams.values()].filter((p) => p.agentId === agentId).length;
    if (busy >= MAX_STREAMS_PER_AGENT) {
      return Promise.reject(new LocalAgentError("LOCAL_AGENT_STREAM_LIMIT", "Demasiadas conexiones abiertas con el agente de tu equipo"));
    }
    const streamId = randomUUID();
    const token = randomBytes(32).toString("hex");
    return new Promise<WebSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingStreams.delete(streamId);
        reject(new LocalAgentError("LOCAL_AGENT_TIMEOUT", `El agente no abrió la conexión a ${target} en ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pendingStreams.set(streamId, { agentId, token, resolve, reject, timer });
      this.send(entry, { t: "open_stream", streamId, target, dataToken: token });
    });
  }

  /** Igual que acceptDataChannel, para el canal de una conexión TCP. */
  acceptStreamChannel(params: { streamId: string; token: string; agentId: string }): ((socket: WebSocket) => void) | undefined {
    const pending = this.pendingStreams.get(params.streamId);
    if (!pending || pending.agentId !== params.agentId || !safeEqual(pending.token, params.token)) return undefined;
    this.pendingStreams.delete(params.streamId);
    clearTimeout(pending.timer);
    return (socket) => {
      const open = this.openStreams.get(params.agentId) ?? new Set<WebSocket>();
      this.openStreams.set(params.agentId, open);
      open.add(socket);
      socket.on("close", () => {
        open.delete(socket);
        if (open.size === 0) this.openStreams.delete(params.agentId);
      });
      pending.resolve(socket);
    };
  }

  /** Conexiones TCP abiertas con el agente (para pruebas y diagnóstico). */
  openStreamCount(agentId: string): number {
    return this.openStreams.get(agentId)?.size ?? 0;
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
    ...(entry.android ? { android: entry.android } : {}),
    ...(entry.appium ? { appium: { installed: [...entry.appium.installed] } } : {}),
    connectedAt: entry.connectedAt,
    lastSeenAt: entry.lastSeenAt,
  };
}

/** El hello llega del PC: se acota y se normaliza antes de guardarlo. */
export function sanitizeAndroid(raw: unknown): AndroidStatus | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Partial<AndroidStatus>;
  const text = (v: unknown, max = 256) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
  const checkedAt = text(a.checkedAt, 40);
  const sdkPath = text(a.sdkPath, 512);
  const adbVersion = text(a.adbVersion, 32);
  const error = text(a.error, 500);
  return {
    sdkFound: a.sdkFound === true,
    ...(sdkPath ? { sdkPath } : {}),
    ...(adbVersion ? { adbVersion } : {}),
    emulatorFound: a.emulatorFound === true,
    avds: Array.isArray(a.avds) ? a.avds.map((v) => text(v, 128)).filter((v): v is string => Boolean(v)).slice(0, 50) : [],
    devices: Array.isArray(a.devices)
      ? a.devices
        .filter((d) => d && typeof d === "object" && text(d.serial, 64))
        .slice(0, 20)
        .map((d) => {
          const model = text(d.model, 128);
          const avd = text(d.avd, 128);
          return {
            serial: text(d.serial, 64)!,
            state: text(d.state, 32) ?? "unknown",
            kind: d.kind === "emulator" ? ("emulator" as const) : ("physical" as const),
            ...(model ? { model } : {}),
            ...(avd ? { avd } : {}),
          };
        })
      : [],
    ...(error ? { error } : {}),
    checkedAt: checkedAt && Number.isFinite(Date.parse(checkedAt)) ? checkedAt : new Date().toISOString(),
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
export const localAgentRegistry = new LocalAgentRegistry(new ChromiumPackage(), (line) => console.log(line), appiumPackage);
