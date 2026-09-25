import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Paso 2: separar el ESTADO del CÓDIGO.
 *
 * Hoy la base, las evidencias y los scripts generados viven dentro de la carpeta
 * de la aplicación. En un servidor eso significa que un redespliegue borraría los
 * usuarios, el historial de ejecuciones y las pruebas promovidas.
 *
 * Este paso crea la raíz de estado y enlaza las dos carpetas que el código
 * escribe por ruta fija. La base no necesita enlace: se mueve con SQLITE_DB_PATH.
 *
 *   npx tsx deploy/2-preparar-carpetas.ts            (muestra qué haría)
 *   npx tsx deploy/2-preparar-carpetas.ts --aplicar  (lo hace)
 *
 * Variable opcional: QA_STATE_ROOT (por defecto D:\qa)
 */

const apply = process.argv.includes("--aplicar");
const stateRoot = process.env.QA_STATE_ROOT || "D:\\qa";
const engineRoot = process.cwd();

/** Carpetas que el motor escribe y que deben sobrevivir a un despliegue. */
const LINKED = ["automations", ".artifacts"] as const;
const PLAIN = ["data", "backups", "logs"] as const;

let problems = 0;

function say(mark: string, text: string): void {
  console.log(`  [${mark}] ${text}`);
}

function isJunction(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function run(command: string, args: string[]): boolean {
  try {
    execFileSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

function main(): void {
  console.log("\n============================================================");
  console.log(`  PASO 2 — Carpetas de estado${apply ? "" : "   (SIMULACIÓN)"}`);
  console.log("============================================================\n");
  console.log(`  código  : ${engineRoot}`);
  console.log(`  estado  : ${stateRoot}\n`);

  if (!apply) {
    console.log("  Nada se modifica. Repite con --aplicar cuando el plan te cuadre.\n");
  }

  // --- Crear la raíz de estado ---------------------------------------------
  console.log("Carpetas\n");

  for (const name of [...PLAIN, ...LINKED]) {
    const dir = path.join(stateRoot, name);
    if (fs.existsSync(dir)) {
      say("ya", `${dir}`);
      continue;
    }
    if (!apply) {
      say("crear", dir);
      continue;
    }
    try {
      fs.mkdirSync(dir, { recursive: true });
      say("creada", dir);
    } catch (err) {
      say("ERROR", `${dir} — ${err instanceof Error ? err.message : err}`);
      problems++;
    }
  }

  // --- Mover contenido existente y enlazar ---------------------------------
  console.log("\nEnlaces de directorio\n");

  for (const name of LINKED) {
    const inside = path.join(engineRoot, name);
    const outside = path.join(stateRoot, name);

    if (isJunction(inside)) {
      say("ya", `${inside} ya es un enlace`);
      continue;
    }

    const exists = fs.existsSync(inside);
    const hasContent = exists && fs.readdirSync(inside).length > 0;

    if (!apply) {
      if (hasContent) say("mover", `${inside} → ${outside} (y enlazar)`);
      else say("enlazar", `${inside} → ${outside}`);
      continue;
    }

    try {
      // El contenido actual se conserva: se copia al destino antes de enlazar.
      if (hasContent) {
        const copied = run("robocopy", [inside, outside, "/E", "/MOVE", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"]);
        // robocopy devuelve códigos < 8 en éxito; run() ya los normaliza a false
        // solo cuando lanza, así que se comprueba el resultado real en disco.
        if (!fs.existsSync(outside)) {
          say("ERROR", `no se pudo mover ${inside} (robocopy=${copied})`);
          problems++;
          continue;
        }
      }
      if (fs.existsSync(inside)) fs.rmSync(inside, { recursive: true, force: true });

      if (!run("cmd", ["/c", "mklink", "/J", inside, outside])) {
        say("ERROR", `no se pudo crear el enlace ${inside} → ${outside}`);
        problems++;
        continue;
      }
      say("ok", `${inside} → ${outside}`);
    } catch (err) {
      say("ERROR", `${name} — ${err instanceof Error ? err.message : err}`);
      problems++;
    }
  }

  // --- Recordatorios --------------------------------------------------------
  console.log("\nQué falta configurar en el .env del servidor\n");
  console.log(`    SQLITE_DB_PATH=${path.join(stateRoot, "data", "qa-lab.db")}`);
  console.log(`    BACKUP_DIR=${path.join(stateRoot, "backups")}`);
  console.log(`    PLAYWRIGHT_BROWSERS_PATH=${path.join(stateRoot, "ms-playwright")}`);
  console.log(`    HEADLESS=true`);
  console.log(`    RECORDING_ENABLED=false`);
  console.log(`    AUTH_ENABLED=true`);

  console.log("\n============================================================\n");
  if (!apply) {
    console.log("  Simulación terminada. Ejecuta con --aplicar para hacerlo.\n");
  } else if (problems === 0) {
    console.log("  Listo. El estado vive fuera de la carpeta de despliegue.\n");
    console.log("  Siguiente: copia deploy/.env.servidor a .env y ajústalo.\n");
  } else {
    console.log(`  Terminó con ${problems} problema(s). Revísalos antes de seguir.\n`);
  }
  process.exitCode = problems === 0 ? 0 : 1;
}

main();
