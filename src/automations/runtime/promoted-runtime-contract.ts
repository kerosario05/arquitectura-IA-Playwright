import fs from "node:fs/promises";
import path from "node:path";

export type PromotedStrategyMarker = "pom_runtime" | "inline_executor" | "unknown";

export type PromotionDiagnosticsLike = {
  selectedStrategy?: "pom" | "inline";
  fallbackUsed?: boolean;
  requirePomRuntime?: boolean;
  blockers?: string[];
  reason?: string;
};

export type PromotedSpecRuntimeContractResult = {
  valid: boolean;
  strategy: PromotedStrategyMarker;
  usesPromotedRuntime: boolean;
  diagnosticsFound: boolean;
  errors: string[];
  warnings: string[];
};

function detectStrategy(specContent: string): PromotedStrategyMarker {
  if (specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`)) return "pom_runtime";
  if (specContent.includes(`PROMOTED_SPEC_STRATEGY = "inline_executor"`)) return "inline_executor";
  return "unknown";
}

function hasAnyRuntimeHelper(specContent: string): boolean {
  return [
    "clickPromotedTarget(",
    "fillPromotedField(",
    "expectPromotedVisible(",
    "selectPromotedItem("
  ].some((token) => specContent.includes(token));
}

function looksLikePromotedActionSpec(specContent: string): boolean {
  return specContent.includes("[target:") || specContent.includes("await promotedRuntime.");
}

function detectFillValueLiteralFieldNameAntiPattern(specContent: string): string[] {
  const errors: string[] = [];
  
  const fillPromotedFieldRegex = /fillPromotedField\(\{\s*stepIndex:\s*\d+,\s*field:\s*'([^']+)',\s*value:\s*String\(([^)]+)\),[^}]*fill:\s*async\s*\(\)\s*=>\s*\{\s*await\s+\w+\.\w+\([^}]+\}\s*\}\)/g;
  
  let match: RegExpExecArray | null;
  while ((match = fillPromotedFieldRegex.exec(specContent)) !== null) {
    const fieldName = match[1];
    const valueVar = match[2];
    const fullCall = match[0];
    
    const fillMethodMatch = fullCall.match(/await\s+\w+\.\w+\(\s*'([^']+)',\s*'([^']+)'\s*\)/);
    if (fillMethodMatch) {
      const firstArg = fillMethodMatch[1];
      const secondArg = fillMethodMatch[2];
      
      if (firstArg === fieldName && secondArg === fieldName) {
        errors.push(`PROMOTED_FILL_VALUE_LITERAL_FIELD_NAME: fillPromotedField field="${fieldName}" has callback fill('${firstArg}', '${secondArg}') where second arg equals field name instead of using value variable "${valueVar}"`);
      }
    }
  }
  
  return errors;
}

function detectUnusedRequirePromotedData(specContent: string): string[] {
  const warnings: string[] = [];
  
  const declaredVars = new Set<string>();
  const usedVars = new Set<string>();
  
  const declareRegex = /const\s+(\w+)\s*=\s*requirePromotedData\(/g;
  let match: RegExpExecArray | null;
  while ((match = declareRegex.exec(specContent)) !== null) {
    declaredVars.add(match[1]);
  }
  
  const usageRegex = /\b(\w+)\b(?!\s*=)/g;
  while ((match = usageRegex.exec(specContent)) !== null) {
    const varName = match[1];
    if (declaredVars.has(varName)) {
      usedVars.add(varName);
    }
  }
  
  for (const declaredVar of declaredVars) {
    if (!usedVars.has(declaredVar)) {
      warnings.push(`UNUSED_PROMOTED_DATA_VAR: Variable "${declaredVar}" declared with requirePromotedData but not used`);
    }
  }
  
  return warnings;
}

export async function validatePromotedSpecRuntimeContract(
  specPath: string,
  diagnosticsPath?: string
): Promise<PromotedSpecRuntimeContractResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let specContent = "";
  try {
    specContent = await fs.readFile(specPath, "utf-8");
  } catch {
    return {
      valid: false,
      strategy: "unknown",
      usesPromotedRuntime: false,
      diagnosticsFound: false,
      errors: [`spec_not_found:${specPath}`],
      warnings
    };
  }

  const strategy = detectStrategy(specContent);
  const usesPromotedRuntime = specContent.includes("createPromotedSpecRuntime(");
  const hasRuntimeHelperUsage = hasAnyRuntimeHelper(specContent);

  let diagnostics: PromotionDiagnosticsLike | undefined;
  let diagnosticsFound = false;
  if (diagnosticsPath) {
    try {
      const raw = await fs.readFile(diagnosticsPath, "utf-8");
      diagnostics = JSON.parse(raw) as PromotionDiagnosticsLike;
      diagnosticsFound = true;
    } catch {
      warnings.push(`diagnostics_missing_or_invalid:${diagnosticsPath}`);
    }
  }

  const selectedStrategy = diagnostics?.selectedStrategy;
  const requirePomRuntime = diagnostics?.requirePomRuntime === true;

  if (selectedStrategy === "pom") {
    if (strategy !== "pom_runtime") {
      errors.push("diagnostics_pom_but_spec_marker_not_pom_runtime");
    }
    if (!usesPromotedRuntime) {
      errors.push("pom_runtime_missing_createPromotedSpecRuntime");
    }
    if (strategy === "inline_executor") {
      errors.push("pom_runtime_contains_inline_strategy_marker");
    }
    if (looksLikePromotedActionSpec(specContent) && !hasRuntimeHelperUsage) {
      errors.push("pom_runtime_missing_runtime_helper_usage");
    }
  }

  if (selectedStrategy === "inline") {
    if (strategy === "pom_runtime") {
      errors.push("diagnostics_inline_but_spec_marker_pom_runtime");
    }
  }

  if (requirePomRuntime) {
    if (strategy !== "pom_runtime") {
      errors.push("require_pom_runtime_but_spec_not_pom_runtime");
    }
    if (diagnostics?.fallbackUsed === true) {
      errors.push("require_pom_runtime_but_fallback_used");
    }
  }

  if (strategy === "pom_runtime") {
    if (!usesPromotedRuntime) {
      errors.push("spec_marker_pom_runtime_without_runtime_factory");
    }
    if (!hasRuntimeHelperUsage && looksLikePromotedActionSpec(specContent)) {
      errors.push("pom_runtime_strategy_without_runtime_helpers");
    }
  }

  if (strategy === "inline_executor" && selectedStrategy === "pom") {
    errors.push("inline_executor_with_pom_selected_strategy");
  }

  if (selectedStrategy === "pom" && diagnostics?.fallbackUsed) {
    warnings.push("pom_selected_with_fallback_used");
  }

  if (selectedStrategy === "pom" && Array.isArray(diagnostics?.blockers) && diagnostics!.blockers!.length > 0) {
    const fatalBlocker = diagnostics!.blockers!.some((b) => /missing_|validation_error|unavailable|failed/i.test(b));
    if (fatalBlocker) {
      errors.push("pom_selected_with_fatal_blockers");
    }
  }

  const fillValueErrors = detectFillValueLiteralFieldNameAntiPattern(specContent);
  errors.push(...fillValueErrors);

  const unusedDataWarnings = detectUnusedRequirePromotedData(specContent);
  warnings.push(...unusedDataWarnings);

  return {
    valid: errors.length === 0,
    strategy,
    usesPromotedRuntime,
    diagnosticsFound,
    errors,
    warnings
  };
}

export async function collectPromotedSpecs(appSlug?: string): Promise<Array<{ caseSlug: string; specPath: string; diagnosticsPath: string }>> {
  const appsRoot = path.resolve("automations/apps");
  const appDirs = appSlug
    ? [path.join(appsRoot, appSlug)]
    : (await fs.readdir(appsRoot)).map((d) => path.join(appsRoot, d));
  const rows: Array<{ caseSlug: string; specPath: string; diagnosticsPath: string }> = [];

  for (const appDir of appDirs) {
    const casesDir = path.join(appDir, "cases");
    try {
      const caseSlugs = await fs.readdir(casesDir);
      for (const caseSlug of caseSlugs) {
        const caseDir = path.join(casesDir, caseSlug);
        const specPath = path.join(caseDir, "case.spec.ts");
        try {
          await fs.access(specPath);
          rows.push({
            caseSlug,
            specPath,
            diagnosticsPath: path.join(caseDir, "promotion-diagnostics.json")
          });
        } catch {
          // ignore non-promoted cases
        }
      }
    } catch {
      // ignore missing apps/cases directory
    }
  }

  return rows;
}
