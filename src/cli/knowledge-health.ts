import "../config/env";
import { analyzeKnowledgeHealth, type HealthSeverity } from "../knowledge/knowledge-health";
import { loadMobileKnowledge, selectRelevantMobileKnowledge } from "../mobile/mobile-knowledge-resolver";

/**
 * Reports whether an app's learned knowledge is in a state the scenario generator can use.
 *
 * Answers, in one command, the question that has so far cost a full run each time it went
 * unasked: is there real screen evidence, does it reach the generator, and does it distinguish
 * the states of a screen? With `--for "<texto>"` it also prints exactly which screens the
 * generator would be given for that story.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ICON: Record<HealthSeverity, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };

async function main(): Promise<void> {
  const appSlug = arg("app") ?? process.env.APP_SLUG ?? process.env.APP_PROFILE;
  if (!appSlug) {
    console.error('Falta el slug de la app. Uso: npm run knowledge:health -- --app <slug> [--for "texto de la HU"]');
    process.exitCode = 2;
    return;
  }

  const knowledge = loadMobileKnowledge(appSlug);
  const report = analyzeKnowledgeHealth(knowledge.items);

  console.log(`\n[knowledge] app: ${appSlug}`);
  console.log(`[knowledge] items totales: ${report.totalItems}`);
  for (const [kind, count] of Object.entries(report.itemsByKind).sort((a, b) => b[1] - a[1])) {
    console.log(`              ${String(count).padStart(4)}  ${kind}`);
  }

  console.log("\nPantallas");
  console.log(`  aprendidas                 : ${report.screenItems}`);
  console.log(`  legibles por el generador  : ${report.readableByGenerator}`);
  console.log(`  con más de un estado       : ${report.screensWithMultipleStates}`);
  console.log(`  con evidencia de gate      : ${report.itemsWithGateEvidence}`);
  console.log(`  sin estado de habilitado   : ${report.itemsMissingEnabledCapture}`);

  console.log("\nDiagnóstico");
  for (const f of report.findings) {
    console.log(`  [${ICON[f.severity]}] ${f.title}`);
    console.log(`         ${f.detail}`);
    if (f.action) console.log(`         → ${f.action}`);
  }

  const forText = arg("for");
  if (forText) {
    const screens = selectRelevantMobileKnowledge(knowledge, forText, 5);
    console.log(`\nLo que el generador vería para: "${forText}"`);
    if (screens.length === 0) {
      console.log("  (ninguna pantalla) — generaría a ciegas y marcaría los escenarios como requiresRouteLearning.");
    }
    for (const s of screens) {
      console.log(`  · ${s.title || s.screenKey}  (runCount=${s.runCount})`);
      console.log(`      tappables : ${s.clickTargets.slice(0, 8).join(", ") || "-"}`);
      if (s.disabledTargets.length > 0) console.log(`      bloqueados: ${s.disabledTargets.join(", ")}`);
    }
  }

  console.log(`\n[knowledge] resultado: ${report.severity.toUpperCase()}\n`);
  // Non-zero only on a genuine failure, so this can gate a pipeline without warnings breaking it.
  if (report.severity === "fail") process.exitCode = 1;
}

main().catch((err) => {
  console.error(`[knowledge] error: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
