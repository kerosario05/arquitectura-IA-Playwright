import type {
  FunctionalBranchRef,
  CanonicalClaim,
  FunctionalCoverageResult,
  FunctionalRequirementAccount,
  McpRejectedScenario,
  McpScenario,
  RequirementCategory,
  RequirementFacet,
  RequirementStatus,
} from "./scenario-types";

// ─────────────────────────────────────────────────────────────────────────────
// Functional scenario quality pass.
//
// Improves the functional quality of scenarios generated from a HU WITHOUT
// touching execution readiness, Knowledge, discovery, allowedExecutableClicks,
// aliases, Playwright or SQL.
//
// Objectives:
//   A. Branch purity  — a scenario for branch A must contain A and must NOT
//      contain actions of sibling branches (unless the HU states the
//      dependency explicitly). Stable reason: cross_branch_action_contamination.
//   B. Requirement-step alignment — a scenario must demonstrate in its steps
//      what its title/expected promises (negative rules → negative assertion,
//      pre-Entry checks happen before clicking Entry, welcome assertions before
//      navigating away). Never accept a title that promises a rule the steps do
//      not validate.
//   C. Semantic dedup — dedup by functional objective + actions + main
//      assertions (order-insensitive), never by title/id alone. Distinct
//      branches are never merged.
//   D. Coverage accounting — every extracted functional requirement must land in
//      covered / adaptive / nonAutomatable / incompleteRequirement. Truncated or
//      incomplete source text → incompleteRequirement (never invent the result).
//
// This pass NEVER re-validates clicks against allowedExecutableClicks. A
// functional scenario may contain "Clic en Branch A" even though it still
// requires route_learning.
// ─────────────────────────────────────────────────────────────────────────────

export interface FunctionalQualityResult {
  scenarios: McpScenario[];
  rejected: McpRejectedScenario[];
  generated: McpScenario[];
  cleaned: number;
  mismatched: number;
  removedDedup: number;
}

// ── Local generic helpers (project/HU agnostic) ─────────────────────────────

const norm = (s: unknown): string =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const stripStepNumber = (s: string): string => String(s).replace(/^\s*\d+[\.)]\s*/, "");

const isClickStep = (step: unknown): boolean => /^clic\s+en/i.test(stripStepNumber(String(step ?? "")));

const isAssertionStep = (step: unknown): boolean =>
  /^(validar|verificar|comprobar|visualizar|esperar|confirmar|asegurar)\b/i.test(stripStepNumber(String(step ?? "")));

/** Title expresses a positive visibility/observation intention.  Reuses the
 *  same verb set as `isAssertionStep` but tests for presence anywhere in the
 *  title (not just at the start).  Used as an intent gate for the title
 *  fallback in visibility coverage. */
const visibilityVerbRe = /\b(?:validar|verificar|comprobar|visualizar|esperar|confirmar|asegurar)\b/i;
const titleHasVisibilityVerb = (title: string): boolean => visibilityVerbRe.test(title);

const clickTargetsOf = (scenario: McpScenario): string[] =>
  (scenario.steps ?? [])
    .map((step) => String(step).match(/clic\s+en\s+"([^"]+)"/i)?.[1])
    .filter((t): t is string => Boolean(t));

const assertionTargetsOf = (scenario: McpScenario): string[] =>
  (scenario.steps ?? [])
    .filter((step) => isAssertionStep(step))
    .map((step) => String(step).match(/"([^"]+)"/i)?.[1])
    .filter((t): t is string => Boolean(t));

const isNegativeAssertion = (step: unknown): boolean => {
  const s = String(step ?? "");
  return (
    /no\s+(?:se\s+)?(?:muestre|muestra|visualice|visualiza|vea|aparezca|encuentre|exhiba|deba|debe|estar|est[ée])\s+/i.test(s) ||
    /(?:ausencia|ocultamiento|no\s+visible|no\s+presente|sin\s+mostrar|enmascarad|no\s+se\s+exhiba)/i.test(s)
  );
};

const scenarioText = (scenario: McpScenario): string =>
  [scenario.title ?? "", ...(scenario.steps ?? []), scenario.expectedResult ?? ""]
    .map((part) => String(part ?? ""))
    .join(" ");

const numberedSteps = (steps: string[]): string[] =>
  steps.map((step, index) => `${index + 1}. ${String(step).replace(/^\d+[\.)]\s*/, "").trim()}`);

// ── Objective A: branch purity ──────────────────────────────────────────────

const dependencyConnector = /\b(luego|despu[ée]s|seguido|seguidamente|entonces|siguiente|continuaci[oó]n|seguir con|antes de|previamente|primero|next|then|before|after)\b|→|->|>/i;

function hasExplicitDependency(huText: string, ownLabel: string, siblingLabel: string): boolean {
  const text = norm(huText);
  const own = norm(ownLabel);
  const sibling = norm(siblingLabel);
  if (!text || !own || !sibling) return false;
  let idxOwn = text.indexOf(own);
  while (idxOwn !== -1) {
    let idxSibling = text.indexOf(sibling);
    while (idxSibling !== -1) {
      if (Math.abs(idxSibling - idxOwn) <= 180) {
        const start = Math.min(idxOwn, idxSibling);
        const end = Math.max(idxOwn + own.length, idxSibling + sibling.length);
        const windowText = text.slice(start, end);
        if (dependencyConnector.test(windowText)) return true;
      }
      idxSibling = text.indexOf(sibling, idxSibling + 1);
    }
    idxOwn = text.indexOf(own, idxOwn + 1);
  }
  return false;
}

/**
 * Objective A — a scenario assigned to branch A must contain A and must not
 * contain click actions of sibling branches. Contaminated scenarios are CLEANED
 * (sibling clicks removed) so their branch coverage is preserved; a scenario
 * that cannot be cleaned without losing its own branch action is rejected with
 * the stable reason `cross_branch_action_contamination`.
 */
function enforceBranchPurity(
  scenarios: McpScenario[],
  functionalBranches: FunctionalBranchRef[],
  huText: string,
): { scenarios: McpScenario[]; rejected: McpRejectedScenario[]; cleaned: number } {
  const branchByLabel = new Map<string, string>();
  for (const branch of functionalBranches) {
    if (!branch.sourceLabel) continue;
    const key = norm(branch.sourceLabel);
    if (!branchByLabel.has(key)) branchByLabel.set(key, branch.branchId);
  }
  const kept: McpScenario[] = [];
  const rejected: McpRejectedScenario[] = [];
  let cleaned = 0;

  for (const scenario of scenarios) {
    const ownBranchId = scenario.functionalBranch?.branchId;
    if (!ownBranchId) {
      kept.push(scenario);
      continue;
    }
    const steps = [...(scenario.steps ?? [])];
    const contamination: string[] = [];
    for (const target of clickTargetsOf(scenario)) {
      const siblingId = branchByLabel.get(norm(target));
      if (siblingId !== undefined && siblingId !== ownBranchId) {
        if (hasExplicitDependency(huText, scenario.functionalBranch?.sourceLabel ?? "", target)) continue;
        contamination.push(target);
      }
    }
    if (contamination.length === 0) {
      kept.push(scenario);
      continue;
    }
    // Clean: drop sibling click steps, preserve own-branch clicks and assertions.
    const contaminatedNorm = new Set(contamination.map((t) => norm(t)));
    const cleanSteps = steps.filter((step) => {
      if (!isClickStep(step)) return true;
      const target = String(step).match(/clic\s+en\s+"([^"]+)"/i)?.[1];
      return !(target && contaminatedNorm.has(norm(target)));
    });
    const ownClickPresent = cleanSteps.some((step) => {
      if (!isClickStep(step)) return false;
      const target = String(step).match(/clic\s+en\s+"([^"]+)"/i)?.[1];
      return target !== undefined && norm(target) === norm(scenario.functionalBranch?.sourceLabel ?? "");
    });
    if (cleanSteps.length === 0 || !ownClickPresent) {
      rejected.push({
        sourceIssueKey: scenario.sourceIssueKey,
        reason: `cross_branch_action_contamination: ${contamination.join(", ")}`,
      });
      continue;
    }
    cleaned++;
    kept.push({ ...scenario, steps: numberedSteps(cleanSteps) });
  }
  return { scenarios: kept, rejected, cleaned };
}

// ── Objective B: requirement-step alignment ─────────────────────────────────

const negativeTitlePattern =
  /no\s+(?:se\s+)?(?:muestre|muestra|visualice|visualiza|vea|aparezca|exhiba|revele|exponga|exponer|mostrar|mostrarse)|ocult|restringid|enmascar|no\s+(?:debe|deber[íi]a)\s+(?:mostrar|ver|visualizar|exponer)/i;

const welcomePattern = /bienvenid|pantalla\s+(?:de\s+)?(?:inicio|inicial|principal|portada)|home|welcome|landing/i;

const entryDemandPattern =
  /no\s+(?:avanzar|navegar|continuar|ingresar|acceder|proseguir|pasar|seguir)\s+(?:sin|antes\s+de|hasta|antes\s+que|a\s+menos\s+que|previamente|que\s+completar)\s+(?:completar|hacer|realizar|el|la|lo|los|las|que|su\s+)?([a-zA-ZáéíóúüñÁÉÍÓÚÜÑ][a-zA-ZáéíóúüñÁÉÍÓÚÜÑ\s]{1,40})/i;

