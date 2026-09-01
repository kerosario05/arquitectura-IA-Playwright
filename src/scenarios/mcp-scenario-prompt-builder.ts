import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  JiraIssueSource,
  McpRouteProfile,
  ScenarioRouteResolution,
  DeterministicSeedScenario,
  FunctionalBranchRef,
} from "./scenario-types";
import type { CanonicalClaim, FunctionalRequirementAccount } from "./scenario-types";
import {
  buildAppProfilePromptContext,
  formatAppProfileContext,
  buildEntryPathBlockFromContext,
  logAppProfileContext,
  sanitizeForPrompt,
  type AppProfilePromptContext,
} from "./scenario-prompt-context";
import {
  buildDerivedExecutionContext,
  formatDerivedContextForPrompt,
  logDerivedContext,
  type DerivedExecutionContext,
} from "./route-profile-derived-context";

const SKILL_DIR = path.join(process.cwd(), "src", "agent", "skills", "mcp-scenario-generator-universal");

const LEGACY_SKILL_DIR = path.join(process.cwd(), "src", "agent", "skills", "mcp-testrail-case-generator-v2");

/**
 * Get maximum scenarios to generate per issue (configurable via env)
 */
function getMaxScenariosPerIssue(): number {
  return Number(process.env.AI_SCENARIO_MAX_PER_ISSUE) || 3;
}

/**
 * Calculate dynamic scenario limit based on HU scope and catalog alignment
 *
 * Rules:
 * - If AI_SCENARIO_MAX_PER_ISSUE is defined, use it as absolute limit
 * - Otherwise, calculate dynamically:
 *   - Default simple HU: 3
 *   - HU mentioning products/catalog + multiple aligned categories: min 1 per category (up to 10)
 *   - HU with explicit failure scenarios: add UI-automatable failure quota (up to 3)
 *
 * @param issues - Jira issues (use first issue as primary context)
 * @param routeProfile - Route profile with targetPaths
 * @param alignedCategories - Categories aligned with HU scope (from filterTargetPathsByIssueScope)
 * @returns Dynamic scenario limit
 */
