import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

type RouteProfileLike = Record<string, unknown> | null;

export type AssertionRecoveryDecision =
  | "recovered_accent_insensitive"
  | "recovered_alias_match"
  | "recovered_plural_variant"
  | "recovered_visible_control"
  | "recovered_domain_term"
  | "recovered_semantic_equivalent"
  | "recovered_conditional_variant"
  | "not_recovered";

export type AssertionRecoveryResult = {
  recovered: boolean;
  decision: AssertionRecoveryDecision;
  matchedText: string;
  confidence: number;
  recoveryAttempts: string[];
};

function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toPlural(text: string): string {
  if (text.endsWith("ión")) return text.slice(0, -3) + "iones";
  if (text.endsWith("dad")) return text.slice(0, -3) + "dades";
  if (text.endsWith("tad")) return text.slice(0, -3) + "tades";
  if (text.endsWith("tud")) return text.slice(0, -3) + "tudes";
  if (text.endsWith("z")) return text.slice(0, -1) + "ces";
  if (text.endsWith("s")) return text;
  return text + "s";
}

function toSingular(text: string): string {
  if (text.endsWith("iones")) return text.slice(0, -5) + "ión";
  if (text.endsWith("dades")) return text.slice(0, -5) + "dad";
  if (text.endsWith("tades")) return text.slice(0, -5) + "tad";
  if (text.endsWith("tudes")) return text.slice(0, -5) + "tud";
  if (text.endsWith("ces")) return text.slice(0, -3) + "z";
  if (text.endsWith("s")) return text.slice(0, -1);
  return text;
}

function getPluralSingularVariants(text: string): string[] {
  const variants: string[] = [];
  const plural = toPlural(text);
  const singular = toSingular(text);
  if (plural !== text) variants.push(plural);
  if (singular !== text) variants.push(singular);
  return variants;
}

function getAliasesFromRouteProfile(
  assertionText: string,
  routeProfile: RouteProfileLike,
  appConfig: Record<string, unknown> | null,
): string[] {
  const aliases: string[] = [];
  const normalizedAssertion = normalizeForComparison(assertionText);

  const collectAliases = (rp: Record<string, unknown> | null) => {
    if (!rp?.aliases || typeof rp.aliases !== "object") return;
    const aliasesObj = rp.aliases as Record<string, unknown>;
    for (const [key, value] of Object.entries(aliasesObj)) {
      const normalizedKey = normalizeForComparison(key);
      const normalizedValue = typeof value === "string" ? normalizeForComparison(value) : "";
      if (
        normalizedValue &&
        (normalizedAssertion.includes(normalizedKey) || normalizedKey.includes(normalizedAssertion) || normalizedAssertion.includes(normalizedValue) || normalizedValue.includes(normalizedAssertion))
      ) {
        if (typeof value === "string") {
          aliases.push(value);
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === "string") aliases.push(v);
          }
        }
      }
    }
  };

  collectAliases(routeProfile as unknown as Record<string, unknown> | null);
  if (appConfig?.routeProfile && typeof appConfig.routeProfile === "object") {
    collectAliases(appConfig.routeProfile as Record<string, unknown>);
  }

  return aliases;
}

function getVisibleControlsFromRouteProfile(
  routeProfile: RouteProfileLike,
  appConfig: Record<string, unknown> | null,
): string[] {
  const controls: string[] = [];

  const collectControls = (rp: Record<string, unknown> | null) => {
    if (!rp?.visibleControls || !Array.isArray(rp.visibleControls)) return;
    for (const vc of rp.visibleControls) {
      if (typeof vc === "string") controls.push(vc);
    }
  };

  collectControls(routeProfile as unknown as Record<string, unknown> | null);
  if (appConfig?.routeProfile && typeof appConfig.routeProfile === "object") {
    collectControls(appConfig.routeProfile as Record<string, unknown>);
  }

  return controls;
}

function getDomainTermsFromRouteProfile(
  routeProfile: RouteProfileLike,
  appConfig: Record<string, unknown> | null,
): string[] {
  const terms: string[] = [];

  const collectTerms = (rp: Record<string, unknown> | null) => {
    if (!rp?.domainTerms || typeof rp.domainTerms !== "object") return;
    const termsObj = rp.domainTerms as Record<string, unknown>;
    for (const value of Object.values(termsObj)) {
      if (typeof value === "string") terms.push(value);
      else if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === "string") terms.push(v);
        }
      }
    }
  };

  collectTerms(routeProfile as unknown as Record<string, unknown> | null);
  if (appConfig?.routeProfile && typeof appConfig.routeProfile === "object") {
    collectTerms(appConfig.routeProfile as Record<string, unknown>);
  }

  return terms;
}

