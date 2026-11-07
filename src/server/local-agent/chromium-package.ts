import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);

/**
 * El Chromium que se instala en los PCs de los usuarios.
 *
 * Es el MISMO que usa el motor (la revisión que pide la versión de Playwright
 * instalada), así el grabador ve en el PC el mismo navegador con el que se
 * ajustó. El servidor no tiene internet: el zip se arma una vez desde la carpeta
 * de Playwright del propio servidor y se guarda en la carpeta de descargas. Si
 * el pase ya trae `chromium-<rev>.zip` en esa carpeta, se usa tal cual.
 */

export type ChromiumPackageInfo = {
  revision: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

export type ChromiumPackageSource = {
  /** Revisión que necesita el motor (p. ej. "1223"). */
  revision: string;
  /** Carpeta ms-playwright\chromium-<rev> que contiene chrome-win64\chrome.exe. */
  revisionDir: string;
  /** Subcarpeta con chrome.exe: chrome-win64 (por defecto) o chrome-win (revisiones antiguas). */
  chromeFolder?: string;
};

export const DOWNLOADS_URL_PREFIX = "/descargas";

export function defaultDownloadsDir(): string {
  const configured = process.env.LOCAL_AGENT_DOWNLOADS_DIR?.trim();
  return configured ? path.resolve(process.cwd(), configured) : path.resolve(process.cwd(), "data", "descargas");
}

/** Lee la revisión de la ruta de chrome.exe que resuelve Playwright: ...\chromium-1223\chrome-win64\chrome.exe */
export function resolveChromiumSource(executablePath: string = chromium.executablePath()): ChromiumPackageSource | undefined {
  const revisionDir = path.dirname(path.dirname(executablePath));
  const match = /^chromium-(\d+)$/.exec(path.basename(revisionDir));
  if (!match) return undefined;
  return { revision: match[1], revisionDir };
}

/**
 * `LOCAL_AGENT_CHROMIUM_DIR` fija la carpeta chromium-<rev> que se reparte, en lugar de la
 * que pide Playwright: sirve para entregar una revisión que ya está en el servidor cuando
 * la exigida no se puede descargar (servidor sin internet).
 */
export function configuredChromiumSource(dir: string | undefined = process.env.LOCAL_AGENT_CHROMIUM_DIR?.trim()): ChromiumPackageSource | undefined {
  if (!dir) return undefined;
  const revisionDir = path.resolve(dir);
  const match = /^chromium-(\d+)$/.exec(path.basename(revisionDir));
  if (!match) return undefined;
  const chromeFolder = ["chrome-win64", "chrome-win"].find((folder) => fs.existsSync(path.join(revisionDir, folder, "chrome.exe")));
  return chromeFolder ? { revision: match[1], revisionDir, chromeFolder } : undefined;
}

export class ChromiumPackage {
  private building?: Promise<ChromiumPackageInfo>;
  private cached?: ChromiumPackageInfo;

  constructor(
    private readonly downloadsDir: string = defaultDownloadsDir(),
    private readonly sourceResolver: () => ChromiumPackageSource | undefined = () => configuredChromiumSource() ?? resolveChromiumSource(),
  ) {}

  get dir(): string {
    return this.downloadsDir;
  }

  /** Revisión exigida a los agentes, o undefined si el motor no encuentra su Chromium. */
  requiredRevision(): string | undefined {
    return this.sourceResolver()?.revision;
  }

  /** Ya listo para descargar, sin esperar a armarlo. */
  readyInfo(): ChromiumPackageInfo | undefined {
    const source = this.sourceResolver();
    if (!source) return undefined;
    if (this.cached?.revision === source.revision && fs.existsSync(this.zipPath(source.revision))) return this.cached;
    return undefined;
  }

  zipPath(revision: string): string {
    return path.join(this.downloadsDir, `chromium-${revision}.zip`);
  }

  /** Arma (una sola vez aunque lo pidan varios) y devuelve el zip de la revisión exigida. */
  ensure(log: (line: string) => void = (line) => console.log(line)): Promise<ChromiumPackageInfo> {
    const ready = this.readyInfo();
    if (ready) return Promise.resolve(ready);
    if (this.building) return this.building;
    this.building = this.build(log).then(
      (info) => {
        this.cached = info;
        this.building = undefined;
        return info;
      },
      (err) => {
        this.building = undefined;
        throw err;
      },
    );
    return this.building;
  }

  private async build(log: (line: string) => void): Promise<ChromiumPackageInfo> {
    const source = this.sourceResolver();
    if (!source) throw new Error("El servidor no encuentra el Chromium de Playwright para entregar a los agentes");
    const zip = this.zipPath(source.revision);
    const shaFile = `${zip}.sha256`;
    fs.mkdirSync(this.downloadsDir, { recursive: true });

    if (!fs.existsSync(zip)) {
      const chromeFolder = source.chromeFolder ?? "chrome-win64";
      const chromeDir = path.join(source.revisionDir, chromeFolder);
      if (!fs.existsSync(path.join(chromeDir, "chrome.exe"))) {
        throw new Error(`No existe ${path.join(chromeDir, "chrome.exe")}: falta instalar Chromium ${source.revision} en el servidor`);
      }
      // tar.exe de Windows con --format zip comprime; el nombre temporal acaba en
      // .zip porque el formato no debe depender de la extensión.
      const tmp = path.join(this.downloadsDir, `chromium-${source.revision}.tmp.zip`);
      fs.rmSync(tmp, { force: true });
      const started = Date.now();
      log(`[agente-local] armando chromium-${source.revision}.zip desde ${source.revisionDir}`);
      const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      await execFileAsync(tar, ["--format", "zip", "-c", "-f", tmp, "-C", source.revisionDir, chromeFolder], {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      fs.rmSync(shaFile, { force: true });
      fs.renameSync(tmp, zip);
      log(`[agente-local] chromium-${source.revision}.zip listo en ${Math.round((Date.now() - started) / 1000)} s`);
    }

    const sizeBytes = fs.statSync(zip).size;
    let sha256 = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0] : "";
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      sha256 = await hashFile(zip);
      fs.writeFileSync(shaFile, `${sha256}  chromium-${source.revision}.zip\n`);
    }
    const fileName = path.basename(zip);
    return { revision: source.revision, fileName, url: `${DOWNLOADS_URL_PREFIX}/${fileName}`, sha256: sha256.toLowerCase(), sizeBytes };
  }
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    fs.createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}
