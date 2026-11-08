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
 *   npx tsx deploy/3-empaquetar.ts --ligero             (sin node_modules: el servidor conserva los suyos;
 *                                                        solo si package-lock.json no cambió desde la última instalación)
 *   npx tsx deploy/3-empaquetar.ts --con-navegadores    (añade Playwright, ~400 MB)
 *
 * El front debe estar compilado antes: en el repo de QA-lab, `npm run build`.
 */

const withDeps = process.argv.includes("--con-dependencias");
const ligero = !withDeps && process.argv.includes("--ligero");
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

/**
 * Carpetas de trabajo que no son codigo y llegaron a ser el 65% del paquete
 * (3.973 de 6.125 entradas): un Python 3.14 completo vendorizado, las
 * compilaciones que deja el agente, la cuarentena de `.js` obsoletos y el
 * volcado del MCP de Playwright.
 *
 * Se descubren en tiempo de ejecucion y no se listan a mano porque `.codex-*`
 * crece con cada sesion de trabajo: ya hay once, y una lista fija se queda corta
 * en silencio. Siguen excluyendose por ruta absoluta, como el resto.
 */
const JUNK_PATTERNS = [/^Python$/, /^\.codex-/, /^\.stale-js-quarantine/, /^\.playwright-mcp$/];

function descubrirBasura(source: string): string[] {
  let entradas: fs.Dirent[];
  try {
    entradas = fs.readdirSync(source, { withFileTypes: true });
  } catch {
    return [];
  }
  return entradas
    .filter((e) => e.isDirectory() && JUNK_PATTERNS.some((p) => p.test(e.name)))
    .map((e) => e.name);
}

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
  const excludeDirs = [...EXCLUDE_DIRS_ROOT, ...descubrirBasura(source)].map((d) => path.join(source, d));
  args.push("/XD", ...excludeDirs, "/XF", ...EXCLUDE_FILES);

  const code = run("robocopy", args);
  if (code >= 8) {
    say("ERROR", `robocopy devolvió ${code} copiando ${label}`);
    return false;
  }
  say("ok", `${label} → ${sizeOf(destination)}`);
  return true;
}

function listarArchivos(dir: string, filtro: (nombre: string) => boolean, saltar = /^node_modules$/): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!saltar.test(e.name)) out.push(...listarArchivos(full, filtro, saltar));
    } else if (filtro(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Mismas comprobaciones que el checklist de infraestructura: si alguna falla,
 * el paquete se devuelve sin instalar. El 2026-10-13 un `.env` local del front
 * con VITE_API_URL=http://localhost:3001 quedo grabado en el bundle y rompio el
 * login de la v2; Vite lee ese `.env` al compilar sin avisar.
 */
function revisarPaquete(staging: string): boolean {
  let ok = true;
  const req = (cond: boolean, texto: string, ayuda?: string) => {
    say(cond ? "ok" : "ERROR", texto);
    if (!cond && ayuda) console.log(`          ${ayuda}`);
    ok = cond && ok;
  };

  const instalador = path.join(staging, "qa-engine", "deploy", "instalar-paralelo.ps1");
  req(fs.existsSync(instalador), "qa-engine\\deploy\\instalar-paralelo.ps1");
  req(
    fs.existsSync(instalador) && fs.readFileSync(instalador, "utf8").includes("serviciosWin"),
    "instalador compatible con WinSW (serviciosWin)",
  );
  if (ligero) {
    say("aviso", "paquete ligero: sin node_modules, el instalador conserva los del servidor");
  } else {
    req(
      fs.existsSync(path.join(staging, "qa-engine", "node_modules", "tsx", "dist", "cli.mjs")),
      "qa-engine\\node_modules\\tsx\\dist\\cli.mjs",
      "el servidor no tiene internet: empaqueta con --con-dependencias (o --ligero si las dependencias no cambiaron)",
    );
  }
  req(fs.existsSync(path.join(staging, "qa-lab", "dist", "index.html")), "qa-lab\\dist\\index.html");

  const assets = path.join(staging, "qa-lab", "dist", "assets");
  const fijas = new Set<string>();
  if (fs.existsSync(assets)) {
    for (const js of listarArchivos(assets, (n) => n.endsWith(".js"))) {
      for (const m of fs.readFileSync(js, "utf8").matchAll(/localhost:\d+|127\.0\.0\.1:\d+/g)) fijas.add(m[0]);
    }
  }
  req(
    fijas.size === 0,
    fijas.size === 0 ? "front sin URL de API fija" : `front con URL fija: ${[...fijas].join(", ")}`,
    "compila qa-lab con VITE_API_URL vacia (revisa .env / .env.local / .env.production)",
  );

  const envs = listarArchivos(staging, (n) => n.startsWith(".env"));
  req(
    envs.length === 0,
    envs.length === 0 ? "sin archivos .env" : `.env dentro del paquete: ${envs.map((f) => path.relative(staging, f)).join(", ")}`,
  );
  return ok;
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

  console.log("\nRevision del paquete (checklist de SRVDEVQACA01)\n");
  ok = revisarPaquete(staging) && ok;

  if (!ok) {
    console.log("\n  Hubo errores; no se genera el ZIP.\n");
    process.exitCode = 1;
    return;
  }

  // --- Comprimir ------------------------------------------------------------
  console.log("\nComprimiendo\n");

  fs.mkdirSync(outputRoot, { recursive: true });
  const zip = path.join(outputRoot, `qa-lab-actualizacion-${stamp}.zip`);
  fs.rmSync(zip, { force: true });

  // tar (bsdtar de Windows) y no Compress-Archive: con node_modules son ~52.000
  // archivos y Compress-Archive pasaba de 25 minutos sin terminar. El formato va
  // explicito: `-a` lo deduce de la extension y con otra que no sea .zip genera
  // un .tar sin comprimir.
  const code = run(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["--format", "zip", "-c", "-f", zip, "-C", staging, ...fs.readdirSync(staging)]);

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