function findTextInSnapshot(
  snapshot: PageSnapshot,
  targetText: string,
): { found: boolean; matchedText: string; confidence: number } {
  const normalizedTarget = normalizeForComparison(targetText);

  for (const el of snapshot.elements) {
    const texts = [el.text, el.label, el.name, el.placeholder, el.value].filter(Boolean) as string[];
    for (const t of texts) {
      const normalizedT = normalizeForComparison(t);
      if (normalizedT === normalizedTarget) {
        return { found: true, matchedText: t, confidence: 1.0 };
      }
      if (normalizedT.includes(normalizedTarget) || normalizedTarget.includes(normalizedT)) {
        return { found: true, matchedText: t, confidence: 0.85 };
      }
    }
  }

  const snapshotBlob = normalizeForComparison(
    `${snapshot.title} ${snapshot.elements.map((e) => `${e.text ?? ""} ${e.label ?? ""} ${e.name ?? ""}`).join(" ")}`,
  );
  if (snapshotBlob.includes(normalizedTarget)) {
    return { found: true, matchedText: targetText, confidence: 0.7 };
  }

  return { found: false, matchedText: "", confidence: 0 };
}

export function attemptAssertionRecovery(
  snapshot: PageSnapshot,
  failedAssertionText: string,
  options: {
    routeProfile?: RouteProfileLike;
    appConfig?: Record<string, unknown> | null;
    scenarioTitle?: string;
    expectedResult?: string;
  } = {},
): AssertionRecoveryResult {
  const recoveryAttempts: string[] = [];
  const { routeProfile = null, appConfig = null, scenarioTitle = "", expectedResult = "" } = options;

  // 1. Try accent-insensitive match
  const accentResult = findTextInSnapshot(snapshot, failedAssertionText);
  if (accentResult.found && accentResult.confidence >= 0.85) {
    return {
      recovered: true,
      decision: "recovered_accent_insensitive",
      matchedText: accentResult.matchedText,
      confidence: accentResult.confidence,
      recoveryAttempts: ["accent_insensitive_match"],
    };
  }
  recoveryAttempts.push("accent_insensitive_match_failed");

  // 2. Try aliases from routeProfile
  const aliases = getAliasesFromRouteProfile(failedAssertionText, routeProfile, appConfig);
  for (const alias of aliases) {
    const aliasResult = findTextInSnapshot(snapshot, alias);
    if (aliasResult.found) {
      return {
        recovered: true,
        decision: "recovered_alias_match",
        matchedText: aliasResult.matchedText,
        confidence: 0.9,
        recoveryAttempts: [`alias_match:${alias}`],
      };
    }
  }
  if (aliases.length > 0) {
    recoveryAttempts.push(`alias_match_failed:${aliases.join(",")}`);
  }

  // 3. Try plural/singular variants
  const pluralSingularVariants = getPluralSingularVariants(failedAssertionText);
  for (const variant of pluralSingularVariants) {
    const variantResult = findTextInSnapshot(snapshot, variant);
    if (variantResult.found) {
      return {
        recovered: true,
        decision: "recovered_plural_variant",
        matchedText: variantResult.matchedText,
        confidence: 0.85,
        recoveryAttempts: [`plural_singular_variant:${variant}`],
      };
    }
  }
  if (pluralSingularVariants.length > 0) {
    recoveryAttempts.push(`plural_singular_variant_failed:${pluralSingularVariants.join(",")}`);
  }

  // 4. Try visibleControls
  const visibleControls = getVisibleControlsFromRouteProfile(routeProfile, appConfig);
  for (const control of visibleControls) {
    const normalizedControl = normalizeForComparison(control);
    const normalizedAssertion = normalizeForComparison(failedAssertionText);
    if (
      normalizedAssertion.includes(normalizedControl) ||
      normalizedControl.includes(normalizedAssertion)
    ) {
      const controlResult = findTextInSnapshot(snapshot, control);
      if (controlResult.found) {
        return {
          recovered: true,
          decision: "recovered_visible_control",
          matchedText: controlResult.matchedText,
          confidence: 0.8,
          recoveryAttempts: [`visible_control_match:${control}`],
        };
      }
    }
  }
  if (visibleControls.length > 0) {
    recoveryAttempts.push("visible_control_match_failed");
  }

  // 5. Try domainTerms
  const domainTerms = getDomainTermsFromRouteProfile(routeProfile, appConfig);
  for (const term of domainTerms) {
    const normalizedTerm = normalizeForComparison(term);
    const normalizedAssertion = normalizeForComparison(failedAssertionText);
    if (
      normalizedAssertion.includes(normalizedTerm) ||
      normalizedTerm.includes(normalizedAssertion)
    ) {
      const termResult = findTextInSnapshot(snapshot, term);
      if (termResult.found) {
        return {
          recovered: true,
          decision: "recovered_domain_term",
          matchedText: termResult.matchedText,
          confidence: 0.75,
          recoveryAttempts: [`domain_term_match:${term}`],
        };
      }
    }
  }
  if (domainTerms.length > 0) {
    recoveryAttempts.push("domain_term_match_failed");
  }

  // 6. Try semantic equivalents for common patterns
  const semanticResult = trySemanticEquivalents(snapshot, failedAssertionText);
  if (semanticResult.found) {
    return {
      recovered: true,
      decision: "recovered_semantic_equivalent",
      matchedText: semanticResult.matchedText,
      confidence: semanticResult.confidence,
      recoveryAttempts: [`semantic_equivalent:${semanticResult.reason}`],
    };
  }
  recoveryAttempts.push("semantic_equivalent_failed");

  // 7. Try conditional variants for "no está disponible" type assertions
  const conditionalResult = tryConditionalVariants(snapshot, failedAssertionText);
  if (conditionalResult.found) {
    return {
      recovered: true,
      decision: "recovered_conditional_variant",
      matchedText: conditionalResult.matchedText,
      confidence: conditionalResult.confidence,
      recoveryAttempts: [`conditional_variant:${conditionalResult.reason}`],
    };
  }
  recoveryAttempts.push("conditional_variant_failed");

  return {
    recovered: false,
    decision: "not_recovered",
    matchedText: "",
    confidence: 0,
    recoveryAttempts,
  };
}

