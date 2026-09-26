import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Paso 1 del despliegue: ¿tiene este servidor lo que hace falta?
 *
 * No cambia nada. Solo mira y reporta, para no descubrir a mitad del montaje
 * que falta un módulo de IIS o que la cuenta no puede escribir donde debe.
 *
 *   npx tsx deploy/1-verificar-servidor.ts
 */

type Level = "ok" | "falta" | "aviso";
const findings: { level: Level; label: string; detail: string }[] = [];

function note(level: Level, label: string, detail = ""): void {
  findings.push({ level, label, detail });
  const mark = level === "ok" ? " OK  " : level === "aviso" ? "AVISO" : "FALTA";
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function ps(command: string): string {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", command], {
      encoding: "utf8",
      timeout: 30_000,
      // Un comando que falla ya se interpreta como "no detectado"; su ruido
      // en stderr solo confunde a quien lee el reporte.
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  console.log("\n============================================================");
  console.log("  PASO 1 — Requisitos del servidor");
  console.log("============================================================\n");

  // --- Sistema --------------------------------------------------------------
  console.log("Sistema\n");

  note("ok", "equipo", `${os.hostname()} · ${os.platform()} ${os.release()} ${os.arch()}`);
  note("ok", "usuario actual", os.userInfo().username);

  const totalGb = os.totalmem() / 1024 ** 3;
  note(
    totalGb >= 12 ? "ok" : totalGb >= 8 ? "aviso" : "falta",
    "memoria",
    `${totalGb.toFixed(1)} GB (con 16 GB caben 3 ejecuciones simultáneas)`,
  );

  const cpus = os.cpus().length;
  note(cpus >= 4 ? "ok" : "aviso", "CPU", `${cpus} núcleos`);

  // --- Node -----------------------------------------------------------------
  console.log("\nNode y herramientas\n");

  const major = Number(process.versions.node.split(".")[0]);
  note(
    major >= 22 ? "ok" : "falta",
    "Node.js",
    `v${process.versions.node}${major >= 22 ? "" : " — se necesita 22 o superior: la base usa node:sqlite nativo"}`,
  );

  for (const [label, cmd] of [
    ["npm", "npm --version"],
    ["git", "git --version"],
  ] as const) {
    const out = ps(`(${cmd}) 2>$null`);
    note(out ? "ok" : "aviso", label, out || "no encontrado en PATH");
  }

  // --- IIS ------------------------------------------------------------------
  console.log("\nIIS\n");

  // El servicio W3SVC es la señal fiable y no necesita privilegios elevados,
  // a diferencia de Get-WindowsOptionalFeature.
  const w3svc = ps(`(Get-Service W3SVC -ErrorAction SilentlyContinue).Status`);
  note(
    w3svc ? "ok" : "falta",
    "IIS instalado",
    w3svc ? `servicio W3SVC ${w3svc}` : "no se encontró el servicio W3SVC — instalar el rol de Servidor web (IIS)",
  );

  // ARR y URL Rewrite son los que permiten a IIS hacer de proxy hacia Node.
  const rewrite = ps(
    `if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\IIS Extensions\\URL Rewrite') { 'instalado' } else { '' }`,
  );
  note(
    rewrite ? "ok" : "falta",
    "URL Rewrite",
    rewrite || "descargar de iis.net/downloads/microsoft/url-rewrite",
  );

  const arr = ps(
    `if (Test-Path 'HKLM:\\SOFTWARE\\Microsoft\\IIS Extensions\\Application Request Routing') { 'instalado' } else { '' }`,
  );
  note(
    arr ? "ok" : "falta",
    "Application Request Routing",
    arr || "descargar de iis.net/downloads/microsoft/application-request-routing",
  );

  if (arr) {
    const proxyOn = ps(
      `(Get-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter 'system.webServer/proxy' -name 'enabled' -ErrorAction SilentlyContinue).Value`,
    );
    note(
      proxyOn.toLowerCase() === "true" ? "ok" : "aviso",
      "proxy de ARR habilitado",
      proxyOn.toLowerCase() === "true"
        ? "sí"
        : "hay que activarlo: IIS Manager → servidor → Application Request Routing Cache → Server Proxy Settings → Enable proxy",
    );
  }

  // --- Discos y rutas -------------------------------------------------------
  console.log("\nDiscos y rutas\n");

  const drives = ps(
    `Get-PSDrive -PSProvider FileSystem | ForEach-Object { "$($_.Name):" + [math]::Round($_.Free/1GB,1) }`,
  )
    .split(/\r?\n/)
    .filter(Boolean);
  note(drives.length > 0 ? "ok" : "aviso", "unidades", drives.join("  ") || "no se pudo leer");

  const stateRoot = process.env.QA_STATE_ROOT || "D:\\qa";
  const stateDrive = stateRoot.slice(0, 2);
  const stateDriveExists = fs.existsSync(`${stateDrive}\\`);
  note(
    stateDriveExists ? "ok" : "aviso",
    `unidad para el estado (${stateDrive})`,
    stateDriveExists
      ? `se usará ${stateRoot} para base, artefactos y respaldos`
      : `${stateDrive} no existe — define QA_STATE_ROOT con otra ruta antes del paso 2`,
  );

  if (stateDriveExists) {
    note(canWrite(stateRoot) ? "ok" : "falta", `escritura en ${stateRoot}`, "");
  }

  // --- Red ------------------------------------------------------------------
  console.log("\nRed\n");

  for (const port of [80, 443, 3001, 3002]) {
    const busy = ps(
      `if (Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue) { 'ocupado' } else { '' }`,
    );
    const expected = port === 80 || port === 443;
    note(
      busy ? (expected ? "ok" : "aviso") : expected ? "aviso" : "ok",
      `puerto ${port}`,
      busy ? "ocupado" : "libre",
    );
  }

  const internet = ps(
    `try { (Invoke-WebRequest -Uri 'https://registry.npmjs.org' -UseBasicParsing -TimeoutSec 8).StatusCode } catch { '' }`,
  );
  note(
    internet === "200" ? "ok" : "aviso",
    "salida a internet",
    internet === "200"
      ? "sí (npm install y descarga de navegadores funcionarán)"
      : "no — habrá que copiar node_modules y los navegadores de Playwright a mano",
  );

  // --- Veredicto ------------------------------------------------------------
  console.log("\n============================================================");
  console.log("  RESULTADO");
  console.log("============================================================\n");

  const missing = findings.filter((f) => f.level === "falta");
  const warnings = findings.filter((f) => f.level === "aviso");

  if (missing.length === 0) {
    console.log("  Requisitos cubiertos. Puedes seguir con el paso 2.\n");
  } else {
    console.log(`  Faltan ${missing.length} requisito(s) antes de continuar:\n`);
    for (const f of missing) console.log(`    - ${f.label}: ${f.detail}`);
    console.log("");
  }

  if (warnings.length > 0) {
    console.log(`  ${warnings.length} punto(s) a revisar (no bloquean):\n`);
    for (const f of warnings) console.log(`    - ${f.label}: ${f.detail}`);
    console.log("");
  }

  console.log("  Siguiente: npx tsx deploy/2-preparar-carpetas.ts\n");
  process.exitCode = missing.length === 0 ? 0 : 1;
}

main();
