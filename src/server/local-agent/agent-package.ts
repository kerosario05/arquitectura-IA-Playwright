import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildAgentBundle } from "../../local-agent/build-agent";
import { AGENT_VERSION } from "../../local-agent/version";
import { DOWNLOADS_URL_PREFIX, defaultDownloadsDir, hashFile } from "./chromium-package";

const execFileAsync = promisify(execFile);

/**
 * El agente que instala TI en los PCs (`/descargas/qalab-agente.zip`).
 *
 * Igual que con Chromium, el servidor no tiene internet y el pase no crece: el
 * zip se arma en el propio servidor con SU node.exe (renombrado a
 * qalab-agente.exe, sin instalar Node en el PC) y el agente empaquetado desde
 * src/local-agent. `qalab-agente.json` dice versión y sha256 para que el
 * instalador de TI solo descargue cuando cambia. El instalador mismo
 * (deploy/agente/instalar-agente.ps1) se publica al lado.
 */

export const AGENT_ZIP = "qalab-agente.zip";
export const AGENT_MANIFEST = "qalab-agente.json";
export const AGENT_INSTALLER = "instalar-agente.ps1";
/** Lo que se pide a /descargas y obliga a armar (o refrescar) el paquete antes de servirlo. */
export const AGENT_DOWNLOADS = new Set([AGENT_ZIP, AGENT_MANIFEST, AGENT_INSTALLER]);

export type AgentPackageInfo = {
  version: string;
  nodeVersion: string;
  fileName: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  builtAt: string;
};

export type AgentPackageSources = {
  version: string;
  nodeExe: string;
  nodeVersion: string;
  /** deploy/agente/instalar-agente.ps1 (puede faltar: entonces no se publica). */
  installer: string;
  bundle: (outfile: string) => Promise<void>;
};

function defaultSources(): AgentPackageSources {
  return {
    version: AGENT_VERSION,
    nodeExe: process.execPath,
    nodeVersion: process.versions.node,
    installer: path.resolve(__dirname, "..", "..", "..", "deploy", "agente", AGENT_INSTALLER),
    bundle: buildAgentBundle,
  };
}

export class AgentPackage {
  private building?: Promise<AgentPackageInfo>;

  constructor(
    private readonly downloadsDir: string = defaultDownloadsDir(),
    private readonly sources: AgentPackageSources = defaultSources(),
  ) {}

  /** Arma (una sola vez aunque lo pidan varios) el zip de la versión actual del agente. */
  ensure(log: (line: string) => void = (line) => console.log(line)): Promise<AgentPackageInfo> {
    if (this.building) return this.building;
    this.building = this.build(log).finally(() => {
      this.building = undefined;
    });
    return this.building;
  }

  private current(): AgentPackageInfo | undefined {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(this.downloadsDir, AGENT_MANIFEST), "utf8")) as AgentPackageInfo;
      const zip = path.join(this.downloadsDir, AGENT_ZIP);
      if (
        manifest.version === this.sources.version &&
        manifest.nodeVersion === this.sources.nodeVersion &&
        fs.existsSync(zip) &&
        fs.statSync(zip).size === manifest.sizeBytes
      ) {
        return manifest;
      }
    } catch {
      // Sin manifiesto (o roto): se arma de nuevo.
    }
    return undefined;
  }

  private publishInstaller(): void {
    if (!fs.existsSync(this.sources.installer)) return;
    const target = path.join(this.downloadsDir, AGENT_INSTALLER);
    const source = fs.readFileSync(this.sources.installer);
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(source)) fs.writeFileSync(target, source);
  }

  private async build(log: (line: string) => void): Promise<AgentPackageInfo> {
    fs.mkdirSync(this.downloadsDir, { recursive: true });
    this.publishInstaller();
    const ready = this.current();
    if (ready) return ready;

    const started = Date.now();
    const { version, nodeVersion } = this.sources;
    log(`[agente-local] armando ${AGENT_ZIP} ${version} (node ${nodeVersion})`);
    const staging = path.join(this.downloadsDir, "qalab-agente.tmp");
    const tmpZip = path.join(this.downloadsDir, "qalab-agente.tmp.zip");
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(tmpZip, { force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      await this.sources.bundle(path.join(staging, "qalab-agente.cjs"));
      fs.copyFileSync(this.sources.nodeExe, path.join(staging, "qalab-agente.exe"));
      fs.writeFileSync(path.join(staging, "version.txt"), version);
      const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
      await execFileAsync(tar, ["--format", "zip", "-c", "-f", tmpZip, "-C", staging, "qalab-agente.exe", "qalab-agente.cjs", "version.txt"], {
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      });
      const zip = path.join(this.downloadsDir, AGENT_ZIP);
      fs.rmSync(path.join(this.downloadsDir, AGENT_MANIFEST), { force: true });
      fs.renameSync(tmpZip, zip);
      const info: AgentPackageInfo = {
        version,
        nodeVersion,
        fileName: AGENT_ZIP,
        url: `${DOWNLOADS_URL_PREFIX}/${AGENT_ZIP}`,
        sha256: (await hashFile(zip)).toLowerCase(),
        sizeBytes: fs.statSync(zip).size,
        builtAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(this.downloadsDir, AGENT_MANIFEST), JSON.stringify(info, null, 2));
      log(`[agente-local] ${AGENT_ZIP} listo en ${Math.round((Date.now() - started) / 1000)} s (${(info.sizeBytes / 1048576).toFixed(0)} MB)`);
      return info;
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(tmpZip, { force: true });
    }
  }
}

export const agentPackage = new AgentPackage();