function trySemanticEquivalents(
  snapshot: PageSnapshot,
  assertionText: string,
): { found: boolean; matchedText: string; confidence: number; reason: string } {
  const normalizedAssertion = normalizeForComparison(assertionText);

  const semanticMap: Array<{ pattern: RegExp; equivalents: string[]; reason: string }> = [
    {
      pattern: /\b(dolares|dolares estadounidenses|usd|us\$)\b/,
      equivalents: ["Dólares", "Dólares estadounidenses", "USD", "US$"],
      reason: "currency_equivalent_dolares",
    },
    {
      pattern: /\b(pesos|pesos dominicanos|rd\$)\b/,
      equivalents: ["Pesos", "Pesos dominicanos", "RD$"],
      reason: "currency_equivalent_pesos",
    },
    {
      pattern: /\b(euros|eur|€)\b/,
      equivalents: ["Euros", "EUR", "€"],
      reason: "currency_equivalent_euros",
    },
  ];

  for (const { pattern, equivalents, reason } of semanticMap) {
    if (pattern.test(normalizedAssertion)) {
      for (const eq of equivalents) {
        const eqResult = findTextInSnapshot(snapshot, eq);
        if (eqResult.found) {
          return { found: true, matchedText: eqResult.matchedText, confidence: 0.7, reason };
        }
      }
    }
  }

  return { found: false, matchedText: "", confidence: 0, reason: "" };
}

function tryConditionalVariants(
  snapshot: PageSnapshot,
  assertionText: string,
): { found: boolean; matchedText: string; confidence: number; reason: string } {
  const normalizedAssertion = normalizeForComparison(assertionText);

  const conditionalPatterns: Array<{ pattern: RegExp; variants: string[]; reason: string }> = [
    {
      pattern: /\b(no (esta|está) disponible|no disponible|no se encuentra|no existe)\b/,
      variants: ["No disponible", "Información no disponible", "Producto no disponible", "No se encuentra disponible", "No disponible en este momento"],
      reason: "conditional_availability_variant",
    },
    {
      pattern: /\b(no hay|sin (stock|disponibilidad|existencia))\b/,
      variants: ["No hay", "Sin stock", "Sin disponibilidad", "Agotado"],
      reason: "conditional_stock_variant",
    },
  ];

  for (const { pattern, variants, reason } of conditionalPatterns) {
    if (pattern.test(normalizedAssertion)) {
      for (const variant of variants) {
        const variantResult = findTextInSnapshot(snapshot, variant);
        if (variantResult.found) {
          return { found: true, matchedText: variantResult.matchedText, confidence: 0.65, reason };
        }
      }
    }
  }

  return { found: false, matchedText: "", confidence: 0, reason: "" };
}