const stopWords = new Set([
  "que", "se", "de", "el", "la", "los", "las", "un", "una", "unos", "unas", "no", "sin", "y", "a", "al",
  "para", "por", "con", "en", "del", "lo", "al", "los", "las", "antes", "hasta", "cuando", "pueda",
]);

function extractEntryScreenLabel(huText: string): string | null {
  const match = huText.match(entryDemandPattern);
  if (!match || !match[1]) return null;
  const candidate = String(match[1]).replace(/[.,;:!?]+$/g, "").trim();
  if (candidate.length < 3 || candidate.length > 40) return null;
  const words = candidate.split(/\s+/);
  if (words.some((w) => stopWords.has(w.toLowerCase()))) {
    // Keep the last two words that are not stopwords — never invent content.
    const meaningful = words.filter((w) => !stopWords.has(w.toLowerCase()));
    if (meaningful.length === 0) return null;
    return meaningful.slice(0, 2).join(" ");
  }
  return candidate;
}

/**
 * Objective B — align each scenario with what its title/expected promises:
 *  - Negative titles must contain a functionally equivalent negative assertion.
 *  - Welcome-screen assertions must occur BEFORE navigating out of that screen.
 *  - If the HU explicitly demands "no avanzar antes de <Entry>", a scenario that
 *    verifies the pre-Entry state (without clicking Entry first) must exist.
 */
function ensureRequirementStepAlignment(
  scenarios: McpScenario[],
  huText: string,
): { scenarios: McpScenario[]; rejected: McpRejectedScenario[]; generated: McpScenario[]; mismatched: number } {
  const kept: McpScenario[] = [];
  const rejected: McpRejectedScenario[] = [];
  const generated: McpScenario[] = [];
  let mismatched = 0;

  for (const scenario of scenarios) {
    const titleExpected = [scenario.title ?? "", scenario.expectedResult ?? ""].join(" ");
    // Negative-title alignment applies to standalone negative scenarios. Branch
    // scenarios demonstrate their requirement through their decisive branch
    // action + destination assertion, so they are never dropped here.
    if (negativeTitlePattern.test(titleExpected) && !scenario.functionalBranch) {
      const hasNegative = (scenario.steps ?? []).some(isNegativeAssertion);
      if (!hasNegative) {
        mismatched++;
        rejected.push({
          sourceIssueKey: scenario.sourceIssueKey,
          reason: "requirement_step_mismatch: negative_title_without_negative_assertion",
        });
        continue;
      }
    }

    const steps = [...(scenario.steps ?? [])];
    const firstClick = steps.findIndex(isClickStep);
    if (firstClick > 0) {
      const isWelcomeAssertion = (step: unknown) => isAssertionStep(step) && welcomePattern.test(String(step ?? ""));
      const welcomeBeforeFirstClick = steps.slice(0, firstClick).some(isWelcomeAssertion);
      if (!welcomeBeforeFirstClick) {
        const welcomeAfter = steps.filter(isWelcomeAssertion);
        if (welcomeAfter.length > 0) {
          const before = steps.slice(0, firstClick);
          const after = steps.slice(firstClick).filter((step) => !isWelcomeAssertion(step));
          scenario.steps = numberedSteps([...before, ...welcomeAfter, ...after]);
        }
      }
    }

    kept.push(scenario);
  }

  // Pre-Entry verification scenario when the HU explicitly requires it.
  const entryLabel = extractEntryScreenLabel(huText);
  if (entryLabel) {
    const entryNorm = norm(entryLabel);
    const alreadyCoversPreEntry = kept.some((scenario) => {
      const steps = scenario.steps ?? [];
      const firstClick = steps.findIndex(isClickStep);
      const validatesEntryBeforeClick =
        firstClick === -1
          ? steps.some((step) => norm(step).includes(entryNorm))
          : steps.slice(0, firstClick).some((step) => isAssertionStep(step) && norm(step).includes(entryNorm));
      return validatesEntryBeforeClick;
    });
    if (!alreadyCoversPreEntry) {
      generated.push({
        sourceIssueKey: kept[0]?.sourceIssueKey ?? "functional",
        title: `Validar que no se avanza antes de completar ${entryLabel}`,
        steps: numberedSteps([
          `Validar que se muestre la pantalla de ${entryLabel}.`,
          `Validar que el control ${entryLabel} esté visible.`,
          `Validar que no se avanza a la siguiente pantalla sin completar ${entryLabel}.`,
        ]),
        preconditions: ["La aplicación está disponible."],
        expectedResult: `No se avanza antes de completar ${entryLabel}.`,
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_validation",
        setupStrategy: "no_login",
        appSlug: kept[0]?.appSlug ?? "",
        routeProfile: "",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        scenarioId: `functional:entry-precondition:${entryLabel.slice(0, 24)}`,
      } as McpScenario);
    }
  }

  // Explicit negative rule in the HU ("no mostrar X") must be represented by a
  // functionally equivalent negative assertion when no scenario covers it yet.
  const negativeTerm = extractNegativeTerm(huText);
  if (negativeTerm) {
    const negativeKey = norm(negativeTerm);
    const alreadyCoversNegative = kept.some(
      (scenario) =>
        (scenario.steps ?? []).some(isNegativeAssertion) &&
        norm(scenarioText(scenario)).includes(negativeKey),
    );
    if (!alreadyCoversNegative) {
      generated.push({
        sourceIssueKey: kept[0]?.sourceIssueKey ?? "functional",
        title: `Validar que no se muestra ${negativeTerm}`,
        steps: numberedSteps([`Validar que no se muestre "${negativeTerm}".`]),
        preconditions: ["La aplicación está disponible."],
        expectedResult: `No se muestra ${negativeTerm}.`,
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_validation",
        setupStrategy: "no_login",
        appSlug: kept[0]?.appSlug ?? "",
        routeProfile: "",
        dataRequirements: "N/A",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        scenarioId: `functional:negative-rule:${negativeKey.slice(0, 24)}`,
      } as McpScenario);
    }
  }

  return { scenarios: kept, rejected, generated, mismatched };
}

// ── Non-UI requirement scenarios ────────────────────────────────────────────

const inactivityPattern =
  /inactiv|sin\s+(?:actividad|interacci[oó]n)|timeout|tiempo\s+de\s+espera|sesi[oó]n\s+(?:expira|termine|caduque)/i;

const restartPattern =
  /reinici|restart|apagad|p[eé]rdida\s+de\s+(?:energ[íi]a|corriente|conexi[oó]n)|power\s+(?:loss|failure)/i;

const environmentPattern =
  /entorno\s+restringid|environment\s+(?:restriction|capability|variable)|capacidad\s+del\s+entorno|restricci[oó]n\s+del\s+entorno|permisos\s+de\s+entorno|capacidad\s+ambiental/i;

const inactivitySecondsMatch = (huText: string): string | null => {
  const match = huText.match(/inactiv\w*\s*(?:>=|de|mayor\s+[aá]|m[áa]s\s+de|al\s+menos)?\s*(\d+)\s*(?:segundos?|seg|minutos?|min|horas?|hrs?)/i);
  return match ? match[1] : null;
};

/**
 * Objective D — non-UI requirements (timeout/inactivity, restart/power-loss,
 * environment capability) must not silently disappear. A functional scenario is
 * generated for each one found in the HU so it remains accounted; its
 * nonExecutableCriteria marks it as non-UI so downstream readiness classifies it
 * nonAutomatable/adaptive without any readiness logic change.
 */
function generateNonUiRequirementScenarios(
  scenarios: McpScenario[],
  huText: string,
): { scenarios: McpScenario[]; generated: McpScenario[] } {
  const generated: McpScenario[] = [];
  const base = {
    sourceIssueKey: scenarios[0]?.sourceIssueKey ?? "functional",
    appSlug: scenarios[0]?.appSlug ?? "",
    preconditions: ["La aplicación está disponible."],
    type: "functional",
    database: "",
    isConverted: 0,
    automationType: "ui_validation",
    setupStrategy: "no_login",
    routeProfile: "",
    dataRequirements: "N/A",
  };

  const allText = scenarios.map(scenarioText).join(" ");

  if (inactivityPattern.test(huText)) {
    const seconds = inactivitySecondsMatch(huText);
    const alreadyCovered = /inactiv|timeout|sesi[oó]n\s+(?:expira|termine|caduque)/i.test(allText);
    if (!alreadyCovered) {
      const suffix = seconds ? ` >= ${seconds}` : "";
      generated.push({
        ...base,
        title: `Validar que la sesión expire tras inactividad${suffix}`,
        steps: numberedSteps([
          "Validar que la sesión permanece activa sin interacción.",
          seconds
            ? `Validar que tras ${seconds} segundos de inactividad la sesión expire.`
            : "Validar que tras el periodo de inactividad la sesión expire.",
        ]),
        expectedResult: `La sesión expira tras el periodo de inactividad${suffix}.`,
        nonExecutableCriteria: "inactivity_timeout_requirement",
        mcpExecutable: false,
        scenarioId: "functional:inactivity-timeout",
      } as McpScenario);
    }
  }

  if (restartPattern.test(huText)) {
    const alreadyCovered = /reinici|restart|p[eé]rdida\s+de\s+energ[íi]a/i.test(allText);
    if (!alreadyCovered) {
      generated.push({
        ...base,
        title: "Validar el estado inicial tras un reinicio o pérdida de energía",
        steps: numberedSteps([
          "Validar que tras un reinicio la aplicación vuelve a la pantalla inicial.",
          "Validar que no se pierde el estado de autenticación tras la recuperación.",
        ]),
        expectedResult: "La aplicación vuelve al estado inicial tras el reinicio.",
        nonExecutableCriteria: "restart_requirement",
        mcpExecutable: false,
        scenarioId: "functional:restart-power-loss",
      } as McpScenario);
    }
  }

  if (environmentPattern.test(huText)) {
    const alreadyCovered = /entorno\s+restringid|environment\s+capability/i.test(allText);
    if (!alreadyCovered) {
      generated.push({
        ...base,
        title: "Validar el comportamiento ante restricciones del entorno",
        steps: numberedSteps([
          "Validar que la aplicación se comporta según la capacidad del entorno.",
          "Validar que las restricciones del entorno no exponen datos sensibles.",
        ]),
        expectedResult: "La aplicación respeta las restricciones del entorno.",
        nonExecutableCriteria: "environment_capability_requirement",
        mcpExecutable: false,
        scenarioId: "functional:environment-capability",
      } as McpScenario);
    }
  }

  return { scenarios: [...scenarios, ...generated], generated };
}

