import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DOWNLOADS_URL_PREFIX, defaultDownloadsDir, hashFile } from "./chromium-package";

const execFileAsync = promisify(execFile);

/**
 * El Appium que el agente arranca en los PCs de los usuarios.
 *
 * Es el MISMO Appium y driver UiAutomator2 que tiene instalados el motor (sus
 * dependencias npm), así las sesiones del PC se comportan como las del servidor.
 * El servidor no tiene internet: el zip se arma una vez con esos paquetes y todas
 * sus dependencias (sin los binarios de otros sistemas) y se guarda en la carpeta
 * de descargas. Dentro lleva un package.json que declara Appium y el driver: con
 * APPIUM_HOME en esa carpeta, Appium encuentra el driver sin `appium driver install`.
 * El agente lo ejecuta con su propio node.exe, sin instalar Node en el PC.
 */

export const APPIUM_PACKAGES = ["appium", "appium-uiautomator2-driver"] as const;

/**
 * Lo que Node nunca carga al ejecutar (mapas de fuentes y TypeScript): un tercio de los
 * ~15 000 archivos. Armar y descomprimir cuesta por archivo, no por tamaño.
 */
const RUNTIME_EXCLUDES = ["--exclude=*.map", "--exclude=*.ts", "--exclude=*.mts", "--exclude=*.cts"];

export type AppiumPackageInfo = {
  version: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
};

export type AppiumPackageSource = {
  /** "<appium>-uia2-<driver>", p. ej. "3.5.0-uia2-8.4.0". */
  version: string;
  /** Carpeta con node_modules/appium y node_modules/appium-uiautomator2-driver. */
  rootDir: string;
  dependencies: Record<string, string>;
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
};

function readPackageJson(dir: string): PackageJson | undefined {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageJson;
  } catch {
    return undefined;
  }
}

export function resolveAppiumSource(rootDir: string = process.cwd()): AppiumPackageSource | undefined {
  const dependencies: Record<string, string> = {};
  for (const name of APPIUM_PACKAGES) {
    const version = readPackageJson(path.join(rootDir, "node_modules", name))?.version;
    if (!version) return undefined;
    dependencies[name] = version;
  }
  const version = `${dependencies.appium}-uia2-${dependencies["appium-uiautomator2-driver"]}`;
  if (!/^[0-9A-Za-z.+-]{1,64}$/.test(version)) return undefined;
  return { version, rootDir, dependencies };
}

/** Un paquete que declara `os`/`cpu` y no incluye Windows x64 no sirve en los PCs. */
function runsOnWindowsX64(pkg: PackageJson): boolean {
  const allowed = (list: string[] | undefined, value: string) => {
    if (!list || list.length === 0) return true;
    if (list.includes(`!${value}`)) return false;
    const positive = list.filter((v) => !v.startsWith("!"));
    return positive.length === 0 || positive.includes(value);
  };
  return allowed(pkg.os, "win32") && allowed(pkg.cpu, "x64");
}

/**
 * Carpetas (relativas a rootDir, con /) de Appium, el driver y todas sus dependencias,
 * resueltas como lo hace Node. Solo las de nivel más alto: tar recorre cada una entera.
 */
export function appiumClosure(rootDir: string, roots: readonly string[] = APPIUM_PACKAGES): string[] {
  const seen = new Set<string>();
  const findPackage = (name: string, fromDir: string): string | undefined => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const candidate = path.join(dir, "node_modules", name);
      if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
      if (path.dirname(dir) === dir || path.relative(rootDir, dir).startsWith("..")) return undefined;
    }
  };
  const walk = (dir: string) => {
    const real = fs.realpathSync(dir);
    if (seen.has(real)) return;
    const pkg = readPackageJson(dir);
    if (!pkg || !runsOnWindowsX64(pkg)) return;
    seen.add(real);
    const optional = pkg.optionalDependencies ?? {};
    for (const name of Object.keys({ ...pkg.dependencies, ...optional })) {
      const found = findPackage(name, dir);
      if (found) walk(found);
      else if (!(name in optional)) throw new Error(`Falta ${name} (dependencia de ${pkg.name}) en ${rootDir}`);
    }
  };
  for (const name of roots) walk(path.join(rootDir, "node_modules", name));

  const realRoot = fs.realpathSync(rootDir);
  const dirs = [...seen].sort();
  return dirs
    .filter((dir) => !dirs.some((other) => other !== dir && dir.startsWith(other + path.sep)))
    .map((dir) => path.relative(realRoot, dir).split(path.sep).join("/"));
}

