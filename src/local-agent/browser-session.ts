import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import WebSocket from "ws";

/**
 * Un Chromium con ventana en el PC del usuario, unido al servidor.
 *
 *  servidor (connectOverCDP) ⇄ canal de datos (saliente) ⇄ agente ⇄ CDP local de Chromium
 *
 * Seguridad local: depuración solo en 127.0.0.1, puerto aleatorio y perfil
 * temporal que se borra al cerrar; no se toca el perfil ni las contraseñas del
 * Chrome/Edge del usuario.
 *
 * `--no-startup-window`: el usuario solo ve la ventana que crea la grabación.
 * Con ese modo Chromium no termina al cerrar su última ventana, así que una
 * segunda conexión CDP local vigila las pestañas: si el usuario cierra la última,
 * la sesión termina como "user_closed".
 */

export type BrowserCloseReason = "user_closed" | "server_closed" | "data_channel_lost" | "crashed";

export type BrowserSessionOptions = {
  sessionId: string;
  executablePath: string;
  /** ws(s)://servidor/api/local-agent/cdp?... ya con sesión y token. */
  dataChannelUrl: string;
  headers?: Record<string, string>;
  log?: (line: string) => void;
  /** Para pruebas: tiempo máximo esperando DevToolsActivePort. */
  startTimeoutMs?: number;
};

const MAX_PAYLOAD = 256 * 1024 * 1024;

/**
 * Mismos switches que pone `chromium.launch` de Playwright en modo con ventana
 * (sin --enable-automation, que mostraría la barra de "controlado por software").
 * El grabador está ajustado a ese comportamiento: sin ellos Chromium frena
 * temporizadores y render de una ventana tapada o sin foco, y la foto de la
 * pantalla tras una navegación llega tarde (la fase 1 lo midió: 1 pantalla en
 * vez de 2). Sin back/forward cache, volver atrás recarga la página y los
 * scripts de captura se reinstalan como con Playwright.
 */
export const CHROMIUM_ARGS = [
  "--remote-debugging-port=0",
  "--remote-debugging-address=127.0.0.1",
  "--no-startup-window",
  "--disable-field-trial-config",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-back-forward-cache",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-component-extensions-with-background-pages",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  // Lista exacta de Playwright 1.60 (chromiumSwitches/disabledFeatures). Ojo a
  // BoundaryEventDispatchTracksNodeRemoval: cambia los eventos de puntero que escucha la captura.
  "--disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,BoundaryEventDispatchTracksNodeRemoval,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,Translate,AutoDeElevate,RenderDocument,OptimizationHints",
  "--allow-pre-commit-input",
  "--disable-hang-monitor",
  "--disable-ipc-flooding-protection",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-sync",
  "--metrics-recording-only",
  "--no-first-run",
  "--no-default-browser-check",
  "--no-service-autorun",
  "--password-store=basic",
  "--disable-search-engine-choice-screen",
];

export class BrowserSession {
  private chrome?: ChildProcess;
  private profileDir?: string;
  private data?: WebSocket;
  private cdp?: WebSocket;
  private watcher?: WebSocket;
  private closing?: Promise<void>;
  private closeReason?: BrowserCloseReason;
  private readonly closedListeners: Array<(reason: BrowserCloseReason) => void> = [];

  constructor(private readonly options: BrowserSessionOptions) {}

  get sessionId(): string {
    return this.options.sessionId;
  }

  onClosed(listener: (reason: BrowserCloseReason) => void): void {
    this.closedListeners.push(listener);
  }

