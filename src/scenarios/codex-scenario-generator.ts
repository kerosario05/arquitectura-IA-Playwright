import type { McpGenerationResponse, McpRouteProfile, ScenarioRouteResolution, DeterministicSeedScenario, ScenarioGenerationMode } from "./scenario-types";
import { buildMcpScenarioMessages } from "./mcp-scenario-prompt-builder";
import { parseAiResponse } from "./scenario-output-parser";
import type { JiraIssueSource } from "./scenario-types";
import { createScenarioAiProvider } from "../ai/ai-provider-factory";
import { AiProviderError, type AiProvider } from "../ai/ai-provider.types";
import { resolveScenarioRoute } from "./scenario-route-resolver";
import {
  buildDerivedExecutionContext,
  logDerivedContext,
} from "./route-profile-derived-context";
import {
  validateRouteProfileQuality,
  logRouteProfileQuality,
} from "./route-profile-quality-validator";
import {
  validateScenariosCompliance,
  validateScenarioCompliance,
  logComplianceResult,
  logComplianceSummary,
} from "./scenario-route-compliance-validator";
import { ensureStepStrings, normalizeScenarioSteps } from "./step-formatter";

/**
 * Convert deterministic seeds to full scenarios and validate them
 * Used as fallback when AI fails
 */
function convertSeedsToValidatedScenarios(
  seeds: DeterministicSeedScenario[],
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  derivedContext: any,
  routeResolutions: Map<string, ScenarioRouteResolution>
): { validScenarios: any[]; invalidScenarios: Array<{ scenario: any; result: any }> } {
  const seedScenarios = seeds.map(seed => ({
    sourceIssueKey: seed.sourceIssueKey,
    title: seed.title,
    steps: seed.steps,
    preconditions: ["AuthGate"],
    expectedResult: seed.notes || `Escenario de fallback por error de IA`,
    caseOracle: "assert_visible",
    type: "Automated",
    database: "",
    isConverted: 1,
    automationType: "ui_with_controlled_data",
    setupStrategy: "ui_with_controlled_data",
    appSlug,
    routeProfile: routeProfile?.name || "default",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    scenarioMode: seed.mode,
    routeConfidence: seed.confidence
  }));

  // Validate seed scenarios
  const validScenarios: any[] = [];
  const invalidScenarios: Array<{ scenario: any; result: any }> = [];

  for (const scenario of seedScenarios) {
    const result = validateScenarioCompliance(scenario, derivedContext, routeResolutions.get(scenario.sourceIssueKey));
    if (result.valid) {
      validScenarios.push(scenario);
    } else {
      invalidScenarios.push({ scenario, result });
    }
  }

  return { validScenarios, invalidScenarios };
}

/**
 * Normalize AI-generated scenarios to ensure valid field values
 * Applies multiproject-safe defaults for missing or invalid fields
 */
function normalizeAiScenario(scenario: any, appSlug: string): any {
  const normalized = { ...scenario };

  // Normalize automationType (must be in allowed list)
  const validAutomationTypes = [
    "ui_discovery",
    "ui_with_auth_gate",
    "ui_with_controlled_data",
    "ui_with_auth_gate_controlled_data"
  ];
  if (!validAutomationTypes.includes(normalized.automationType)) {
    normalized.automationType = "ui_with_controlled_data";
  }

  // Normalize setupStrategy (must be in allowed list)
  const validSetupStrategies = [
    "self_contained",
    "auth_gate",
    "controlled_data",
    "no_login"
  ];
  if (!validSetupStrategies.includes(normalized.setupStrategy)) {
    normalized.setupStrategy = "controlled_data";
  }

  // Ensure mcpExecutable is true
  if (normalized.mcpExecutable !== true) {
    normalized.mcpExecutable = true;
  }

  // Ensure appSlug is set
  if (!normalized.appSlug) {
    normalized.appSlug = appSlug;
  }

  // Ensure preconditions array exists
  if (!normalized.preconditions || !Array.isArray(normalized.preconditions)) {
    normalized.preconditions = ["AuthGate"];
  }

  // Ensure caseOracle exists
  if (!normalized.caseOracle) {
    normalized.caseOracle = "assert_visible";
  }

  // Ensure type field exists
  if (!normalized.type) {
    normalized.type = "Automated";
  }

  // Ensure database field exists
  if (normalized.database === undefined) {
    normalized.database = "";
  }

  // Ensure isConverted field exists
  if (normalized.isConverted === undefined) {
    normalized.isConverted = 1;
  }

  // Ensure dataRequirements field exists
  if (!normalized.dataRequirements) {
    normalized.dataRequirements = "";
  }

  // Ensure nonExecutableCriteria field exists
  if (!normalized.nonExecutableCriteria) {
    normalized.nonExecutableCriteria = "";
  }

  return normalized;
}