export class AppiumPackage {
  private building?: Promise<AppiumPackageInfo>;
  private cached?: AppiumPackageInfo;

  constructor(
    private readonly downloadsDir: string = defaultDownloadsDir(),
    private readonly sourceResolver: () => AppiumPackageSource | undefined = () => resolveAppiumSource(),
  ) {}

  get dir(): string {
    return this.downloadsDir;
  }

  /** Versión que se reparte a los agentes, o undefined si el motor no tiene Appium. */
  requiredVersion(): string | undefined {
    return this.sourceResolver()?.version;
  }

  zipPath(version: string): string {
    return path.join(this.downloadsDir, `appium-${version}.zip`);
  }

  readyInfo(): AppiumPackageInfo | undefined {
    const source = this.sourceResolver();
    if (!source) return undefined;
    if (this.cached?.version === source.version && fs.existsSync(this.zipPath(source.version))) return this.cached;
    return undefined;
  }

  /** Arma (una sola vez aunque lo pidan varios) y devuelve el zip de la versión actual. */
  ensure(log: (line: string) => void = (line) => console.log(line)): Promise<AppiumPackageInfo> {
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

  private async build(log: (line: string) => void): Promise<AppiumPackageInfo> {
    const source = this.sourceResolver();
    if (!source) throw new Error("El servidor no tiene Appium y el driver UiAutomator2 para entregar a los agentes");
    const zip = this.zipPath(source.version);
    const shaFile = `${zip}.sha256`;
    fs.mkdirSync(this.downloadsDir, { recursive: true });

    if (!fs.existsSync(zip)) {
      const started = Date.now();
      log(`[agente-local] armando appium-${source.version}.zip desde ${source.rootDir}`);
      const stage = path.join(this.downloadsDir, `appium-${source.version}.stage`);
      const tmp = path.join(this.downloadsDir, `appium-${source.version}.tmp.zip`);
      fs.rmSync(stage, { recursive: true, force: true });
      fs.rmSync(tmp, { force: true });
      fs.mkdirSync(stage, { recursive: true });
      try {
        const dirs = appiumClosure(source.rootDir);
        fs.writeFileSync(
          path.join(stage, "package.json"),
          JSON.stringify({ name: "qalab-appium", version: "1.0.0", private: true, dependencies: source.dependencies }, null, 2),
        );
        // tar.exe de Windows: -C cambia de carpeta antes de cada grupo de archivos. No admite -T
        // después de -C, así que las carpetas van como argumentos (unos cientos, caben de sobra).
        const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
        await execFileAsync(tar, ["--format", "zip", "-c", "-f", tmp, ...RUNTIME_EXCLUDES, "-C", stage, "package.json", "-C", source.rootDir, ...dirs], {
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
        fs.rmSync(shaFile, { force: true });
        fs.renameSync(tmp, zip);
        log(`[agente-local] appium-${source.version}.zip listo (${dirs.length} paquetes) en ${Math.round((Date.now() - started) / 1000)} s`);
      } finally {
        fs.rmSync(stage, { recursive: true, force: true });
        fs.rmSync(tmp, { force: true });
      }
    }

    const sizeBytes = fs.statSync(zip).size;
    let sha256 = fs.existsSync(shaFile) ? fs.readFileSync(shaFile, "utf8").trim().split(/\s+/)[0] : "";
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      sha256 = await hashFile(zip);
      fs.writeFileSync(shaFile, `${sha256}  appium-${source.version}.zip\n`);
    }
    const fileName = path.basename(zip);
    return { version: source.version, fileName, url: `${DOWNLOADS_URL_PREFIX}/${fileName}`, sha256: sha256.toLowerCase(), sizeBytes };
  }
}

/** Instancia del proceso del motor. */
export const appiumPackage = new AppiumPackage();
