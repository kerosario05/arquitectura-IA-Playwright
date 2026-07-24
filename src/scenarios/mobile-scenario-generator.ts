import { loadJiraIssues } from "./jira-scenario-source";
import { createScenarioAiProvider } from "../ai/ai-provider-factory";
import { buildMobileScenarioMessages } from "./mobile-scenario-prompt-builder";
import { loadMobileRouteProfile } from "../mobile/mobile-route-profile";
import { loadMobileKnowledge, selectRelevantMobileKnowledge } from "../mobile/mobile-knowledge-resolver";
import type { RequiredJiraRuntimeConfig } from "../types/jira.types";
import { isSensitiveDataLabel, slugifyDataKey, type MobileStep, type MobileDataField } from "../mobile/mobile-step-types";
import type { MobileRouteProfile, MobileScreenDataField } from "../mobile/mobile-route-profile.types";
import type { LaunchScenario } from "../server/jobs/launch-orchestrator";

export type MobileGeneratedScenario = {
  scenarioId: string;
  sourceIssueKey: string;
  title: string;
  steps: MobileStep[];
  expectedResult: string;
  preconditions: string[];
  /** Editable data fields the scenario needs (text inputs + dropdown selects), surfaced to the UI. */
  requiredData: MobileDataField[];
};

/** Flattens all declared dataFields across every screen of the route profile. */
function collectDeclaredDataFields(routeProfile?: MobileRouteProfile | null): MobileScreenDataField[] {
  if (!routeProfile) return [];
  return Object.values(routeProfile.screens).flatMap((s) => s.dataFields ?? []);
}

/**
 * Builds the editable data-field list from a scenario's steps, classifying each as
 * text (fill) or select (a click that picks a declared dropdown option). Declared
 * dataFields in the route profile drive select detection and enrich text labels.
 */
function deriveRequiredData(steps: MobileStep[], routeProfile?: MobileRouteProfile | null): MobileDataField[] {
  const declared = collectDeclaredDataFields(routeProfile);
  const declaredSelects = declared.filter((d) => d.kind === "select");
  const declaredTexts = declared.filter((d) => d.kind === "text");
  const fields: MobileDataField[] = [];

  steps.forEach((step, idx) => {
    const targetValue = step.target?.value ?? "";

    if (step.action === "fill") {
      // Match a declared text field by its locator to inherit its label/sensitivity.
      const match = declaredTexts.find((d) => d.matchLocator.value === targetValue);
      const label = match?.label || step.description?.trim() || targetValue || `Campo ${idx + 1}`;
      fields.push({
        key: match?.key || slugifyDataKey(label),
        label,
        kind: "text",
        stepIndex: idx,
        exampleValue: step.value ?? match?.exampleValue ?? "",
        sensitive: match ? match.sensitive : isSensitiveDataLabel(label)
      });
      return;
    }

    if (step.action === "click" && targetValue) {
      // A click that selects a declared dropdown option (target mentions one of the options).
      for (const sel of declaredSelects) {
        const matchedOption = (sel.options ?? []).find((opt) => targetValue.includes(opt));
        if (matchedOption) {
          fields.push({
            key: sel.key,
            label: sel.label,
            kind: "select",
            stepIndex: idx,
            exampleValue: matchedOption,
            sensitive: sel.sensitive,
            options: sel.options,
            defaultValue: sel.defaultValue,
            applyTargetTemplate: sel.applyTargetTemplate
          });
          break;
        }
      }
    }
  });

  return fields;
}

export type MobileRejectedIssue = {
  sourceIssueKey: string;
  reason: string;
};

export type MobileScenarioGenerationResult = {
  scenarios: MobileGeneratedScenario[];
  rejected: MobileRejectedIssue[];
  issuesFound: number;
};

function parseAiScenarios(
  parsed: Record<string, unknown> | undefined,
  fallbackIssueKey: string,
  routeProfile?: MobileRouteProfile | null
): {
  scenarios: MobileGeneratedScenario[];
  rejected: MobileRejectedIssue[];
} {
  const scenarios: MobileGeneratedScenario[] = [];
  const rejected: MobileRejectedIssue[] = [];

  const rawScenarios = Array.isArray(parsed?.scenarios) ? (parsed!.scenarios as any[]) : [];
  let localIndex = 0;
  for (const s of rawScenarios) {
    if (!s || !Array.isArray(s.steps) || s.steps.length === 0) continue;
    const sourceIssueKey = typeof s.sourceIssueKey === "string" ? s.sourceIssueKey : fallbackIssueKey;
    localIndex++;
    const steps = s.steps as MobileStep[];
    scenarios.push({
      // Assigned server-side (not by the AI) so it's stable across re-runs and
      // guaranteed unique — launchExecution() rejects duplicate scenarioIds.
      scenarioId: `MOBILE-${sourceIssueKey}-${String(localIndex).padStart(3, "0")}`,
      sourceIssueKey,
      title: typeof s.title === "string" ? s.title : fallbackIssueKey,
      steps,
      expectedResult: typeof s.expectedResult === "string" && s.expectedResult.trim()
        ? s.expectedResult.trim()
        : "El escenario se ejecuta sin errores.",
      preconditions: Array.isArray(s.preconditions)
        ? s.preconditions.filter((p: unknown): p is string => typeof p === "string")
        : [],
      requiredData: deriveRequiredData(steps, routeProfile)
    });
  }

  const rawRejected = Array.isArray(parsed?.rejected) ? (parsed!.rejected as any[]) : [];
  for (const r of rawRejected) {
    rejected.push({
      sourceIssueKey: typeof r?.sourceIssueKey === "string" ? r.sourceIssueKey : fallbackIssueKey,
      reason: typeof r?.reason === "string" ? r.reason : "unknown"
    });
  }

  return { scenarios, rejected };
}

