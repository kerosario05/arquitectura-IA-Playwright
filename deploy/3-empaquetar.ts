import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

/**
 * Paso 3: arma el paquete que se copia al servidor.
 *
 * Por RDP conviene llevar UN archivo y descomprimirlo allá: copiar miles de
 * ficheros sueltos por el portapapeles es lento y se interrumpe a medias sin
 * avisar.
 *
 *   npx tsx deploy/3-empaquetar.ts
 *   npx tsx deploy/3-empaquetar.ts --con-dependencias   (servidor sin internet)
 *   npx tsx deploy/3-empaquetar.ts --con-navegadores    (añade Playwright, ~400 MB)
 *
 * El front debe estar compilado antes: en el repo de QA-lab, `npm run build`.
 */

const withDeps = process.argv.includes("--con-dependencias");
const withBrowsers = process.argv.includes("--con-navegadores");

const engineRoot = process.cwd();
const qaLabRoot = process.env.QA_LAB_ROOT || path.resolve(engineRoot, "..", "..", "Documents", "QA-lab");
const outputRoot = path.join(engineRoot, "deploy", "paquete");

/**
 * Carpetas que nunca viajan: estado, secretos, o se reinstalan en destino.
 *
 * TODAS se excluyen por ruta absoluta, nunca por nombre. `robocopy /XD` con un
 * nombre suelto descarta cualquier carpeta que se llame así a cualquier nivel, y
 * el código fuente tiene src/data, src/evidence y src/automations: excluirlas
 * por nombre se llevaba 46 archivos de código por delante.
 */
const EXCLUDE_DIRS_ROOT = [
  "node_modules",
  ".git",
  "data",
  ".artifacts",
  "automations",
  "test-results",
  "playwright-report",
  "allure-results",
  "evidence",
  "token-metrics",
  "deploy/paquete",
];
// ".env*" y no ".env": en la carpeta hay copias como .env.backup-2026... que
// llevan credenciales reales de Jira, TestRail y Oracle. Ninguna debe viajar.
// Los .zip quedan fuera porque las propias carpetas del proyecto acaban
// conteniendo paquetes de transferencia (node_modules.zip, dist.zip) que no
// son codigo y multiplican el tamaño del paquete.
const EXCLUDE_FILES = [".env*", "*.log", "*.png", "*.tmp", "*.bak", "*.zip", "*.7z", "*.pem", "*.key", "*.pfx"];

function say(mark: string, text: string): void {
  console.log(`  [${mark}] ${text}`);
}

function run(command: string, args: string[]): number {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "ignore"] });
    return 0;
  } catch (err: any) {
    // robocopy usa códigos < 8 para éxito con matices; solo >= 8 es error real.
    return typeof err?.status === "number" ? err.status : 1;
  }
}

function sizeOf(target: string): string {
  try {
    const bytes = Number(
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-ChildItem -LiteralPath '${target}' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim(),
    );
    if (!Number.isFinite(bytes) || bytes === 0) return "?";
    return bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  } catch {
    return "?";
  }
}

