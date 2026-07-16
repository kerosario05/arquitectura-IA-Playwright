/**
 * Route Profile Derived Context
 *
 * Derives enforceable execution context from route profile and resolutions.
 * This module is app-agnostic and works with any appSlug/routeProfile.
 *
 * Sources:
 * - routeProfile.entry (executable entry targets)
 * - routeProfile.visibleControls (general visible controls)
 * - routeProfile.aliases (target normalization)
 * - routeProfile.domainTerms (ordinal selection terms)
 * - routeResolutions.executableRouteSteps (validated route steps)
 * - appConfig metadata (if available)
 *
 * DO NOT hardcode project-specific names or logic.
 */

import type { McpRouteProfile, ScenarioRouteResolution } from "./scenario-types";

export type DerivedExecutionContext = {
  appSlug: string;
  allowedExecutableClicks: string[];
  assertionOnlyTerms: string[];
  visibleButNotExecutableTerms: string[];
  sensitiveActions: string[];
  entryActionTargets: string[];
  routeTargets: string[];
  aliasesByTarget: Map<string, string[]>;
  domainTerms: string[];
  profileConfidence: "high" | "medium" | "low" | "none";
  diagnostics: string[];
  // Source tracking for each allowed click
  clickSources?: Map<string, string>; // target -> source (entry|entryStep|executableRouteStep|targetPath|intermediate)
};

/**
 * Generic sensitive action patterns (not project-specific)
 */
const SENSITIVE_ACTION_PATTERNS = [
  /\bSolicitar\b/i,
  /\bPagar\b/i,
  /\bTransferir\b/i,
  /\bContratar\b/i,
  /\bConfirmar\b/i,
  /\bAutorizar\b/i,
  /\bAprobar\b/i,
  /\bFirmar\b/i,
  /\bEnviar\b/i,
  /\bAceptar contrato\b/i,
  /\bDebitar\b/i,
  /\bEliminar\b/i,
  /\bCancelar producto\b/i,
  /\bActivar\b/i,
  /\bDesactivar\b/i,
];

/**
 * Product detail section patterns (multiproject, content sections)
 * These are informational sections that should be validated, not clicked
 */
const DETAIL_SECTION_PATTERNS = [
  /^Detalles?$/i,
  /^Requisitos?$/i,
  /^Beneficios?$/i,
  /^Condiciones?$/i,
  /^Tasas?$/i,
  /^Informaci[oó]n\s+(?:del\s+)?producto/i,
  /^Informaci[oó]n\s+legal/i,
  /^T[eé]rminos\s+y\s+condiciones/i,
  /^Caracter[ií]sticas?$/i,
  /^Especificaciones?$/i,
  /^Documentaci[oó]n$/i,
  /^Descripci[oó]n$/i,
];

/**
 * Generic assertion-only indicators (fields, labels, content)
 */
const ASSERTION_ONLY_INDICATORS = [
  /\b(nombre|título|title|name)\b/i,
  /\b(descripci[oó]n|description)\b/i,
  /\b(beneficio|benefit|ventaja)\b/i,
  /\b(condici[oó]n|condition|requisito|requirement)\b/i,
  /\b(estado|status)\b/i,
  /\b(saldo|balance|amount|monto)\b/i,
  /\b(tasa|rate|inter[eé]s|interest)\b/i,
  /\b(plazo|term|periodo)\b/i,
  /\b(moneda|currency|divisa)\b/i,
  /\b(fecha|date)\b/i,
  /\b(mensaje|message|alert|alerta)\b/i,
  /\b(informaci[oó]n|information|info)\b/i,
  /\b(detalle|detail)\b/i,
  /\b(categor[ií]a|category)\b/i,
  /\b(secci[oó]n|section)\b/i,
  /\b(etiqueta|label|tag)\b/i,
  /\b(columna|column)\b/i,
  /\b(campo|field)\b/i,
];