/**
 * Generates mobile (Appium) test steps from Jira issues via AI. Each issue gets its
 * own independent AI call — batching multiple issues into one prompt is what caused
 * the equivalent web pipeline to silently drop all but the first issue (see the
 * scenario-preview.service.ts fix earlier this session); this generator is built to
 * not repeat that mistake.
 *
 * There is no mobile equivalent of the web route-profile/app.knowledge grounding yet,
 * so steps are generated from the HU text alone and will often need manual correction
 * before they reliably drive a real app — same quality ceiling the web pipeline hits
 * for issues without a matching routeProfile.
 */
export async function generateMobileScenarios(
  jiraConfig: RequiredJiraRuntimeConfig,
  projectKey: string,
  sprintId: number,
  status?: string,
  maxResults = 50,
  appSlug?: string
): Promise<MobileScenarioGenerationResult> {
  const issues = await loadJiraIssues(jiraConfig, projectKey, sprintId, status, maxResults);

  if (issues.length === 0) {
    return { scenarios: [], rejected: [], issuesFound: 0 };
  }

  const routeProfile = appSlug ? loadMobileRouteProfile(appSlug) : null;
  const knowledge = appSlug ? loadMobileKnowledge(appSlug) : { items: [] };
  if (appSlug) {
    console.log(`[mobile:scenarios] routeProfile appSlug=${appSlug} found=${routeProfile !== null} screens=${routeProfile ? Object.keys(routeProfile.screens).length : 0} knowledgeItems=${knowledge.items.length}`);
  }

  const scenarios: MobileGeneratedScenario[] = [];
  const rejected: MobileRejectedIssue[] = [];

  for (const issue of issues) {
    console.log(`[mobile:scenarios] generating steps for issue=${issue.key}`);
    try {
      const provider = await createScenarioAiProvider();
      const huText = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
      const learnedScreens = selectRelevantMobileKnowledge(knowledge, huText);
      if (learnedScreens.length > 0) {
        console.log(`[mobile:scenarios] issue=${issue.key} injecting ${learnedScreens.length} learned screen(s) from previous runs`);
      }
      const messages = buildMobileScenarioMessages(issue, routeProfile, learnedScreens);
      const response = await provider.completeJson({
        messages,
        purpose: "mobile_scenario_generation",
        requireJson: true
      });

      const { scenarios: issueScenarios, rejected: issueRejected } = parseAiScenarios(
        response.parsedJson,
        issue.key,
        routeProfile
      );

      if (issueScenarios.length === 0 && issueRejected.length === 0) {
        rejected.push({ sourceIssueKey: issue.key, reason: "ai_returned_no_scenarios" });
      } else {
        scenarios.push(...issueScenarios);
        rejected.push(...issueRejected);
      }

      console.log(`[mobile:scenarios] issue=${issue.key} scenarios=${issueScenarios.length} rejected=${issueRejected.length}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[mobile:scenarios] issue=${issue.key} generation failed: ${message}`);
      rejected.push({ sourceIssueKey: issue.key, reason: `generation_failed: ${message}` });
    }
  }

  return { scenarios, rejected, issuesFound: issues.length };
}

/**
 * Converts an AI-generated mobile scenario into the shape the (unmodified, reused)
 * web TestRail publish pipeline expects. `steps` becomes one human-readable row per
 * MobileStep (its `description`), matching how web scenario steps are already plain
 * strings — the structured MobileStep[] (locators/values) stays with the caller for
 * execution, it is not needed by TestRail.
 */
export function mobileScenarioToLaunchScenario(s: MobileGeneratedScenario): LaunchScenario {
  return {
    scenarioId: s.scenarioId,
    title: s.title,
    steps: s.steps.map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim()),
    expectedResult: s.expectedResult,
    preconditions: s.preconditions,
    sourceIssueKey: s.sourceIssueKey
  };
}