export function calculateDynamicScenarioLimit(
  issues: JiraIssueSource[],
  routeProfile: McpRouteProfile | null,
  alignedCategories?: string[]
): number {
  // If env var is set, use it as absolute limit
  if (process.env.AI_SCENARIO_MAX_PER_ISSUE) {
    return Number(process.env.AI_SCENARIO_MAX_PER_ISSUE);
  }

  // Default limit for simple HUs
  let limit = 3;

  if (issues.length === 0) {
    return limit;
  }

  const issue = issues[0]; // Use first issue as primary context

  // Build HU corpus
  const huCorpus = [
    issue.summary || "",
    issue.description || "",
    issue.acceptanceCriteria || "",
    issue.labels.join(" "),
    issue.components.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  // Detect if HU mentions products/catalog
  const mentionsProducts =
    huCorpus.includes("producto") ||
    huCorpus.includes("products") ||
    huCorpus.includes("catalogo") ||
    huCorpus.includes("catalog") ||
    huCorpus.includes("información") ||
    huCorpus.includes("information");

  // Detect if HU is broad (mentions multiple categories or "todos"/"all")
  const isBroadScope =
    huCorpus.includes("todos") ||
    huCorpus.includes("todas") ||
    huCorpus.includes("all") ||
    huCorpus.includes("varios") ||
    huCorpus.includes("múltiples") ||
    huCorpus.includes("multiple") ||
    huCorpus.includes("diferentes") ||
    huCorpus.includes("different");

  // Count aligned categories (passed from filterTargetPathsByIssueScope)
  const categoryCount = alignedCategories?.length || 0;

  // Detect explicit variant mentions in HU (Pesos, Dólares, Euros, etc.)
  const variantPatterns = [
    /\bpesos?\b/i,
    /\bd[oó]lares?\b/i,
    /\beuros?\b/i,
    /\busd\b/i,
    /\beur\b/i,
    /\bclp\b/i,
  ];

  const explicitVariants = new Set<string>();
  for (const pattern of variantPatterns) {
    if (pattern.test(huCorpus)) {
      explicitVariants.add(pattern.source.replace(/\\b/g, "").replace(/[?\\]/g, ""));
    }
  }

  const variantCount = explicitVariants.size;

  // If HU mentions products and is broad (or has multiple categories/variants), increase limit
  // Broad signals: explicit "todos/all", multiple aligned categories, or multiple explicit variants
  const hasBroadSignal = isBroadScope || categoryCount > 2 || variantCount > 1;

  if (mentionsProducts && hasBroadSignal) {
    // Representative budget: 1 per category + 1 per explicit variant (capped at 10)
    const representativeBudget = categoryCount + variantCount;
    limit = Math.min(Math.max(limit, representativeBudget), 10);
    console.log(
      `[scenarios:limit] broad product HU detected: ` +
        `alignedCategories=${categoryCount} explicitVariants=${variantCount} ` +
        `representativeBudget=${representativeBudget} dynamicLimit=${limit}`
    );
  }

  // Detect explicit failure scenarios in HU
  const failureKeywords = [
    "error",
    "fallo",
    "falla",
    "failure",
    "validación negativa",
    "negative validation",
    "escenario negativo",
    "negative scenario",
    "caso de error",
    "error case",
  ];

  const mentionsFailures = failureKeywords.some((kw) => huCorpus.includes(kw));

  // Count explicit failure scenarios mentioned
  const failureScenarioCount = huCorpus.match(/escenario\s+(?:de\s+)?(?:fallo|error|negativo)/gi)?.length || 0;

  if (mentionsFailures && failureScenarioCount > 0) {
    // Add quota for UI-automatable failures (up to 3)
    const failureQuota = Math.min(failureScenarioCount, 3);
    limit += failureQuota;
    console.log(
      `[scenarios:limit] failure scenarios detected: count=${failureScenarioCount} addedQuota=${failureQuota} newLimit=${limit}`
    );
  }

  // Cap at reasonable maximum to avoid overwhelming AI
  limit = Math.min(limit, 12);

  return limit;
}

async function loadSkillMarkdown(): Promise<string | null> {
  // Try universal skill first, fallback to legacy
  for (const dir of [SKILL_DIR, LEGACY_SKILL_DIR]) {
    const skillPath = path.join(dir, "SKILL.md");
    try {
      const content = await fs.readFile(skillPath, "utf-8");
      console.log(`[scenarios:prompt] skill=mcp-scenario-generator-universal loaded=true path=${skillPath} chars=${content.length}`);
      return content;
    } catch {
      // try next
    }
  }
  console.error(`[scenarios:prompt] skill not found at ${SKILL_DIR} or ${LEGACY_SKILL_DIR}`);
  return null;
}

/**
 * Build compact MCP rules without full SKILL.md
 * Used when routeProfile/derivedContext provides sufficient enforcement
 */
function buildCompactMcpRules(scenarioLimit: number): string {
  return `## Compact MCP Rules (Scenario Generation)

**Critical Output Format**:
- Return ONLY valid JSON (no markdown, no fences, no explanations)
- Every scenario must have mcpExecutable: true
- Steps use ONLY these patterns:
  1. Clic en "X" (ONLY if X in ALLOWED_EXECUTABLE_CLICKS, executableRouteSteps, or BRANCH_REQUIRED_CLICKS)
  2. Validar que se muestre "X" (X must be specific label from HU, NOT "Nombre", "Información", "Detalle")
  3. Validar que el botón "X" esté visible/habilitado/deshabilitado
  4. Seleccionar el primer <domainTerm> visible del listado (domainTerm from entity name: préstamo, cuenta, producto, tarjeta — NEVER "elemento")
  5. Ingresar <campo> usando <dataKey>

**Step Numbering**: Steps MUST be numbered: "1. Clic en...", "2. Validar..."

**Forbidden Patterns — REJECT immediately** (IMPORTANT):
- Seleccionar el primer elemento visible del listado. → USE entity name
- Validar que se muestre "Nombre". → USE specific label from HU fields
- Validar que se muestre "Información". / Validar que se muestre "Detalle". → too vague
- Validar que funcione correctamente. / Validar resultado esperado. → abstract
- Completar datos requeridos. / Ejecutar acción de la HU. → no target
- Gestionar la solicitud. / Continuar con el flujo. → narrative

**Coverage Requirements**:
- Simple HU (1-2 screens): minimum 3 scenarios
- Rich HU (detail + financial fields + options): minimum 6 scenarios
- Always include: list view, selection, detail fields, formats (if applicable), post-options, return flow
- If HU has explicit error cases, generate them as routePending scenarios

**Forbidden Scenarios**:
- DO NOT generate: backend-only, manual, OTP, login, PIN, password, token, database, Core Banking, API, log, auditoría scenarios
- If not UI-automatable, add to "rejected" array with reason

**Click Authorization** (CRITICAL):
- "Clic en X" requires X to be in ALLOWED_EXECUTABLE_CLICKS, executableRouteSteps, or BRANCH_REQUIRED_CLICKS
- visible ≠ clickable, domain term ≠ clickable, mentioned in story ≠ clickable
- When in doubt: use "Validar que se muestre" not "Clic en"

**Scenario Limit**: Generate maximum ${scenarioLimit} scenarios per issue. Prioritize positive UI flows.

**Expected Result**: Must be short contextual phrase. NOT a source of executable steps.`;
}

function formatIssues(issues: JiraIssueSource[]): string {
  if (issues.length === 0) return "No issues found.";

  const MAX_DESCRIPTION_CHARS = 2000; // Truncate long descriptions

  return issues
    .map((issue) => {
      const parts = [
        `## ${issue.key}: ${issue.summary}`,
        `**Type:** ${issue.issueType}`,
        `**Status:** ${issue.status}`,
      ];

      if (issue.labels.length > 0) {
        parts.push(`**Labels:** ${issue.labels.join(", ")}`);
      }
      if (issue.components.length > 0) {
        parts.push(`**Components:** ${issue.components.join(", ")}`);
      }

      let description = issue.acceptanceCriteria || issue.description || "";

      // Truncate long descriptions to reduce prompt size
      if (description.length > MAX_DESCRIPTION_CHARS) {
        description = description.substring(0, MAX_DESCRIPTION_CHARS) + "\n\n[... truncated for brevity. Use UI terms above for generation.]";
      }

      if (issue.acceptanceCriteria) {
        parts.push(`\n### Acceptance Criteria\n${description}`);
      } else if (issue.description) {
        parts.push(`\n### Description\n${description}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Build Route Resolution Context section for AI prompt
 */
function buildRouteResolutionContext(
  issues: JiraIssueSource[],
  routeResolutions?: Map<string, ScenarioRouteResolution>
): string {
  if (!routeResolutions || routeResolutions.size === 0) {
    return "";
  }

  const sections: string[] = ["\n\n## Route Resolution Context"];
  sections.push("**CRITICAL**: The following issues have been pre-validated. Their executable route steps are provided below.");
  sections.push("**YOU MUST**:");
  sections.push("- Use EXACTLY the provided executableRouteSteps for navigation");
  sections.push("- Do NOT invent, remove, reorder, or rename route steps");
  sections.push("- Do NOT modify entry steps or intermediate navigation");
  sections.push("- Add ONLY validations required by the functional intent from the issue");
  sections.push("- expectedResult is context only, NOT a source of executable steps");
  sections.push("");

  for (const issue of issues) {
    const resolution = routeResolutions.get(issue.key);
    if (!resolution) continue;

    sections.push(`### ${issue.key}: ${issue.summary}`);
    sections.push(`- **Mode**: ${resolution.scenarioMode}`);
    sections.push(`- **Confidence**: ${resolution.routeConfidence}`);

    if (resolution.executableRouteSteps.length > 0) {
      sections.push(`- **Executable Route Steps**:`);
      resolution.executableRouteSteps.forEach(step => {
        sections.push(`  ${step}`);
      });
    } else {
      sections.push(`- **Note**: Mode is ${resolution.scenarioMode}, generate steps according to mode rules`);
    }

    if (resolution.diagnostics.length > 0) {
      const warnings = resolution.diagnostics.filter(d => d.level === "warning");
      if (warnings.length > 0) {
        sections.push(`- **Warnings**: ${warnings.map(w => w.message).join("; ")}`);
      }
    }

    sections.push("");
  }

  return sections.join("\n");
}

/**
 * Build discovered products block for prompt
 *
 * Extracts products from routeProfile.targetPaths and formats them
 * for AI consumption with full metadata for scenario generation.
 */
function buildDiscoveredProductsBlock(profileCtx?: AppProfilePromptContext): string {
  if (!profileCtx || !profileCtx.present) {
    return "";
  }

  // Extract discovered products from targetPaths
  const targetPaths = (profileCtx as any).targetPaths;
  if (!targetPaths || typeof targetPaths !== "object") {
    return "";
  }

  const discoveredProducts = Object.entries(targetPaths)
    .filter(([_, tp]: [string, any]) => tp.productMetadata && tp.source === "runtime_discovery")
    .map(([target, tp]: [string, any]) => ({
      target,
      category: tp.productMetadata?.category,
      subcategory: tp.productMetadata?.subcategory,
      variant: tp.productMetadata?.variant,
      path: tp.requiredIntermediates || [],
      presentationType: tp.productMetadata?.presentationType || "unknown",
      validationStatus: tp.productMetadata?.validationStatus,
      detailSections: tp.productMetadata?.detailSections || [],
      actionButtons: tp.productMetadata?.actionButtons || [],
      expectedCardSignals: tp.productMetadata?.expectedCardSignals,
      clickableToDetail: tp.productMetadata?.clickableToDetail,
      confidence: tp.confidence || "medium",
    }));

  if (discoveredProducts.length === 0) {
    return "";
  }

  let content = "\n\n## Discovered Product Catalog\n\n";
  content += "The following products were discovered at runtime and are SAFE to use for scenario generation:\n\n";

  // Group by category
  const byCategory = new Map<string, typeof discoveredProducts>();
  for (const prod of discoveredProducts) {
    const cat = prod.category || "General";
    if (!byCategory.has(cat)) {
      byCategory.set(cat, []);
    }
    byCategory.get(cat)!.push(prod);
  }

  for (const [category, prods] of byCategory.entries()) {
    content += `### ${category}\n\n`;
    for (const prod of prods) {
      content += `- **${prod.target}**\n`;
      content += `  - Navigation: ${prod.path.join(" → ")} → ${prod.target}\n`;
      if (prod.variant) {
        content += `  - Variant: ${prod.variant}\n`;
      }
      content += `  - Presentation: ${prod.presentationType}\n`;
      content += `  - Validation: ${prod.validationStatus}\n`;

      // Add type-specific metadata
      if (prod.presentationType === "detail_page") {
        content += `  - Detail Sections: ${prod.detailSections.join(", ") || "none"}\n`;
        content += `  - Action Buttons: ${prod.actionButtons.join(", ") || "none"}\n`;
        content += `  - **Scenario Type**: Navigate to product → Validate detail sections and buttons\n`;
      } else if (prod.presentationType === "product_card") {
        content += `  - Card Signals: ${prod.expectedCardSignals?.bulletCount || 0} bullets, ${prod.expectedCardSignals?.hasImageOrIcon ? "has image" : "no image"}\n`;
        content += `  - Clickable to Detail: ${prod.clickableToDetail ? "Yes" : "No"}\n`;
        if (prod.clickableToDetail) {
          content += `  - **Scenario Type**: Navigate to listing → Validate card → Click card → Validate detail opened\n`;
        } else {
          content += `  - **Scenario Type**: Navigate to listing → Validate card presence and content\n`;
        }
      }
    }
    content += "\n";
  }

  content += "## Instructions for Using Discovered Products\n\n";
  content += "**CRITICAL RULES**:\n\n";
  content += "1. **Use Real Product Names**: Generate scenarios with ACTUAL product names from the catalog:\n";
  content += '   - Good: "Consultar información de Tarjeta de Crédito Visa Joven"\n';
  content += '   - Bad: "Consultar información de tarjetas" (too generic)\n\n';

  content += "2. **Respect presentationType**:\n";
  content += "   - **detail_page**: Generate navigation + detail validation scenarios\n";
  content += '     - Steps: Navigate → Click product → Validate sections ("Detalles", "Requisitos") → Validate buttons ("Solicitar", "Volver")\n';
  content += "     - DO click the product (it opens detail page)\n\n";

  content += "   - **product_card**: Generate card listing validation scenarios\n";
  content += "     - If clickableToDetail=false:\n";
  content += '       - Steps: Navigate → Validate card presence → Validate card content (bullets, image)\n';
  content += "       - DO NOT click the card (it's not clickable)\n";
  content += "     - If clickableToDetail=true:\n";
  content += "       - Steps: Navigate → Validate card → Click card → Validate detail opened\n";
  content += "       - DO click the card (it opens detail)\n\n";

  content += "3. **Follow Navigation Paths**: Use the exact requiredIntermediates path:\n";
  content += '   - Path: ["Información de productos", "Tarjetas"] → "Tarjeta Multicrédito"\n';
  content += '   - Steps: Clic en "Información de productos" → Clic en "Tarjetas" → Validar que se muestre "Tarjeta Multicrédito"\n\n';

  content += "4. **Expand QA Coverage**: Even if the HU is generic, generate SPECIFIC scenarios per representative product:\n";
  content += '   - HU: "Validar listado de tarjetas"\n';
  content += '   - Generate: "Validar tarjeta Visa Joven en listado", "Validar tarjeta PriceSmart en listado"\n\n';

  content += "5. **Preserve Variants**: If products have variants (monedas, tipos), include them in scenarios:\n";
  content += '   - "Consultar Cuenta de Ahorros en Pesos"\n';
  content += '   - "Consultar Cuenta de Ahorros en Dólares"\n';
  content += '   - "Consultar Cuenta de Ahorros en Euros"\n\n';

  content += "6. **DO NOT**:\n";
  content += "   - Invent products not in the catalog\n";
  content += "   - Click cards marked as not clickable\n";
  content += "   - Generate routes not backed by requiredIntermediates\n";
  content += "   - Use generic names when specific products are available\n\n";

  content += "7. **Scenario Generation Strategy**:\n";
  content += "   - For each HU about catalog/products, generate AT LEAST one scenario per representative product\n";
  content += "   - Group by category if many products, but keep representative variants\n";
  content += `   - Stay within maxScenariosPerIssue=${getMaxScenariosPerIssue()} limit by prioritizing high-confidence products\n\n`;

  return content;
}

function buildFunctionalBranchBlock(functionalBranches?: FunctionalBranchRef[]): string {
  if (!functionalBranches || functionalBranches.length === 0) return "";

  const lines: string[] = [];
  lines.push("\n\n## Functional Branch Coverage Contract");
  lines.push("Each branch below represents a distinct UI-functional obligation.");
  lines.push("You MUST generate at least one UI-automatable scenario per branchId.");
  lines.push("Do NOT merge two different branches into one scenario.");
  lines.push("Do NOT use two scenarios from one branch to claim coverage of another branch.");
  lines.push("");
  lines.push("For EACH generated scenario that maps to a listed branch:");
  lines.push("- Include `scenarioId`.");
  lines.push("- Include `functionalBranch` object with EXACT `branchId` from this list.");
  lines.push("- Preserve branch `actionIntent`, `expectedDestination`, and `accessIntent`.");
  lines.push("- REQUIRED: include decisive click on sourceLabel and observable validation of expectedDestination.");
  lines.push("- Do NOT claim branch coverage with only sourceLabel visibility assertions.");
  lines.push("- For auth-start branches, destination may be satisfied by observable authentication boundary evidence.");
  lines.push("");
  lines.push("### Required Branches");

  for (const branch of functionalBranches) {
    const visibleObligation = branch.expectedDestination || branch.sourceLabel || "visible_branch_obligation_required";
    lines.push(`- branchId: ${branch.branchId}`);
    lines.push(`  actionIntent: ${branch.actionIntent}`);
    lines.push(`  expectedDestination: ${branch.expectedDestination ?? "unknown"}`);
    lines.push(`  accessIntent: ${branch.accessIntent}`);
    lines.push(`  visibleObligation: ${visibleObligation}`);
    lines.push(`  requiredAction: { type: "click", target: "${branch.sourceLabel ?? "unknown"}", source: "user_story" }`);
    lines.push(`  requiredObservableResult: ${branch.expectedDestination ?? "unknown"}`);
  }

  return lines.join("\n");
}

function buildBranchRequiredClicksBlock(
  functionalBranches?: FunctionalBranchRef[],
  suppressRouteProfile?: boolean,
): string {
  if (!functionalBranches || functionalBranches.length === 0) return "";
  const requiredClicks = Array.from(
    new Set(
      functionalBranches
        .map((branch) => branch.sourceLabel?.trim())
        .filter((label): label is string => Boolean(label)),
    ),
  );
  if (requiredClicks.length === 0) return "";
  const lines: string[] = [];
  lines.push("\n\n## Branch Required Clicks (HU-derived)");
  lines.push("These targets are mandatory branch actions extracted from the HU.");
  lines.push("Treat BRANCH_REQUIRED_CLICKS as executable click authority (same level as ALLOWED_EXECUTABLE_CLICKS).");
  if (suppressRouteProfile) {
    lines.push("routeProfile context is suppressed for compatibility, but BRANCH_REQUIRED_CLICKS remain mandatory.");
  }
  lines.push("BRANCH_REQUIRED_CLICKS:");
  for (const label of requiredClicks) {
    lines.push(`- ${label}`);
  }
  return lines.join("\n");
}

function buildSystemPrompt(
  skillMd: string | null,
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  profileCtx?: AppProfilePromptContext,
  derivedCtx?: DerivedExecutionContext,
  useCompactMode?: boolean,
  scenarioLimit?: number,
  suppressRouteProfile?: boolean,
  functionalBranches?: FunctionalBranchRef[],
): string {
  const testrailSection = testrailMeta
    ? `\n\n## TestRail Target\n- Project ID: ${testrailMeta.projectId}\n- Suite ID: ${testrailMeta.suiteId}${testrailMeta.sectionId ? `\n- Section ID: ${testrailMeta.sectionId}` : ""}${testrailMeta.sectionName ? `\n- Section Name: ${testrailMeta.sectionName}` : ""}`
    : "";

  const targetAppInfo = targetAppSlug
    ? `\n\n## Target Functional App\n- targetAppSlug: ${targetAppSlug}\n- targetAppName: ${targetAppName ?? targetAppSlug}`
    : "";

  const routeProfileBlock = profileCtx?.present && !suppressRouteProfile
    ? `\n\n## App Configuration / RouteProfile\n${formatAppProfileContext(profileCtx)}`
    : "";

  const derivedContextBlock = derivedCtx && !suppressRouteProfile
    ? `\n\n${formatDerivedContextForPrompt(derivedCtx)}`
    : "";

  // Build discovered products block
  const discoveredProductsBlock = suppressRouteProfile ? "" : buildDiscoveredProductsBlock(profileCtx);
  const functionalBranchBlock = buildFunctionalBranchBlock(functionalBranches);
  const branchRequiredClicksBlock = buildBranchRequiredClicksBlock(functionalBranches, suppressRouteProfile);

  const entryPathBlock = buildEntryPathBlockFromContext(profileCtx ?? { appSlug, entrySteps: [], navigationHints: {}, aliases: {}, domainTerms: {}, visibleControls: [], present: false });

  // Use compact mode when derivedContext provides enforcement
  const compactMode = useCompactMode ?? (derivedCtx && derivedCtx.allowedExecutableClicks.length > 0);

  // Use provided scenarioLimit or fallback to env/default
  const limit = scenarioLimit ?? getMaxScenariosPerIssue();

  const skillRules = compactMode
    ? buildCompactMcpRules(limit)
    : (skillMd ? `## Skill Rules (from mcp-scenario-generator-universal)\n\n${skillMd}\n\n` : "");

  console.log(`[scenarios:prompt] compactMode=${compactMode} skillCharsIncluded=${skillRules.length} maxScenariosPerIssue=${limit}`);

  return `You are an expert QA automation engineer. Your task is to generate MCP-ready TestRail scenarios from Jira user stories.

${skillRules}
## Critical Output Rules
1. Return ONLY valid JSON. No markdown fences, no explanations.
2. Every scenario must have mcpExecutable: true.
3. Do NOT generate backend-only, manual, OTP, login, PIN, password, cédula, token, database, Core Banking, API, log, or auditoría scenarios.
4. Steps must use MCP patterns only:
   - Clic en "X".
   - Validar que se muestre "X".
   - Validar que el botón "X" esté visible/habilitado/deshabilitado.
   - Validar que la opción "X" esté disponible.
   - Esperar que se muestre "X".
   - Seleccionar el primer/último <domainTerm> visible del listado.
   - Ingresar <campo> usando <dataKey>.
5. Use AuthGate in preconditions for authenticated flows.
6. expectedResult must be a short contextual phrase, not new validation targets.
7. If an issue is not UI-automatable, add it to "rejected" array with reason.
8. Forbidden step phrases: "El sistema permite", "El cliente accede", "Validar correctamente", "Verificar que funcione", "Se procesa exitosamente", "Validar backend", "Validar Core Banking", "Validar base de datos", "Validar cálculo exacto", "Validar auditoría".
 9. If Functional Branch Coverage Contract is present, generate independent coverage for each listed branchId and return branchId in functionalBranch.
  10. Return one stepClaimTypes value per step for step semantics only. Do not use it to redefine canonical claim metadata.
  11. Return stepClaims for every referenced canonical claim using only { stepIndex, claimId }. Use only claimIds present in the supplied manifest, do not invent IDs, and do not repeat requirementId, facet, claimType, targetKind, or scope. The core resolves those values from CanonicalClaim. A claim may be grouped with compatible claims in one scenario, but every required coverable claim must be referenced.

## Entry Steps Rules
- entrySteps represent the navigation needed to reach a functional context that comes AFTER the entry screen. They are mandatory only when the scenario's target context is downstream of that navigation.
- If the scenario's primary objective is to validate the screen/context that exists BEFORE the entrySteps, do NOT prepend entrySteps that would leave that screen. Perform the assertions while that screen/context remains active.
- If the scenario validates a screen or behavior that occurs AFTER the entry navigation, include the required entrySteps in order before the scenario-specific steps.
- Temporal coherence: an assertion must run while the screen/context it belongs to is still active. Never place an assertion after a navigation step that leaves that context.
- If entrySteps are needed for the target context, do NOT omit, reorder, or modify them.
- If entrySteps are NOT provided, do NOT invent them. Generate steps based ONLY on the Jira story.
- MCP will insert missing entrySteps automatically at runtime if the routeProfile defines them.
- Do NOT duplicate entry steps. Each entry step must appear exactly once per scenario.

## Multiproject Execution Rules
**CRITICAL - Apply to ALL projects/apps without exception**:

1. **Click Authorization**: "Clic en X" requires X to be in ALLOWED_EXECUTABLE_CLICKS, executableRouteSteps, or BRANCH_REQUIRED_CLICKS
   - NO clicks on visibleControls unless also in ALLOWED_EXECUTABLE_CLICKS
   - NO clicks on domainTerms unless also in ALLOWED_EXECUTABLE_CLICKS
   - NO clicks on story content sections (Beneficios, Requisitos, Condiciones, etc.)
   - NO clicks on field names, labels, messages, or data values

2. **Content vs Controls**:
   - User story sections → Validations only
   - Expected results → Context only, never executable
   - Field names/labels → Validations only
   - Messages/alerts → Validations only
   - Legal/informational text → Validations only
   - Data values → Validations only
   - Interactive controls in ALLOWED_EXECUTABLE_CLICKS → Clicks allowed

3. **Validation Preference**: When uncertain, use "Validar que se muestre" instead of "Clic en"

4. **Route Adherence**: If executableRouteSteps provided, use them exactly - do not modify navigation

5. **Post-Generation Check**: Invalid clicks will be rejected by compliance validator - better to under-click than over-click

## Sensitive Actions
Sensitive actions include: Solicitar, Confirmar, Enviar, Pagar, Transferir, Firmar, Aceptar contrato, Aprobar, Debitar, Eliminar, Cancelar producto.
- Do NOT generate "Clic en" for sensitive actions by default.
- DO allow "Validar que el botón 'X' esté visible/deshabilitado" for sensitive actions.
- DO allow "Validar que se muestre 'X'" for sensitive action labels.

${entryPathBlock}
${functionalBranchBlock}
${branchRequiredClicksBlock}
## COVERAGE EXPECTATIONS
- If the Jira story describes a functional area with multiple visible layers (list+detail+actions), generate separate scenarios per layer.
- Do not collapse all paths into one scenario.
- Generate scenarios for:
  - visualización del área funcional principal
  - navegación a opciones disponibles
  - selección de primer elemento disponible (only if backed by route or HU text)
  - detalle de información con campos específicos de la HU
  - validación de formatos (moneda/fecha/porcentaje) si la HU los menciona
  - controles y opciones posteriores visibles
  - regresar o volver desde el detalle
  - estados vacíos solo si son visibles por UI y la HU los menciona
- Prefer 6 to 12 scenarios when the story contains enough UI material.
- Reject backend/manual/integration/log/audit/external website checks.
- Do not reject valid UI routes only because they require controlled data.
- Prefer \`ui_with_controlled_data\` when a realistic fixture is needed.

## Valid Action Targets - MULTIPROJECT RULES
**CRITICAL**: "Clic en X" is ONLY allowed when X is explicitly listed in ALLOWED_EXECUTABLE_CLICKS (from Enforceable Execution Context), appears in executableRouteSteps (from Route Resolution Context), or is listed in BRANCH_REQUIRED_CLICKS.

**Source of Truth for Clicks**:
1. ALLOWED_EXECUTABLE_CLICKS - The ONLY authorized click targets
2. executableRouteSteps - Pre-validated route steps that can be used as-is
3. BRANCH_REQUIRED_CLICKS - Mandatory click actions derived from Functional Branches

**NOT Sources for Clicks** (these are for validations/assertions only):
- visibleControls - Visible elements that may or may not be clickable (default: validation only)
- domainTerms - Business vocabulary for listings/content (default: validation only)
- ASSERTION_ONLY_TERMS - Explicitly forbidden as click targets
- expectedResult - Context only, never a source of executable steps
- User story content sections (Beneficios, Requisitos, Condiciones, Información legal, etc.) - Validation only
- Field names, labels, messages, data values, currency names, section titles - Validation only

**Key Principles**:
- "visible" does NOT mean "clickable"
- "mentioned in user story" does NOT mean "clickable"
- "domain term" does NOT mean "clickable"
- "appears in visibleControls" does NOT mean "clickable"
- ALLOWED_EXECUTABLE_CLICKS is the primary route-profile source of truth for click actions
- BRANCH_REQUIRED_CLICKS are mandatory HU-derived clicks that must be preserved for branch coverage

**How to Use Terms**:
- If term is in ALLOWED_EXECUTABLE_CLICKS → "Clic en \"<term>\""
- If term is in BRANCH_REQUIRED_CLICKS → "Clic en \"<term>\"" (mandatory for that branch)
- If term is in ASSERTION_ONLY_TERMS → ONLY "Validar que se muestre \"<term>\""
- If term is in SENSITIVE_ACTIONS → ONLY "Validar que el botón \"<term>\" esté visible"
- If term is visible/domain/content but NOT in allowed clicks → "Validar que se muestre \"<term>\""
- If term is from expectedResult/story sections → "Validar que se muestre \"<term>\""

 **Content/Assertion Terms**:
Content sections, expected results, messages, conditions, field names, legal notes, and informational sections must ALWAYS become validations:
- Wrong: Clic en contenido no ejecutable
- Wrong: Clic en "Beneficios"
- Right: Validar que se muestre el label especifico de la HU
- Right: Validar que se muestre "Beneficios"
- Never: generate assertions for labels NOT mentioned in the HU text

**When in Doubt**: If you are uncertain whether a target is executable, use "Validar que se muestre" instead of "Clic en". The post-generation validator will reject scenarios with unbacked clicks.

## Detail Scenario Pattern
**IMPORTANT**: Do NOT assume all listings are selectable. Selection steps are ONLY allowed when backed by profile/route.

**When to Use Selection**:
- ONLY if routeResolution includes selection in executableRouteSteps
- ONLY if domainTerm explicitly indicates selectable items (e.g., "producto seleccionable", "tarjeta clickeable")
- ONLY if ALLOWED_EXECUTABLE_CLICKS includes the specific item type

 **When NOT to Use Selection** (use validation instead):
- Listing of informational sections (secciones informativas, contenido estático)
- Listing of data/content blocks without interactive elements
- Category/label names that are text content, not navigation targets
- Detail fields displayed on current page (no selection needed)

**Pattern for Informational Listings**:
Instead of:
1. Navigate to module
2. Seleccionar el primer elemento visible del listado
3. Validar campos de detalle

Use:
1. Navigate to module
2. Validar que se muestre lista de secciones
3. Validar que se muestre cada campo especifico mencionado en la HU

**Pattern for Interactive Listings** (ONLY when backed):
1. Navigate to module
2. Seleccionar el primer <domainTerm> visible del listado (ONLY if domainTerm indicates selectability)
3. Validar campos de detalle

## CRITICAL OUTPUT CONTRACT
- Return exactly one JSON object.
- Do not use markdown.
- Do not use \`\`\` fences.
- Do not include explanations.
- Do not include comments.
- Do not include trailing commas.
- Do not write CSV.
- The first non-whitespace character of your response must be '{'.
- The last non-whitespace character of your response must be '}'.
- If no scenarios can be generated, return:
{
  "appSlug": "${appSlug}",
  "targetAppSlug": "${targetAppSlug ?? appSlug}",
  "targetAppName": "${targetAppName ?? appSlug}",
  "confidence": "low",
  "reason": "No MCP-executable scenarios could be generated from the provided Jira issues.",
  "functionalRoute": "",
  "routeProfile": {
    "name": "",
    "entry": [],
    "aliases": {},
    "intermediates": {},
    "domainTerms": {},
    "visibleControls": [],
    "representativeFixture": {},
    "notes": []
  },
  "scenarios": [],
  "warnings": ["No executable scenarios generated."],
  "rejected": []
}

## App Configuration
- appSlug: ${appSlug} (technical profile)
- targetAppSlug: ${targetAppSlug ?? appSlug} (functional app)
- targetAppName: ${targetAppName ?? appSlug}${testrailSection}${targetAppInfo}${routeProfileBlock}${derivedContextBlock}${discoveredProductsBlock}

## Required JSON Output Format
Return a JSON object with this exact structure:
{
  "appSlug": "${appSlug}",
  "targetAppSlug": "${targetAppSlug ?? appSlug}",
  "targetAppName": "${targetAppName ?? appSlug}",
  "confidence": "high|medium|low",
  "reason": "Brief explanation",
  "functionalRoute": "Expected functional route description",
  "routeProfile": {
    "name": "generated_profile_name",
    "entry": [],
    "aliases": {},
    "intermediates": {},
    "domainTerms": {},
    "visibleControls": [],
    "representativeFixture": {},
    "notes": []
  },
  "scenarios": [
    {
       "sourceIssueKey": "<source-issue-key>",
       "scenarioId": "<source-issue-key>:<scenario-slug>:01",
      "title": "Scenario title",
      "steps": ["1. Clic en \"X\".", "2. Validar que se muestre \"Y\"."],
      "stepClaimTypes": ["action", "visibility_assertion"],
      "stepClaims": [{ "stepIndex": 0, "claimId": "canonical-claim-id" }],
      "preconditions": ["1. BASE_URL configurado.", "2. App available.", "3. APP_LOGIN_MODE=password.", "4. AuthGate/AuthFlow enabled.", "5. Test client meets dataRequirements.", "6. App Slug: ${appSlug}."],
      "expectedResult": "Short contextual phrase.",
      "type": "Functional",
      "database": "QA",
      "isConverted": 0,
      "automationType": "ui_with_auth_gate",
      "setupStrategy": "auth_gate",
      "authIntent": "gate_observation",
      "appSlug": "${targetAppSlug ?? appSlug}",
      "targetAppSlug": "${targetAppSlug ?? appSlug}",
      "targetAppName": "${targetAppName ?? appSlug}",
      "routeProfile": "generated_profile_name",
      "dataRequirements": "cliente_fixture_requerido",
      "nonExecutableCriteria": "",
      "mcpExecutable": true,
      "functionalBranch": {
         "branchId": "<branch-id-from-structured-metadata>",
        "sourceLabel": "Visible option label from HU",
         "sourceRequirementId": "<canonical-requirement-id>",
        "actionIntent": "select_option",
        "expectedDestination": "Expected visible destination",
        "accessIntent": "public|authenticated|unknown",
        "evidenceSource": "user_story|acceptance_criteria|route_profile|knowledge|discovery"
      }
    }
  ],
  "warnings": [],
  "rejected": [
     {
       "sourceIssueKey": "<source-issue-key>",
      "reason": "backend_only_or_not_ui_automatable"
    }
  ]
}

## AUTH INTENT
- Use "authIntent": "gate_observation" SOLO cuando el objetivo funcional del escenario termina al comprobar que aparece o se activa un mecanismo de autenticación.
- Use "authIntent": "full_authentication" cuando el escenario necesita atravesar autenticación para ejecutar o validar pasos funcionales posteriores.
- Omite authIntent cuando el escenario no requiere autenticación o la evidencia de la HU no permite determinarlo.
- NO uses "gate_observation" únicamente porque la funcionalidad sea privada, accessIntent sea "authenticated", exista un auth gate en la ruta, o la navegación llegue a una pantalla de login.
- NO infieras authIntent desde appSlug, URL, stage, nombre de módulo, producto o implementación específica.
`;
}

export async function buildMcpScenarioMessages(
  issues: JiraIssueSource[],
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  loginMode?: string,
  routeResolutions?: Map<string, ScenarioRouteResolution>,
  deterministicSeeds?: DeterministicSeedScenario[],
  effectiveIntent?: string,
  _huEvidenceMap?: Map<string, any>,
  _pathSelectionMap?: Map<string, any>,
  _huScopeGuard?: any,
  _huScenarioModel?: any,
  _routePendingScenarioPlan?: any,
  functionalBranches?: FunctionalBranchRef[],
  requirementAccounting?: FunctionalRequirementAccount[],
  canonicalClaims?: CanonicalClaim[],
): Promise<Array<{ role: "system" | "user"; content: string }>> {
  const skillMd = await loadSkillMarkdown();

  // Detect intent from explicit effectiveIntent first, fallback to annotated issues
  const classifierIntent = ((issues[0] as any)?._huIntent as string) ?? "unknown_flow";
  const canonicalIntent = effectiveIntent || classifierIntent;
  const primaryHuIntent = canonicalIntent;
  console.log(`[scenarios:prompt] intentResolution canonicalIntent=${canonicalIntent} source=${effectiveIntent ? "derivedModelIntent" : "classifier"} primaryClassifierIntent=${classifierIntent}`);
  const isNonCatalogIntent = primaryHuIntent !== "catalog_listing_flow" &&
    primaryHuIntent !== "product_detail_flow" &&
    canonicalIntent !== "catalog_listing" && canonicalIntent !== "product_detail";

  // Detect routeProfile catalog orientation via structural signals
  let routeProfileIsCatalog = false;
  if (routeProfile) {
    const rp = routeProfile as any;
    const targetPathKeys = Object.keys(rp.targetPaths ?? {});
    const hasProductMetadata = targetPathKeys.some(
      (k: string) => !!(rp.targetPaths?.[k] as any)?.productMetadata?.subcategory
    );
    const entryLabels = (rp.entry ?? []).map((e: any) =>
      (e.businessLabel ?? e.visibleLabel ?? "").toLowerCase()
    ).join(" ");
    const hasCatalogEntry = /informacion_de_productos|productos|catalogo/i.test(entryLabels);
    const controls = (rp.visibleControls ?? []) as string[];
    const catalogControls = controls.filter((c: string) =>
      /beneficios|requisitos|condiciones relevantes|descripci[oó]n general|informaci[oó]n legal|nombre del producto|solicitar/i.test(c));
    const controlRatio = catalogControls.length / Math.max(controls.length, 1);
    const score = (targetPathKeys.length >= 3 ? 3 : targetPathKeys.length >= 1 ? 2 : 0) +
      (hasProductMetadata ? 3 : 0) + (hasCatalogEntry ? 1 : 0) + (controlRatio >= 0.3 ? 1 : 0);
    routeProfileIsCatalog = score >= 2;
  }

  // Suppress incompatible routeProfile from prompt for non-catalog intents
  const suppressRouteProfile = isNonCatalogIntent && routeProfileIsCatalog;
  console.log(`[scenarios:prompt] promptRouteProfileSuppressed=${suppressRouteProfile} reason=${suppressRouteProfile ? "non_catalog_intent" : isNonCatalogIntent ? "routeProfile_not_catalog" : "catalog_intent"} effectiveIntent=${primaryHuIntent} routeProfileIsCatalog=${routeProfileIsCatalog}`);
  if (suppressRouteProfile) {
    console.log(`[scenarios:prompt] routeProfile suppressed allowedClicks, assertionTerms, routeResolutions for prompt`);
    console.log(`[scenarios:prompt] promptSources primary=hu+knowledge+explicitRoute routeProfile=diagnostic_only`);
  }

  const profileCtx = buildAppProfilePromptContext(appSlug, {
    targetAppSlug,
    targetAppName,
    routeProfile,
    entrySteps,
    loginMode,
  });

  logAppProfileContext(profileCtx);

  // Extract additional entry targets from entrySteps
  const additionalEntryTargets: string[] = [];
  if (entrySteps) {
    for (const step of entrySteps) {
      if (step.action === "click" && step.target) {
        additionalEntryTargets.push(step.target);
      }
    }
  }

  // Build derived execution context
  const derivedCtx = routeProfile
    ? buildDerivedExecutionContext(
        appSlug,
        routeProfile,
        routeResolutions ?? new Map(),
        additionalEntryTargets
      )
    : undefined;

  if (derivedCtx) {
    logDerivedContext(derivedCtx);
  }

  const issueKeys = issues.map((i) => i.key).join(", ");
  console.log(`[scenarios:prompt] jira issues included keys=${issueKeys} routeResolutions=${routeResolutions?.size ?? 0}`);

  // Calculate dynamic scenario limit based on HU scope and catalog alignment
  let alignedCategories: string[] = [];

  if (issues.length > 0 && routeProfile?.targetPaths) {
    // Import filterTargetPathsByIssueScope to get aligned categories
    const { filterTargetPathsByIssueScope } = await import("./scenario-hu-scope-filter");

    const issueContext = issues[0]; // Use first issue as primary context

    const { alignedTargetPaths, diagnostics } = filterTargetPathsByIssueScope(
      issueContext,
      routeProfile.targetPaths,
      routeProfile ?? null
    );

    // Extract unique categories from aligned products
    const categorySet = new Set<string>();
    for (const tp of Object.values(alignedTargetPaths)) {
      if (tp.productMetadata?.category) {
        categorySet.add(tp.productMetadata.category);
      }
    }
    alignedCategories = Array.from(categorySet);

    console.log(
      `[scenarios:limit] HU scope analysis: totalProducts=${diagnostics.totalProducts} ` +
        `alignedProducts=${diagnostics.alignedProducts} alignedCategories=${alignedCategories.length}`
    );
  }

  // Calculate dynamic limit
  const dynamicScenarioLimit = calculateDynamicScenarioLimit(issues, routeProfile ?? null, alignedCategories);

  console.log(`[scenarios:limit] resolved limit: ${dynamicScenarioLimit}`);

  // Determine compact mode: use if derivedCtx provides enforcement
  const useCompactMode = derivedCtx && derivedCtx.allowedExecutableClicks.length > 0;

  // Build system prompt with route resolution context and derived context
  let systemContent = buildSystemPrompt(
    skillMd,
    appSlug,
    testrailMeta,
    targetAppSlug,
    targetAppName,
    profileCtx,
    derivedCtx,
    useCompactMode,
    dynamicScenarioLimit,
    suppressRouteProfile,
    functionalBranches,
  );
  console.log(`[scenarios:prompt] functionalBranches=${functionalBranches?.length ?? 0}`);
  if (requirementAccounting?.length) {
    const manifest = requirementAccounting.map((r) => ({
      requirementId: r.requirementId ?? r.id,
      category: r.category,
      ...(r.associatedBranchId ? { associatedBranchId: r.associatedBranchId } : {}),
      ...(r.prerequisiteRequirementIds?.length ? { prerequisiteRequirementIds: r.prerequisiteRequirementIds } : {}),
      ...(r.expectedBehavior ? { expectedBehavior: r.expectedBehavior } : {}),
    }));
    systemContent += `\n## Requirement ID manifest\n${JSON.stringify(manifest)}\n` +
      "All coverable requirements in this manifest must be represented by at least one valid stepRequirementRef across the candidate scenarios. " +
      "Use only IDs from this manifest, use 0-based stepIndex, and never invent requirement IDs. " +
      "A step may have multiple refs and a requirement may appear in multiple scenarios. " +
      "Non-automatable requirements do not require executable refs.\n";
  }
  if (canonicalClaims?.length) {
    const requiredClaims = canonicalClaims.filter((claim) => claim.required && claim.coverable);
    systemContent += `\n## Canonical claim manifest\n${JSON.stringify(requiredClaims)}\n` +
      "Every required coverable claim must be referenced exactly by claimId in scenario stepClaims. " +
      "Use only supplied claimIds; never invent or replace a claim with description text. " +
      "Keep claimId, requirementId, facet, claimType, targetKind, and scope structurally compatible. " +
      "A semantic_destination claim must remain semantic and cannot become an exact UI assertion without an explicit exact UI target.\n";
  }

  // Add route resolution context if available
  if (!suppressRouteProfile) {
    const routeContext = buildRouteResolutionContext(issues, routeResolutions);
    if (routeContext) {
      systemContent += routeContext;
      console.log(`[scenarios:prompt] route resolution context added for ${routeResolutions?.size ?? 0} issues`);
    }
  } else if (routeResolutions && routeResolutions.size > 0) {
    console.log(`[scenarios:prompt] routeResolution suppressed count=${routeResolutions.size} reason=incompatibleRouteProfile`);
  }

  // Add deterministic seeds if available
  if (deterministicSeeds && deterministicSeeds.length > 0) {
    const seedsSection: string[] = [];
    seedsSection.push("\n## Deterministic Seed Scenarios\n");
    seedsSection.push("The following are base/seed scenarios generated deterministically.\n");
    seedsSection.push("Use these as starting points or context, but feel free to expand, refine, or add alternative scenarios.\n");
    seedsSection.push("Generate additional scenarios that explore edge cases, validations, or alternative user flows.\n\n");

    for (const seed of deterministicSeeds) {
      seedsSection.push(`### ${seed.sourceIssueKey}: ${seed.title}\n`);
      seedsSection.push(`Mode: ${seed.mode}\n`);
      seedsSection.push(`Confidence: ${seed.confidence}\n`);
      seedsSection.push("Steps:\n");
      seed.steps.forEach(step => {
        seedsSection.push(`  ${step}\n`);
      });
      if (seed.notes) {
        seedsSection.push(`Notes: ${seed.notes}\n`);
      }
      seedsSection.push("\n");
    }

    systemContent += seedsSection.join("");
    console.log(`[scenarios:prompt] added ${deterministicSeeds.length} deterministic seeds as context`);
  }

  const safeUserContent = sanitizeForPrompt(formatIssues(issues));
  const userContent = `Generate MCP-ready TestRail scenarios from the following Jira issues:\n\n${safeUserContent}`;

  // Comprehensive size logging
  const systemChars = systemContent.length;
  const userChars = userContent.length;
  const totalChars = systemChars + userChars;
  const estimatedTokens = Math.ceil(totalChars / 4); // rough token estimate (4 chars per token)
  // Compute effective counts (reflect what actually goes into the prompt)
  const rawAllowedClicksCount = derivedCtx?.allowedExecutableClicks.length ?? 0;
  const rawBranchRequiredClicksCount = new Set(
    (functionalBranches ?? [])
      .map((branch) => branch.sourceLabel?.trim())
      .filter((label): label is string => Boolean(label)),
  ).size;
  const rawAssertionTermsCount = derivedCtx?.assertionOnlyTerms.length ?? 0;
  const rawRouteResolutionCount = routeResolutions?.size ?? 0;
  const effectiveAllowedClicksCount = suppressRouteProfile
    ? rawBranchRequiredClicksCount
    : new Set([
        ...(derivedCtx?.allowedExecutableClicks ?? []),
        ...((functionalBranches ?? [])
          .map((branch) => branch.sourceLabel?.trim())
          .filter((label): label is string => Boolean(label))),
      ]).size;
  const effectiveAssertionTermsCount = suppressRouteProfile ? 0 : rawAssertionTermsCount;
  const effectiveRouteResolutionCount = suppressRouteProfile ? 0 : rawRouteResolutionCount;

  console.log(
    `[scenarios:prompt] promptRouteProfileSuppressed=${suppressRouteProfile} reason=${suppressRouteProfile ? "non_catalog_intent" : "catalog_intent_or_route_not_catalog"} effectiveIntent=${primaryHuIntent} allowedClicksBefore=${rawAllowedClicksCount} branchRequiredClicks=${rawBranchRequiredClicksCount} allowedClicksAfter=${effectiveAllowedClicksCount} assertionTermsBefore=${rawAssertionTermsCount} assertionTermsAfter=${effectiveAssertionTermsCount} routeResolutionsBefore=${rawRouteResolutionCount} routeResolutionsAfter=${effectiveRouteResolutionCount}`);

  console.log(
    `[scenarios:prompt] prompt built ` +
    `compactMode=${useCompactMode} ` +
    `systemChars=${systemChars} ` +
    `userChars=${userChars} ` +
    `totalChars=${totalChars} ` +
    `estimatedTokens=${estimatedTokens} ` +
    `issues=${issues.length} ` +
    `allowedClicksCount=${effectiveAllowedClicksCount} ` +
    `assertionTermsCount=${effectiveAssertionTermsCount} ` +
    `routeResolutionCount=${effectiveRouteResolutionCount} ` +
    `maxScenariosPerIssue=${dynamicScenarioLimit} ` +
    `expectedResultAsContext=true`
  );

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}
