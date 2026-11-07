import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { downloadVerified, run, type InstallProgress } from "./chromium-installer";

/**
 * Appium en el PC del usuario, sin que tenga que instalar Node ni Appium.
 *
 * El zip lo sirve el servidor de QA Lab: el mismo Appium y driver UiAutomator2 que usa
 * el motor. Se descomprime en %LOCALAPPDATA%\QALab\agente\appium\appium-<versión> y se
 * ejecuta con el node.exe del propio agente. Igual que Chromium, solo cuenta como
 * instalado cuando existe el marcador final.
 *
 * Appium se arranca la primera vez que el motor abre el túnel y nada escucha en su puerto;
 * si el usuario ya tiene su propio Appium abierto en ese puerto, se usa el suyo.
 */

const MARKER = ".qalab-instalado";
const VERSION = /^[0-9A-Za-z.+-]{1,64}$/;
const READY_TIMEOUT_MS = 240_000; // arranque en frío (tras reiniciar el PC) tarda > 75 s por antivirus + ~15k archivos
const LOG_TAIL_CHARS = 2000;

export type AppiumInstallRequest = { version: string; url: string; sha256?: string; sizeBytes?: number };

export class AppiumInstaller {
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly baseDir: string,
    private readonly serverUrl: string,
    private readonly headers: Record<string, string> = {},
    private readonly tarPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
  ) {}

  dirFor(version: string): string {
    if (!VERSION.test(version)) throw new Error(`versión de Appium inválida: ${version}`);
    return path.join(this.baseDir, `appium-${version}`);
  }

  /** Script de Appium de esa versión, si está instalada. */
  mainScript(version: string): string | undefined {
    const dir = this.dirFor(version);
    const main = path.join(dir, "node_modules", "appium", "index.js");
    return fs.existsSync(path.join(dir, MARKER)) && fs.existsSync(main) ? main : undefined;
  }

  installedVersions(): string[] {
    if (!fs.existsSync(this.baseDir)) return [];
    return fs
      .readdirSync(this.baseDir)
      .map((name) => /^appium-(.+)$/.exec(name)?.[1])
      .filter((v): v is string => Boolean(v && VERSION.test(v) && !v.endsWith(".tmp") && this.mainScript(v)));
  }

  /** Idempotente: si ya está no descarga; si se está instalando, comparte el intento. Devuelve la carpeta. */
  install(request: AppiumInstallRequest, onProgress: (p: InstallProgress) => void = () => undefined): Promise<string> {
    if (this.mainScript(request.version)) return Promise.resolve(this.dirFor(request.version));
    const pending = this.inFlight.get(request.version);
    if (pending) return pending;
    const attempt = this.doInstall(request, onProgress).finally(() => this.inFlight.delete(request.version));
    this.inFlight.set(request.version, attempt);
    return attempt;
  }

  /** Borra versiones que ya no se usan. Nunca la indicada ni una en uso (no se deja borrar). */
  pruneExcept(keepVersion: string): string[] {
    const removed: string[] = [];
    if (!fs.existsSync(this.baseDir)) return removed;
    for (const name of fs.readdirSync(this.baseDir)) {
      if (name === `appium-${keepVersion}` || !name.startsWith("appium-")) continue;
      try {
        fs.rmSync(path.join(this.baseDir, name), { recursive: true, force: true });
        removed.push(name);
      } catch {
        // Un Appium de esa versión sigue abierto; se intenta en la próxima.
      }
    }
    return removed;
  }

  private async doInstall(request: AppiumInstallRequest, onProgress: (p: InstallProgress) => void): Promise<string> {
    const finalDir = this.dirFor(request.version);
    const tmpDir = `${finalDir}.tmp`;
    const zipPath = `${finalDir}.zip.part`;
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });
    try {
      await downloadVerified({ ...request, label: "Appium", serverUrl: this.serverUrl, headers: this.headers, dest: zipPath, onProgress });
      onProgress({ phase: "extract", receivedBytes: 0 });
      fs.mkdirSync(tmpDir, { recursive: true });
      await run(this.tarPath, ["-xf", zipPath, "-C", tmpDir]);
      if (!fs.existsSync(path.join(tmpDir, "node_modules", "appium", "index.js"))) {
        throw new Error("el paquete descargado no contiene Appium");
      }
      fs.writeFileSync(path.join(tmpDir, MARKER), JSON.stringify({ version: request.version, installedAt: new Date().toISOString() }));
      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(tmpDir, finalDir);
      return finalDir;
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  }
}

