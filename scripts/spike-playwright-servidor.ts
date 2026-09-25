import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

/**
 * Diagnóstico de Playwright en el servidor.
 *
 * Responde tres preguntas antes de invertir en el despliegue:
 *   1. ¿Encuentra los navegadores la cuenta con la que corre el servicio?
 *   2. ¿Arranca Chromium headless? (lo que necesitan las ejecuciones)
 *   3. ¿Hay escritorio interactivo? (lo que necesita la grabación)
 *
 * Correr DOS veces y comparar:
 *   - como tu usuario:            npx tsx scripts/spike-playwright-servidor.ts
 *   - como la cuenta de servicio: ver instrucciones al final de la salida
 */

const results: { label: string; ok: boolean | null; detail: string }[] = [];

function report(label: string, ok: boolean | null, detail = ""): void {
  results.push({ label, ok, detail });
  const mark = ok === null ? "  ?  " : ok ? " OK  " : "FALLA";
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function canWrite(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.escritura-${process.pid}.tmp`);
    fs.writeFileSync(probe, "ok");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  console.log("\n============================================================");
  console.log("  SPIKE: Playwright en el servidor");
  console.log("============================================================\n");

  // --- 1. Identidad y sesión ------------------------------------------------
  console.log("1. Identidad y sesión\n");

  const user = os.userInfo();
  report("usuario", true, `${user.username} (perfil: ${user.homedir})`);
  report("Node", process.versions.node >= "22", `v${process.versions.node} (node:sqlite necesita >= 22)`);
  report("plataforma", true, `${os.platform()} ${os.release()} ${os.arch()}`);

  // En Windows, un servicio corre en la Sesión 0, que NO tiene escritorio.
  // SESSIONNAME viene vacío ahí, "Console" en sesión interactiva y "RDP-Tcp#n" por escritorio remoto.
  const sessionName = process.env.SESSIONNAME;
  const interactive = Boolean(sessionName);
  report(
    "escritorio interactivo",
    interactive,
    interactive
      ? `SESSIONNAME=${sessionName}`
      : "SESSIONNAME vacío → Sesión 0 (servicio): no hay escritorio donde mostrar una ventana",
  );

  const totalGb = os.totalmem() / 1024 ** 3;
  report("memoria", totalGb >= 8, `${totalGb.toFixed(1)} GB totales, ${mb(os.freemem())} libres`);

  // --- 2. Navegadores -------------------------------------------------------
  console.log("\n2. Navegadores de Playwright\n");

  const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const defaultPath = path.join(user.homedir, "AppData", "Local", "ms-playwright");
  const effectivePath = browsersPath || defaultPath;

  report(
    "PLAYWRIGHT_BROWSERS_PATH",
    Boolean(browsersPath),
    browsersPath
      ? browsersPath
      : `sin definir → usa el perfil del usuario (${defaultPath}). En un servicio el perfil cambia: conviene fijarla`,
  );

  const browsersExist = fs.existsSync(effectivePath);
  let installed: string[] = [];
  if (browsersExist) {
    try {
      installed = fs.readdirSync(effectivePath).filter((n) => !n.startsWith("."));
    } catch {
      installed = [];
    }
  }
  report(
    "navegadores instalados",
    browsersExist && installed.some((n) => n.startsWith("chromium")),
    browsersExist ? `${installed.length} paquetes en ${effectivePath}` : `no existe ${effectivePath}`,
  );

  // --- 3. Permisos de escritura --------------------------------------------
  console.log("\n3. Permisos de escritura (con la cuenta actual)\n");

  for (const [label, dir] of [
    ["carpeta de datos", path.resolve(process.cwd(), "data")],
    ["artefactos", path.resolve(process.cwd(), ".artifacts")],
    ["automations", path.resolve(process.cwd(), "automations")],
    ["temporal del sistema", os.tmpdir()],
  ] as const) {
    report(label, canWrite(dir), dir);
  }

  // --- 4. Chromium headless: lo que necesitan las EJECUCIONES ---------------
  console.log("\n4. Chromium headless (ejecuciones de pruebas)\n");

  let headlessOk = false;
  try {
    const startedAt = Date.now();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent("<h1>spike</h1>");
    const title = await page.evaluate(() => document.querySelector("h1")?.textContent);
    const shot = path.join(os.tmpdir(), `spike-${process.pid}.png`);
    await page.screenshot({ path: shot });
    const shotOk = fs.existsSync(shot);
    if (shotOk) fs.unlinkSync(shot);
    await browser.close();

    headlessOk = title === "spike" && shotOk;
    report("arranca, navega y captura", headlessOk, `${Date.now() - startedAt} ms`);
  } catch (err) {
    report("arranca, navega y captura", false, err instanceof Error ? err.message : String(err));
  }

  // --- 5. Chromium con ventana: lo que necesita la GRABACIÓN ---------------
  console.log("\n5. Chromium con ventana visible (grabación)\n");

  if (!interactive) {
    report(
      "ventana visible",
      false,
      "Sesión 0: aunque el proceso arranque, la ventana no existe en ningún escritorio y nadie puede usarla",
    );
  } else {
    try {
      const browser = await chromium.launch({ headless: false });
      const page = await browser.newPage();
      await page.setContent("<h1>ventana visible</h1>");
      await browser.close();
      report("ventana visible", true, "arrancó en una sesión con escritorio");
    } catch (err) {
      report("ventana visible", false, err instanceof Error ? err.message : String(err));
    }
  }

  // --- 6. Concurrencia real -------------------------------------------------
  console.log("\n6. Concurrencia: 3 navegadores a la vez\n");

  if (!headlessOk) {
    report("3 navegadores simultáneos", null, "omitido: el headless no arrancó");
  } else {
    try {
      const before = os.freemem();
      const browsers = await Promise.all([
        chromium.launch({ headless: true }),
        chromium.launch({ headless: true }),
        chromium.launch({ headless: true }),
      ]);
      const pages = await Promise.all(browsers.map((b) => b.newPage()));
      await Promise.all(pages.map((p) => p.setContent("<h1>carga</h1>")));
      const after = os.freemem();
      const used = before - after;
      await Promise.all(browsers.map((b) => b.close()));

      report(
        "3 navegadores simultáneos",
        true,
        `consumieron ~${mb(used)} (≈${mb(used / 3)} cada uno), quedan ${mb(after)} libres`,
      );
    } catch (err) {
      report("3 navegadores simultáneos", false, err instanceof Error ? err.message : String(err));
    }
  }

  // --- Veredicto ------------------------------------------------------------
  console.log("\n============================================================");
  console.log("  VEREDICTO");
  console.log("============================================================\n");

  const failed = results.filter((r) => r.ok === false);

  console.log(
    `  Ejecutar pruebas (headless) : ${headlessOk ? "SÍ, funciona con esta cuenta" : "NO — revisar los fallos de arriba"}`,
  );
  console.log(
    `  Grabar recorridos (ventana) : ${interactive ? "SÍ en esta sesión" : "NO — esta cuenta no tiene escritorio"}`,
  );

  if (failed.length > 0) {
    console.log(`\n  ${failed.length} comprobación(es) fallaron:`);
    for (const f of failed) console.log(`    - ${f.label}: ${f.detail}`);
  }

  console.log(`
  Para repetirlo COMO LA CUENTA DE SERVICIO (es la comparación que importa):

    schtasks /create /tn "spike-pw" /tr "cmd /c cd /d ${process.cwd()} && npx tsx scripts/spike-playwright-servidor.ts > %TEMP%\\spike-pw.txt 2>&1" /sc once /st 23:59 /ru "DOMINIO\\cuenta-servicio" /rp *
    schtasks /run /tn "spike-pw"
    timeout /t 60 && type %TEMP%\\spike-pw.txt
    schtasks /delete /tn "spike-pw" /f
`);

  process.exitCode = headlessOk ? 0 : 1;
}

main().catch((err) => {
  console.error("\n[spike] error inesperado:", err instanceof Error ? err.stack : err);
  process.exitCode = 1;
});