// ── Objective C: semantic dedup ─────────────────────────────────────────────

function objectiveStrength(scenario: McpScenario): number {
  const assertionSet = assertionTargetsOf(scenario);
  const destination = scenario.functionalBranch?.expectedDestination ?? "";
  const steps = scenario.steps ?? [];
  return (
    steps.length
    + assertionSet.length
    + (destination && steps.some((step) => norm(step).includes(norm(destination))) ? 4 : 0)
  );
}

/**
 * Objective C — dedup by functional objective (branch + click sequence + ordered
 * assertion SET + destination), order-insensitive on assertions. The strongest
 * scenario is kept; distinct branches are never merged.
 */
function dedupeByFunctionalObjective(scenarios: McpScenario[]): { scenarios: McpScenario[]; removed: number } {
  const keyOf = (scenario: McpScenario): string => {
    const clicks = clickTargetsOf(scenario).join(">");
    const assertions = Array.from(new Set(assertionTargetsOf(scenario).map(norm))).sort().join("|");
    const branch = scenario.functionalBranch?.branchId ?? "none";
    const destination = norm(scenario.functionalBranch?.expectedDestination ?? scenario.expectedResult ?? "");
    return [branch, clicks, assertions, destination].join("||");
  };
  const byKey = new Map<string, McpScenario>();
  let removed = 0;
  for (const scenario of scenarios) {
    const key = keyOf(scenario);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, scenario);
      continue;
    }
    if (objectiveStrength(scenario) > objectiveStrength(existing)) byKey.set(key, scenario);
    removed++;
  }
  return { scenarios: Array.from(byKey.values()), removed };
}

// ── Objective D: universal requirement coverage accounting ──────────────────

const truncatedMarker = /(?:\.{3,}|\u2026|\[\.\.\.|truncat|cortad[oa]|incomplet[oa])\s*$/i;

interface RequirementCandidate {
  id: string;
  sourceRequirementId?: string;
  prerequisiteRequirementIds?: string[];
  category: RequirementCategory;
  sourceText: string;
  keyTerm: string;
  truncated: boolean;
  expectedBehavior?: string;
  associatedBranchId?: string;
  associatedDestination?: string;
  facets?: Array<"activation" | "destination" | "visibility" | "action" | "technical">;
}

function isTruncatedSource(sourceText: string): boolean {
  const trimmed = String(sourceText ?? "").trim();
  if (!trimmed) return true;
  return truncatedMarker.test(trimmed);
}

const negativeRulePattern =
  /no\s+(?:se\s+)?(?:muestre|muestra|visualice|visualiza|vea|aparezca|exhiba|exponga|exponer|mostrar|mostrarse)\s+(?:la\s+|el\s+|los\s+|las\s+|ninguna?\s+)?([a-záéíóúüñ]{3,40}(?:\s+[a-záéíóúüñ]{2,40}){0,4})/i;

function extractNegativeTerm(huText: string): string | null {
  const match = huText.match(negativeRulePattern);
  if (!match || !match[1]) return null;
  const term = String(match[1]).trim();
  if (term.length < 3 || term.length > 60) return null;
  return term;
}

// ── Universal extraction patterns (generic Spanish, no business hardcodes) ──

/** "se muestra X", "visualizar X", "debe estar visible X" → visibility/state requirement. */
const visibilityPattern =
  /(?:se\s+(?:muestre|muestra|visualice|visualiza|vea|aparezca|encuentre)\s+|mostrar\s+|visualizar\s+|debe\s+estar\s+visible\s+|se\s+debe\s+(?:mostrar|visualizar)\s+)(?:la\s+|el\s+|los\s+|las\s+|un\s+|una\s+)?["""\u201C\u201D]?([a-záéíóúüñ0-9][\wáéíóúüñ0-9\s\-]{2,40})["""\u201C\u201D]?/gi;

/** "seleccionar X", "clic en X", "presionar X", "tocar X" → required functional action. */
const actionPattern =
  /\b(?:seleccionar|seleccione|selecciona|elegir|elija|hacer\s+clic\s+en|clic\s+en|clic\s+sobre|tocar|toque|presionar|presione|pulsar|pulse|oprimir)\s+(?:el\s+|la\s+|los\s+|las\s+|en\s+el\s+|en\s+la\s+)?["""\u201C\u201D]?([a-záéíóúüñ0-9][\wáéíóúüñ0-9\s\-]{1,40})["""\u201C\u201D]?/gi;

/** "redirige a X", "muestra la pantalla de X", "inicia el flujo de X" → expected destination/result. */
const destinationPattern =
  /\b(?:redirig\w*\s+(?:a|al|a\s+la)|muestra\s+la\s+pantalla\s+(?:de|del)|se\s+muestra\s+la\s+pantalla\s+(?:de|del)|lleva\s+(?:a|al|a\s+la)|permite\s+acceder\s+(?:a|al|a\s+la)|inicia\s+el\s+flujo\s+(?:de|del)|accede\s+(?:al|a\s+la)\s+m[oó]dulo\s+(?:de|del)|dirige\s+(?:a|al|a\s+la))\s+["""\u201C\u201D]?([a-záéíóúüñ0-9][\wáéíóúüñ0-9\s\-]{1,40})["""\u201C\u201D]?/gi;

/** Shared generic prerequisite recognizer.
 *  Recognizes "<prerequisite phrase> + <action verb> + <visible target>" clauses
 *  (e.g. "para continuar debe seleccionar X", "antes de continuar haga clic en X",
 *  "no debe permitirse avanzar sin que el usuario seleccione X").
 *  Single source of truth for prerequisite phrases — consumed by
 *  extractRequirements here and by hu-declared knowledge persistence. */
const PREREQ_PREFIX =
  `(?:para\\s+(?:continuar|avanzar|ingresar|acceder|completar)|antes\\s+de\\s+continuar|primero|previamente|no\\s+debe\\s+permitirse\\s+(?:avanzar|continuar|proceder|ingresar|acceder)\\s+sin\\s+que)`;
const PREREQ_ACTION =
  `(?:seleccionar|seleccione|selecciona|elegir|elija|hacer\\s+clic\\s+en|haga\\s+clic\\s+en|clic\\s+en|clic\\s+sobre|tocar|toque|presionar|presione|pulsar|pulse|oprimir|ingresar\\s+a|acceder\\s+a)`;
const PREREQ_UI_NOUN =
  `(?:bot[oó]n|opci[oó]n|pantalla|p[aá]gina|vista|secci[oó]n|campo|men[uú]|elemento|control|enlace|link|tarjeta|recuadro|ventana|modal|í?t[eé]m|item)`;
const PREREQ_TARGET =
  `([a-záéíóúüñ0-9][\\wáéíóúüñ0-9\\s\\-]{1,40})`;
const PREREQUISITE_RE = new RegExp(
  `(?:\\b${PREREQ_PREFIX}\\b[^.\\n]{0,80}?\\b${PREREQ_ACTION}\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?${PREREQ_UI_NOUN}\\s+[""\u201C\u201D]?${PREREQ_TARGET}[""\u201C\u201D]?|\\b${PREREQ_PREFIX}\\b[^.\\n]{0,80}?\\b${PREREQ_ACTION}\\s+(?:el\\s+|la\\s+|los\\s+|las\\s+)?[""\u201C\u201D]?${PREREQ_TARGET}[""\u201C\u201D]?)`,
  "gi",
);

export type PrerequisiteTarget = {
  sourceText: string;
  actionIntent: string;
  actionTarget: string;
  truncated: boolean;
};

/** Normalized action intent derived from the actual verb used in the clause. */
function prerequisiteActionIntent(matchText: string): string {
  if (/ingresar\s+a|acceder\s+a/i.test(matchText)) return "navigate";
  if (/hacer\s+clic|haga\s+clic|clic\s+en|clic\s+sobre|tocar|toque|presionar|presione|pulsar|pulse|oprimir/i.test(matchText)) return "click";
  return "select";
}

/** Extract structured prerequisites from the HU text. The target always comes
 *  from the real HU clause (never business labels or fixed lists). */
export function extractPrerequisiteTargets(huText: string): PrerequisiteTarget[] {
  const results: PrerequisiteTarget[] = [];
  const text = String(huText ?? "").normalize("NFC");
  const seen = new Set<string>();
  for (const match of text.matchAll(PREREQUISITE_RE)) {
    const rawTarget = (match[1] ?? match[2] ?? "").trim();
    if (!rawTarget) continue;
    const atomic = cleanRequirementTarget(atomicRequirementTarget(rawTarget));
    if (!atomic) continue;
    const key = norm(atomic);
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      sourceText: String(match[0]).trim(),
      actionIntent: prerequisiteActionIntent(String(match[0])),
      actionTarget: atomic,
      truncated: isTruncatedMatch(text, match, atomic),
    });
  }
  return results;
}

