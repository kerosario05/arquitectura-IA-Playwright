import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { AgentConfig } from "./agent-config";
import { BrowserSession } from "./browser-session";
import { AppiumInstaller, AppiumServer } from "./appium-runtime";
import { ChromiumInstaller } from "./chromium-installer";
import { probeAndroid, resolveSdk, runCommand, startEmulator, stopEmulator, type AndroidStatus } from "./android-probe";
import { openTcpStream, type LocalTarget } from "./tcp-stream";
import {
  AGENT_CDP_PATH,
  AGENT_CONTROL_PATH,
  AGENT_PROTOCOL_VERSION,
  AGENT_STREAM_PATH,
  parseServerMessage,
  toWebSocketUrl,
  type AgentToServer,
  type ServerToAgent,
  type StreamTarget,
} from "./protocol";

/**
 * Agente local: mantiene un canal de control con el servidor y ejecuta sus
 * órdenes (instalar Chromium y Appium, abrir y cerrar navegadores, arrancar emuladores). No decide nada por
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
  /** Android Studio del PC; las pruebas lo sustituyen. */
  android?: {
    probe(): Promise<AndroidStatus>;
    start(avd: string, onProgress: (phase: "launched" | "booting") => void): Promise<{ serial: string; avd: string }>;
    stop(serial: string): Promise<void>;
  };
  /** Dónde escuchan adb y Appium en este PC; las pruebas lo sustituyen. */
  localTargets?: Partial<Record<StreamTarget, LocalTarget>>;
  /** node.exe con el que se arranca Appium y su puerto; las pruebas los sustituyen. */
  appiumNodePath?: string;
  appiumPort?: number;
};

/** adb escucha en 5037 (o ANDROID_ADB_SERVER_PORT); Appium, en QALAB_APPIUM_PORT o 4723. */
function defaultLocalTargets(): Record<StreamTarget, LocalTarget> {
  const adbPort = Number(process.env.ANDROID_ADB_SERVER_PORT) || 5037;
  return {
    adb: {
      port: adbPort,
      // Si el servidor de adb no está arrancado, lo arranca y reintenta una vez.
      start: async () => {
        const sdk = resolveSdk();
        if (!sdk) throw new Error("No se encontró el SDK de Android (Android Studio)");
        await runCommand(sdk.adbPath, ["start-server"], 20_000);
      },
    },
    appium: { port: Number(process.env.QALAB_APPIUM_PORT) || 4723 },
  };
}

const defaultAndroid: NonNullable<LocalAgentOptions["android"]> = {
  probe: () => probeAndroid(),
  start: (avd, onProgress) => startEmulator(avd, { onProgress }),
  stop: (serial) => stopEmulator(serial),
};

export class LocalAgent {
  private socket?: WebSocket;
  private stopped = false;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer?: NodeJS.Timeout;
  private heartbeat?: NodeJS.Timeout;
  private readonly sessions = new Map<string, BrowserSession>();
  private readonly installer: ChromiumInstaller;
  private readonly appiumInstaller: AppiumInstaller;
  private appiumServer?: AppiumServer;
  /** La versión que reparte el servidor (welcome); sin ella, la más reciente instalada. */
  private requiredAppium?: string;
  private readonly log: (line: string) => void;
  private connectedOnce?: () => void;
  private readonly android: NonNullable<LocalAgentOptions["android"]>;
  private readonly localTargets: Record<StreamTarget, LocalTarget>;
  readonly connected: Promise<void>;

  constructor(private readonly options: LocalAgentOptions) {
    this.log = options.log ?? ((line) => console.log(line));
    this.android = options.android ?? defaultAndroid;
    const defaults = defaultLocalTargets();
    // Nada escucha en el puerto de Appium: el agente arranca el suyo y la conexión se reintenta.
    const appiumPort = options.appiumPort ?? defaults.appium.port;
    const appium: LocalTarget = { port: appiumPort, start: () => this.startAppium(appiumPort) };
    this.localTargets = { ...defaults, appium, ...options.localTargets };
    this.installer = new ChromiumInstaller(options.config.browsersDir, options.config.serverUrl, this.authHeaders());
    this.appiumInstaller = new AppiumInstaller(path.join(options.config.rootDir, "appium"), options.config.serverUrl, this.authHeaders());
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
    await this.appiumServer?.stop();
    this.socket?.close();
  }