export function classifyAssertionImportance(
  assertionText: string,
  options: {
    scenarioTitle?: string;
    expectedResult?: string;
    routeProfile?: RouteProfileLike;
  } = {},
): "blocking" | "contextual" | "optional" {
  const { scenarioTitle = "", expectedResult = "", routeProfile = null } = options;
  const normalizedAssertion = normalizeForComparison(assertionText);
  const normalizedTitle = normalizeForComparison(scenarioTitle);
  const normalizedExpected = normalizeForComparison(expectedResult);

  // Blocking: appears in title or expectedResult
  if (normalizedTitle && normalizedAssertion.length >= 3) {
    if (normalizedTitle.includes(normalizedAssertion) || normalizedAssertion.includes(normalizedTitle)) {
      return "blocking";
    }
  }
  if (normalizedExpected && normalizedAssertion.length >= 3) {
    if (normalizedExpected.includes(normalizedAssertion) || normalizedAssertion.includes(normalizedExpected)) {
      return "blocking";
    }
  }

  // Optional: conditional language
  const optionalPatterns = [
    /\b(si (esta|está|disponible|existe|hay))\b/,
    /\b(puede|podria|podría|tal vez|quizas|quizás)\b/,
    /\b(no (esta|está) disponible|no disponible|no se encuentra)\b/,
    /\b(opcional|opcionalmente|si aplica|si corresponde)\b/,
    // Global session/navigation assertions (non-blocking when secondary)
    /\b(finalizar sesion|cerrar sesion|logout|sign out|log out|salir|ayuda|help|perfil|profile)\b/i,
  ];
  for (const pattern of optionalPatterns) {
    if (pattern.test(normalizedAssertion)) {
      return "optional";
    }
  }

  // Contextual: appears in routeProfile aliases/visibleControls but not in title/expectedResult
  const rp = routeProfile as unknown as Record<string, unknown> | null;
  if (rp) {
    const allLabels: string[] = [];
    if (rp.visibleControls && Array.isArray(rp.visibleControls)) {
      allLabels.push(...(rp.visibleControls as string[]));
    }
    if (rp.aliases && typeof rp.aliases === "object") {
      for (const value of Object.values(rp.aliases as Record<string, unknown>)) {
        if (typeof value === "string") allLabels.push(value);
        else if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === "string") allLabels.push(v);
          }
        }
      }
    }
    for (const label of allLabels) {
      const normalizedLabel = normalizeForComparison(label);
      if (normalizedAssertion.includes(normalizedLabel) || normalizedLabel.includes(normalizedAssertion)) {
        return "contextual";
      }
    }
  }

  // Default: contextual if assertion is short/generic, blocking otherwise
  if (normalizedAssertion.length < 10) {
    return "contextual";
  }

  // Field label: capitalized noun phrase (no action verb) like "Tipo de Depósito"
  // These are context-dependent and should not block when not visible
  const ACTION_VERB_START = /^(?:click|seleccionar|ingresar|validar|esperar|llenar|confirmar|cerrar|aceptar|cancelar|buscar|agregar|editar|eliminar|navegar|regresar|volver|continuar|abrir|mostrar|ocultar|haga|realice|ejecute|elija|escoja)/i;
  if (!ACTION_VERB_START.test(assertionText.trim()) && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]/.test(assertionText.trim())) {
    return "contextual";
  }

  return "blocking";
}

export function detectConditionalAssertionRisk(
  assertionText: string,
  options: {
    dataRequirement?: string;
    routeProfile?: RouteProfileLike;
  } = {},
): { isConditional: boolean; risk: "low" | "medium" | "high"; reason: string } {
  const { dataRequirement = "", routeProfile = null } = options;
  const normalizedAssertion = normalizeForComparison(assertionText);

  const conditionalPatterns = [
    { pattern: /\b(no (esta|está) disponible|no disponible|no se encuentra|no existe)\b/, reason: "conditional_availability" },
    { pattern: /\b(no hay|sin (stock|disponibilidad|existencia))\b/, reason: "conditional_stock" },
    { pattern: /\b(si (esta|está|disponible|existe|hay|aplica|corresponde))\b/, reason: "conditional_if" },
    { pattern: /\b(puede|podria|podría|tal vez|quizas|quizás|depende)\b/, reason: "conditional_maybe" },
  ];

  for (const { pattern, reason } of conditionalPatterns) {
    if (pattern.test(normalizedAssertion)) {
      if (!dataRequirement) {
        return { isConditional: true, risk: "high", reason: `${reason}_without_data_requirement` };
      }
      return { isConditional: true, risk: "low", reason: `${reason}_with_data_requirement` };
    }
  }

  return { isConditional: false, risk: "low", reason: "not_conditional" };
}