/** "solo muestra X", "únicamente X", "restringe el acceso a X" → content restriction rule. */
const contentRestrictionPattern =
  /\b(?:solo\s+(?:se\s+)?(?:muestra|muestre|visualiza|visualice|aparece|debe\s+mostrar)|[uú]nicamente\s+(?:se\s+)?(?:muestra|muestre)|restring\w*\s+(?:el\s+acceso\s+a|la\s+visualizaci[oó]n\s+de|la\s+informaci[oó]n\s+de)|limita\s+(?:el\s+acceso\s+a|la\s+visualizaci[oó]n\s+de))\s+["""\u201C\u201D]?([a-záéíóúüñ0-9][\wáéíóúüñ0-9\s\-]{1,40})["""\u201C\u201D]?/gi;

/**
 * Generic UI nouns that are never a concrete requirement target by themselves.
 * "seleccionar el botón" → no requirement; "seleccionar el botón 'Alfa'" → Alfa.
 */
const REQUIREMENT_NOISE_RE =
  /^(?:bot[oó]n|opci[oó]n|pantalla|p[aá]gina|vista|secci[oó]n|campo|men[uú]|elemento|control|enlace|link|tarjeta|fila|columna|panel|recuadro|ventana|modal|di[aá]logo|notificaci[oó]n|alerta|mensaje|texto|imagen|icono|t[ií]tulo|encabezado|header|footer|barra|pieza|componente)$/i;

/** Abstract business concepts ("tipo de gestión", "módulo de información") → not a concrete UI requirement. */
const ABSTRACT_REQUIREMENT_RE =
  /^(?:tipo\s+de|inicio\s+de|cierre\s+de|proceso\s+de|m[oó]dulo\s+de|gesti[oó]n\s+de|operaci[oó]n\s+de|transacci[oó]n\s+de|consulta\s+de|solicitud\s+de|registro\s+de|configuraci[oó]n\s+de|administraci[oó]n\s+de|generaci[oó]n\s+de|cancelaci[oó]n\s+de|actualizaci[oó]n\s+de|eliminaci[oó]n\s+de|creaci[oó]n\s+de)/i;

/** Narrative/infinitive verbs that should never appear as the START of an action
 *  or visibility target.  When the captured target after "seleccionar ..." or
 *  "mostrar ..." begins with one of these verbs, the match is a false positive
 *  from a compound/narrative clause (e.g. "seleccionar visualizar la pantalla"). */
const NARRATIVE_INFINITIVES = new Set([
  "visualizar", "ver", "mostrar", "mostrarse",
  "seleccionar", "seleccione", "selecciona", "elegir", "elija",
  "hacer", "clic", "tocar", "toque", "presionar", "presione", "pulsar", "pulse", "oprimir",
  "ingresar", "ingrese", "acceder", "acceda", "navegar", "navegue",
  "completar", "completar", "llenar", "llene", "digitar", "digite", "ingresar", "ingrese",
  "continuar", "avanzar", "proceder",
  "esperar", "espere", "aguardar",
  "validar", "valide", "verificar", "verifique", "comprobar", "compruebe", "confirmar", "confirme",
  "descargar", "descargue", "exportar", "exporte", "imprimir", "imprima",
  "crear", "cree", "agregar", "agregue", "editar", "edite", "modificar", "modifique", "eliminar", "elimine",
  "enviar", "envíe", "recibir", "reciba", "aprobar", "apruebe", "rechazar", "rechace",
  "iniciar", "inicie", "cerrar", "cierre", "salir", "salga", "volver", "vuelva",
]);

/** Return true if the first word of `target` is an action/narrative infinitive
 *  that indicates the capture is a false positive from a compound clause. */
function startsWithNarrativeVerb(target: string): boolean {
  const first = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/\s+/)[0];
  return NARRATIVE_INFINITIVES.has(first);
}