  async open(): Promise<void> {
    const log = this.options.log ?? (() => undefined);
    this.profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-agente-perfil-"));
    const chrome = spawn(this.options.executablePath, [...CHROMIUM_ARGS, `--user-data-dir=${this.profileDir}`], {
      stdio: "ignore",
      windowsHide: false,
    });
    this.chrome = chrome;
    let exited = false;
    chrome.on("exit", (code) => {
      exited = true;
      log(`[navegador ${this.sessionId}] Chromium terminó (código ${code})`);
      void this.close(code === 0 || code === null ? "user_closed" : "crashed");
    });

    try {
      const { port, browserPath } = await waitForDevToolsPort(this.profileDir, this.options.startTimeoutMs ?? 30000, () => exited);
      const localCdpUrl = `ws://127.0.0.1:${port}${browserPath}`;

      this.cdp = await openSocket(localCdpUrl);
      this.data = await openSocket(this.options.dataChannelUrl, this.options.headers);
      this.pipe(this.data, this.cdp);
      this.watcher = await openSocket(localCdpUrl);
      this.watchTabs(this.watcher);
      log(`[navegador ${this.sessionId}] Chromium listo y conectado al servidor`);
    } catch (err) {
      await this.close("crashed");
      throw err;
    }
  }

  close(reason: BrowserCloseReason): Promise<void> {
    if (this.closing) return this.closing;
    this.closeReason = reason;
    this.closing = (async () => {
      for (const socket of [this.watcher, this.data, this.cdp]) {
        try { socket?.close(); } catch { /* ya cerrado */ }
      }
      await killTree(this.chrome);
      if (this.profileDir) {
        fs.rmSync(this.profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      }
      for (const listener of this.closedListeners) listener(reason);
    })();
    return this.closing;
  }

  get closedReason(): BrowserCloseReason | undefined {
    return this.closeReason;
  }

  /** Tubería transparente: los mensajes CDP no se interpretan ni se modifican. */
  private pipe(data: WebSocket, cdp: WebSocket): void {
    data.on("message", (msg, isBinary) => {
      if (cdp.readyState === WebSocket.OPEN) cdp.send(msg, { binary: isBinary });
    });
    cdp.on("message", (msg, isBinary) => {
      if (data.readyState === WebSocket.OPEN) data.send(msg, { binary: isBinary });
    });
    data.on("close", () => void this.close("data_channel_lost"));
    cdp.on("close", () => void this.close("crashed"));
  }

  private watchTabs(watcher: WebSocket): void {
    const pages = new Set<string>();
    let sawPage = false;
    watcher.on("message", (raw) => {
      let msg: { method?: string; params?: { targetInfo?: { targetId: string; type: string }; targetId?: string } };
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.method === "Target.targetCreated" && msg.params?.targetInfo?.type === "page") {
        pages.add(msg.params.targetInfo.targetId);
        sawPage = true;
      } else if (msg.method === "Target.targetDestroyed" && msg.params?.targetId) {
        pages.delete(msg.params.targetId);
        // Solo cuenta como cierre del usuario si llegó a haber una pestaña: al
        // arrancar no hay ninguna hasta que el servidor crea la de la grabación.
        if (sawPage && pages.size === 0) void this.close("user_closed");
      }
    });
    watcher.send(JSON.stringify({ id: 1, method: "Target.setDiscoverTargets", params: { discover: true } }));
  }
}

async function waitForDevToolsPort(profileDir: string, timeoutMs: number, hasExited: () => boolean): Promise<{ port: string; browserPath: string }> {
  const file = path.join(profileDir, "DevToolsActivePort");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (hasExited()) throw new Error("Chromium terminó al arrancar");
    if (fs.existsSync(file)) {
      const [port, browserPath] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
      if (port && browserPath) return { port, browserPath };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Chromium no abrió la depuración en ${Math.round(timeoutMs / 1000)} s`);
}

function openSocket(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers, perMessageDeflate: false, maxPayload: MAX_PAYLOAD, handshakeTimeout: 15000 });
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
    socket.once("unexpected-response", (_req, res) => reject(new Error(`el servidor rechazó la conexión: HTTP ${res.statusCode}`)));
  });
}

/** Chromium abre varios procesos hijos; se cierra el árbol completo. */
function killTree(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    } else {
      child.kill("SIGKILL");
      resolve();
    }
  });
}
