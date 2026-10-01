import type { SessionTrace } from "./session-trace.types";

/**
 * Does the recording do what its declared goal says?
 *
 * Recording 2920301b declared "solicitar tarjeta, prestamo y cuenta" but only browsed the product
 * details: "Solicitar" was on screen and never pressed. Nothing said so -- the generated cases
 * silently documented a consultation, and every suggestion was discarded as incoherent with a goal
 * the recording never reached. This compares each goal term with what was actually pressed and
 * reached, and names the control that was visible but not used.
 *
 * Structural and deterministic: words of the goal against labels and screen titles the recording
 * captured. No application vocabulary, no AI, no recorded values (only control labels).
 */

export type GoalTermCoverage = {
  term: string;
  /** An operation the user must perform ("solicitar"), or what it applies to ("tarjeta"). */
  kind: "action" | "object";
  covered: boolean;
  /** Pressed controls or reached screens that cover the term. */
  evidence: string[];
  /** For an uncovered action: a control that was on screen and matches it, never pressed. */
  missing?: { control: string; screen?: string };
};

export type GoalCoverageStatus = "no_goal" | "covered" | "partial" | "not_reached";

export type GoalCoverage = {
  goal?: string;
  status: GoalCoverageStatus;
  terms: GoalTermCoverage[];
  /** Distinct controls pressed, in order: what the recording actually did. */
  pressed: string[];
  acknowledged: boolean;
};

const STOP_WORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al", "en", "para", "por",
  "y", "e", "o", "u", "a", "con", "sin", "mi", "su", "sus", "mis", "que", "se", "lo", "le",
]);

/**
 * Verbs a walkthrough satisfies by reaching screens, not by pressing a particular control:
 * looking at something is what browsing already does.
 */
const BROWSING_VERBS = new Set(["ver", "consultar", "revisar", "explorar", "navegar", "mirar", "conocer", "visualizar", "recorrer"]);

/** Labels that name no function (icon-only controls captured without a name). */
const GENERIC_LABELS = /^(control|button|boton|icono|icon|elemento|imagen)$/i;

const FUNCTIONAL_KINDS = new Set(["tap", "press", "select", "fill"]);

function fold(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function words(value: string): string[] {
  return fold(value).split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/** A crude Spanish stem: enough to match "Préstamos" with "prestamo" or "Solicitar" with "solicitud". */
function stem(word: string): string {
  let current = word;
  for (const suffix of ["aciones", "acion", "iones", "ion", "udes", "ud", "es", "s", "ar", "er", "ir", "a", "o", "e"]) {
    if (current.endsWith(suffix) && current.length - suffix.length >= 4) {
      current = current.slice(0, -suffix.length);
      break;
    }
  }
  return current;
}

function sameStem(a: string, b: string): boolean {
  const left = stem(a);
  const right = stem(b);
  if (left.length < 4 || right.length < 4) return left === right;
  return left.startsWith(right) || right.startsWith(left);
}

function mentions(label: string, term: string): boolean {
  return words(label).some((word) => sameStem(word, term));
}

function isActionTerm(word: string): boolean {
  return word.length > 4 && /(ar|er|ir)$/.test(word);
}

export function evaluateGoalCoverage(trace: Pick<SessionTrace, "recordingGoal" | "label" | "events" | "screens">): GoalCoverage {
  const goal = trace.recordingGoal?.normalizedGoal ?? trace.recordingGoal?.declaredGoal;
  const acknowledged = Boolean(trace.recordingGoal?.coverageAcknowledged);
  const events = (trace.events ?? []) as Array<{ kind: string; target?: { label?: string } }>;
  const screens = (Array.isArray(trace.screens) ? trace.screens : Object.values(trace.screens ?? {})) as Array<{
    title?: string;
    controls?: Array<{ label?: string }>;
  }>;

  const pressed: string[] = [];
  for (const event of events) {
    const label = event.target?.label?.trim();
    if (!FUNCTIONAL_KINDS.has(event.kind) || !label || GENERIC_LABELS.test(label)) continue;
    if (!pressed.includes(label)) pressed.push(label);
  }
  if (!goal?.trim()) return { status: "no_goal", terms: [], pressed, acknowledged };

  const reached = screens.map((screen) => screen.title?.trim()).filter((title): title is string => Boolean(title));
  const visibleControls = screens.flatMap((screen) => (screen.controls ?? [])
    .map((control) => ({ control: control.label?.trim() ?? "", screen: screen.title?.trim() }))
    .filter((entry) => entry.control.length > 0 && !GENERIC_LABELS.test(entry.control)));

  const seen = new Set<string>();
  const terms: GoalTermCoverage[] = [];
  for (const word of words(goal)) {
    if (seen.has(stem(word))) continue;
    seen.add(stem(word));
    if (isActionTerm(word)) {
      if (BROWSING_VERBS.has(word)) {
        terms.push({ term: word, kind: "action", covered: reached.length > 1, evidence: reached.slice(-1) });
        continue;
      }
      const evidence = pressed.filter((label) => mentions(label, word));
      const missing = evidence.length === 0 ? visibleControls.find((entry) => mentions(entry.control, word)) : undefined;
      terms.push({
        term: word,
        kind: "action",
        covered: evidence.length > 0,
        evidence,
        ...(missing ? { missing: { control: missing.control, ...(missing.screen ? { screen: missing.screen } : {}) } } : {}),
      });
      continue;
    }
    const evidence = [...pressed, ...reached].filter((label) => mentions(label, word));
    terms.push({ term: word, kind: "object", covered: evidence.length > 0, evidence: [...new Set(evidence)].slice(0, 4) });
  }

  const status: GoalCoverageStatus = terms.every((term) => term.covered)
    ? "covered"
    : terms.some((term) => term.covered) ? "partial" : "not_reached";
  return { goal, status, terms, pressed, acknowledged };
}

/**
 * The operations a goal asks for ("solicitar" in "solicitar tarjeta"), browsing verbs excluded.
 * Shared with the suggestion quality gate (trace-to-scenario.ts scoreGoalRelevance) so both read a
 * goal's operation the same way.
 */
export function goalOperationTerms(goal: string | undefined): string[] {
  return [...new Set(words(goal ?? "").filter((word) => isActionTerm(word) && !BROWSING_VERBS.has(word)))];
}

/** Whether `text` names `term` in any word form ("Solicitud" for "solicitar"). */
export function textMentionsTerm(text: string, term: string): boolean {
  return mentions(text, term);
}