/**
 * Check if a target is backed by route profile metadata
 *
 * A target is considered backed if it appears in:
 * - routeProfile.entry
 * - routeProfile.intermediates
 * - routeProfile.targetPaths (target or requiredIntermediates)
 * - routeProfile.aliases (as key or value)
 * - Already in allowed set (from earlier resolution stages)
 *
 * NOT backed if only in:
 * - routeProfile.visibleControls
 * - routeProfile.domainTerms
 *
 * @param target - Target label to check
 * @param routeProfile - Route profile metadata
 * @param allowedSoFar - Targets already resolved as allowed
 * @returns True if target is backed by executable route metadata
 */
function isTargetBacked(
  target: string,
  routeProfile: McpRouteProfile | null,
  allowedSoFar: Set<string>
): boolean {
  if (!routeProfile) return false;

  // Already in allowed set from earlier resolution stages
  if (allowedSoFar.has(target)) return true;

  // Entry targets
  if (routeProfile.entry) {
    for (const entry of routeProfile.entry) {
      if (entry.visibleLabel === target || entry.businessLabel === target) {
        return true;
      }
    }
  }

  // Intermediate targets
  if (routeProfile.intermediates) {
    for (const hints of Object.values(routeProfile.intermediates)) {
      if (Array.isArray(hints)) {
        if (hints.includes(target)) {
          return true;
        }
      }
    }
  }

  // Target paths
  if (routeProfile.targetPaths) {
    for (const [pathTarget, pathDef] of Object.entries(routeProfile.targetPaths)) {
      if (pathTarget === target) {
        return true;
      }
      if (pathDef.requiredIntermediates?.includes(target)) {
        return true;
      }
    }
  }

  // Aliases (as key or value)
  if (routeProfile.aliases) {
    for (const [key, value] of Object.entries(routeProfile.aliases)) {
      if (key === target) {
        return true;
      }
      const values = Array.isArray(value) ? value : [value];
      if (values.includes(target)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Derive allowed executable clicks from route profile
 * Returns both the allowed clicks and their sources
 */
function deriveAllowedExecutableClicks(
  routeProfile: McpRouteProfile | null,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  additionalEntryTargets?: string[]
): { allowed: string[]; sources: Map<string, string> } {
  const allowed = new Set<string>();
  const sources = new Map<string, string>();

  if (!routeProfile) {
    // If no profile but additional entry targets provided, include them
    if (additionalEntryTargets) {
      for (const target of additionalEntryTargets) {
        allowed.add(target);
        sources.set(target, "entryStep");
      }
    }
    return { allowed: Array.from(allowed).sort(), sources };
  }

  // 1. Entry targets from profile
  if (routeProfile.entry) {
    for (const entry of routeProfile.entry) {
      if (entry.visibleLabel) {
        allowed.add(entry.visibleLabel);
        sources.set(entry.visibleLabel, "entry");
      }
      if (entry.businessLabel) {
        allowed.add(entry.businessLabel);
        sources.set(entry.businessLabel, "entry");
      }
    }
  }

  // 2. Additional entry targets (from newEntrySteps, oldEntrySteps, etc.)
  if (additionalEntryTargets) {
    for (const target of additionalEntryTargets) {
      allowed.add(target);
      if (!sources.has(target)) {
        sources.set(target, "entryStep");
      }
    }
  }

  // 3. Intermediate targets (navigation hints) - these are explicitly navigation steps
  if (routeProfile.intermediates) {
    for (const hints of Object.values(routeProfile.intermediates)) {
      if (Array.isArray(hints)) {
        for (const hint of hints) {
          allowed.add(hint);
          if (!sources.has(hint)) {
            sources.set(hint, "intermediate");
          }
        }
      }
    }
  }

  // 4. Target paths - explicit path definitions
  if (routeProfile.targetPaths) {
    for (const [target, pathDef] of Object.entries(routeProfile.targetPaths)) {
      // Add the target itself
      allowed.add(target);
      if (!sources.has(target)) {
        sources.set(target, "targetPath");
      }

      // Add all required intermediates
      if (pathDef.requiredIntermediates) {
        for (const intermediate of pathDef.requiredIntermediates) {
          allowed.add(intermediate);
          if (!sources.has(intermediate)) {
            sources.set(intermediate, "targetPath");
          }
        }
      }
    }
  }

  // 5. Extract from executable route steps - these are validated as executable
  // CRITICAL: Only extract click targets, not validation targets
  // DEFENSIVE: Verify target is backed before adding
  for (const resolution of routeResolutions.values()) {
    if (resolution.executableRouteSteps) {
      for (const step of resolution.executableRouteSteps) {
        const clickMatch = step.match(/Clic en "([^"]+)"/i);
        if (clickMatch) {
          const target = clickMatch[1];

          // Defensive validation: Ensure target is backed by profile before adding
          const isBacked = isTargetBacked(target, routeProfile, allowed);

          if (isBacked) {
            allowed.add(target);
            if (!sources.has(target)) {
              sources.set(target, "executableRouteStep");
            }
          } else {
            console.warn(
              `[route-profile-derived] executableRouteStep contains unbacked target: "${target}". ` +
              `This indicates route resolver generated an invalid navigation step. ` +
              `Target will be excluded from allowedExecutableClicks.`
            );
          }
        }
      }
    }
  }

  // NOTE: visibleControls are NOT automatically included here
  // They must be backed by entry, intermediates, targetPaths, or executableRouteSteps
  // to be considered executable clicks

  if (allowed.size > 0) {
    const entryCount = [...sources.values()].filter(s => s === "entry").length;
    const entryStepCount = [...sources.values()].filter(s => s === "entryStep").length;
    console.log(`[route-profile-derived] allowedClicks sources: entry=${entryCount} entryStep=${entryStepCount}`);
    console.log(`[route-profile-derived] allowedClicks sample: ${Array.from(allowed).slice(0, 5).join(", ")}${allowed.size > 5 ? "..." : ""}`);
  }

  return { allowed: Array.from(allowed).sort(), sources };
}

/**
 * Derive assertion-only terms (fields, labels, content that should NOT be clicked)
 */
function deriveAssertionOnlyTerms(
  routeProfile: McpRouteProfile | null
): string[] {
  const assertionOnly = new Set<string>();

  if (!routeProfile) return [];

  // Check domain terms for assertion-only indicators
  if (routeProfile.domainTerms) {
    for (const [key, value] of Object.entries(routeProfile.domainTerms)) {
      const values = Array.isArray(value) ? value : [value];
      for (const term of values) {
        if (ASSERTION_ONLY_INDICATORS.some(pattern => pattern.test(term))) {
          assertionOnly.add(term);
        }
        if (ASSERTION_ONLY_INDICATORS.some(pattern => pattern.test(key))) {
          assertionOnly.add(term);
        }
      }
    }
  }

  // Check aliases for assertion-only patterns
  if (routeProfile.aliases) {
    for (const [key, value] of Object.entries(routeProfile.aliases)) {
      if (ASSERTION_ONLY_INDICATORS.some(pattern => pattern.test(key))) {
        const values = Array.isArray(value) ? value : [value];
        for (const v of values) {
          assertionOnly.add(v);
        }
      }
    }
  }

  // Check visibleControls for detail section patterns
  // Detail sections (Detalles, Requisitos, etc.) should be validated, not clicked
  if (routeProfile.visibleControls) {
    for (const control of routeProfile.visibleControls) {
      if (DETAIL_SECTION_PATTERNS.some(pattern => pattern.test(control))) {
        assertionOnly.add(control);
      }
    }
  }

  return Array.from(assertionOnly).sort();
}

/**
 * Derive visible but not executable terms
 * These are visibleControls that are NOT in allowedExecutableClicks
 * They can be validated but should not be clicked
 */
function deriveVisibleButNotExecutableTerms(
  routeProfile: McpRouteProfile | null,
  allowedExecutableClicks: string[]
): string[] {
  const visibleButNotExecutable = new Set<string>();

  if (!routeProfile) return [];

  // Add visibleControls that are NOT in allowedExecutableClicks
  if (routeProfile.visibleControls) {
    for (const control of routeProfile.visibleControls) {
      if (!allowedExecutableClicks.includes(control)) {
        visibleButNotExecutable.add(control);
      }
    }
  }

  // Add domainTerms that are NOT in allowedExecutableClicks
  // Domain terms are typically content/data terms, not navigation targets
  if (routeProfile.domainTerms) {
    for (const value of Object.values(routeProfile.domainTerms)) {
      const values = Array.isArray(value) ? value : [value];
      for (const term of values) {
        if (!allowedExecutableClicks.includes(term)) {
          visibleButNotExecutable.add(term);
        }
      }
    }
  }

  return Array.from(visibleButNotExecutable).sort();
}

/**
 * Derive sensitive actions from route profile
 */
function deriveSensitiveActions(
  routeProfile: McpRouteProfile | null
): string[] {
  const sensitive = new Set<string>();

  if (!routeProfile) return [];

  // Check visible controls for sensitive action patterns
  if (routeProfile.visibleControls) {
    for (const control of routeProfile.visibleControls) {
      if (SENSITIVE_ACTION_PATTERNS.some(pattern => pattern.test(control))) {
        sensitive.add(control);
      }
    }
  }

  // Check aliases for sensitive actions
  if (routeProfile.aliases) {
    for (const value of Object.values(routeProfile.aliases)) {
      const values = Array.isArray(value) ? value : [value];
      for (const v of values) {
        if (SENSITIVE_ACTION_PATTERNS.some(pattern => pattern.test(v))) {
          sensitive.add(v);
        }
      }
    }
  }

  return Array.from(sensitive).sort();
}

/**
 * Build alias map (target -> aliases)
 */
function buildAliasesByTarget(routeProfile: McpRouteProfile | null): Map<string, string[]> {
  const aliasMap = new Map<string, string[]>();

  if (!routeProfile?.aliases) return aliasMap;

  for (const [target, aliases] of Object.entries(routeProfile.aliases)) {
    const aliasList = Array.isArray(aliases) ? aliases : [aliases];
    aliasMap.set(target, aliasList);

    // Also map each alias back to the target
    for (const alias of aliasList) {
      if (!aliasMap.has(alias)) {
        aliasMap.set(alias, [target]);
      }
    }
  }

  return aliasMap;
}

/**
 * Determine profile confidence based on available data
 */
function determineProfileConfidence(
  routeProfile: McpRouteProfile | null,
  routeResolutions: Map<string, ScenarioRouteResolution>
): "high" | "medium" | "low" | "none" {
  if (!routeProfile) return "none";

  let score = 0;
  const diagnostics: string[] = [];

  // Entry steps present
  if (routeProfile.entry && routeProfile.entry.length > 0) {
    score += 2;
  } else {
    diagnostics.push("missing_entry_steps");
  }

  // Visible controls present
  if (routeProfile.visibleControls && routeProfile.visibleControls.length > 0) {
    score += 2;
  } else {
    diagnostics.push("missing_visible_controls");
  }

  // Aliases present
  if (routeProfile.aliases && Object.keys(routeProfile.aliases).length > 0) {
    score += 1;
  }

  // Domain terms present
  if (routeProfile.domainTerms && Object.keys(routeProfile.domainTerms).length > 0) {
    score += 1;
  }

  // Route resolutions present with executable steps
  const hasExecutableSteps = Array.from(routeResolutions.values()).some(
    r => r.executableRouteSteps && r.executableRouteSteps.length > 0
  );
  if (hasExecutableSteps) {
    score += 2;
  } else {
    diagnostics.push("missing_executable_route_steps");
  }

  // Scoring: high >= 6, medium >= 3, low < 3
  if (score >= 6) return "high";
  if (score >= 3) return "medium";
  return "low";
}

/**
 * Build derived execution context from route profile and resolutions
 *
 * @param appSlug - The application slug
 * @param routeProfile - The route profile (can be null)
 * @param routeResolutions - Route resolutions map
 * @param additionalEntryTargets - Additional entry targets (from newEntrySteps, oldEntrySteps, etc.)
 */
export function buildDerivedExecutionContext(
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  additionalEntryTargets?: string[]
): DerivedExecutionContext {
  const diagnostics: string[] = [];

  const { allowed: allowedExecutableClicks, sources: clickSources } = deriveAllowedExecutableClicks(
    routeProfile,
    routeResolutions,
    additionalEntryTargets
  );
  const assertionOnlyTerms = deriveAssertionOnlyTerms(routeProfile);
  const visibleButNotExecutableTerms = deriveVisibleButNotExecutableTerms(routeProfile, allowedExecutableClicks);
  const sensitiveActions = deriveSensitiveActions(routeProfile);
  const entryActionTargets = routeProfile?.entry?.map(e => e.visibleLabel).filter(Boolean) ?? [];
  const routeTargets = allowedExecutableClicks.filter(c => !sensitiveActions.includes(c));
  const aliasesByTarget = buildAliasesByTarget(routeProfile);
  const domainTerms = routeProfile?.domainTerms
    ? Object.values(routeProfile.domainTerms).flatMap(v => Array.isArray(v) ? v : [v])
    : [];

  const profileConfidence = determineProfileConfidence(routeProfile, routeResolutions);

  if (profileConfidence === "none") {
    diagnostics.push("no_route_profile_available");
  } else if (profileConfidence === "low") {
    diagnostics.push("route_profile_incomplete");
  }

  if (allowedExecutableClicks.length === 0 && routeResolutions.size > 0) {
    diagnostics.push("no_executable_clicks_derived");
  }

  return {
    appSlug,
    allowedExecutableClicks,
    assertionOnlyTerms,
    visibleButNotExecutableTerms,
    sensitiveActions,
    entryActionTargets,
    routeTargets,
    aliasesByTarget,
    domainTerms,
    profileConfidence,
    diagnostics,
    clickSources, // Include source tracking
  };
}

/**
 * Format derived context for AI prompt
 */
export function formatDerivedContextForPrompt(context: DerivedExecutionContext): string {
  const sections: string[] = [];

  sections.push("## Enforceable Execution Context");
  sections.push(`appSlug: ${context.appSlug}`);
  sections.push(`profileConfidence: ${context.profileConfidence}`);
  sections.push("");

  if (context.allowedExecutableClicks.length > 0) {
    sections.push("### ALLOWED_EXECUTABLE_CLICKS");
    sections.push("These are the ONLY targets that can appear in \"Clic en\" steps:");
    sections.push(context.allowedExecutableClicks.map(c => `- "${c}"`).join("\n"));
    sections.push("");
  } else {
    sections.push("### ALLOWED_EXECUTABLE_CLICKS");
    sections.push("⚠️ No executable clicks available. Only validations can be generated.");
    sections.push("");
  }

  if (context.assertionOnlyTerms.length > 0) {
    sections.push("### ASSERTION_ONLY_TERMS");
    sections.push("These terms can ONLY appear in validation steps, NOT in clicks:");
    sections.push(context.assertionOnlyTerms.map(t => `- "${t}"`).join("\n"));
    sections.push("");
  }

  if (context.visibleButNotExecutableTerms.length > 0) {
    sections.push("### VISIBLE_BUT_NOT_EXECUTABLE");
    sections.push("These are visible controls/terms that can be VALIDATED but NOT clicked:");
    sections.push(context.visibleButNotExecutableTerms.map(t => `- "${t}"`).join("\n"));
    sections.push("");
  }

  if (context.sensitiveActions.length > 0) {
    sections.push("### SENSITIVE_ACTIONS");
    sections.push("Do NOT generate \"Clic en\" for these. Only validations allowed:");
    sections.push(context.sensitiveActions.map(a => `- "${a}"`).join("\n"));
    sections.push("");
  }

  sections.push("### CRITICAL RULES");
  sections.push("1. NEVER generate \"Clic en <target>\" if <target> is NOT in ALLOWED_EXECUTABLE_CLICKS");
  sections.push("2. NEVER generate \"Clic en <term>\" if <term> is in ASSERTION_ONLY_TERMS");
  sections.push("3. NEVER generate \"Clic en <term>\" if <term> is in VISIBLE_BUT_NOT_EXECUTABLE");
  sections.push("4. NEVER generate \"Clic en <action>\" if <action> is in SENSITIVE_ACTIONS");
  sections.push("5. Aliases are resolved to their canonical targets");
  sections.push("6. expectedResult is context only, NOT a source of executable steps");
  sections.push("7. If a click target is not backed by this context, the scenario MUST be rejected");
  sections.push("");
  sections.push("### REMEMBER");
  sections.push("- visibleControls are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
  sections.push("- domainTerms are for VALIDATIONS unless also in ALLOWED_EXECUTABLE_CLICKS");
  sections.push("- User story content sections (Beneficios, Requisitos, Condiciones, etc.) are for VALIDATIONS only");
  sections.push("- Field names, labels, messages, data values are for VALIDATIONS only");
  sections.push("- When in doubt: \"Validar que se muestre\" not \"Clic en\"");

  if (context.diagnostics.length > 0) {
    sections.push("");
    sections.push("### Profile Diagnostics");
    sections.push(context.diagnostics.join(", "));
  }

  return sections.join("\n");
}

/**
 * Log derived context
 */
export function logDerivedContext(context: DerivedExecutionContext): void {
  console.log(
    `[route-profile-derived] appSlug=${context.appSlug} ` +
    `allowedClicks=${context.allowedExecutableClicks.length} ` +
    `assertionTerms=${context.assertionOnlyTerms.length} ` +
    `visibleButNotExecutable=${context.visibleButNotExecutableTerms.length} ` +
    `sensitiveActions=${context.sensitiveActions.length} ` +
    `confidence=${context.profileConfidence} ` +
    `diagnostics=${context.diagnostics.length}`
  );

  if (context.diagnostics.length > 0) {
    console.log(`[route-profile-derived] diagnostics: ${context.diagnostics.join(", ")}`);
  }

  // Log sample of each category for debugging
  if (context.allowedExecutableClicks.length > 0) {
    const sample = context.allowedExecutableClicks.slice(0, 5).join(", ");
    console.log(`[route-profile-derived] allowedClicks sample: ${sample}${context.allowedExecutableClicks.length > 5 ? "..." : ""}`);

    // Log source breakdown
    if (context.clickSources) {
      const sourceBreakdown: Record<string, number> = {};
      for (const source of context.clickSources.values()) {
        sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
      }
      const sourceStr = Object.entries(sourceBreakdown)
        .map(([source, count]) => `${source}=${count}`)
        .join(" ");
      console.log(`[route-profile-derived] allowedClicks sources: ${sourceStr}`);

      // Log first 3 with their sources as examples
      const examples = context.allowedExecutableClicks.slice(0, 3).map(
        (target) => `"${target}"(${context.clickSources?.get(target) || "unknown"})`
      );
      console.log(`[route-profile-derived] allowedClicks examples: ${examples.join(", ")}`);
    }
  }
  if (context.assertionOnlyTerms.length > 0) {
    const sample = context.assertionOnlyTerms.slice(0, 5).join(", ");
    console.log(`[route-profile-derived] assertionTerms sample: ${sample}${context.assertionOnlyTerms.length > 5 ? "..." : ""}`);
  }
  if (context.visibleButNotExecutableTerms.length > 0) {
    const sample = context.visibleButNotExecutableTerms.slice(0, 5).join(", ");
    console.log(`[route-profile-derived] visibleButNotExecutable sample: ${sample}${context.visibleButNotExecutableTerms.length > 5 ? "..." : ""}`);
  }
}