/**
 * Deduplicate consecutive steps with the same click target
 * Removes duplicate steps like:
 *   "1. Clic en X"
 *   "2. Clic en X"
 * Keeps only the first occurrence
 */
function dedupeConsecutiveSteps(steps: any[]): any[] {
  if (steps.length === 0) return steps;

  const deduped: any[] = [steps[0]];

  for (let i = 1; i < steps.length; i++) {
    const current = steps[i];
    const previous = steps[i - 1];

    // Extract click targets for comparison
    const getCurrentTarget = (step: any): string | null => {
      if (typeof step === "string") {
        const match = step.match(/Clic en "([^"]+)"/i);
        return match ? match[1].toLowerCase().trim() : null;
      }
      if (typeof step === "object" && step.action === "click" && step.target) {
        return step.target.toLowerCase().trim();
      }
      return null;
    };

    const currentTarget = getCurrentTarget(current);
    const previousTarget = getCurrentTarget(previous);

    // Skip if same click target as previous step
    if (currentTarget && previousTarget && currentTarget === previousTarget) {
      console.log(`[scenarios:dedupe] skipping duplicate consecutive click: "${currentTarget}"`);
      continue;
    }

    deduped.push(current);
  }

  return deduped;
}

/**
 * Remove or convert unbacked click targets to validations
 * Prevents scenarios from being rejected due to unbacked clicks like "Volver"
 */
function repairUnbackedClicks(steps: any[], allowedTargets: string[]): any[] {
  if (steps.length === 0) return steps;

  const repaired: any[] = [];

  for (const step of steps) {
    // Extract click target
    let clickTarget: string | null = null;
    if (typeof step === "string") {
      const match = step.match(/Clic en "([^"]+)"/i);
      if (match) {
        clickTarget = match[1];
      }
    }

    if (clickTarget) {
      // Check if target is in allowedTargets (case-insensitive)
      const isAllowed = allowedTargets.some(t => t.toLowerCase() === clickTarget!.toLowerCase());

      if (!isAllowed) {
        // For unbacked targets, remove if "Volver", convert to validation otherwise
        if (clickTarget.toLowerCase() === "volver") {
          console.log(`[scenarios:repair] removing unbacked navigation click: "Clic en ${clickTarget}"`);
          continue;
        } else {
          // For other unbacked targets, convert to validation
          const validationStep = `Validar que se muestre "${clickTarget}"`;
          console.log(`[scenarios:repair] converting unbacked click to validation: "Clic en ${clickTarget}" → "${validationStep}"`);
          repaired.push(validationStep);
          continue;
        }
      }
    }

    repaired.push(step);
  }

  return repaired;
}

/**
 * Get scenario generation mode from environment
 *
 * Default: ai_supported_by_deterministic
 * Override with: SCENARIO_GENERATION_MODE env var
 */