  /** Arranca el Appium instalado por el agente en `port` (una vez; luego lo reutiliza). */
  private async startAppium(port: number): Promise<void> {
    const installed = this.appiumInstaller.installedVersions();
    const version = this.requiredAppium && installed.includes(this.requiredAppium) ? this.requiredAppium : installed.sort().at(-1);
    const mainScript = version ? this.appiumInstaller.mainScript(version) : undefined;
    if (!version || !mainScript) throw new Error("Appium aún no está instalado en tu equipo");
    const home = this.appiumInstaller.dirFor(version);
    if (!this.appiumServer || this.appiumServer.home !== home) {
      await this.appiumServer?.stop();
      this.appiumServer = new AppiumServer({
        home,
        mainScript,
        port,
        sdkPath: resolveSdk()?.sdkPath,
        logFile: path.join(this.options.config.logsDir, "appium.log"),
        nodePath: this.options.appiumNodePath,
        log: this.log,
      });
    }
    await this.appiumServer.start();
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
      this.sendHello();
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

  private sendHello(): void {
    void this.hello().then(
      (msg) => this.send(msg),
      (err) => this.log(`[agente] no se pudo armar el estado: ${err?.message ?? err}`),
    );
  }

  private async hello(): Promise<AgentToServer> {
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
      appium: { installed: this.appiumInstaller.installedVersions() },
      android: await this.android.probe().catch((err) => ({
        sdkFound: false,
        emulatorFound: false,
        avds: [],
        devices: [],
        error: `No se pudo revisar Android Studio: ${err instanceof Error ? err.message : String(err)}`,
        checkedAt: new Date().toISOString(),
      })),
    };
  }

  private async handle(msg: ServerToAgent): Promise<void> {
    switch (msg.t) {
      case "welcome":
        if (msg.requiredRevision && this.sessions.size === 0) {
          const removed = this.installer.pruneExcept(msg.requiredRevision);
          if (removed.length > 0) this.log(`[agente] revisiones antiguas borradas: ${removed.join(", ")}`);
        }
        if (msg.requiredAppium) {
          this.requiredAppium = msg.requiredAppium;
          if (!this.appiumServer?.running && this.appiumInstaller.mainScript(msg.requiredAppium)) {
            const removed = this.appiumInstaller.pruneExcept(msg.requiredAppium);
            if (removed.length > 0) this.log(`[agente] versiones antiguas de Appium borradas: ${removed.join(", ")}`);
          }
        }
        return;

      case "status_request":
        this.sendHello();
        return;

      case "start_emulator": {
        this.log(`[agente] arrancando el emulador ${msg.avd}`);
        try {
          const ready = await this.android.start(msg.avd, (phase) =>
            this.send({ t: "emulator_progress", requestId: msg.requestId, avd: msg.avd, phase }),
          );
          this.log(`[agente] emulador ${msg.avd} listo (${ready.serial})`);
          this.send({ t: "emulator_ready", requestId: msg.requestId, avd: msg.avd, serial: ready.serial });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`[agente] falló el emulador ${msg.avd}: ${message}`);
          this.send({ t: "emulator_error", requestId: msg.requestId, avd: msg.avd, message });
        }
        this.sendHello();
        return;
      }

      case "stop_emulator":
        try {
          await this.android.stop(msg.serial);
        } catch (err) {
          this.log(`[agente] no se pudo apagar ${msg.serial}: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.sendHello();
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

      case "install_appium": {
        this.log(`[agente] instalando Appium ${msg.version}`);
        try {
          await this.appiumInstaller.install(msg, (p) =>
            this.send({ t: "appium_install_progress", requestId: msg.requestId, version: msg.version, ...p }),
          );
          this.log(`[agente] Appium ${msg.version} instalado`);
          this.send({ t: "appium_install_done", requestId: msg.requestId, version: msg.version });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`[agente] falló la instalación de Appium ${msg.version}: ${message}`);
          this.send({ t: "appium_install_error", requestId: msg.requestId, version: msg.version, message });
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

      case "open_stream": {
        const local = this.localTargets[msg.target];
        if (!local) {
          this.send({ t: "stream_error", streamId: msg.streamId, message: `servicio desconocido: ${String(msg.target)}` });
          return;
        }
        try {
          await openTcpStream({
            local,
            dataChannelUrl: toWebSocketUrl(this.options.config.serverUrl, AGENT_STREAM_PATH, { stream: msg.streamId, token: msg.dataToken }),
            headers: this.authHeaders(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log(`[agente] no se pudo abrir la conexión a ${msg.target}: ${message}`);
          this.send({ t: "stream_error", streamId: msg.streamId, message });
        }
        return;
      }

      case "close_browser":
        await this.sessions.get(msg.sessionId)?.close("server_closed");
        return;
    }
  }
}
