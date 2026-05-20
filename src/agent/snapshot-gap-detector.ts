import type { PageSnapshot } from "../types/page-snapshot.types";
import type { ExecutionPlan } from "../types/execution-plan.types";

export type SnapshotGap = {
  stepIndex: number;
  stepDescription: string;
  missingTargets: string[];
};

export type SnapshotGapAnalysis = {
  hasGaps: boolean;
  gaps: SnapshotGap[];
  allMissingTargets: string[];
};

const STOP_WORDS = new Set([
  "de", "la", "el", "los", "las", "un", "una", "y", "o", "en", "por", "para",
  "con", "sin", "al", "del", "se", "su", "es", "son", "the", "a", "an", "is",
  "are", "to", "for", "on", "in", "at", "by", "que", "su", "se", "no", "si",
  "clic", "click", "en", "validar", "que", "abrir", "url", "del", "listado",
  "pantalla", "final", "muestre", "señales", "esperadas", "ingresar", "presionar",
  "esperar", "carga", "inicio", "sesion", "session"
]);

function extractPotentialTargets(text: string): string[] {
  const quoted = text.match(/'([^']+)'/g) ?? [];
  if (quoted.length > 0) {
    return quoted.map((q) => q.slice(1, -1).trim()).filter(Boolean);
  }

  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));

  const phrases: string[] = [];
  const cleaned = text.replace(/[^a-zA-Z0-9\sáéíóúñ]/g, " ").trim();
  const sentences = cleaned.split(/[.\n]+/).filter(Boolean);
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length > 3) {
      phrases.push(trimmed);
    }
  }

  return [...new Set([...quoted.map((q) => q.slice(1, -1).trim()).filter(Boolean), ...phrases])];
}

function getAllSnapshotTexts(snapshot: PageSnapshot | undefined): Set<string> {
  const texts = new Set<string>();
  if (!snapshot) return texts;

  for (const el of snapshot.elements) {
    if (el.text) texts.add(el.text.toLowerCase().trim());
    if (el.label) texts.add(el.label.toLowerCase().trim());
    if (el.placeholder) texts.add(el.placeholder.toLowerCase().trim());
    if (el.name) texts.add(el.name.toLowerCase().trim());
    if (el.nearbyText) texts.add(el.nearbyText.toLowerCase().trim());
  }

  return texts;
}

function targetExistsInSnapshot(target: string, snapshotTexts: Set<string>): boolean {
  const normalized = target.toLowerCase().trim();
  if (snapshotTexts.has(normalized)) return true;

  for (const existing of snapshotTexts) {
    if (existing.includes(normalized) || normalized.includes(existing)) {
      return true;
    }
  }

  return false;
}

export function analyzeSnapshotGaps(
  plan: ExecutionPlan,
  snapshot: PageSnapshot | undefined
): SnapshotGapAnalysis {
  const snapshotTexts = getAllSnapshotTexts(snapshot);
  const gaps: SnapshotGap[] = [];
  const allMissingTargets = new Set<string>();

  for (const step of plan.steps) {
    if (step.action !== "noop") continue;

    const textToAnalyze = [step.description, step.expected, step.value]
      .filter(Boolean)
      .join(" ");

    if (!textToAnalyze.trim()) continue;

    const potentialTargets = extractPotentialTargets(textToAnalyze);
    const missingTargets: string[] = [];

    for (const target of potentialTargets) {
      if (!targetExistsInSnapshot(target, snapshotTexts)) {
        missingTargets.push(target);
      }
    }

    if (missingTargets.length > 0) {
      gaps.push({
        stepIndex: step.index,
        stepDescription: step.description ?? "no description",
        missingTargets
      });
      for (const mt of missingTargets) {
        allMissingTargets.add(mt);
      }
    }
  }

  return {
    hasGaps: gaps.length > 0,
    gaps,
    allMissingTargets: [...allMissingTargets]
  };
}

export function formatGapDiagnosis(analysis: SnapshotGapAnalysis, noPlaywright: boolean): string {
  if (!analysis.hasGaps) return "";

  const parts: string[] = [];
  parts.push("Snapshot gap analysis detected missing elements:");
  parts.push("");

  for (const gap of analysis.gaps) {
    parts.push(`Step #${gap.stepIndex}: ${gap.stepDescription}`);
    parts.push(`  Missing targets: ${gap.missingTargets.join(", ")}`);
    parts.push("");
  }

  if (noPlaywright) {
    parts.push("The requested flow requires browser discovery because target elements are not present in the captured snapshot.");
    parts.push("Codex cannot resolve locators for elements not visible in the snapshot without executing Playwright.");
    parts.push("");
    parts.push("Recommended actions:");
    parts.push("1. Run discovery:scan after navigating to the relevant screens.");
    parts.push("2. Or manually explore the flow and capture a more complete snapshot.");
    parts.push("3. Then re-run plans:enrich with the updated snapshot.");
  }

  return parts.join("\n");
}
