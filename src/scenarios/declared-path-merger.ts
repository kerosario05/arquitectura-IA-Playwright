/**
 * Deterministic merge of selected declared_path knowledge into AI-generated
 * scenario steps. Runs POST-AI (after parse/normalize) and BEFORE compliance/
 * readiness. Inserted steps are functional context only — they never grant
 * runtime authority (executionBacked stays false; they are NOT added to
 * allowedExecutableClicks).
 *
 * Reuses the selector's output (buildDeclaredOrderedPathsFromKnowledge) and the
 * existing "Clic en \"<target>\"" step format. No new labels, no re-parsing.
 */
import type { DeclaredOrderedPath } from "./knowledge-context-resolver";

export type DeclaredPathMergeResult = {
  steps: string[];
  insertedCount: number;
  existingCount: number;
  insertedTargets: string[];
  /** ALL actionTargets of recognized (applicable) declared paths — protected as
   *  functional declared steps even when insertedCount=0. Per-scenario. */
  matchedDeclaredPathTargets: string[];
  skipped: boolean;
  skipReason?: string;
  terminal?: string;
};

function _norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Shared click-target parser: recognizes both quoted ("Clic en \"X\"") and
 *  unquoted ("Clic en X") runtime formats, never assertions/titles/narrative.
 *  Used by the merger AND repairUnbackedClicks — one parser, one regex family. */
export function extractClickTarget(step: unknown): string | null {
  if (typeof step !== "string") return null;
  const quoted = step.match(/Clic en\s+"([^"]+)"/i);
  if (quoted) return quoted[1];
  const unquoted = step.match(/Clic en\s+([^"][^\r\n]*?)\s*\.?$/i);
  return unquoted ? unquoted[1].trim() : null;
}

function clickTargetOf(step: unknown): string | null {
  return extractClickTarget(step);
}

/** Merge applicable declared paths into a scenario's steps. Returns a new steps
 *  array and merge diagnostics. Pure and deterministic — no I/O. */
export function mergeDeclaredPathsIntoScenario(
  steps: string[],
  paths: DeclaredOrderedPath[],
): DeclaredPathMergeResult {
  const result: DeclaredPathMergeResult = {
    steps: [...steps],
    insertedCount: 0,
    existingCount: 0,
    insertedTargets: [],
    matchedDeclaredPathTargets: [],
    skipped: false,
  };

  for (const path of paths) {
    const pathSteps = [...path.steps].sort((a, b) => a.order - b.order);
    if (pathSteps.length < 2) continue;
    const terminal = pathSteps[pathSteps.length - 1];
    if (!terminal?.actionTarget) continue;
    const terminalNorm = _norm(terminal.actionTarget);

    // The path applies ONLY when the terminal appears as a real ACTION (click),
    // never in title, assertion or narrative text.
    const terminalIndex = result.steps.findIndex(
      (step) => clickTargetOf(step) !== null && _norm(clickTargetOf(step)!) === terminalNorm,
    );
    if (terminalIndex < 0) continue;

    const prefix = pathSteps.slice(0, -1);

    // Count prefix steps already present as actions before the terminal, in the
    // declared order (a prefix step may be preceded by other scenario steps).
    let matchedCount = 0;
    let searchFrom = 0;
    const consumedIndices = new Set<number>();
    for (const p of prefix) {
      const pNorm = _norm(p.actionTarget);
      for (let i = searchFrom; i < terminalIndex; i++) {
        const t = clickTargetOf(result.steps[i]);
        if (t !== null && _norm(t) === pNorm) {
          consumedIndices.add(i);
          matchedCount++;
          searchFrom = i + 1;
          break;
        }
      }
    }

    // Order conflict:
    //  - a prefix target appears AFTER the terminal action, or
    //  - a prefix target appears BEFORE the terminal but was NOT consumed by the
    //    in-order match (it sits out of declared order and can't be extended).
    let conflict = false;
    const prefixNorms = new Set(prefix.map((p) => _norm(p.actionTarget)));
    for (let i = terminalIndex + 1; i < result.steps.length; i++) {
      const t = clickTargetOf(result.steps[i]);
      if (t !== null && prefixNorms.has(_norm(t))) {
        conflict = true;
        break;
      }
    }
    if (!conflict) {
      for (let i = 0; i < terminalIndex; i++) {
        if (consumedIndices.has(i)) continue;
        const t = clickTargetOf(result.steps[i]);
        if (t !== null && prefixNorms.has(_norm(t))) {
          conflict = true;
          break;
        }
      }
    }

    if (conflict) {
      result.skipped = true;
      result.skipReason = "existing_path_order_conflict";
      result.terminal = terminal.actionTarget;
      continue;
    }

    // The declared_path is recognized as applicable to this scenario → ALL its
    // actionTargets become protected functional declared steps, regardless of
    // insertedCount (a full path the IA already returned must not be destroyed
    // by the unbacked-click repair).
    for (const p of pathSteps) {
      if (p.actionTarget && !result.matchedDeclaredPathTargets.includes(p.actionTarget)) {
        result.matchedDeclaredPathTargets.push(p.actionTarget);
      }
    }

    // Insert only the missing prefix steps, preserving declared order.
    const missing = prefix.slice(matchedCount).filter((p) => p.actionTarget);
    if (missing.length > 0) {
      const insertion = missing.map((p) => `Clic en "${p.actionTarget}"`);
      result.steps = [
        ...result.steps.slice(0, terminalIndex),
        ...insertion,
        ...result.steps.slice(terminalIndex),
      ];
      result.insertedCount += insertion.length;
      result.insertedTargets.push(...missing.map((p) => p.actionTarget));
    }
    result.existingCount += matchedCount;
    if (!result.terminal) result.terminal = terminal.actionTarget;
  }

  return result;
}