import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/**
 * Instala el APK del proyecto en un dispositivo, sea del servidor o del PC del
 * usuario (por el túnel adb del agente: `adb -H 127.0.0.1 -P <puerto>`). El adb
 * del servidor sube el APK por esa misma conexión, así el agente no necesita
 * descargarlo.
 *
 * Solo instala si falta o si el APK del dispositivo es otro (se compara su
 * SHA-256; la versión sola no basta: las compilaciones de desarrollo suelen
 * repetir versionCode 1). Grabar o lanzar de nuevo con el mismo APK no reinstala
 * ni borra datos.
 */

export type AdbTarget = {
  adbPath: string;
  serial: string;
  /** Servidor de adb a usar; ausente = el local por defecto (5037). */
  host?: string;
  port?: number;
};

export type AdbResult = { exitCode: number; stdout: string; stderr: string };
export type AdbExec = (adbPath: string, args: string[], timeoutMs: number) => Promise<AdbResult>;

export type ApkToInstall = { apkPath: string; packageName: string; versionCode?: string };

export type InstallOutcome = {
  action: "already_installed" | "installed" | "updated";
  /** Versión del dispositivo antes de instalar (ausente si no estaba). */
  previousVersionCode?: string;
};

const QUERY_TIMEOUT_MS = 20_000;
/** El APK viaja por la red hasta el PC del usuario: margen amplio. */
const INSTALL_TIMEOUT_MS = 5 * 60_000;

export class ApkInstallError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApkInstallError";
  }
}

export function adbArgs(target: AdbTarget, args: string[]): string[] {
  const server = target.host ? ["-H", target.host, "-P", String(target.port ?? 5037)] : [];
  return [...server, "-s", target.serial, ...args];
}

