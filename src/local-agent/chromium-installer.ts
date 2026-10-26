import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import type { ChromiumStatus } from "./protocol";

/**
 * Instala Chromium en %LOCALAPPDATA%\QALab\agente\navegadores\chromium-<rev>.
 *
 * El zip lo sirve el propio servidor de QA Lab (los PCs y el servidor pueden no
 * tener internet). Es el contenido de ms-playwright\chromium-<rev> del servidor,
 * la misma revisión que usa su Playwright.
 *
 * Una instalación solo cuenta cuando existe el marcador `.qalab-instalado`, que
 * se escribe al final: un corte de red o de luz a mitad deja una carpeta
 * temporal que el siguiente intento descarta.
 */

const MARKER = ".qalab-instalado";

export type InstallRequest = {
  revision: string;
  /** Absoluta o relativa a serverUrl. */
  url: string;
  sha256?: string;
  sizeBytes?: number;
};

export type InstallProgress = {
  phase: "download" | "extract";
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
};

export class ChromiumInstaller {
  private readonly inFlight = new Map<string, Promise<ChromiumStatus>>();

  constructor(
    private readonly browsersDir: string,
    private readonly serverUrl: string,
    private readonly headers: Record<string, string> = {},
    private readonly tarPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"),
  ) {}

  dirFor(revision: string): string {
    if (!/^\d+$/.test(revision)) throw new Error(`revisión de Chromium inválida: ${revision}`);
    return path.join(this.browsersDir, `chromium-${revision}`);
  }

  status(revision: string): ChromiumStatus {
    const dir = this.dirFor(revision);
    if (!fs.existsSync(path.join(dir, MARKER))) return { revision, installed: false };
    const executablePath = findChromeExe(dir);
    return executablePath ? { revision, installed: true, executablePath } : { revision, installed: false };
  }

  installedRevisions(): ChromiumStatus[] {
    if (!fs.existsSync(this.browsersDir)) return [];
    return fs
      .readdirSync(this.browsersDir)
      .map((name) => /^chromium-(\d+)$/.exec(name)?.[1])
      .filter((rev): rev is string => Boolean(rev))
      .map((rev) => this.status(rev))
      .filter((s) => s.installed);
  }

  /** Idempotente: si ya está instalada no descarga; si ya se está instalando, comparte el intento. */
  install(request: InstallRequest, onProgress: (p: InstallProgress) => void = () => undefined): Promise<ChromiumStatus> {
    const current = this.status(request.revision);
    if (current.installed) return Promise.resolve(current);
    const pending = this.inFlight.get(request.revision);
    if (pending) return pending;
    const attempt = this.doInstall(request, onProgress).finally(() => this.inFlight.delete(request.revision));
    this.inFlight.set(request.revision, attempt);
    return attempt;
  }

  /** Borra revisiones que ya no se usan. Nunca la indicada ni una que no termine de borrarse (en uso). */
  pruneExcept(keepRevision: string): string[] {
    const removed: string[] = [];
    if (!fs.existsSync(this.browsersDir)) return removed;
    for (const name of fs.readdirSync(this.browsersDir)) {
      if (name === `chromium-${keepRevision}`) continue;
      if (!/^chromium-\d+(\.tmp|\.zip\.part)?$/.test(name)) continue;
      try {
        fs.rmSync(path.join(this.browsersDir, name), { recursive: true, force: true });
        removed.push(name);
      } catch {
        // Un Chromium de esa revisión sigue abierto; se intenta en la próxima.
      }
    }
    return removed;
  }

  private async doInstall(request: InstallRequest, onProgress: (p: InstallProgress) => void): Promise<ChromiumStatus> {
    const finalDir = this.dirFor(request.revision);
    const tmpDir = `${finalDir}.tmp`;
    const zipPath = `${finalDir}.zip.part`;
    fs.mkdirSync(this.browsersDir, { recursive: true });
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(zipPath, { force: true });

    try {
      await this.download(request, zipPath, onProgress);

      onProgress({ phase: "extract", receivedBytes: 0 });
      fs.mkdirSync(tmpDir, { recursive: true });
      await run(this.tarPath, ["-xf", zipPath, "-C", tmpDir]);
      if (!findChromeExe(tmpDir)) throw new Error("el paquete descargado no contiene chrome.exe");
      fs.writeFileSync(path.join(tmpDir, MARKER), JSON.stringify({ revision: request.revision, installedAt: new Date().toISOString() }));

      fs.rmSync(finalDir, { recursive: true, force: true });
      fs.renameSync(tmpDir, finalDir);
      const status = this.status(request.revision);
      if (!status.installed) throw new Error("Chromium no quedó instalado tras descomprimir");
      return status;
    } catch (err) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      throw err;
    } finally {
      fs.rmSync(zipPath, { force: true });
    }
  }

  private async download(request: InstallRequest, zipPath: string, onProgress: (p: InstallProgress) => void): Promise<void> {
    const url = new URL(request.url, `${this.serverUrl}/`).toString();
    const response = await fetch(url, { headers: this.headers });
    if (!response.ok || !response.body) throw new Error(`descarga de Chromium falló: HTTP ${response.status}`);

    const totalBytes = Number(response.headers.get("content-length")) || request.sizeBytes || undefined;
    const hash = createHash("sha256");
    const out = fs.createWriteStream(zipPath);
    let receivedBytes = 0;
    let lastPercent = -1;
    let lastReport = 0;

    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        receivedBytes += chunk.length;
        if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
        const percent = totalBytes ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : undefined;
        const now = Date.now();
        if ((percent !== undefined && percent !== lastPercent) || now - lastReport > 500) {
          lastPercent = percent ?? lastPercent;
          lastReport = now;
          onProgress({ phase: "download", receivedBytes, totalBytes, percent });
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    }

    if (totalBytes && receivedBytes !== totalBytes) {
      throw new Error(`descarga incompleta: ${receivedBytes} de ${totalBytes} bytes`);
    }
    if (request.sha256) {
      const actual = hash.digest("hex");
      if (actual.toLowerCase() !== request.sha256.toLowerCase()) {
        throw new Error("la descarga de Chromium no coincide con su sha256");
      }
    }
  }
}

/** chrome.exe en la raíz o un nivel por debajo (chrome-win64\ o chrome-win\). */
export function findChromeExe(dir: string): string | undefined {
  const direct = path.join(dir, "chrome.exe");
  if (fs.existsSync(direct)) return direct;
  if (!fs.existsSync(dir)) return undefined;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(dir, entry.name, "chrome.exe");
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function run(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} falló: ${String(stderr || err.message).trim().slice(0, 500)}`));
      else resolve();
    });
  });
}