function getScenarioGenerationMode(): ScenarioGenerationMode {
  const envMode = process.env.SCENARIO_GENERATION_MODE;

  if (!envMode) {
    return "ai_supported_by_deterministic"; // DEFAULT
  }

  const validModes: ScenarioGenerationMode[] = [
    "ai_supported_by_deterministic",
    "ai_only",
    "deterministic_only",
    "fallback_deterministic_on_ai_failure"
  ];

  if (validModes.includes(envMode as ScenarioGenerationMode)) {
    if (envMode === "deterministic_only") {
      console.log(`[scenarios:mode] deterministic_only enabled by env. AI will be skipped.`);
    }
    return envMode as ScenarioGenerationMode;
  }

  console.warn(`[scenarios:mode] invalid SCENARIO_GENERATION_MODE="${envMode}", using default ai_supported_by_deterministic`);
  return "ai_supported_by_deterministic";
}

/**
 * Try to generate deterministic seed scenarios for simple cases
 *
 * These are NOT final scenarios, but base/seed scenarios to guide AI generation.
 * The AI should use these as context, not skip generation.
 *
 * Supported modes:
 * - action_button_validation: Just validate a sensitive button is visible (no click)
 *
 * @returns Generated seed scenarios, or null if not applicable
 */
function tryDeterministicGeneration(
  issues: JiraIssueSource[],
  appSlug: string,
  routeResolutions: Map<string, ScenarioRouteResolution>,
  entrySteps?: Array<{ action: string; target: string; when?: string }>
): DeterministicSeedScenario[] | null {
  const seeds: DeterministicSeedScenario[] = [];

  for (const issue of issues) {
    const resolution = routeResolutions.get(issue.key);

    // Only handle action_button_validation mode deterministically
    if (resolution?.scenarioMode !== "action_button_validation") {
      continue;
    }

    // Extract button name from resolution steps or HU
    let buttonTarget: string | null = null;
    if (resolution.executableRouteSteps) {
      for (const step of resolution.executableRouteSteps) {
        const match = step.match(/Validar que el botón "([^"]+)" esté visible/i);
        if (match) {
          buttonTarget = match[1];
          break;
        }
      }
    }

    // If no button found, skip deterministic seed
    if (!buttonTarget) {
      continue;
    }

    // Generate deterministic seed scenario
    const steps: any[] = [];

    // Add entry steps if provided
    if (entrySteps) {
      for (const entryStep of entrySteps) {
        steps.push({
          description: `Clic en "${entryStep.target}".`,
          action: entryStep.action || "click",
          target: entryStep.target || "",
        });
      }
    }

    // Add navigation steps from resolution (excluding validation steps)
    if (resolution.executableRouteSteps) {
      for (const routeStep of resolution.executableRouteSteps) {
        const clickMatch = routeStep.match(/Clic en "([^"]+)"/i);
        if (clickMatch) {
          steps.push({
            description: routeStep,
            action: "click",
            target: clickMatch[1],
          });
        }
      }
    }

    // Add button validation step (never click)
    steps.push({
      description: `Validar que el botón "${buttonTarget}" esté visible.`,
      action: "assert",
      target: `button:has-text("${buttonTarget}")`,
    });

    // Deduplicate consecutive steps before converting to strings
    const dedupedSteps = dedupeConsecutiveSteps(steps);

    // Convert object steps to string steps
    const stringSteps = ensureStepStrings(dedupedSteps);

    const seed: DeterministicSeedScenario = {
      sourceIssueKey: issue.key,
      title: `Validar visibilidad del botón ${buttonTarget}`,
      steps: stringSteps,
      mode: resolution.scenarioMode,
      confidence: resolution.routeConfidence || "high",
      notes: "Deterministic seed for action_button_validation mode"
    };

    seeds.push(seed);
  }

  if (seeds.length === 0) {
    return null;
  }

  console.log(`[scenarios:deterministic] generated ${seeds.length} seed scenarios (not final) for issues: ${seeds.map(s => s.sourceIssueKey).join(", ")}`);
  return seeds;
}