/** Return a cleaned concrete target or null when the candidate is generic/abstract noise. */
function cleanRequirementTarget(raw: string | undefined): string | null {
  const value = String(raw ?? "").replace(/["""\u201C\u201D]/g, "").replace(/[.,;:!?]+$/g, "").trim();
  if (!value || value.length < 2 || value.length > 60) return null;
  const lower = value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (REQUIREMENT_NOISE_RE.test(lower)) return null;
  if (ABSTRACT_REQUIREMENT_RE.test(lower)) return null;
  return value;
}

/** Alternative/sequence connectors that terminate a free-text capture. */
const requirementConnector =
  /\b(?:o|u|y|e|ni)\b|\b(?:antes\s+de|despu[ée]s\s+de|antes|despu[ée]s|luego|entonces|seguidamente|posteriormente|seguido)\b|\b(?:para\s+poder|para\s+continuar|para|debe|deber[áa]|deber[íi]a|puede|podr[áa]|podr[íi]a|cuando|donde|mientras|hasta|sin|que)\b|\b(?:seleccionar|seleccione|selecciona|elegir|elija|hacer\s+clic|clic|tocar|toque|presionar|presione|pulsar|pulse|oprimir|navegar|ingresar|acceder|abrir|dirigirse|completar|llenar|digitar|escribir|enviar|recibir|aprobar|rechazar|crear|agregar|editar|modificar|eliminar|iniciar|cerrar|salir|volver|continuar|avanzar|proceder)\b|[,;]/i;

/** Truncate a raw capture at the first alternative/sequence connector. */
function atomicRequirementTarget(raw: string): string {
  const value = String(raw ?? "").trim();
  const match = value.match(requirementConnector);
  if (match && typeof match.index === "number" && match.index > 0) {
    return value.slice(0, match.index).trim();
  }
  return value;
}

/** Explicit clause boundary truncation for compound phrases.
 *  Cuts at "y poder", "para poder", "y seleccionar", "luego", etc.
 *  Applied as defense-in-depth after atomicRequirementTarget. */
const clauseBoundaryRe =
  /\s+(?:y\s+poder|para\s+poder|con\s+el\s+fin\s+de|y\s+seleccionar|y\s+hacer\s+clic|y\s+elegir|y\s+presionar|luego|despu[eé]s|posteriormente)\b/i;

function truncateAtClauseBoundary(raw: string): string {
  const value = String(raw ?? "").trim();
  const match = value.match(clauseBoundaryRe);
  if (match && typeof match.index === "number") {
    return value.slice(0, match.index).trim();
  }
  return value;
}

/** True when a capture equals a structured branch label or is contained by one. */
function isBranchTerm(raw: string, branchTermKeys: Set<string>): boolean {
  const term = norm(raw);
  if (!term) return false;
  if (branchTermKeys.has(term)) return true;
  for (const key of branchTermKeys) {
    if (key.includes(term) || term.includes(key)) return true;
  }
  return false;
}

/** True when a regex match is part of a negated phrase ("no mostrar X"). */
function isNegatedMatch(huText: string, match: RegExpMatchArray): boolean {
  const before = huText.slice(Math.max(0, (match.index ?? 0) - 12), match.index ?? 0).toLowerCase();
  return /\bno\s*$/.test(before) || /\bno\s+(?:se|debe|deber[íi]a|deber[áa]|podr[íi]a|puede|permite|mostrar)\s*$/i.test(before);
}

/** Detect truncation immediately after the ATOMIC term, never a later clause. */
function isTruncatedMatch(huText: string, match: RegExpMatchArray, atomic: string): boolean {
  if (truncatedMarker.test(String(match[0]))) return true;
  const idx = huText.indexOf(atomic, match.index ?? 0);
  if (idx === -1) return false;
  const tail = huText.slice(idx + atomic.length).trimStart();
  return truncatedMarker.test(tail.slice(0, 12));
}

/**
 * Extract the UNIVERSAL functional requirement contract from the HU text plus
 * the structured branches. Categories are derived from generic Spanish
 * linguistic patterns — never from fixed counts or business labels. Every
 * explicit requirement gets a stable id and must terminate in exactly one
 * RequirementStatus downstream.
 */
export function extractRequirements(
  huText: string,
  functionalBranches: FunctionalBranchRef[],
): RequirementCandidate[] {
  const candidates: RequirementCandidate[] = [];
  const seenKeys = new Set<string>();
  // A concrete term must not be counted twice across the click-oriented
  // categories ("seleccionar Entry" as both action and prerequisite). The first
  // category wins; this prevents inflating `required`.
  const seenClickTerms = new Set<string>();
  // Assertion-oriented categories share a term space: a term must not become
  // both a content restriction and a visibility requirement from one phrase.
  const seenContentRestrictionTerms = new Set<string>();
  const seenDestinationTerms = new Set<string>();
  const seenVisibilityTerms = new Set<string>();
  const branchTermKeys = new Set<string>();
  const add = (candidate: RequirementCandidate): void => {
    const key = `${candidate.category}:${norm(candidate.keyTerm)}:${candidate.associatedBranchId ?? ""}`;
    if (seenKeys.has(key)) return;
    if (candidate.category === "action" || candidate.category === "prerequisite") {
      const term = norm(candidate.keyTerm);
      if (branchTermKeys.has(term)) return; // the branch requirement already owns this action
      if (seenClickTerms.has(term)) return; // already extracted as a click-oriented requirement
      seenClickTerms.add(term);
    }
    seenKeys.add(key);
    candidates.push(candidate);
  };

  // 1. Functional branches — each branch is an ordinary requirement with its
  //    own requirementId. Sibling branches never cover each other.
  for (const branch of functionalBranches) {
    if (!branch.sourceLabel) continue;
    branchTermKeys.add(norm(branch.sourceLabel));
    add({
      id: `branch:${branch.branchId}`,
      sourceRequirementId: branch.sourceRequirementId ?? `branch:${branch.branchId}`,
      category: "branch",
      sourceText: branch.sourceLabel,
      keyTerm: branch.sourceLabel,
      truncated: isTruncatedSource(branch.sourceLabel),
      expectedBehavior: branch.expectedDestination ? `Llegar a ${branch.expectedDestination}` : undefined,
      associatedBranchId: branch.branchId,
      associatedDestination: branch.expectedDestination,
      facets: ["activation", ...(branch.expectedDestination ? ["destination" as const] : [])],
    });
  }

  // An explicitly listed set of alternatives is visible before activation. Its
  // visibility is therefore shared screen evidence; activation and destination
  // remain branch-scoped on the branch requirement above.
  const sharedScreenVisibility = functionalBranches.length > 1
    && /(?:opciones?|alternativas?|men[uú]|seleccionar|seleccione|elegir)[^\n:]*[:：]/i.test(huText);
  for (const branch of functionalBranches) {
    if (!branch.sourceLabel) continue;
    const visibilityId = sharedScreenVisibility
      ? `visibility:global:${norm(branch.sourceLabel)}`
      : `visibility:branch:${branch.branchId}`;
    add({
      id: visibilityId,
      sourceRequirementId: visibilityId,
      category: "visibility",
      sourceText: branch.sourceLabel,
      keyTerm: branch.sourceLabel,
      truncated: isTruncatedSource(branch.sourceLabel),
      expectedBehavior: `Se muestra ${branch.sourceLabel}`,
      ...(sharedScreenVisibility ? {} : { associatedBranchId: branch.branchId }),
      facets: ["visibility"],
    });
  }

  // Explicit prerequisite phrases — shared recognizer pre-scan so an explicit
  // "<prerequisite phrase> + <action verb> + <target>" clause is categorized as
  // prerequisite (never re-claimed as a plain action).
  const prerequisiteTargets = extractPrerequisiteTargets(huText);
  const prereqTermKeys = new Set(prerequisiteTargets.map((p) => norm(p.actionTarget)));

  // 2. Required functional actions (click-oriented).
  let actionCount = 0;
  for (const match of huText.matchAll(actionPattern)) {
    const rawFull = String(match[1] ?? "").trim();
    if (isNegatedMatch(huText, match)) continue; // "no mostrar X" is a negative rule, not an action
    if (isBranchTerm(rawFull, branchTermKeys)) continue; // the branch requirement owns it
    const atomic = cleanRequirementTarget(atomicRequirementTarget(rawFull));
    if (!atomic || isBranchTerm(atomic, branchTermKeys)) continue;
    if (prereqTermKeys.has(norm(atomic))) continue; // explicit prerequisite owns the term
    if (startsWithNarrativeVerb(atomic)) continue; // compound clause: "seleccionar visualizar ..." → skip
    actionCount++;
    add({
      id: `action:${actionCount}`,
      category: "action",
      sourceText: String(match[0]),
      keyTerm: atomic,
      truncated: isTruncatedMatch(huText, match, atomic),
      expectedBehavior: `Seleccionar ${atomic}`,
    });
  }

  // 3. Prerequisite rules — shared generic recognizer; same click-oriented
  //    dedup so "seleccionar Entry" is never counted twice.
  let prerequisiteCount = 0;
  for (const prereq of prerequisiteTargets) {
    if (isBranchTerm(prereq.actionTarget, branchTermKeys)) continue;
    prerequisiteCount++;
    add({
      id: `prerequisite:${prerequisiteCount}`,
      category: "prerequisite",
      sourceText: prereq.sourceText,
      keyTerm: prereq.actionTarget,
      truncated: prereq.truncated,
      expectedBehavior: `Avanzar requiere ${prereq.actionTarget}`,
    });
  }

  // 4. Entry precondition ("no avanzar antes de <Entry>") — distinct rule; skip
  //    when the target is already owned by a structured branch.
  const entryLabel = extractEntryScreenLabel(huText);
  if (entryLabel && !branchTermKeys.has(norm(entryLabel))) {
    add({
      id: "entry_precondition:1",
      category: "entry_precondition",
      sourceText: `no avanzar antes de ${entryLabel}`,
      keyTerm: entryLabel,
      truncated: false,
      expectedBehavior: `No avanzar sin ${entryLabel}`,
    });
  }

  // 5. Assertion-oriented requirements share a term space so a single phrase
  //    ("solo se muestre Detalle") never yields both a content restriction and
  //    a visibility requirement. Content restrictions take priority.

  // 5a. Content restrictions.
  let contentRestrictionCount = 0;
  for (const match of huText.matchAll(contentRestrictionPattern)) {
    if (isNegatedMatch(huText, match)) continue;
    const term = cleanRequirementTarget(atomicRequirementTarget(String(match[1] ?? "")));
    if (!term) continue;
    const tKey = norm(term);
    if (seenContentRestrictionTerms.has(tKey)) continue;
    seenContentRestrictionTerms.add(tKey);
    contentRestrictionCount++;
    add({
      id: `content_restriction:${contentRestrictionCount}`,
      category: "content_restriction",
      sourceText: String(match[0]),
      keyTerm: term,
      truncated: isTruncatedMatch(huText, match, term),
      expectedBehavior: `Contenido restringido: ${term}`,
    });
  }

  // 5b. Expected destinations / results.
  let destinationCount = 0;
  for (const match of huText.matchAll(destinationPattern)) {
    if (isNegatedMatch(huText, match)) continue;
    const term = cleanRequirementTarget(atomicRequirementTarget(String(match[1] ?? "")));
    if (!term) continue;
    const tKey = norm(term);
    if (seenDestinationTerms.has(tKey)) continue;
    seenDestinationTerms.add(tKey);
    destinationCount++;
    add({
      id: `destination:${destinationCount}`,
      category: "destination",
      sourceText: String(match[0]),
      keyTerm: term,
      truncated: isTruncatedMatch(huText, match, term),
      expectedBehavior: `Resultado: ${term}`,
      facets: ["destination"],
    });
  }

  // 5c. Visibility/state requirements.
  let visibilityCount = 0;
  for (const match of huText.matchAll(visibilityPattern)) {
    if (isNegatedMatch(huText, match)) continue; // "no mostrar X" → negative rule
    const term = cleanRequirementTarget(
      truncateAtClauseBoundary(atomicRequirementTarget(String(match[1] ?? ""))),
    );
    if (!term) continue;
    if (startsWithNarrativeVerb(term)) continue; // compound clause: "mostrar seleccionar ..." → skip
    const tKey = norm(term);
    if (seenVisibilityTerms.has(tKey)) continue;
    seenVisibilityTerms.add(tKey);
    visibilityCount++;
    add({
      id: `visibility:${visibilityCount}`,
      category: "visibility",
      sourceText: truncateAtClauseBoundary(String(match[0])),
      keyTerm: term,
      truncated: isTruncatedMatch(huText, match, term),
      expectedBehavior: `Mostrar ${term}`,
    });
  }

  // 6. Negative rules.
  const negativeMatch = huText.match(negativeRulePattern);
  if (negativeMatch && negativeMatch[0]) {
    const negativeTerm = negativeMatch[1] ? String(negativeMatch[1]).trim() : String(negativeMatch[0]);
    add({
      id: "negative:1",
      category: "negative",
      sourceText: String(negativeMatch[0]),
      keyTerm: negativeTerm,
      truncated: isTruncatedSource(String(negativeMatch[0])),
      expectedBehavior: `No mostrar ${negativeTerm}`,
    });
  }

  // 7. Special-capability requirements (timeout/inactivity, restart, environment).
  if (inactivityPattern.test(huText)) {
    const line = huText.split(/[\n\r]+/).find((l) => inactivityPattern.test(l)) ?? "inactividad";
    add({
      id: "inactivity:1",
      category: "inactivity",
      sourceText: line.trim(),
      keyTerm: "inactividad",
      truncated: isTruncatedSource(line.trim()),
      expectedBehavior: "La sesión termina tras inactividad",
    });
  }

  if (restartPattern.test(huText)) {
    const line = huText.split(/[\n\r]+/).find((l) => restartPattern.test(l)) ?? "reinicio";
    add({
      id: "restart:1",
      category: "restart",
      sourceText: line.trim(),
      keyTerm: "reinicio",
      truncated: isTruncatedSource(line.trim()),
      expectedBehavior: "El sistema se recupera tras reinicio",
    });
  }

  if (environmentPattern.test(huText)) {
    const line = huText.split(/[\n\r]+/).find((l) => environmentPattern.test(l)) ?? "entorno";
    add({
      id: "environment:1",
      category: "environment",
      sourceText: line.trim(),
      keyTerm: "entorno",
      truncated: isTruncatedSource(line.trim()),
      expectedBehavior: "El sistema respeta restricciones del entorno",
    });
  }

  // An explicit "before continuing" prerequisite applies to downstream
  // structured branches; the relation is carried by IDs, never by labels.
  const prerequisiteIds = candidates
    .filter((candidate) => candidate.category === "prerequisite")
    .map((candidate) => candidate.sourceRequirementId ?? candidate.id);
  if (prerequisiteIds.length > 0) {
    for (const candidate of candidates) {
      if (candidate.category !== "branch") continue;
      candidate.prerequisiteRequirementIds = [...prerequisiteIds];
    }
  }

  return candidates;
}

export function buildRequirementManifest(
  huText: string,
  functionalBranches: FunctionalBranchRef[] = [],
): FunctionalRequirementAccount[] {
  return extractRequirements(huText, functionalBranches).map((requirement) => ({
    id: requirement.id,
    requirementId: requirement.sourceRequirementId ?? requirement.id,
    sourceRequirementId: requirement.sourceRequirementId ?? requirement.id,
    prerequisiteRequirementIds: requirement.prerequisiteRequirementIds,
    sourceIssueKey: "",
    category: requirement.category,
    sourceText: requirement.sourceText,
    expectedBehavior: requirement.expectedBehavior ?? "",
    associatedBranchId: requirement.associatedBranchId,
    facets: requirement.facets,
  }));
}

function claimTypeForFacet(facet: RequirementFacet): CanonicalClaim["claimType"] {
  if (facet === "activation" || facet === "action") return "action";
  if (facet === "destination") return "semantic_destination_assertion";
  if (facet === "visibility") return "visibility_assertion";
  return "technical_route_step";
}

function targetKindForFacet(facet: RequirementFacet): CanonicalClaim["targetKind"] {
  if (facet === "destination") return "semantic_destination";
  if (facet === "technical") return "structured_route";
  return "declared_ui_target";
}

export function buildCanonicalClaims(requirements: FunctionalRequirementAccount[]): CanonicalClaim[] {
  return requirements.flatMap((requirement) => {
    const requirementId = requirement.requirementId ?? requirement.id;
    if (!requirementId) return [];
    const facets = requirement.facets?.length
      ? requirement.facets
      : requirement.category === "visibility" ? ["visibility" as const]
        : requirement.category === "action" || requirement.category === "prerequisite" ? ["action" as const]
          : requirement.category === "branch" ? ["activation" as const, "destination" as const]
            : requirement.category === "destination" ? ["destination" as const]
            : ["technical" as const];
    const coverable = isRequirementFunctionallyCoverable(requirement);
    return facets.map((facet) => ({
      claimId: `${requirementId}::${facet}`,
      requirementId,
      facet,
      claimType: claimTypeForFacet(facet),
      targetKind: targetKindForFacet(facet),
      required: requirement.category !== "restart" && requirement.category !== "environment",
      coverable,
      ...(requirement.associatedBranchId
        ? { scope: "branch" as const, scopeId: requirement.associatedBranchId }
        : { scope: "global" as const }),
    }));
  });
}

/**
 * Categories that are functionally EVALUABLE: a scenario with the right
 * functional evidence can legitimately cover them. `inactivity` / `restart` /
 * `environment` and truncated source are NOT evaluable — they are accounted
 * (adaptive / nonAutomatable / incompleteRequirement) but never silently
 * counted as missing coverage.
 */
const EVALUABLE_CATEGORIES: ReadonlySet<RequirementCategory> = new Set([
  "branch",
  "visibility",
  "action",
  "destination",
  "negative",
  "prerequisite",
  "entry_precondition",
  "content_restriction",
]);

export function isRequirementFunctionallyCoverable(requirement: Pick<FunctionalRequirementAccount, "category" | "reasonCode">): boolean {
  return EVALUABLE_CATEGORIES.has(requirement.category) && requirement.reasonCode !== "incomplete_source_text";
}

// ── Visibility conservative matching (generic, no business vocab) ───────────

/** Within one edit (substitution / insertion / deletion / transposition).
 *  Pure edit-distance gate — no synonym tables, no project vocabulary.
 *  Substitution/insertion/deletion require a substantial common prefix to
 *  avoid accepting unrelated words (e.g. "saldo"≠"salto").  Transposition
 *  is only allowed for longer tokens where a single swap is a plausible
 *  typo, never for short words where it would conflate real terms. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 1) return false;

  // Insertion / deletion
  if (m !== n) {
    const short = m < n ? a : b;
    const long = m < n ? b : a;
    let i = 0;
    let j = 0;
    let skips = 0;
    while (i < short.length && j < long.length) {
      if (short[i] === long[j]) {
        i++;
        j++;
      } else {
        skips++;
        j++;
        if (skips > 1) return false;
      }
    }
    if (skips + (long.length - j) > 1) return false;
    // Require substantial common prefix — a single insertion/deletion in a
    // short word with little shared root is NOT enough evidence.
    let common = 0;
    while (common < short.length && short[common] === long[common]) common++;
    return common >= 4 || common / short.length >= 0.7;
  }

  // Same length: substitution or transposition.
  let diffs = 0;
  let firstDiff = -1;
  for (let i = 0; i < m; i++) {
    if (a[i] !== b[i]) {
      diffs++;
      if (firstDiff === -1) firstDiff = i;
      if (diffs > 2) return false;
    }
  }

  // Single substitution — require substantial shared root prefix.
  if (diffs === 1) {
    let common = 0;
    while (common < m && a[common] === b[common]) common++;
    return common >= 4 || common / m >= 0.7;
  }

  // Two adjacent differences — transposition.  Only accept for longer tokens
  // where a single swap is a plausible typo, never for short words where it
  // would conflate genuinely distinct terms.
  if (diffs === 2) {
    const isTransposition =
      firstDiff >= 0 &&
      firstDiff + 1 < m &&
      a[firstDiff] === b[firstDiff + 1] &&
      a[firstDiff + 1] === b[firstDiff];
    return isTransposition && m >= 8;
  }

  return false;
}

/** Generic near-equivalence for a single significant token:
 *  exact | one-edit typo | shared-root morphological variant.
 *  Approximate matching applies ONLY to sufficiently long tokens so short
 *  words never produce false positives. No hardcoded synonym pairs. */
function visibilityTokenNear(reqToken: string, assertionToken: string): boolean {
  if (reqToken === assertionToken) return true;
  if (reqToken.length < 4 || assertionToken.length < 4) return false;
  if (withinOneEdit(reqToken, assertionToken)) return true;
  // Morphological: shared-root must be clearly dominant — common prefix >= 5
  // chars AND >= 60% of the shorter token.  Prevents conflating unrelated
  // words that merely share a short prefix (e.g. "saldo"/"salto").
  let common = 0;
  const limit = Math.min(reqToken.length, assertionToken.length);
  while (common < limit && reqToken[common] === assertionToken[common]) common++;
  const shorter = Math.min(reqToken.length, assertionToken.length);
  return common >= 5 && Math.abs(reqToken.length - assertionToken.length) <= 2 && common / shorter >= 0.6;
}

/** Significant tokens: alnum-only, generic stopwords dropped. Reuses the
 *  module-level `stopWords` set. */
function significantTokens(value: string): string[] {
  return value
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));
}

/** Conservative visibility fallback: every significant requirement token must
 *  find a near-equivalent inside the SAME assertion target. Tokens from
 *  different assertions are never mixed. */
function visibilityCoveredByAssertions(assertions: string[], key: string): boolean {
  const reqTokens = significantTokens(key);
  if (reqTokens.length === 0) return false;
  return assertions.some((assertion) => {
    const asTokens = significantTokens(assertion);
    if (asTokens.length === 0) return false;
    return reqTokens.every((reqToken) =>
      asTokens.some((asToken) => visibilityTokenNear(reqToken, asToken)),
    );
  });
}

/**
 * Does a scenario demonstrate the requirement functionally?
 *
 * - branch: click OWN branch label AND assertion of its own destination.
 *   assertVisible(branch) alone never covers selecting the branch.
 * - negative: a negative assertion mentioning the forbidden term.
 * - visibility: a specific assertion of the term.
 * - action: a click of the term (not merely an assertion).
 * - destination: a specific assertion of the destination term.
 * - prerequisite / entry_precondition: the pre-state is validated BEFORE the
 *   prerequisite is executed, OR the prerequisite is clicked and a resulting
 *   state asserted.
 * - content_restriction: an assertion (positive or negative) about the term.
 * - inactivity / restart / environment: never covered by a plain state
 *   assertion — handled as adaptive / nonAutomatable upstream.
 */
function scenarioCoversRequirement(scenario: McpScenario, requirement: RequirementCandidate): boolean {
  const trace = (result: boolean, reason: string, refFound: boolean, refIndex?: number) => {
    console.log(`[requirement-coverage-trace] requirementId=${requirement.sourceRequirementId ?? requirement.id} scenarioId=${scenario.scenarioId ?? scenario.sourceIssueKey ?? "unknown"} refFound=${refFound} refIndex=${refIndex ?? "none"} scenarioValid=${scenario.validation?.valid !== false} branchRequired=${Boolean(requirement.associatedBranchId)} branchMatches=${requirement.associatedBranchId ? scenario.functionalBranch?.branchId === requirement.associatedBranchId : "n-a"} prerequisites=${JSON.stringify(requirement.prerequisiteRequirementIds ?? [])} structuredCoverageCandidate=${refFound} finalCoversRequirement=${result} firstFailedCondition=${reason}`);
    return result;
  };
  // Execution/readiness invalidation does not erase functional evidence. The
  // readiness gate may set mcpExecutable=false after canonical refs exist;
  // only scenarios still executable-invalid participate in this guard.
  if (scenario.validation?.valid === false && scenario.mcpExecutable !== false) {
    return trace(false, "scenario_invalid", false);
  }
  const requirementId = requirement.sourceRequirementId ?? requirement.id;
  const refs = scenario.stepRequirementRefs ?? [];
  const refFor = (id: string) => refs.filter((ref) =>
    ref.requirementId === id && Number.isInteger(ref.stepIndex) && ref.stepIndex >= 0 && ref.stepIndex < (scenario.steps ?? []).length,
  );
  const requirementRefs = refFor(requirementId);
  if (requirementRefs.length === 0) return trace(false, "ref_missing_or_invalid", false);
  if (requirement.associatedBranchId && scenario.functionalBranch?.branchId !== requirement.associatedBranchId) return trace(false, "branch_mismatch", true, requirementRefs[0].stepIndex);
  for (const prerequisiteId of requirement.prerequisiteRequirementIds ?? []) {
    const prerequisiteRefs = refFor(prerequisiteId);
    if (prerequisiteRefs.length === 0) return trace(false, "prerequisite_ref_missing", true, requirementRefs[0].stepIndex);
    if (!prerequisiteRefs.some((prerequisite) => requirementRefs.some((dependent) => prerequisite.stepIndex < dependent.stepIndex))) return trace(false, "prerequisite_order_invalid", true, requirementRefs[0].stepIndex);
  }
  return trace(true, "none", true, requirementRefs[0].stepIndex);

  // Legacy text checks remain below for callers that do not have structured refs.
  const text = norm(scenarioText(scenario));
  const key = norm(requirement.keyTerm);
  if (!key) return false;
  const mentions = text.includes(key);
  const steps = scenario.steps ?? [];
  const clicks = clickTargetsOf(scenario).map(norm);
  const assertions = assertionTargetsOf(scenario).map(norm);
  const matches = (list: string[], term: string): boolean =>
    list.some((entry) => entry === term || entry.includes(term) || term.includes(entry));

  switch (requirement.category) {
    case "branch": {
      const ownClick = matches(clicks, key);
      if (!ownClick) return false;
      const destination = requirement.associatedDestination ? norm(requirement.associatedDestination) : "";
      if (!destination) return true;
      return matches(assertions, destination);
    }
    case "negative":
      return mentions && steps.some(isNegativeAssertion);
    case "visibility":
      if (matches(assertions, key)) return true;
      if (visibilityCoveredByAssertions(assertions, key)) return true;
      if (
        steps.some(isAssertionStep) &&
        titleHasVisibilityVerb(scenario.title ?? "") &&
        visibilityCoveredByAssertions([norm(scenario.title ?? "")], key)
      ) {
        return true;
      }
      return false;
    case "action":
      return matches(clicks, key);
    case "destination":
      return matches(assertions, key);
    case "prerequisite":
    case "entry_precondition": {
      const firstClick = steps.findIndex(isClickStep);
      const before = firstClick === -1 ? steps : steps.slice(0, firstClick);
      const validatesBefore = before.some((step) => isAssertionStep(step) && norm(step).includes(key));
      const clickedThenAsserted = matches(clicks, key) && steps.some(isAssertionStep);
      return validatesBefore || clickedThenAsserted;
    }
    case "content_restriction":
      return mentions && (steps.some(isAssertionStep) || steps.some(isNegativeAssertion));
    default:
      return mentions;
  }
}

/**
 * Derive functionalCoverage from the SAME requirements[] list that feeds
 * requirementAccounting:
 *   - required  = evaluable functional requirements (branch/visibility/action/
 *                 destination/negative/prerequisite/entry_precondition/
 *                 content_restriction)
 *   - covered   = evaluable requirements with status "covered"
 *   - missing   = evaluable requirements with status "incompleteRequirement"
 *                 (silent gaps that SHOULD be covered but have no covering
 *                 scenario)
 *   - valid     = no missing coverage and every requirement classified
 * adaptive (e.g. dynamic selection awaiting runtime materialization, sensitive
 * action awaiting runtime evidence) and nonAutomatable are ACCOUNTED but are
 * NOT part of missing — they are not expected to be functionally covered in
 * this stage.
 */
export function computeFunctionalCoverage(requirements: FunctionalRequirementAccount[]): FunctionalCoverageResult {
  const invariant = evaluateFunctionalCoverageInvariant(requirements);
  return {
    required: invariant.coverableRequired,
    covered: invariant.covered,
    missing: invariant.missing,
    valid: invariant.valid,
  };
}

export type FunctionalCoverageInvariant = {
  coverableRequired: number;
  coverableSatisfied: number;
  covered: number;
  nonAutomatable: number;
  incomplete: number;
  missing: string[];
  valid: boolean;
};

export function evaluateFunctionalCoverageInvariant(
  requirements: FunctionalRequirementAccount[],
): FunctionalCoverageInvariant {
  // Truncated source (incomplete_source_text) is NOT evaluable: we cannot know
  // what behavior is required, so it can never be "missing" functional coverage.
  const evaluable = requirements.filter(
    isRequirementFunctionallyCoverable,
  );
  const missing = evaluable
    .filter((r) => r.status === "incompleteRequirement" || !r.status)
    .map((r) => r.id)
    .filter((id): id is string => Boolean(id));
  const unclassified = requirements.filter((r) => !r.status).length;
  const nonAutomatable = requirements.filter((r) => r.status === "nonAutomatable").length;
  const incomplete = evaluable.filter((r) => r.status === "incompleteRequirement" || !r.status).length;
  const coverableSatisfied = evaluable.filter((r) => r.status === "covered" || r.status === "adaptive").length;
  return {
    coverableRequired: evaluable.length,
    coverableSatisfied,
    covered: evaluable.filter((r) => r.status === "covered").length,
    nonAutomatable,
    incomplete,
    missing,
    valid: incomplete === 0 && coverableSatisfied === evaluable.length && unclassified === 0,
  };
}

/** Validate generator-provided step references without deriving them from text. */
export function validateStepRequirementRefs(
  scenario: McpScenario,
  requirements: FunctionalRequirementAccount[],
): McpScenario {
  if (!scenario.stepRequirementRefs) return scenario;
  const known = new Set(requirements.map((requirement) => requirement.requirementId ?? requirement.id).filter(Boolean));
  const refs = scenario.stepRequirementRefs.filter((ref) =>
    Number.isInteger(ref.stepIndex) && ref.stepIndex >= 0 && ref.stepIndex < scenario.steps.length && known.has(ref.requirementId),
  );
  const covered = new Set(refs.flatMap((ref) => [ref.requirementId, ...(ref.prerequisiteRequirementIds ?? [])]));
  const required = new Set(
    scenario.requirementDependencies?.flatMap((dependency) => dependency.prerequisiteRequirementIds ?? []) ?? [],
  );
  scenario.stepRequirementRefs = refs;
  scenario.missingPrerequisiteRequirementIds = [...required].filter((id) => !covered.has(id));
  return scenario;
}

/** Indefinite/anaphoric/quantifier determiner opening a dynamic collection
 *  selection reference: "un producto", "uno de los tipos", "algún elemento",
 *  "el primer elemento visible". Such actions depend on a runtime catalog not
 *  yet discovered — no concrete execution-backed target exists. Never
 *  fabricate a concrete label for them. */
const DYNAMIC_SELECTION_RE =
  /^(?:uno\s+de\s+(?:los|las)|una\s+de\s+(?:los|las)|un\s+|una\s+|unos\s+|unas\s+|alg[uú]n\s+|alguna\s+|algunos\s+|algunas\s+|cualquier\s+|cualquiera\s+|otro\s+|otra\s+|otros\s+|otras\s+|varios\s+|varias\s+|cada\s+|el\s+primer\s+|la\s+primera\s+|los\s+primeros\s+|las\s+primeras\s+|primer\s+|primera\s+|primeros\s+|primeras\s+)/i;

/** Destructive/committing action verbs that require runtime evidence
 *  (confirmation dialogs, security context) before execution. Mirror of the
 *  compliance sensitive-action protection. Generic Spanish verbs — no business
 *  labels. */
const SENSITIVE_ACTION_RE =
  /\b(?:solicitar|solicita|solicite|pagar|pague|paga|transferir|transfer|contratar|contrata|confirma|confirmar|autorizar|autoriza|aprobar|aprueba|firmar|firma|enviar|env[ií]a|aceptar|acepta|debitar|debita|eliminar|elimina|cancelar|cancela|sensibl\w*)\b/i;

/** True when an ACTION requirement selects from a dynamic collection not yet
 *  discovered (no concrete execution-backed target exists). */
function isDynamicSelectionAction(requirement: RequirementCandidate): boolean {
  const term = norm(requirement.keyTerm ?? requirement.sourceText ?? "");
  return DYNAMIC_SELECTION_RE.test(term);
}

// ── AI-invented ordinal selection normalization ─────────────────────────────

/** Ordinal determiner opening a dynamic selection step. The ordinal word encodes
 *  the gender, which lets us derive the indefinite article ("el primer X" →
 *  "un X", "la primera X" → "una X"). */
const SELECTION_ORDINAL_RE =
  /^Seleccionar\s+(?:el\s+|la\s+)?(primer|primera|[uú]ltimo|[uú]ltima)\s+(.+)$/i;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * When an AI-generated selection step contains an ordinal ("el primer préstamo")
 * that the HU/source requirement does NOT declare explicitly, normalize it
 * conservatively to a dynamic non-ordinal selection ("un préstamo") — the AI
 * cannot decide WHICH dynamic collection item must be selected.
 *
 * If the HU explicitly declares the ordinal ("seleccionar el primer préstamo"),
 * the ordinal is preserved. The functional noun is always preserved (never
 * replaced by a generic "elemento"), and no concrete label/index is invented.
 * The normalized step stays dynamic: requires_runtime_materialization.
 */
export function normalizeInventedOrdinalSelection(step: unknown, huText: string): string {
  const raw = String(step ?? "").trim();
  const m = raw.match(SELECTION_ORDINAL_RE);
  if (!m) return raw;
  const ordinal = m[1];
  const nounPhrase = m[2].trim();
  const firstWord = nounPhrase.split(/\s+/)[0];
  if (!nounPhrase || !firstWord) return raw;

  // Declared by HU/source requirement? e.g. "seleccionar el primer préstamo".
  const declared = new RegExp(
    `(?:primer|primera|ultimo|ultima)\\s+${escapeRegExp(norm(firstWord))}`,
    "i",
  ).test(norm(huText));
  if (declared) return raw;

  // Derive indefinite article from the ordinal's gender.
  const article = /^(?:primer|ultimo)$/.test(norm(ordinal)) ? "un" : "una";
  const normalized = `Seleccionar ${article} ${nounPhrase}`;
  console.log(`[scenarios:quality] inventedOrdinalNormalized from="${raw}" to="${normalized}"`);
  return normalized;
}

/** True when an ACTION requirement is a sensitive/committing operation that
 *  cannot be executed without runtime evidence. */
function isSensitiveAction(requirement: RequirementCandidate): boolean {
  const text = norm(`${requirement.keyTerm ?? ""} ${requirement.sourceText ?? ""}`);
  return SENSITIVE_ACTION_RE.test(text);
}

export function buildRequirementAccounting(
  scenarios: McpScenario[],
  functionalBranches: FunctionalBranchRef[],
  huText: string,
  sourceIssueKey?: string,
): {
  requirements: FunctionalRequirementAccount[];
  summary: {
    total: number;
    covered: number;
    adaptive: number;
    nonAutomatable: number;
    incompleteRequirement: number;
  };
  functionalCoverage: FunctionalCoverageResult;
} {
  console.log(`[requirement-accounting-trace] scenarios=${scenarios.length} ids=${JSON.stringify(scenarios.map((scenario) => scenario.scenarioId ?? scenario.sourceIssueKey ?? "unknown"))} refs=${JSON.stringify(scenarios.map((scenario) => scenario.stepRequirementRefs ?? []))}`);
  const requirements: FunctionalRequirementAccount[] = [];
  const summary: {
    total: number;
    covered: number;
    adaptive: number;
    nonAutomatable: number;
    incompleteRequirement: number;
  } = {
    total: 0,
    covered: 0,
    adaptive: 0,
    nonAutomatable: 0,
    incompleteRequirement: 0,
  };

  for (const requirement of extractRequirements(huText, functionalBranches)) {
    let status: RequirementStatus;
    let coveredBy: string | undefined;
    let reasonCode: string | undefined;

    if (requirement.truncated) {
      // Source is truncated — we cannot know the expected behavior. Never invent it.
      status = "incompleteRequirement";
      reasonCode = "incomplete_source_text";
    } else if (requirement.category === "inactivity") {
      // Timeout/inactivity needs a capability to wait/control the condition;
      // a final-state assertion alone is never evidence.
      status = "adaptive";
      reasonCode = "timeout_requirement";
    } else if (requirement.category === "restart" || requirement.category === "environment") {
      // Restart / environment / power capabilities are not provable in the
      // current runtime — never fabricate coverage.
      status = "nonAutomatable";
      reasonCode = "non_ui_requirement";
    } else if (requirement.category === "action" && isDynamicSelectionAction(requirement)) {
      // Dynamic collection selection whose concrete object depends on a
      // runtime catalog not yet discovered. Never fabricate a concrete label
      // and never accept a weak/invented click as coverage — the concrete
      // execution-backed target does not exist yet. Account as adaptive until
      // materialization. NOT a hard coverage gap.
      status = "adaptive";
      reasonCode = "requires_runtime_materialization";
    } else if (requirement.category === "action" && isSensitiveAction(requirement)) {
      // Sensitive/committing action. Never covered merely by an unbacked
      // invented click just to pass coverage, and never authorized as an
      // executable click without runtime evidence. Account as adaptive pending
      // runtime evidence.
      status = "adaptive";
      reasonCode = "sensitive_action_requires_runtime_evidence";
    } else {
      const covering = scenarios.find((scenario) => scenarioCoversRequirement(scenario, requirement));
      if (covering) {
        status = "covered";
        coveredBy = covering.title ?? covering.scenarioId ?? "";
      } else {
        // Evaluable functional requirement with no covering scenario: it SHOULD
        // be covered but is not. Reported as functionalCoverage.missing.
        status = "incompleteRequirement";
        reasonCode = "no_covering_scenario";
      }
    }

    summary.total++;
    summary[status]++;
    requirements.push({
      id: requirement.id,
      sourceRequirementId: requirement.sourceRequirementId ?? requirement.id,
      requirementId: requirement.sourceRequirementId ?? requirement.id,
      prerequisiteRequirementIds: requirement.prerequisiteRequirementIds,
      sourceIssueKey: sourceIssueKey ?? "",
      category: requirement.category,
      sourceText: requirement.sourceText,
      expectedBehavior: requirement.expectedBehavior ?? "",
      associatedBranchId: requirement.associatedBranchId,
      facets: requirement.facets,
      status,
      coveredBy,
      reasonCode,
    });
  }

  const functionalCoverage = computeFunctionalCoverage(requirements);
  const requirementsByBranchId = new Map(
    requirements
      .filter((requirement) => requirement.associatedBranchId)
      .map((requirement) => [requirement.associatedBranchId!, requirement]),
  );
  for (const scenario of scenarios) {
    const branchId = scenario.functionalBranch?.branchId;
    const requirement = branchId ? requirementsByBranchId.get(branchId) : undefined;
    if (!requirement?.prerequisiteRequirementIds?.length || !requirement.requirementId) continue;
    scenario.requirementDependencies = [{
      requirementId: requirement.requirementId,
      prerequisiteRequirementIds: [...requirement.prerequisiteRequirementIds],
    }];
  }
  return { requirements, summary, functionalCoverage };
}

// ── Orchestrator ────────────────────────────────────────────────────────────

/**
 * Apply the functional quality pass to the final visible scenarios BEFORE
 * execution readiness classification. The returned scenarios are functionally
 * clean: no cross-branch contamination, title/expected aligned with steps,
 * non-UI requirements preserved, semantic duplicates removed. No click is ever
 * re-validated against allowedExecutableClicks.
 */
export function applyFunctionalScenarioQuality(
  scenarios: McpScenario[],
  functionalBranches: FunctionalBranchRef[],
  huText: string,
): FunctionalQualityResult {
  const rejected: McpRejectedScenario[] = [];

  // Normalize AI-invented ordinal selections in dynamic selection steps when the
  // HU does NOT declare the ordinal explicitly. Preserves the functional noun
  // and keeps the step dynamic (no invented index/label ever enters a scenario).
  const ordinalNormalized = scenarios.map((scenario) => ({
    ...scenario,
    steps: (scenario.steps ?? []).map((step) => normalizeInventedOrdinalSelection(step, huText)),
  }));

  // A. Branch purity (clean contaminated scenarios, reject unrecoverable ones).
  const purity = enforceBranchPurity(ordinalNormalized, functionalBranches, huText);
  rejected.push(...purity.rejected);

  // B. Requirement-step alignment (reject mismatch, fix welcome ordering, generate pre-Entry).
  const aligned = ensureRequirementStepAlignment(purity.scenarios, huText);
  rejected.push(...aligned.rejected);

  // D (non-UI). Keep timeout/restart/environment requirements accounted.
  const nonUi = generateNonUiRequirementScenarios(aligned.scenarios, huText);

  // C. Semantic dedup by functional objective (includes the pre-Entry scenario
  // generated in B and the non-UI scenarios generated in D).
  const deduped = dedupeByFunctionalObjective([
    ...aligned.scenarios,
    ...aligned.generated,
    ...nonUi.generated,
  ]);

  return {
    scenarios: deduped.scenarios,
    rejected,
    generated: [...aligned.generated, ...nonUi.generated],
    cleaned: purity.cleaned,
    mismatched: aligned.mismatched,
    removedDedup: deduped.removed,
  };
}