export const runAdb: AdbExec = (adbPath, args, timeoutMs) =>
  new Promise((resolve) => {
    const child = spawn(adbPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: AdbResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("close", (code) => settle({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (err) => settle({ exitCode: 1, stdout, stderr: `${stderr}${err.message}` }));
    const timer = setTimeout(() => {
      child.kill();
      settle({ exitCode: 1, stdout, stderr: `${stderr}adb timeout after ${timeoutMs} ms`.trim() });
    }, timeoutMs);
  });

/** Lo que hay del paquete en el dispositivo. */
export type InstalledApk = {
  /** Hay APK en el dispositivo (`pm path`). Una app archivada (Android 15+) conserva datos y versión, pero no APK. */
  present: boolean;
  versionCode?: string;
  /** SHA-256 del base.apk instalado, si el dispositivo lo puede calcular. */
  sha256?: string;
};

export async function inspectInstalled(target: AdbTarget, packageName: string, exec: AdbExec = runAdb): Promise<InstalledApk> {
  const dumpsys = await queryWithRetry(target, ["shell", "dumpsys", "package", packageName], exec);
  const versionCode = parseInstalledVersion(dumpsys.stdout, packageName);
  // `pm path` sale con 1 cuando no hay APK: no es un fallo de adb.
  const paths = await exec(target.adbPath, adbArgs(target, ["shell", "pm", "path", packageName]), QUERY_TIMEOUT_MS);
  const apkOnDevice = parsePmPath(paths.stdout);
  if (!apkOnDevice) return { present: false, ...(versionCode ? { versionCode } : {}) };
  const sum = await exec(target.adbPath, adbArgs(target, ["shell", "sha256sum", apkOnDevice]), QUERY_TIMEOUT_MS);
  const sha256 = sum.exitCode === 0 ? sum.stdout.trim().match(/^([0-9a-f]{64})\s/i)?.[1]?.toLowerCase() : undefined;
  return { present: true, ...(versionCode ? { versionCode } : {}), ...(sha256 ? { sha256 } : {}) };
}

/** Recién arrancado, el gestor de paquetes puede tardar unos segundos en responder. */
async function queryWithRetry(target: AdbTarget, args: string[], exec: AdbExec, attempts = 5, delayMs = 2000): Promise<AdbResult> {
  let last: AdbResult = { exitCode: 1, stdout: "", stderr: "" };
  for (let i = 0; i < attempts; i += 1) {
    last = await exec(target.adbPath, adbArgs(target, args), QUERY_TIMEOUT_MS);
    if (last.exitCode === 0 && last.stdout.trim()) return last;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new ApkInstallError("adb_failed", `No se pudo consultar el dispositivo ${target.serial}: ${lastLine(last.stderr || last.stdout) || "adb no respondió"}`);
}

export function parseInstalledVersion(dumpsys: string, packageName: string): string | undefined {
  const start = dumpsys.indexOf(`Package [${packageName}]`);
  if (start < 0) return undefined;
  return dumpsys.slice(start).match(/versionCode=(\d+)/)?.[1];
}

/** "package:/data/app/~~x/com.app-y/base.apk" (y splits) → la ruta del base.apk. */
export function parsePmPath(output: string): string | undefined {
  const paths = output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("package:")).map((l) => l.slice(8));
  return paths.find((p) => p.endsWith("/base.apk")) ?? paths[0];
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

export async function ensureApkInstalled(
  target: AdbTarget,
  apk: ApkToInstall,
  options: { exec?: AdbExec; log?: (line: string) => void; sha256?: string } = {},
): Promise<InstallOutcome> {
  const exec = options.exec ?? runAdb;
  const log = options.log ?? (() => undefined);
  const installed = await inspectInstalled(target, apk.packageName, exec);
  const previous = installed.versionCode;

  if (installed.present) {
    if (installed.sha256) {
      // Mismo archivo: nada que hacer. Una compilación distinta con el mismo versionCode sí se instala.
      const local = options.sha256 ?? (await sha256File(apk.apkPath));
      if (installed.sha256 === local) {
        log(`[apk] ${apk.packageName} ya tiene este mismo APK en ${target.serial}`);
        return { action: "already_installed", ...(previous ? { previousVersionCode: previous } : {}) };
      }
    } else if (!apk.versionCode || previous === apk.versionCode) {
      // Sin hash en el dispositivo solo se puede comparar la versión.
      log(`[apk] ${apk.packageName}${previous ? ` ${previous}` : ""} ya está instalado en ${target.serial}`);
      return { action: "already_installed", ...(previous ? { previousVersionCode: previous } : {}) };
    }
  }

  log(`[apk] instalando ${apk.packageName}${apk.versionCode ? ` ${apk.versionCode}` : ""} en ${target.serial}${installed.present && previous ? ` (tenía ${previous})` : ""}`);
  // -r reemplaza conservando datos, -t admite APKs de prueba, -d permite bajar de versión.
  const result = await exec(target.adbPath, adbArgs(target, ["install", "-r", "-t", "-d", apk.apkPath]), INSTALL_TIMEOUT_MS);
  const output = `${result.stdout}
${result.stderr}`;
  const failure = output.match(/Failure \[([A-Z_]+)[^\]]*\]/)?.[1] ?? output.match(/\b(INSTALL_[A-Z_]+)\b/)?.[1];
  if (result.exitCode !== 0 || failure || !/\bSuccess\b/.test(output)) {
    throw new ApkInstallError(failure ?? "install_failed", installFailureMessage(failure, apk.packageName, target.serial, output));
  }
  return installed.present ? { action: "updated", ...(previous ? { previousVersionCode: previous } : {}) } : { action: "installed" };
}

function installFailureMessage(code: string | undefined, packageName: string, serial: string, output: string): string {
  switch (code) {
    case "INSTALL_FAILED_UPDATE_INCOMPATIBLE":
      return `${packageName} ya está instalado en ${serial} con otra firma. Desinstálalo del dispositivo y vuelve a intentar.`;
    case "INSTALL_FAILED_VERSION_DOWNGRADE":
      return `${serial} tiene una versión más nueva de ${packageName}. Desinstálala del dispositivo y vuelve a intentar.`;
    case "INSTALL_FAILED_INSUFFICIENT_STORAGE":
      return `${serial} no tiene espacio para instalar ${packageName}.`;
    case "INSTALL_FAILED_OLDER_SDK":
      return `La versión de Android de ${serial} es más antigua que la que exige ${packageName}.`;
    case "INSTALL_FAILED_NO_MATCHING_ABIS":
      return `${packageName} no tiene librerías para la arquitectura de ${serial} (prueba con un emulador x86_64 o un teléfono).`;
    default:
      return `No se pudo instalar ${packageName} en ${serial}: ${lastLine(output) || "adb no respondió"}`;
  }
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? "";
}