export async function generateScenariosWithAi(
  issues: JiraIssueSource[],
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  loginMode?: string,
  _testProvider?: AiProvider // Optional test-only provider injection
): Promise<McpGenerationResponse> {
  // Extract additional entry targets from entrySteps parameter
  const additionalEntryTargets: string[] = [];
  if (entrySteps) {
    for (const step of entrySteps) {
      if (step.action === "click" && step.target) {
        additionalEntryTargets.push(step.target);
      }
    }
  }

  // Also extract from old-style entry labels (from routeProfile.entry)
  if (routeProfile?.entry) {
    for (const entry of routeProfile.entry) {
      if (entry.visibleLabel && !additionalEntryTargets.includes(entry.visibleLabel)) {
        additionalEntryTargets.push(entry.visibleLabel);
      }
      if (entry.businessLabel && !additionalEntryTargets.includes(entry.businessLabel)) {
        additionalEntryTargets.push(entry.businessLabel);
      }
    }
  }

  console.log(`[scenario-route] additionalEntryTargets=${JSON.stringify(additionalEntryTargets)}`);

  // Route Resolution: Validate routes BEFORE calling AI
  const routeResolutions = new Map<string, ScenarioRouteResolution>();
  const routeBackedIssues: JiraIssueSource[] = [];
  const blockedIssues: Array<{ key: string; title: string; reason: string }> = [];

  console.log(`[scenario-route] resolving routes for ${issues.length} issues routeProfile=${routeProfile?.name ?? "none"}`);

  for (const issue of issues) {
    const resolution = resolveScenarioRoute(issue, routeProfile ?? null, appSlug);
    routeResolutions.set(issue.key, resolution);

    if (resolution.canGenerate) {
      routeBackedIssues.push(issue);
      console.log(`[scenario-route] resolved issue=${issue.key} mode=${resolution.scenarioMode} confidence=${resolution.routeConfidence} canGenerate=true`);
    } else {
      blockedIssues.push({
        key: issue.key,
        title: issue.summary,
        reason: resolution.missingRouteReason || "Route not backed"
      });
      console.log(`[scenario-route] blocked issue=${issue.key} reason=${resolution.missingRouteReason} diagnostics=${resolution.diagnostics.length}`);
    }
  }

  console.log(`[scenario-preview] route-backed issues=${routeBackedIssues.length} blocked=${blockedIssues.length}`);

  // Build derived execution context and validate profile quality
  const derivedContext = buildDerivedExecutionContext(
    appSlug,
    routeProfile ?? null,
    routeResolutions,
    additionalEntryTargets
  );
  logDerivedContext(derivedContext);

  const profileQuality = validateRouteProfileQuality(appSlug, routeProfile ?? null, routeResolutions, derivedContext);
  logRouteProfileQuality(profileQuality);

  // If profile quality prevents generation, return early
  if (!profileQuality.canGenerate) {
    console.log(`[scenario-preview] profile quality prevents generation status=${profileQuality.status}`);
    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "low",
      reason: `Route profile quality insufficient: ${profileQuality.status}. ${profileQuality.diagnostics.map(d => d.message).join("; ")}`,
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: [],
      warnings: [
        ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
        ...profileQuality.diagnostics.filter(d => d.level === "warning").map(d => d.message)
      ],
      rejected: [
        ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
        ...routeBackedIssues.map(issue => ({
          sourceIssueKey: issue.key,
          reason: `route_profile_quality_insufficient: ${profileQuality.status}`
        }))
      ],
      routeResolutions
    };
  }

  // If all issues are blocked, return early with diagnostics
  if (routeBackedIssues.length === 0) {
    console.log(`[scenario-preview] no route-backed issues, skipping AI generation`);
    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "low",
      reason: "All issues blocked due to missing route profile or incomplete routes",
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: [],
      warnings: blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
      rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
      routeResolutions
    };
  }

  // Get scenario generation mode
  const generationMode = getScenarioGenerationMode();
  console.log(`[scenarios:mode] using generation mode: ${generationMode}`);

  // Try to generate deterministic seed scenarios (not final output)
  const deterministicSeeds = tryDeterministicGeneration(routeBackedIssues, appSlug, routeResolutions, entrySteps);
  const seedCount = deterministicSeeds?.length || 0;

  if (seedCount > 0) {
    console.log(`[scenarios:deterministic] generated ${seedCount} seed scenarios as context for AI`);
  }

  // Initialize generation diagnostics
  const generationDiagnostics: any = {
    generationMode,
    deterministicSeedsGenerated: seedCount,
    aiCalled: false,
    aiGenerated: 0,
    finalValid: 0,
    finalRejected: 0,
    finalBlocked: blockedIssues.length,
    fallbackUsed: false
  };

  // Check if we should skip AI (only in deterministic_only mode)
  const shouldSkipAI = generationMode === "deterministic_only";

  if (shouldSkipAI) {
    console.log(`[scenarios:deterministic_only] skipping AI generation by explicit env mode`);
    generationDiagnostics.skipAIReason = "deterministic_only mode enabled by env";

    // If no seeds generated, return early
    if (!deterministicSeeds || deterministicSeeds.length === 0) {
      console.log(`[scenarios:deterministic_only] no seeds generated, returning empty`);
      return {
        appSlug,
        targetAppSlug,
        targetAppName,
        confidence: "low",
        reason: "deterministic_only mode enabled but no seeds could be generated",
        functionalRoute: "",
        routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
        scenarios: [],
        warnings: blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
        rejected: blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
        routeResolutions,
        generationDiagnostics
      };
    }

    // Convert seeds to full scenarios and validate
    const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
      deterministicSeeds,
      appSlug,
      routeProfile || null,
      derivedContext,
      routeResolutions
    );

    console.log(`[scenarios:deterministic_only] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

    generationDiagnostics.finalValid = validScenarios.length;
    generationDiagnostics.finalRejected = invalidScenarios.length;

    return {
      appSlug,
      targetAppSlug,
      targetAppName,
      confidence: "high",
      reason: "Deterministic generation only (by explicit env mode)",
      functionalRoute: "",
      routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
      scenarios: validScenarios,
      warnings: invalidScenarios.map((inv: any) =>
        `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
      ),
      rejected: invalidScenarios.map((inv: any) => ({
        sourceIssueKey: inv.scenario.sourceIssueKey,
        reason: `compliance_failed: ${inv.result.reasonCode}`
      })),
      routeResolutions,
      generationDiagnostics
    };
  }

  // AI generation (default path)
  console.log(`[scenarios:ai] calling AI for scenario generation mode=${generationMode}`);
  generationDiagnostics.aiCalled = true;

  // Create AI provider for scenario generation
  const provider = _testProvider ?? await createScenarioAiProvider();

  console.log(`[scenarios:ai] purpose=scenario_generation provider=${provider.providerType} model=${provider.model}`);

  // Build messages with route resolution context and deterministic seeds
  const messages = await buildMcpScenarioMessages(
    routeBackedIssues,
    appSlug,
    testrailMeta,
    targetAppSlug,
    targetAppName,
    routeProfile,
    entrySteps,
    loginMode,
    routeResolutions, // Pass route resolutions to prompt builder
    deterministicSeeds || undefined // Pass deterministic seeds if available
  );

  console.log(`[scenarios:prompt] messages built system=${messages[0]?.content.length ?? 0} user=${messages[1]?.content.length ?? 0} issues=${routeBackedIssues.length}`);

  try {
    const response = await provider.completeJson({
      messages,
      requireJson: true,
      requireJsonSchema: false,
      purpose: "scenario_generation",
    });

    console.log(`[scenarios:ai] completed durationMs=${response.durationMs} model=${response.model} provider=${response.providerName}`);

    if (!response.parsedJson) {
      throw new Error(`AI_GENERATION_INVALID_JSON|AI provider returned invalid JSON. Raw output: ${response.rawText.slice(0, 200)}`);
    }

    const parsed = parseAiResponse(response.rawText);

    if (!parsed) {
      throw new Error(`AI_GENERATION_INVALID_RESPONSE|AI provider returned JSON but could not parse as McpGenerationResponse. Raw output: ${response.rawText.slice(0, 200)}`);
    }

    console.log(`[scenarios:parser] parsed scenarios=${parsed.scenarios?.length ?? 0} rejected=${parsed.rejected?.length ?? 0}`);

    // Defensive normalization: ensure all steps are strings
    const normalizedScenarios = parsed.scenarios.map((scenario) =>
      normalizeScenarioSteps(scenario)
    );

    console.log(`[scenarios:normalize] afterStepNormalize=${normalizedScenarios.length}`);

    // Normalize AI scenarios to ensure valid field values
    const fullyNormalizedScenarios = normalizedScenarios.map((scenario) =>
      normalizeAiScenario(scenario, appSlug)
    );

    console.log(`[scenarios:normalize] afterFieldNormalize=${fullyNormalizedScenarios.length}`);

    // Apply deduplication to AI-generated scenarios
    const dedupedScenarios = fullyNormalizedScenarios.map((scenario) => {
      const originalStepCount = scenario.steps?.length ?? 0;
      const dedupedSteps = dedupeConsecutiveSteps(scenario.steps ?? []);
      const removedCount = originalStepCount - dedupedSteps.length;

      if (removedCount > 0) {
        console.log(`[scenarios:dedupe] source=ai scenarioTitle="${scenario.title}" removed=${removedCount}`);
      }

      return {
        ...scenario,
        steps: dedupedSteps
      };
    });

    console.log(`[scenarios:dedupe] afterDedupe=${dedupedScenarios.length}`);

    // Enrich generated scenarios with route-first metadata
    const enrichedScenarios = dedupedScenarios.map(scenario => {
      const resolution = routeResolutions.get(scenario.sourceIssueKey);
      if (resolution) {
        return {
          ...scenario,
          scenarioMode: resolution.scenarioMode,
          routeConfidence: resolution.routeConfidence,
          diagnostics: resolution.diagnostics
        };
      }
      return scenario;
    });

    // Repair unbacked clicks before validation
    const repairedScenarios = enrichedScenarios.map(scenario => {
      const originalStepCount = scenario.steps?.length ?? 0;
      const repairedSteps = repairUnbackedClicks(scenario.steps ?? [], derivedContext.allowedExecutableClicks);
      const removedCount = originalStepCount - repairedSteps.length;

      if (removedCount > 0) {
        console.log(`[scenarios:repair] source=ai scenarioTitle="${scenario.title}" removed=${removedCount}`);
      }

      return {
        ...scenario,
        steps: repairedSteps
      };
    });

    console.log(`[scenarios:repair] afterUnbackedClickRepair=${repairedScenarios.length}`);

    // Validate compliance: ensure generated scenarios respect route profile
    const complianceValidation = validateScenariosCompliance(
      repairedScenarios,
      derivedContext,
      routeResolutions
    );

    // Log compliance results
    for (const invalidEntry of complianceValidation.invalidScenarios) {
      logComplianceResult(
        appSlug,
        invalidEntry.scenario.sourceIssueKey,
        invalidEntry.scenario.title,
        invalidEntry.result
      );
    }

    logComplianceSummary(
      appSlug,
      complianceValidation.validScenarios.length,
      complianceValidation.invalidScenarios.length
    );

    // Build rejected array including invalid scenarios
    const invalidRejected = complianceValidation.invalidScenarios.map(entry => ({
      sourceIssueKey: entry.scenario.sourceIssueKey,
      reason: `compliance_validation_failed: ${entry.result.reasonCode}. ${entry.result.diagnostics.filter(d => d.level === "error").map(d => d.message).join("; ")}`
    }));

    // Merge blocked issues into rejected array
    const allRejected = [
      ...(parsed.rejected || []),
      ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
      ...invalidRejected
    ];

    // Update generation diagnostics
    generationDiagnostics.aiGenerated = repairedScenarios.length;
    generationDiagnostics.finalValid = complianceValidation.validScenarios.length;
    generationDiagnostics.finalRejected = allRejected.length;

    console.log(
      `[scenarios:ai] success ` +
      `aiGenerated=${generationDiagnostics.aiGenerated} ` +
      `finalValid=${generationDiagnostics.finalValid} ` +
      `finalRejected=${generationDiagnostics.finalRejected}`
    );

    return {
      ...parsed,
      scenarios: complianceValidation.validScenarios,
      rejected: allRejected,
      routeResolutions,
      generationDiagnostics
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      if (error.code === "ai_provider_timeout") {
        // Enhanced timeout diagnostics
        const systemChars = messages[0]?.content.length ?? 0;
        const userChars = messages[1]?.content.length ?? 0;
        const totalChars = systemChars + userChars;
        const estimatedTokens = Math.ceil(totalChars / 4);

        const suggestions: string[] = [];

        if (!derivedContext || derivedContext.allowedExecutableClicks.length === 0) {
          suggestions.push("ensure route profile is loaded to enable compact prompt mode");
        }

        if (routeBackedIssues.length > 1) {
          suggestions.push(`reduce issue count (current: ${routeBackedIssues.length})`);
        }

        if (totalChars > 20000) {
          suggestions.push("prompt size is large (>20k chars) - consider splitting issues or simplifying descriptions");
        }

        const deterministicPossible = routeBackedIssues.some(issue =>
          routeResolutions.get(issue.key)?.scenarioMode === "action_button_validation"
        );
        if (deterministicPossible) {
          suggestions.push("some issues support deterministic generation (action_button_validation mode)");
        }

        console.log(
          `[scenarios:timeout] provider=${provider.providerType} ` +
          `totalChars=${totalChars} ` +
          `estimatedTokens=${estimatedTokens} ` +
          `issues=${routeBackedIssues.length} ` +
          `allowedClicks=${derivedContext?.allowedExecutableClicks.length ?? 0} ` +
          `suggestions: ${suggestions.join("; ")}`
        );

        // Fallback to deterministic seeds if available
        // Applies to: fallback_deterministic_on_ai_failure AND ai_supported_by_deterministic
        if (
          (generationMode === "fallback_deterministic_on_ai_failure" || generationMode === "ai_supported_by_deterministic") &&
          deterministicSeeds &&
          deterministicSeeds.length > 0
        ) {
          console.log(`[scenarios:fallback] AI timeout, using ${deterministicSeeds.length} deterministic seeds as fallback`);
          generationDiagnostics.aiFailed = true;
          generationDiagnostics.fallbackUsed = true;
          generationDiagnostics.fallbackReason = "ai_timeout";
          generationDiagnostics.fallbackScenarioCount = deterministicSeeds.length;

          // Convert seeds to full scenarios and validate
          const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
            deterministicSeeds,
            appSlug,
            routeProfile || null,
            derivedContext,
            routeResolutions
          );

          console.log(`[scenarios:fallback] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

          generationDiagnostics.finalValid = validScenarios.length;
          generationDiagnostics.finalRejected = invalidScenarios.length;

          return {
            appSlug,
            targetAppSlug,
            targetAppName,
            confidence: "medium",
            reason: "AI timeout, used deterministic fallback",
            functionalRoute: "",
            routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
            scenarios: validScenarios,
            warnings: [
              "AI generation timed out, using deterministic fallback",
              ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
              ...invalidScenarios.map((inv: any) =>
                `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
              )
            ],
            rejected: [
              ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
              ...invalidScenarios.map((inv: any) => ({
                sourceIssueKey: inv.scenario.sourceIssueKey,
                reason: `compliance_failed: ${inv.result.reasonCode}`
              }))
            ],
            routeResolutions,
            generationDiagnostics
          };
        }

        throw new Error(
          `AI_GENERATION_TIMEOUT|AI provider (${provider.providerType}) timed out after ${error.diagnostics?.timeoutMs || "unknown"}ms. ` +
          `Prompt size: ${totalChars} chars (~${estimatedTokens} tokens). Issues: ${routeBackedIssues.length}. ` +
          `Suggestions: ${suggestions.join("; ")}. ` +
          `Check AI_SCENARIO_TIMEOUT_MS env var.`
        );
      }

      // Handle other AI generation errors (parse failures, missing files, etc.)
      console.log(`[scenarios:ai] generation error: ${error.message}`);

      // Fallback to deterministic seeds if available
      // Applies to: fallback_deterministic_on_ai_failure AND ai_supported_by_deterministic
      if (
        (generationMode === "fallback_deterministic_on_ai_failure" || generationMode === "ai_supported_by_deterministic") &&
        deterministicSeeds &&
        deterministicSeeds.length > 0
      ) {
        // Detect error type
        const errorMessage = error.message || "";
        let fallbackReason: "ai_generation_error" | "ai_parse_failed" = "ai_generation_error";

        if (errorMessage.includes("AI_GENERATION_ERROR") || errorMessage.includes("scenario-generation-result.json")) {
          fallbackReason = "ai_parse_failed";
        }

        console.log(`[scenarios:fallback] AI failed (${fallbackReason}), using ${deterministicSeeds.length} deterministic seeds as fallback`);
        generationDiagnostics.aiFailed = true;
        generationDiagnostics.fallbackUsed = true;
        generationDiagnostics.fallbackReason = fallbackReason;
        generationDiagnostics.fallbackScenarioCount = deterministicSeeds.length;

        // Convert seeds to full scenarios and validate
        const { validScenarios, invalidScenarios } = convertSeedsToValidatedScenarios(
          deterministicSeeds,
          appSlug,
          routeProfile || null,
          derivedContext,
          routeResolutions
        );

        console.log(`[scenarios:fallback] validated=${validScenarios.length} invalid=${invalidScenarios.length}`);

        generationDiagnostics.finalValid = validScenarios.length;
        generationDiagnostics.finalRejected = invalidScenarios.length;

        return {
          appSlug,
          targetAppSlug,
          targetAppName,
          confidence: "medium",
          reason: `AI generation failed (${fallbackReason}), used deterministic fallback`,
          functionalRoute: "",
          routeProfile: routeProfile || { name: "", entry: [], aliases: {}, intermediates: {}, domainTerms: {}, visibleControls: [], representativeFixture: {}, notes: [] },
          scenarios: validScenarios,
          warnings: [
            `AI generation failed: ${fallbackReason}, using deterministic fallback`,
            ...blockedIssues.map(b => `Blocked ${b.key}: ${b.reason}`),
            ...invalidScenarios.map((inv: any) =>
              `Scenario ${inv.scenario.sourceIssueKey} failed compliance: ${inv.result.reasonCode}`
            )
          ],
          rejected: [
            ...blockedIssues.map(b => ({ sourceIssueKey: b.key, reason: b.reason })),
            ...invalidScenarios.map((inv: any) => ({
              sourceIssueKey: inv.scenario.sourceIssueKey,
              reason: `compliance_failed: ${inv.result.reasonCode}`
            }))
          ],
          routeResolutions,
          generationDiagnostics
        };
      }

      throw new Error(`AI_GENERATION_ERROR|${error.message}`);
    }
    throw error;
  }
}