function copyProject(source: string, destination: string, label: string): boolean {
  if (!fs.existsSync(source)) {
    say("ERROR", `no existe ${label}: ${source}`);
    return false;
  }
  const args = [source, destination, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"];
  // Ruta absoluta para cada una: así solo se excluye la del directorio raíz.
  const excludeDirs = EXCLUDE_DIRS_ROOT.map((d) => path.join(source, d));
  args.push("/XD", ...excludeDirs, "/XF", ...EXCLUDE_FILES);

  const code = run("robocopy", args);
  if (code >= 8) {
    say("ERROR", `robocopy devolvió ${code} copiando ${label}`);
    return false;
  }
  say("ok", `${label} → ${sizeOf(destination)}`);
  return true;
}

function main(): void {
  console.log("\n============================================================");
  console.log("  PASO 3 — Paquete para el servidor");
  console.log("============================================================\n");

  console.log(`  motor   : ${engineRoot}`);
  console.log(`  qa-lab  : ${qaLabRoot}\n`);

  // El front DEBE venir compilado: el servidor no compila nada.
  const dist = path.join(qaLabRoot, "dist");
  if (!fs.existsSync(dist) || fs.readdirSync(dist).length === 0) {
    console.log("  [ERROR] falta el build del front.\n");
    console.log(`          cd ${qaLabRoot}`);
    console.log(`          npm run build\n`);
    process.exitCode = 1;
    return;
  }
  say("ok", `front compilado (${sizeOf(dist)})`);

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const staging = path.join(os.tmpdir(), `qa-lab-paquete-${stamp}`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  console.log("\nCopiando\n");

  let ok = true;
  ok = copyProject(engineRoot, path.join(staging, "qa-engine"), "motor") && ok;
  ok = copyProject(qaLabRoot, path.join(staging, "qa-lab"), "qa-lab (BFF + dist)") && ok;

  if (withDeps) {
    console.log("\nDependencias (servidor sin internet)\n");
    for (const [src, dest, label] of [
      [path.join(engineRoot, "node_modules"), path.join(staging, "qa-engine", "node_modules"), "node_modules del motor"],
      [path.join(qaLabRoot, "node_modules"), path.join(staging, "qa-lab", "node_modules"), "node_modules de qa-lab"],
    ] as const) {
      if (!fs.existsSync(src)) {
        say("aviso", `no existe ${src}`);
        continue;
      }
      const code = run("robocopy", [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"]);
      if (code >= 8) {
        say("ERROR", `robocopy ${code} en ${label}`);
        ok = false;
      } else {
        say("ok", `${label} → ${sizeOf(dest)}`);
      }
    }
  }

  if (withBrowsers) {
    console.log("\nNavegadores de Playwright\n");
    const src = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), "AppData", "Local", "ms-playwright");
    if (!fs.existsSync(src)) {
      say("ERROR", `no se encontraron los navegadores en ${src}`);
      ok = false;
    } else {
      const dest = path.join(staging, "ms-playwright");
      const code = run("robocopy", [src, dest, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP", "/R:1", "/W:1"]);
      if (code >= 8) {
        say("ERROR", `robocopy ${code} copiando navegadores`);
        ok = false;
      } else {
        say("ok", `navegadores → ${sizeOf(dest)}`);
      }
    }
  }

  if (!ok) {
    console.log("\n  Hubo errores; no se genera el ZIP.\n");
    process.exitCode = 1;
    return;
  }

  // --- Comprimir ------------------------------------------------------------
  console.log("\nComprimiendo\n");

  fs.mkdirSync(outputRoot, { recursive: true });
  const zip = path.join(outputRoot, `qa-lab-despliegue-${stamp}.zip`);
  fs.rmSync(zip, { force: true });

  const code = run("powershell", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${staging}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`,
  ]);

  if (code !== 0 || !fs.existsSync(zip)) {
    say("ERROR", "no se pudo comprimir");
    process.exitCode = 1;
    return;
  }

  const zipMb = fs.statSync(zip).size / 1024 ** 2;
  say("ok", `${zip}  (${zipMb.toFixed(1)} MB)`);

  fs.rmSync(staging, { recursive: true, force: true });

  console.log(`
============================================================

  Copia ese ZIP al servidor por RDP y descomprímelo, por ejemplo en C:\\temp.
  Luego mueve las carpetas a su sitio:

    move C:\\temp\\qa-engine  C:\\inetpub\\qa-engine
    move C:\\temp\\qa-lab     C:\\inetpub\\qa-lab
${withBrowsers ? "    move C:\\temp\\ms-playwright  D:\\qa\\ms-playwright\n" : ""}
  Y sigue con:

    cd C:\\inetpub\\qa-engine
    npx tsx deploy\\1-verificar-servidor.ts
`);
}

main();