/** JDK de Android Studio cuando el PC no tiene JAVA_HOME (UiAutomator2 lo usa para firmar). */
export function androidStudioJbr(exists: (p: string) => boolean = fs.existsSync): string | undefined {
  const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs")].filter(Boolean) as string[];
  for (const root of roots) {
    for (const jbr of [path.join(root, "Android", "Android Studio", "jbr"), path.join(root, "Android Studio", "jbr")]) {
      if (exists(path.join(jbr, "bin", "java.exe"))) return jbr;
    }
  }
  return undefined;
}

export type AppiumServerOptions = {
  /** Carpeta de la versión instalada (APPIUM_HOME). */
  home: string;
  mainScript: string;
  port: number;
  sdkPath?: string;
  logFile: string;
  /** node.exe del agente; las pruebas lo sustituyen. */
  nodePath?: string;
  readyTimeoutMs?: number;
  log?: (line: string) => void;
};

/** Un Appium arrancado por el agente, escuchando solo en 127.0.0.1. */
export class AppiumServer {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private tail = "";

  constructor(private readonly options: AppiumServerOptions) {}

  get home(): string {
    return this.options.home;
  }

  get running(): boolean {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  /** Arranca (una vez aunque lo pidan varias conexiones a la vez) y espera a /status listo. */
  start(): Promise<void> {
    if (this.running && !this.starting) return Promise.resolve();
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Termina el proceso; se cumple cuando ya salió (Windows no deja borrar su carpeta antes). */
  stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child || child.exitCode !== null) return Promise.resolve();
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    return exited;
  }

  private async doStart(): Promise<void> {
    const { home, mainScript, port, sdkPath, logFile } = this.options;
    const env: NodeJS.ProcessEnv = { ...process.env, APPIUM_HOME: home };
    if (sdkPath) {
      env.ANDROID_HOME = sdkPath;
      env.ANDROID_SDK_ROOT = sdkPath;
    }
    if (!env.JAVA_HOME) {
      const jbr = androidStudioJbr();
      if (jbr) env.JAVA_HOME = jbr;
    }
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const out = fs.openSync(logFile, "a");
    this.tail = "";
    this.options.log?.(`[agente] arrancando Appium en 127.0.0.1:${port}`);
    const child = spawn(
      this.options.nodePath ?? process.execPath,
      [mainScript, "server", "--address", "127.0.0.1", "--port", String(port), "--log-no-colors", "--log-timestamp"],
      { cwd: home, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child = child;
    const keep = (chunk: Buffer) => {
      fs.writeSync(out, chunk);
      this.tail = (this.tail + chunk.toString("utf8")).slice(-LOG_TAIL_CHARS);
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.once("exit", () => {
      try { fs.closeSync(out); } catch { /* ya cerrado */ }
      if (this.child === child) this.child = undefined;
    });

    const deadline = Date.now() + (this.options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Appium terminó al arrancar (código ${child.exitCode}): ${this.tail.trim().slice(-400) || "sin salida"}`);
      }
      if (await statusReady(port)) {
        this.options.log?.(`[agente] Appium listo en 127.0.0.1:${port}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await this.stop();
    throw new Error(`Appium no respondió en ${Math.round((this.options.readyTimeoutMs ?? READY_TIMEOUT_MS) / 1000)} s`);
  }
}

async function statusReady(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { value?: { ready?: boolean } };
    return body.value?.ready !== false;
  } catch {
    return false;
  }
}
