import { loadJiraIssues } from "./jira-scenario-source";
import { createScenarioAiProvider } from "../ai/ai-provider-factory";
import { AiProviderError } from "../ai/ai-provider.types";
import { buildMobileScenarioMessages } from "./mobile-scenario-prompt-builder";
import { loadMobileRouteProfile } from "../mobile/mobile-route-profile";
import { evaluateScenarioPrecheck } from "../mobile/mobile-execution-precheck";
import { loadMobileKnowledge, selectRelevantMobileKnowledge } from "../mobile/mobile-knowledge-resolver";
import type { MobileKnowledgeItem } from "../mobile/mobile-knowledge-persister";
import { repairUtf8Mojibake } from "../mobile/mobile-text-normalization";
import { buildRequirementAccounting } from "./scenario-functional-quality";
import { persistHuDeclaredKnowledge } from "../knowledge/hu-declared-persister";
import type { RequiredJiraRuntimeConfig } from "../types/jira.types";
import { isSensitiveDataLabel, slugifyDataKey, type MobileStep, type MobileDataField, type MobileStepTarget } from "../mobile/mobile-step-types";
import type { MobileRouteProfile, MobileScreenDataField, MobileFlow, MobileStepHint } from "../mobile/mobile-route-profile.types";
import type { LaunchScenario } from "../server/jobs/launch-orchestrator";
import { parseStepDestinationExpectations, validateStepDestinationExpectations, buildMobileDestinationClaimManifest, type StepDestinationExpectation, type DestinationClaimDefinition } from "../mobile/mobile-destination-claim";

export type MobileGeneratedScenario = {
  scenarioId: string;
  sourceIssueKey: string;
  title: string;
  steps: MobileStep[];
  expectedResult: string;
  preconditions: string[];
  /** Editable data fields the scenario needs (text inputs + dropdown selects), surfaced to the UI. */
  requiredData: MobileDataField[];
  /** Name of a functional data profile this scenario depends on (business/backend state). */
  requiredDataProfile?: string;
  /** True when the scenario declared a profile that is missing/unresolved — it still runs,
   *  but the user must supply the data manually (dataOverrides) before execution. */
  requiresManualData?: boolean;
  /** Acceptance-criterion identifiers from the HU that this scenario covers (e.g. ["CA01"]). */
  coveredCriteria?: string[];
  /** Step-level requirement references: which canonical criterion IDs does each step materialize.
   *  stepIndex is 0-based (0 = launchApp). Only steps that inequivocally execute a criterion. */
  stepRequirementRefs?: Array<{ stepIndex: number; requirementIds: string[] }>;
  /** Step-level destination expectations: structured declarations of where each step is expected to land.
   *  Each expectation maps a step to a semantic destination claim derived from canonical requirements.
   *  This is a DECLARATION, not runtime validation — destinationSemanticAuthority remains pending until
   *  runtime evidence confirms the destination. */
  stepDestinationExpectations?: StepDestinationExpectation[];
  /** Materialized navigation steps that reach the required initial state, derived from a
   *  known flow/route when a functional precondition implies a later app screen. */
  prerequisiteSteps?: MobileStep[];
  /** True when a functional precondition needs a route that Knowledge cannot resolve yet —
   *  the scenario must NOT pretend to start at a later screen without a real path. */
  requiresRouteLearning?: boolean;
  /** True only when every AI-generated locator is backed by validated runtime evidence
   *  (source=mcp_runtime_observation, validationStatus=validated, trustedForReuse=true).
   *  False means at least one target is an unverified AI guess and must not be treated as
   *  execution authority on its own. */
  locatorExecutionBacked?: boolean;
};

/** Flattens all declared dataFields across every screen of the route profile. */
function collectDeclaredDataFields(routeProfile?: MobileRouteProfile | null): MobileScreenDataField[] {
  if (!routeProfile?.screens) return [];
  return Object.values(routeProfile.screens).flatMap((s) => s.dataFields ?? []);
}

/**
 * Builds the editable data-field list from a scenario's steps, classifying each as
 * text (fill) or select (a click that picks a declared dropdown option). Declared
 * dataFields in the route profile drive select detection and enrich text labels.
 */
function deriveRequiredData(
  steps: MobileStep[],
  routeProfile?: MobileRouteProfile | null
): { steps: MobileStep[]; fields: MobileDataField[] } {
  const normalizeToken = (value: string): string =>
    repairUtf8Mojibake(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const declared = collectDeclaredDataFields(routeProfile);
  const declaredSelects = declared.filter((d) => d.kind === "select");
  const declaredTexts = declared.filter((d) => d.kind === "text");
  const workingSteps = [...steps];
  const fields: MobileDataField[] = [];
  // (depKey, insertion index) for text fields that declare a dependency, used to
  // materialize the dependent select when it is missing from the scenario steps.
  const pendingDeps: Array<{ depKey: string; beforeStepIndex: number }> = [];

  steps.forEach((step, idx) => {
    const targetValue = repairUtf8Mojibake(step.target?.value ?? "");
    const normalizedTargetValue = normalizeToken(targetValue);

    if (step.action === "fill") {
      // A value resolved at runtime via structured step metadata (e.g. an OTP declared with
      // step.otp.required === true) must NOT be surfaced as a manual input. The step remains
      // visible in PASOS; only the manual data request is dropped. This is metadata-driven, never
      // text-driven, so it applies to any future runtime-resolved datum with the same pattern.
      if (step.otp?.required === true) {
        return;
      }
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
      if (match?.dependsOn) {
        pendingDeps.push({ depKey: match.dependsOn, beforeStepIndex: idx });
      }
      return;
    }

    if (step.action === "click" && targetValue) {
      // A click that selects a declared dropdown option (target mentions one of the options).
      for (const sel of declaredSelects) {
        const template = sel.applyTargetTemplate;
        let matchedOption: string | undefined;
        if (template?.value) {
          // When applyTargetTemplate is declared, prefer matching by strategy: the rendered target
          // ({{value}} substituted by an option) must match the step target value. When the AI
          // generates a different strategy (e.g. accessibilityId instead of androidUiAutomator),
          // fall back to direct text matching so the select field is still detected.
          const sameStrategy = template.strategy === step.target?.strategy;
          if (sameStrategy) {
            matchedOption = (sel.options ?? []).find((opt) => {
              const rendered = template.value!.replace(/{{value}}/g, opt);
              return normalizeToken(rendered) === normalizeToken(targetValue);
            });
          }
          if (!matchedOption) {
            // Fallback: match the raw target value against option text by exact (normalized)
            // equality. This detects the selection when the AI uses a different locator strategy
            // (e.g. accessibilityId "Cédula de identidad") while NOT counting the selector-opener
            // click (whose value is a full UiSelector like descriptionContains("Cédula de
            // identidad") that only contains the option text as a substring).
            matchedOption = (sel.options ?? []).find((opt) => normalizedTargetValue === normalizeToken(opt));
          }
        } else {
          // Backward-compatible fallback for selects without an applyTargetTemplate.
          matchedOption = (sel.options ?? []).find((opt) => normalizedTargetValue.includes(normalizeToken(opt)));
        }
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
            applyTargetTemplate: sel.applyTargetTemplate,
            openerLocator: sel.matchLocator
          });
          break;
        }
      }
    }
  });

  // Resolve declared dependencies for fields the scenario actually uses. Only when the
  // dependent select is NOT already present do we materialize an open-selector click before
  // the dependent step (the option click itself is appended at runtime by applyDataOverrides
  // from the user's dataOverride value via applyTargetTemplate). Process in descending index
  // so earlier insertions don't disturb the positions of later ones.
  const usedKeys = new Set(fields.map((f) => normalizeToken(f.key)));
  const resolveDependency = (depKey: string, beforeStepIndex: number): void => {
    const depSelect = declaredSelects.find((d) => d.key === depKey);
    if (!depSelect) return;
    if (usedKeys.has(normalizeToken(depSelect.key))) return; // already detected from a real step
    if (depSelect.kind !== "select" || !depSelect.applyTargetTemplate) return; // only materializable selects
    // If an open-selector click for this select already exists in the steps (e.g. from a prior
    // generation/re-run), reuse it instead of injecting a duplicate.
    const existingOpenerIndex = workingSteps.findIndex(
      (s) => s.action === "click" && s.target?.value === depSelect.matchLocator.value
    );
    let openerStepIndex = existingOpenerIndex;
    if (existingOpenerIndex === -1) {
      workingSteps.splice(beforeStepIndex, 0, {
        action: "click",
        description: `Abrir selector de ${depSelect.label}`,
        target: depSelect.matchLocator,
      });
      openerStepIndex = beforeStepIndex;
      // Shift existing fields at/after the insertion point by one step.
      for (const f of fields) {
        if (f.stepIndex >= beforeStepIndex) f.stepIndex += 1;
      }
    }
    fields.push({
      key: depSelect.key,
      label: depSelect.label,
      kind: "select",
      stepIndex: openerStepIndex,
      exampleValue: depSelect.defaultValue ?? depSelect.options?.[0] ?? "",
      sensitive: depSelect.sensitive,
      options: depSelect.options,
      defaultValue: depSelect.defaultValue,
      applyTargetTemplate: depSelect.applyTargetTemplate,
      openerLocator: depSelect.matchLocator
    });
    usedKeys.add(normalizeToken(depSelect.key));
  };
  pendingDeps
    .slice()
    .sort((a, b) => b.beforeStepIndex - a.beforeStepIndex)
    .forEach((dep) => resolveDependency(dep.depKey, dep.beforeStepIndex));

  // Guarantee each logical datum appears exactly once, deduplicating by normalized key.
  // For select fields, equivalent detections contribute their unique options (union).
  const seenKeys = new Set<string>();
  const deduped: MobileDataField[] = [];
  for (const field of fields) {
    const normalizedKey = normalizeToken(field.key);
    if (seenKeys.has(normalizedKey)) {
      const existing = deduped.find((f) => normalizeToken(f.key) === normalizedKey);
      if (existing && existing.kind === "select" && field.kind === "select") {
        existing.options = Array.from(new Set([...(existing.options ?? []), ...(field.options ?? [])]));
        if (!existing.defaultValue && field.defaultValue) existing.defaultValue = field.defaultValue;
      }
      continue;
    }
    seenKeys.add(normalizedKey);
    deduped.push(field);
  }

  // Order fields by their effective stepIndex so requiredData reflects execution order.
  // Fields without a valid index sort last while keeping their relative (stable) order.
  deduped.sort((a, b) => (a.stepIndex ?? Infinity) - (b.stepIndex ?? Infinity));

  return { steps: workingSteps, fields: deduped };
}

export function deriveScenarioRequiredData(steps: MobileStep[], routeProfile?: MobileRouteProfile | null): MobileDataField[] {
  return deriveRequiredData(steps, routeProfile).fields;
}

/** Phrases that indicate a FUNCTIONAL prerequisite (the user must already be at / have passed
 *  a later app state) as opposed to a merely descriptive precondition. Neutral, app-agnostic —
 *  no hardcoded labels, document types or business values. */
const PREREQUISITE_STATE_RE = /\b(?:ya (?:supero|completo|completo|realizo|realizo|cargo|cargo|registro|registro|valido|valido|acepto|acepto)|previamente (?:supero|completo|valido|registro|realizo|cargo)|supero (?:las|la|el|los) (?:validaciones|verificaciones|identidad)|paso por|esta (?:pre)?(?:validado|verificado|autenticado|registrado)|cliente (?:ya )?(?:supero|completo|valido|registro|esta (?:pre)?validado|prevalidado)|usuario (?:ya )?(?:supero|completo|valido|registro|esta (?:pre)?validado|prevalidado)|ya se encuentra en|ya esta en|alcanzo el estado|se encuentra en la pantalla)\b/i;

/** Signals a scenario is pretending to start at a later screen: after launchApp the very next
 *  step is a pure assertion/check on a non-entry screen, with no navigation/fill to reach it. */
function startsAtLaterScreenWithoutPath(steps: MobileStep[]): boolean {
  if (steps.length < 2 || steps[0]?.action !== "launchApp") return false;
  const second = steps[1];
  if (!second) return false;
  const isAssert = second.action === "assertVisible" || second.action === "assertEnabled" || second.action === "assertDisabled";
  if (!isAssert) return false;
  // A fill/click path would begin the setup; a pure assert right after launch implies magic state.
  return !steps.slice(1).some((s) => s.action === "fill" || s.action === "click");
}

/** Finds a route profile flow whose trigger keywords match the functional precondition text
 *  (or the scenario title/step descriptions, which often restate the required state). Matching
 *  tolerates morphological variants (plural/gender) by checking keyword tokens as substrings. */
function matchFlowForPrerequisite(
  routeProfile: MobileRouteProfile | null | undefined,
  preconditionText: string,
  contextText = "",
): { flow: MobileFlow; flowId: string } | null {
  if (!routeProfile?.flows) return null;
  const corpus = repairUtf8Mojibake(`${preconditionText} ${contextText}`).toLowerCase();
  const tokens = corpus.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  for (const [flowId, flow] of Object.entries(routeProfile.flows)) {
    const keywords = (flow.triggerKeywords ?? []).map((kw) => repairUtf8Mojibake(kw).toLowerCase());
    for (const kw of keywords) {
      if (corpus.includes(kw)) return { flow, flowId };
      // Morphological tolerance: count how many significant keyword tokens appear inside the
      // corpus as substrings (covers plural/gender inflections like validacion(s), cliente(s)).
      const kwTokens = kw.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
      const hits = kwTokens.filter((tk) => tokens.some((c) => c.includes(tk))).length;
      if (kwTokens.length > 0 && hits >= Math.max(1, Math.ceil(kwTokens.length / 2))) return { flow, flowId };
    }
  }
  return null;
}

/**
 * Strict flow matching for intent-driven materialization.
 *
 * Unlike matchFlowForPrerequisite — whose morphological tolerance is deliberately loose
 * because it runs on an explicit precondition sentence — this runs on EVERY story's text,
 * so a loose match silently routes a login story down the registration flow. It therefore
 * requires the whole trigger keyword to appear as a word-bounded phrase, and when several
 * flows match it prefers the most specific (longest) keyword instead of declaration order.
 */
function matchFlowByIntent(
  routeProfile: MobileRouteProfile | null | undefined,
  text: string,
): { flow: MobileFlow; flowId: string; keyword: string } | null {
  if (!routeProfile?.flows) return null;
  const corpus = ` ${repairUtf8Mojibake(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;
  if (corpus.trim().length === 0) return null;

  let best: { flow: MobileFlow; flowId: string; keyword: string } | null = null;
  for (const [flowId, flow] of Object.entries(routeProfile.flows)) {
    for (const rawKw of flow.triggerKeywords ?? []) {
      const kw = repairUtf8Mojibake(rawKw).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
      if (!kw) continue;
      if (!corpus.includes(` ${kw} `)) continue;
      if (!best || kw.length > best.keyword.length) best = { flow, flowId, keyword: kw };
    }
  }
  return best;
}

/**
 * True when the scenario's own steps already walk every targeted step of the flow's entry
 * path. Prevents prepending a duplicate registration prologue to a scenario the AI already
 * wrote end-to-end from the app launch.
 */
function scenarioAlreadyCoversFlowEntry(scenario: MobileGeneratedScenario, flow: MobileFlow): boolean {
  const targeted = flow.entrySteps.filter((st) => Boolean(st.target?.value));
  if (targeted.length === 0) return true;
  const present = new Set(
    scenario.steps.map((s) => s.target?.value).filter((v): v is string => Boolean(v)),
  );
  return targeted.every((st) => present.has(st.target!.value));
}

/** Collects the data fields of every screen a flow touches (entry screen + screens referenced
 *  by its entry steps via description/screen mentions) so a prerequisite can surface them. */
function collectFlowDataFields(routeProfile: MobileRouteProfile | null | undefined, flow: MobileFlow): MobileScreenDataField[] {
  if (!routeProfile?.screens) return [];
  const ids = new Set<string>();
  if (flow.entryFromScreen) ids.add(flow.entryFromScreen);
  // Best-effort: any screen whose title/description text appears in an entry step description.
  for (const st of flow.entrySteps) {
    const desc = repairUtf8Mojibake(st.description ?? "").toLowerCase();
    for (const [id, screen] of Object.entries(routeProfile.screens)) {
      if (desc.includes(repairUtf8Mojibake(screen.title).toLowerCase())) ids.add(id);
    }
  }
  const fields: MobileScreenDataField[] = [];
  for (const id of ids) {
    const screen = routeProfile.screens[id];
    if (screen?.dataFields) fields.push(...screen.dataFields);
  }
  return fields;
}

/**
 * Materializes a functional prerequisite into real navigation steps + data requirements when
 * the route profile has a matching flow. If no route is known, marks requiresRouteLearning so
 * the scenario is NOT silently left as a launchApp → assert on a later screen (magic state).
 */
export function materializeFunctionalPrerequisite(
  scenario: MobileGeneratedScenario,
  routeProfile?: MobileRouteProfile | null,
): MobileGeneratedScenario {
  if (scenario.requiresRouteLearning) return scenario;
  const preconditions = scenario.preconditions ?? [];
  const functionalPrecondition = preconditions.find((p) => PREREQUISITE_STATE_RE.test(p));
  const scenarioText = `${scenario.title} ${preconditions.join(" ")} ${scenario.steps.map((s) => `${s.description ?? ""} ${s.target?.value ?? ""}`).join(" ")}`;

  let matched: { flow: MobileFlow; flowId: string } | null;

  if (functionalPrecondition) {
    // Scenario already contains an explicit setup path — nothing to materialize.
    if (scenario.steps.some((s) => s.action === "fill") || scenario.steps.some((s) => s.action === "click" && s.target?.value)) {
      return scenario;
    }

    matched = matchFlowForPrerequisite(routeProfile, functionalPrecondition, scenarioText);
    if (!matched) {
      console.log(
        `[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=requires_route_learning precondition="${functionalPrecondition.slice(0, 120)}" flow=none`,
      );
      return { ...scenario, requiresRouteLearning: true };
    }
  } else {
    // Intent-driven materialization: the story itself belongs to a flow (a registration HU
    // describes a step *inside* registration), so the scenario must start at the flow's
    // beginning instead of assuming the app is already on a mid-flow screen. Only the flow's
    // triggerKeywords decide this — no intent is hardcoded here.
    const byIntent = matchFlowByIntent(routeProfile, scenarioText);
    if (!byIntent) return scenario;
    if (scenarioAlreadyCoversFlowEntry(scenario, byIntent.flow)) return scenario;
    matched = { flow: byIntent.flow, flowId: byIntent.flowId };
    console.log(
      `[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=flow_intent_matched flow=${byIntent.flowId} keyword="${byIntent.keyword}" source=hu_text`,
    );
  }

  const { flow } = matched;
  const prerequisiteSteps: MobileStep[] = flow.entrySteps
    .filter((st) => st.action !== "launchApp" && st.action !== "screenshot")
    .map((st) => ({
      action: st.action,
      description: st.description ?? `${st.action} ${st.target?.value ?? ""}`.trim(),
      target: st.target,
      value: st.value,
    }));

  const flowFields = collectFlowDataFields(routeProfile, flow);
  const extraData: MobileDataField[] = flowFields.map((df) => {
    const stepIdx = prerequisiteSteps.findIndex((st) => st.target?.value === df.matchLocator.value);
    return {
      key: df.key,
      label: df.label,
      kind: df.kind,
      stepIndex: stepIdx >= 0 ? stepIdx : 0,
      exampleValue: df.exampleValue ?? df.defaultValue ?? "",
      sensitive: df.sensitive,
      options: df.kind === "select" ? df.options : undefined,
      defaultValue: df.kind === "select" ? df.defaultValue : undefined,
      applyTargetTemplate: df.kind === "select" ? df.applyTargetTemplate : undefined,
      openerLocator: df.kind === "select" ? df.matchLocator : undefined,
    };
  });

  // Merge with existing requiredData (dedupe by key), preserving explicit fields.
  const existingKeys = new Set((scenario.requiredData ?? []).map((f) => f.key));
  const mergedData = [...(scenario.requiredData ?? [])];
  for (const f of extraData) {
    if (!existingKeys.has(f.key)) {
      mergedData.push(f);
      existingKeys.add(f.key);
    }
  }

  console.log(
    `[mobile:prerequisite] appSlug=${routeProfile?.appSlug ?? "-"} scenario=${scenario.scenarioId} status=materialized flow=${matched.flowId} steps=${prerequisiteSteps.length} dataFields=${extraData.length}`,
  );
  return { ...scenario, prerequisiteSteps, requiredData: mergedData, requiresRouteLearning: false };
}

/** Normalizes a token for evidence matching: repairs mojibake, strips accents, lowercases. */
function normalizeLocatorToken(value: string): string {
  return repairUtf8Mojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

type LocatorStrategy = "accessibilityId" | "id" | "xpath" | "className" | "androidUiAutomator";

/** Field keys that carry TECHNICAL locator identity per strategy. Only these can back a
 *  generated technical locator. Semantic label/text fields NEVER appear here. */
const TECHNICAL_FIELD_KEYS: Record<LocatorStrategy, string[]> = {
  accessibilityId: ["accessibilityId", "contentDesc", "content-desc", "accessibility-id"],
  id: ["resourceId", "resource-id", "id"],
  xpath: ["xpath", "locatorIdentity"],
  className: ["className", "class", "locatorIdentity"],
  androidUiAutomator: ["androidUiAutomator", "locatorIdentity", "uiAutomator"],
};

function isLocatorStrategy(value: string | undefined): value is LocatorStrategy {
  return value === "accessibilityId" || value === "id" || value === "xpath" || value === "className" || value === "androidUiAutomator";
}

function collectStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string") return [value];
  return [];
}

function collectTechnicalFromControl(value: unknown, strategy: LocatorStrategy): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rec = value as Record<string, unknown>;
  const out: string[] = [];
  // Explicit strategy/value pair (e.g. { strategy: "accessibilityId", value: "x" }).
  if (typeof rec.strategy === "string" && isLocatorStrategy(rec.strategy) && rec.strategy === strategy && typeof rec.value === "string") {
    out.push(rec.value);
  }
  for (const key of TECHNICAL_FIELD_KEYS[strategy]) {
    out.push(...collectStringArray(rec[key]));
  }
  return out;
}

/**
 * Builds per-strategy sets of TECHNICAL locator identity observed at runtime, plus a set of
 * SEMANTIC control identities. Only the technical set can grant locatorExecutionBacked.
 */
function buildEvidenceSets(knowledge: { items: MobileKnowledgeItem[] }): {
  technicalByStrategy: Map<LocatorStrategy, Set<string>>;
  semantic: Set<string>;
} {
  const technicalByStrategy = new Map<LocatorStrategy, Set<string>>();
  const semantic = new Set<string>();
  for (const item of knowledge.items ?? []) {
    if (item.source !== "mcp_runtime_observation") continue;
    if (item.validationStatus !== "validated" || item.trustedForReuse !== true) continue;

    // SEMANTIC evidence: labels, visible text, business labels, click targets.
    for (const t of [
      ...((item.clickTargets as unknown[]) ?? []),
      ...((item.businessLabels as unknown[]) ?? []),
      ...((item.assertionTargets as unknown[]) ?? []),
    ]) {
      if (typeof t === "string" && t.trim()) semantic.add(normalizeLocatorToken(t));
    }

    // observedControls may be strings (semantic) or structured controls (may carry technical
    // attributes). Keep semantic labels always; collect technical per strategy when present.
    for (const c of (item.observedControls as unknown[]) ?? []) {
      if (typeof c === "string") {
        if (c.trim()) semantic.add(normalizeLocatorToken(c));
        continue;
      }
      if (c && typeof c === "object") {
        const rec = c as Record<string, unknown>;
        for (const t of collectStringArray(rec.label)) if (t.trim()) semantic.add(normalizeLocatorToken(t));
        for (const t of collectStringArray(rec.businessLabel)) if (t.trim()) semantic.add(normalizeLocatorToken(t));
        for (const strategy of Object.keys(TECHNICAL_FIELD_KEYS) as LocatorStrategy[]) {
          for (const t of collectTechnicalFromControl(c, strategy)) {
            if (t.trim()) {
              if (!technicalByStrategy.has(strategy)) technicalByStrategy.set(strategy, new Set());
              technicalByStrategy.get(strategy)!.add(normalizeLocatorToken(t));
            }
          }
        }
      }
    }

    // Item-level technical attributes (direct fields), per strategy.
    for (const strategy of Object.keys(TECHNICAL_FIELD_KEYS) as LocatorStrategy[]) {
      for (const key of TECHNICAL_FIELD_KEYS[strategy]) {
        for (const t of collectStringArray(item[key])) {
          if (t.trim()) {
            if (!technicalByStrategy.has(strategy)) technicalByStrategy.set(strategy, new Set());
            technicalByStrategy.get(strategy)!.add(normalizeLocatorToken(t));
          }
        }
      }
    }
  }
  return { technicalByStrategy, semantic };
}

/**
 * Classifies each AI-generated technical locator: it is execution-backed ONLY when runtime
 * evidence contains a matching TECHNICAL attribute for the same strategy (accessibilityId,
 * resource-id, xpath/locatorIdentity, className identity, androidUiAutomator identity).
 * Semantic matches (labels/text) never grant technical authority — if the required technical
 * attribute is absent, the locator stays unbacked (requiresRouteLearning).
 */
/**
 * Backs an `androidUiAutomator` locator by the TECHNICAL attribute it actually anchors on.
 *
 * A UiSelector is an expression, not an identity, so comparing the whole string against
 * observed evidence can never match — which left every `descriptionContains("Continuar")`
 * unbacked even when a control with exactly that content-desc had just been walked. Worse,
 * the route learner itself emits this form, so its own recorded steps failed the gate.
 *
 * The anchor literal is what decides whether the selector resolves at runtime, so that is what
 * gets checked, against the same evidence the equivalent direct strategy would use:
 * `description*` → observed content-desc, `resourceId` → observed resource-id. `text(...)` is
 * deliberately NOT accepted: visible text is semantic evidence, and semantic evidence never
 * grants technical authority. `className(...)` alone identifies nothing.
 */
function isUiSelectorBacked(
  strategy: LocatorStrategy,
  raw: string,
  contentDescEvidence: Set<string>,
  resourceIdEvidence: Set<string>,
): boolean {
  if (strategy !== "androidUiAutomator") return false;

  const anchors = (method: string): string[] => {
    const re = new RegExp(`\\.${method}\\(\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*\\)`, "g");
    const out: string[] = [];
    for (const m of raw.matchAll(re)) out.push(m[1].replace(/\\"/g, '"'));
    return out;
  };

  // Exact-identity forms: the observed attribute must equal the anchor.
  for (const value of [...anchors("description"), ...anchors("descriptionMatches")]) {
    if (contentDescEvidence.has(normalizeLocatorToken(value))) return true;
  }
  for (const value of anchors("resourceId")) {
    if (resourceIdEvidence.has(normalizeLocatorToken(value))) return true;
  }
  // Containment form: the selector resolves when SOME observed content-desc contains it,
  // which is exactly the runtime semantics of descriptionContains.
  for (const value of anchors("descriptionContains")) {
    const needle = normalizeLocatorToken(value);
    if (!needle) continue;
    for (const observed of contentDescEvidence) {
      if (observed.includes(needle)) return true;
    }
  }
  return false;
}

/**
 * Accepts the positional locator a text field is addressed by.
 *
 * Text fields in these apps expose no content-desc and no resource-id, and their visible text
 * is the placeholder — which typing replaces, so anchoring on it breaks the moment the value
 * is entered. `inputControlToTarget` therefore locates an input by class plus position on
 * purpose. Demanding a technical attribute for a `fill` contradicts the engine's own strategy
 * for inputs and makes every form-filling scenario permanently unexecutable.
 *
 * The tie to reality is kept: the class must have been observed at runtime. Only the identity
 * requirement is relaxed, and only for `fill` — clicks and assertions stay strict, since those
 * do have a stable technical identity to demand.
 */
function isObservedInputLocator(
  strategy: LocatorStrategy,
  raw: string,
  classEvidence: Set<string>,
): boolean {
  if (strategy !== "androidUiAutomator") return false;
  const match = raw.trim().match(/^new UiSelector\(\)\.className\("((?:[^"\\]|\\.)*)"\)(?:\.instance\(\d+\))?$/);
  if (!match) return false;
  return classEvidence.has(normalizeLocatorToken(match[1].replace(/\\"/g, '"')));
}

export function classifyLocatorExecutionBacking(
  scenario: MobileGeneratedScenario,
  knowledge: { items: MobileKnowledgeItem[] },
): MobileGeneratedScenario {
  const { technicalByStrategy, semantic } = buildEvidenceSets(knowledge);
  const contentDescEvidence = technicalByStrategy.get("accessibilityId") ?? new Set<string>();
  const resourceIdEvidence = technicalByStrategy.get("id") ?? new Set<string>();
  const classEvidence = technicalByStrategy.get("className") ?? new Set<string>();
  let anyTargetStep = false;
  let allBacked = true;
  let anySemanticOnly = false;
  const unbacked: string[] = [];
  for (const step of scenario.steps ?? []) {
    const raw = step.target?.value ?? "";
    if (!raw.trim()) continue;
    const strategy = step.target?.strategy;
    if (!isLocatorStrategy(strategy)) continue;
    anyTargetStep = true;
    const normalized = normalizeLocatorToken(raw);
    const technicalBacked = (technicalByStrategy.get(strategy)?.has(normalized) ?? false)
      || isUiSelectorBacked(strategy, raw, contentDescEvidence, resourceIdEvidence)
      || (step.action === "fill" && isObservedInputLocator(strategy, raw, classEvidence));
    const semanticMatch = semantic.has(normalized);
    if (!technicalBacked) {
      allBacked = false;
      if (semanticMatch) anySemanticOnly = true;
      unbacked.push(`${strategy}:${raw.slice(0, 60)}`);
    }
  }
  const requiresRouteLearning = anyTargetStep ? !allBacked : (scenario.requiresRouteLearning ?? false);
  const locatorExecutionBacked = anyTargetStep ? allBacked : (scenario.locatorExecutionBacked ?? false);
  if (unbacked.length > 0) {
    console.log(
      `[mobile:locator-authority] appSlug=${scenario.sourceIssueKey ? "-" : "-"} scenario=${scenario.scenarioId} status=${anySemanticOnly ? "semantic_only_unbacked" : "unbacked"} targets=${unbacked.length} locatorExecutionBacked=false requiresRouteLearning=true`,
    );
  }
  return { ...scenario, requiresRouteLearning, locatorExecutionBacked };
}

export type MobileRejectedIssue = {
  sourceIssueKey: string;
  reason: string;
  /** Acceptance-criterion identifiers this rejected/blocked entry relates to, when declared. */
  coveredCriteria?: string[];
};

export type CriterionCoverageStatus = "covered" | "blocked" | "rejected" | "missing";

export type CriterionCoverage = {
  criterionId: string;
  status: CriterionCoverageStatus;
  scenarioIds: string[];
  reasonCode?: string;
};

export type MobileScenarioGenerationResult = {
  scenarios: MobileGeneratedScenario[];
  rejected: MobileRejectedIssue[];
  issuesFound: number;
  criterionCoverage: CriterionCoverage[];
  diagnosticsByIssue: Record<string, {
    providerExitCode?: number;
    rawOutputLength: number;
    parsed: boolean;
    contractValid: boolean;
    rawScenarioCount: number;
    rawRejectedCount: number;
    normalizationDroppedCount: number;
    dropReasons: string[];
    finalScenarioCount: number;
    finalRejectedCount: number;
    classifiedReason?: string;
  }>;
};

export type MobileScenarioIssueStartEvent = {
  issueKey: string;
  index: number;
  total: number;
  startedAt: string;
};

export type MobileScenarioIssueCompletedEvent = {
  issueKey: string;
  index: number;
  total: number;
  status: "completed" | "failed";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  scenarios: MobileGeneratedScenario[];
  rejected: MobileRejectedIssue[];
  criterionCoverage: CriterionCoverage[];
  diagnostics: MobileScenarioGenerationResult["diagnosticsByIssue"][string];
  classifiedReason?: string;
  errorMessage?: string;
};

type ScenarioContainerResolution = {
  rawScenarios: unknown[];
  rawRejected: unknown[];
  contractValid: boolean;
};

const TARGET_REQUIRED_ACTIONS = new Set<MobileStep["action"]>([
  "click",
  "fill",
  "assertVisible",
  "assertEnabled",
  "assertDisabled",
  "waitFor",
]);

function resolveScenarioContainer(parsed: Record<string, unknown> | undefined): ScenarioContainerResolution {
  if (!parsed) {
    return { rawScenarios: [], rawRejected: [], contractValid: false };
  }
  const candidates: Array<Record<string, unknown>> = [
    parsed,
    typeof parsed.result === "object" && parsed.result && !Array.isArray(parsed.result) ? parsed.result as Record<string, unknown> : {},
    typeof parsed.payload === "object" && parsed.payload && !Array.isArray(parsed.payload) ? parsed.payload as Record<string, unknown> : {},
    typeof parsed.data === "object" && parsed.data && !Array.isArray(parsed.data) ? parsed.data as Record<string, unknown> : {},
  ];

  for (const container of candidates) {
    const scenarios = Array.isArray(container.scenarios)
      ? container.scenarios
      : Array.isArray(container.stories)
        ? container.stories
        : null;
    const rejected = Array.isArray(container.rejected) ? container.rejected : [];
    if (scenarios || rejected.length > 0) {
      return {
        rawScenarios: scenarios ?? [],
        rawRejected: rejected,
        contractValid: true,
      };
    }
  }

  return { rawScenarios: [], rawRejected: [], contractValid: false };
}

function isMobileStepAction(value: unknown): value is MobileStep["action"] {
  return value === "launchApp" ||
    value === "click" ||
    value === "fill" ||
    value === "assertVisible" ||
    value === "assertEnabled" ||
    value === "assertDisabled" ||
    value === "waitFor" ||
    value === "screenshot";
}

function normalizeStep(rawStep: unknown): { step?: MobileStep; reason?: string } {
  if (!rawStep || typeof rawStep !== "object" || Array.isArray(rawStep)) {
    return { reason: "invalid_step_object" };
  }
  const stepRecord = rawStep as Record<string, unknown>;
  if (!isMobileStepAction(stepRecord.action)) {
    return { reason: "invalid_step_action" };
  }
  const action = stepRecord.action;
  let target: MobileStep["target"];
  if (TARGET_REQUIRED_ACTIONS.has(action)) {
    const rawTarget = stepRecord.target;
    if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
      return { reason: "missing_step_target" };
    }
    const targetRecord = rawTarget as Record<string, unknown>;
    const strategy = typeof targetRecord.strategy === "string" ? targetRecord.strategy : "";
    const value = typeof targetRecord.value === "string" ? targetRecord.value.trim() : "";
    const validStrategy = strategy === "accessibilityId" || strategy === "id" || strategy === "xpath" || strategy === "androidUiAutomator" || strategy === "className";
    if (!validStrategy || !value) {
      return { reason: "invalid_step_target" };
    }
    target = { strategy: strategy as MobileStepTarget["strategy"], value };
  }

  // OTP metadata: accept only the structured declaration { required: true, identityField?, channel? }.
  // NEVER accept a static OTP value (string code). If the AI leaked a concrete OTP (in "otp" or a
  // "value" like "123456"/"000000"), treat the step as invalid so no fake code reaches runtime.
  let otp: MobileStep["otp"];
  if (stepRecord.otp !== undefined && stepRecord.otp !== null) {
    const rawOtp = stepRecord.otp as Record<string, unknown>;
    if (typeof rawOtp === "object" && !Array.isArray(rawOtp)) {
      const required = rawOtp.required === true;
      const leakedCode =
        (typeof rawOtp.code === "string" && /^\d{4,8}$/.test(rawOtp.code.trim())) ||
        (typeof rawOtp.value === "string" && /^\d{4,8}$/.test(rawOtp.value.trim())) ||
        (typeof rawOtp.otp === "string" && /^\d{4,8}$/.test(rawOtp.otp.trim()));
      if (required && !leakedCode) {
        otp = {
          required: true,
          identityField: typeof rawOtp.identityField === "string" && rawOtp.identityField.trim()
            ? rawOtp.identityField.trim()
            : undefined,
          channel: typeof rawOtp.channel === "string" && rawOtp.channel.trim()
            ? rawOtp.channel.trim()
            : undefined,
        };
      } else if (leakedCode) {
        return { reason: "static_otp_not_allowed" };
      }
    }
  }

  // If the step is a fill and the AI wrote a static 6-digit code into value in an OTP context
  // (explicit banned "000000", or description referencing OTP/código), reject it — dynamic OTP
  // must be resolved at runtime, never hardcoded.
  if (action === "fill") {
    const rawValue = typeof stepRecord.value === "string" ? stepRecord.value.trim() : "";
    const rawDesc = typeof stepRecord.description === "string" ? stepRecord.description.toLowerCase() : "";
    const otpContext = /otp|codigo|cod\.|verificacion|validacion de codigo/i.test(rawDesc);
    const looksStaticOtp = otpContext && /^\d{6}$/.test(rawValue) && rawValue !== "";
    if (looksStaticOtp && stepRecord.otp === undefined) {
      return { reason: "static_otp_not_allowed" };
    }
  }

  const normalized: MobileStep = {
    action,
    description: typeof stepRecord.description === "string" ? stepRecord.description : undefined,
    target,
    value: typeof stepRecord.value === "string" ? stepRecord.value : undefined,
    timeoutMs: typeof stepRecord.timeoutMs === "number" && Number.isFinite(stepRecord.timeoutMs) && stepRecord.timeoutMs > 0
      ? stepRecord.timeoutMs
      : undefined,
    otp,
  };
  return { step: normalized };
}

function classifyProviderError(error: unknown): string {
  if (!(error instanceof AiProviderError)) {
    return "ai_provider_failed";
  }
  if (
    error.code === "copilot_cli_empty_output" ||
    error.code === "claude_cli_empty_output" ||
    error.code === "ai_provider_output_missing"
  ) {
    return "ai_empty_output";
  }
  if (
    error.code === "ai_provider_invalid_json"
  ) {
    return "ai_invalid_json";
  }
  if (
    error.code === "copilot_cli_execution_failed" ||
    error.code === "claude_cli_execution_failed" ||
    error.code === "ai_provider_process_error" ||
    error.code === "ai_provider_http_error" ||
    error.code === "ai_provider_timeout"
  ) {
    return "ai_provider_failed";
  }
  return "ai_provider_failed";
}

function readErrorExitCode(error: unknown): number | undefined {
  if (!(error instanceof AiProviderError) || !error.diagnostics) return undefined;
  const raw = (error.diagnostics as Record<string, unknown>).exitCode;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function readErrorOutputLength(error: unknown): number {
  if (!(error instanceof AiProviderError) || !error.diagnostics) return 0;
  const diagnostics = error.diagnostics as Record<string, unknown>;
  const stdout = diagnostics.stdout;
  if (typeof stdout === "string") return stdout.length;
  const stdoutPreview = diagnostics.stdoutPreview;
  if (typeof stdoutPreview === "string") return stdoutPreview.length;
  return 0;
}

function parseRequiresManualData(value: unknown): boolean {
  return typeof value === "boolean" ? value : value === "true" || value === 1;
}

/** Canonicalizes a criterion identifier so AI-declared and HU-extracted ids compare equal. */
function normalizeCriterionId(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function parseCriterionIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = Array.from(new Set(
    value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean)
      .map(normalizeCriterionId),
  ));
  return ids.length > 0 ? ids : undefined;
}

function parseStepRequirementRefs(
  value: unknown,
  stepCount: number,
): Array<{ stepIndex: number; requirementIds: string[] }> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const refs: Array<{ stepIndex: number; requirementIds: string[] }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const idx = typeof r.stepIndex === "number" && Number.isInteger(r.stepIndex) && r.stepIndex >= 0 && r.stepIndex < stepCount
      ? r.stepIndex
      : undefined;
    if (idx === undefined) continue;
    const ids = Array.isArray(r.requirementIds)
      ? Array.from(new Set(r.requirementIds.filter((v: unknown): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean).map(normalizeCriterionId)))
      : [];
    if (ids.length > 0) refs.push({ stepIndex: idx, requirementIds: ids });
  }
  return refs.length > 0 ? refs : undefined;
}

function validateStepRequirementRefs(
  refs: Array<{ stepIndex: number; requirementIds: string[] }>,
  canonicalIds: string[],
): Array<{ stepIndex: number; requirementIds: string[] }> {
  const canonicalSet = new Set(canonicalIds);
  return refs
    .map((ref) => {
      const validIds = ref.requirementIds.filter((id) => canonicalSet.has(id));
      return validIds.length > 0 ? { stepIndex: ref.stepIndex, requirementIds: validIds } : null;
    })
    .filter((ref): ref is { stepIndex: number; requirementIds: string[] } => ref !== null);
}

/**
 * Extracts acceptance-criterion identifiers from the HU text delivered to the generator.
 * Supports explicit labels (CA/AC/CRIT/CRITERIO/CRITÉRIO + number) and falls back to a
 * numbered/bulleted list when no explicit labels exist. Returns canonical ids (e.g. "CA01").
 */
function extractCriterionIds(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  const labelRe = /\b(?:CA|AC|CRIT|CRITERIO|CRITÉRIO)\s*[-#.:]?\s*\d{1,3}\b/gi;
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text)) !== null) {
    ids.add(normalizeCriterionId(m[0]));
  }
  if (ids.size > 0) return Array.from(ids);

  let ordinal = 0;
  const listIds: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\d{1,3}\s*[.)]\s+/.test(line)) {
      ordinal++;
      listIds.push(`C${ordinal}`);
    }
  }
  return listIds;
}

const CRITERION_STATUS_RANK: Record<CriterionCoverageStatus, number> = {
  covered: 4,
  blocked: 3,
  rejected: 2,
  missing: 1,
};

/**
 * Builds per-criterion coverage after generation + precheck. Known criterion ids start as
 * "missing" and are promoted by declared coverage: accepted scenarios → "covered", precheck
 * blocks (technical incapability) → "blocked", AI-rejected → "rejected". Higher rank wins.
 */
function buildCriterionCoverage(
  knownIds: string[],
  accepted: MobileGeneratedScenario[],
  aiRejected: MobileRejectedIssue[],
  blocked: Array<{ coveredCriteria?: string[]; reasonCode?: string }>,
): CriterionCoverage[] {
  const map = new Map<string, CriterionCoverage>();
  const ensure = (id: string): CriterionCoverage => {
    let c = map.get(id);
    if (!c) {
      c = { criterionId: id, status: "missing", scenarioIds: [] };
      map.set(id, c);
    }
    return c;
  };
  for (const id of knownIds) ensure(id);

  const apply = (id: string, nextStatus: CriterionCoverageStatus, scenarioId?: string, reasonCode?: string) => {
    const c = ensure(id);
    if (CRITERION_STATUS_RANK[nextStatus] > CRITERION_STATUS_RANK[c.status]) {
      c.status = nextStatus;
      if (reasonCode !== undefined) c.reasonCode = reasonCode;
    }
    if (scenarioId && !c.scenarioIds.includes(scenarioId)) {
      c.scenarioIds.push(scenarioId);
    }
  };

  for (const s of accepted) {
    for (const id of s.coveredCriteria ?? []) apply(id, "covered", s.scenarioId);
  }
  for (const b of blocked) {
    for (const id of b.coveredCriteria ?? []) apply(id, "blocked", undefined, b.reasonCode);
  }
  for (const r of aiRejected) {
    for (const id of r.coveredCriteria ?? []) apply(id, "rejected");
  }

  return Array.from(map.values());
}

function parseAiScenarios(
  parsed: Record<string, unknown> | undefined,
  fallbackIssueKey: string,
  routeProfile?: MobileRouteProfile | null,
  knowledge?: { items: MobileKnowledgeItem[] },
  destinationClaimManifest?: DestinationClaimDefinition[],
): {
  scenarios: MobileGeneratedScenario[];
  rejected: MobileRejectedIssue[];
  diagnostics: {
    parsed: boolean;
    contractValid: boolean;
    rawScenarioCount: number;
    rawRejectedCount: number;
    normalizationDroppedCount: number;
    dropReasons: string[];
    finalScenarioCount: number;
    finalRejectedCount: number;
  };
} {
  const scenarios: MobileGeneratedScenario[] = [];
  const rejected: MobileRejectedIssue[] = [];
  const droppedReasons: string[] = [];
  let droppedCount = 0;

  const container = resolveScenarioContainer(parsed);
  const rawScenarios = container.rawScenarios;
  let localIndex = 0;
  for (const s of rawScenarios) {    if (!s || typeof s !== "object" || Array.isArray(s)) {
      droppedCount++;
      droppedReasons.push("invalid_scenario_object");
      continue;
    }
    const rawScenario = s as Record<string, unknown>;
    const rawSteps = Array.isArray(rawScenario.steps) ? rawScenario.steps : [];
    if (rawSteps.length === 0) {
      droppedCount++;
      droppedReasons.push("missing_steps");
      continue;
    }
    const normalizedSteps: MobileStep[] = [];
    let invalidStepReason: string | undefined;
    for (const rawStep of rawSteps) {
      const normalized = normalizeStep(rawStep);
      if (!normalized.step) {
        invalidStepReason = normalized.reason ?? "invalid_step_contract";
        break;
      }
      normalizedSteps.push(normalized.step);
    }
    if (invalidStepReason) {
      droppedCount++;
      droppedReasons.push(invalidStepReason);
      continue;
    }
    const sourceIssueKey = typeof rawScenario.sourceIssueKey === "string" ? rawScenario.sourceIssueKey : fallbackIssueKey;
    localIndex++;
    const steps = normalizedSteps;
    // deriveRequiredData may materialize a dependent select click, so it can change `steps`.
    const derivedData = deriveRequiredData(steps, routeProfile);
    let scenario: MobileGeneratedScenario = {
      // Assigned server-side (not by the AI) so it's stable across re-runs and
      // guaranteed unique — launchExecution() rejects duplicate scenarioIds.
      scenarioId: `MOBILE-${sourceIssueKey}-${String(localIndex).padStart(3, "0")}`,
      sourceIssueKey,
      title: typeof rawScenario.title === "string" ? rawScenario.title : fallbackIssueKey,
      steps: derivedData.steps,
      expectedResult: typeof rawScenario.expectedResult === "string" && rawScenario.expectedResult.trim()
        ? rawScenario.expectedResult.trim()
        : "El escenario se ejecuta sin errores.",
      preconditions: Array.isArray(rawScenario.preconditions)
        ? rawScenario.preconditions.filter((p: unknown): p is string => typeof p === "string")
        : [],
      requiredData: derivedData.fields,
      requiredDataProfile: typeof rawScenario.requiredDataProfile === "string" && rawScenario.requiredDataProfile.trim()
        ? rawScenario.requiredDataProfile.trim()
        : undefined,
      requiresManualData: parseRequiresManualData(rawScenario.requiresManualData),
      coveredCriteria: parseCriterionIds(rawScenario.coveredCriteria),
      stepRequirementRefs: parseStepRequirementRefs(rawScenario.stepRequirementRefs, steps.length),
      stepDestinationExpectations: parseStepDestinationExpectations(
        rawScenario.stepDestinationExpectations,
        steps.length,
        parseCriterionIds(rawScenario.coveredCriteria) ?? [],
        destinationClaimManifest,
      ),
    };
    scenario = materializeFunctionalPrerequisite(scenario, routeProfile);
    scenario = classifyLocatorExecutionBacking(scenario, knowledge ?? { items: [] });
    scenarios.push(scenario);
  }

  const rawRejected = container.rawRejected;
  for (const r of rawRejected) {
    rejected.push({
      sourceIssueKey: typeof (r as Record<string, unknown>)?.sourceIssueKey === "string" ? String((r as Record<string, unknown>).sourceIssueKey) : fallbackIssueKey,
      reason: typeof (r as Record<string, unknown>)?.reason === "string" ? String((r as Record<string, unknown>).reason) : "issue_not_mobile_automatable",
      coveredCriteria: parseCriterionIds((r as Record<string, unknown>).coveredCriteria)
    });
  }

  return {
    scenarios,
    rejected,
    diagnostics: {
      parsed: Boolean(parsed),
      contractValid: container.contractValid,
      rawScenarioCount: rawScenarios.length,
      rawRejectedCount: rawRejected.length,
      normalizationDroppedCount: droppedCount,
      dropReasons: Array.from(new Set(droppedReasons)),
      finalScenarioCount: scenarios.length,
      finalRejectedCount: rejected.length,
    },
  };
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
  appSlug?: string,
  deps: {
    loadIssues?: typeof loadJiraIssues;
    createProvider?: typeof createScenarioAiProvider;
    logger?: Pick<typeof console, "log" | "error">;
    selectedIssueKeys?: string[];
    onIssuesResolved?: (issueKeys: string[]) => void;
    onIssueStart?: (event: MobileScenarioIssueStartEvent) => void;
    onIssueCompleted?: (event: MobileScenarioIssueCompletedEvent) => void;
  } = {}
): Promise<MobileScenarioGenerationResult> {
  const loadIssues = deps.loadIssues ?? loadJiraIssues;
  const createProvider = deps.createProvider ?? createScenarioAiProvider;
  const logger = deps.logger ?? console;
  const loadedIssues = await loadIssues(jiraConfig, projectKey, sprintId, status, maxResults);
  const selectedIssueKeys = Array.isArray(deps.selectedIssueKeys)
    ? deps.selectedIssueKeys.map((key) => key?.trim()).filter((key): key is string => Boolean(key))
    : [];
  const selectedIssueKeySet = new Set(selectedIssueKeys);
  const issues = selectedIssueKeySet.size > 0
    ? loadedIssues.filter((issue) => selectedIssueKeySet.has(issue.key))
    : loadedIssues;
  if (selectedIssueKeySet.size > 0) {
    logger.log(
      `[mobile:scenarios] selectedIssueKeys requested=${selectedIssueKeySet.size} matched=${issues.length} loaded=${loadedIssues.length}`,
    );
  }

  if (issues.length === 0) {
    deps.onIssuesResolved?.([]);
    return { scenarios: [], rejected: [], issuesFound: 0, criterionCoverage: [], diagnosticsByIssue: {} };
  }
  deps.onIssuesResolved?.(issues.map((issue) => issue.key));

  const routeProfile = appSlug ? loadMobileRouteProfile(appSlug) : null;
  const knowledge = appSlug ? loadMobileKnowledge(appSlug) : { items: [] };
  if (appSlug) {
    logger.log(`[mobile:scenarios] routeProfile appSlug=${appSlug} found=${routeProfile !== null} screens=${routeProfile?.screens ? Object.keys(routeProfile.screens).length : 0} knowledgeItems=${knowledge.items.length}`);
  }

  // Build destination claim manifest BEFORE provider call from authoritative sources.
  // This manifest establishes which destination claims are valid. The provider can only
  // REFERENCE claims in this manifest, not create new ones.
  const allCanonicalIds = issues.flatMap((issue) =>
    extractCriterionIds(issue.acceptanceCriteria || issue.description || "")
  );
  const routeProfileScreenIds = routeProfile?.screens ? Object.keys(routeProfile.screens) : undefined;
  const destinationClaimManifest: DestinationClaimDefinition[] = buildMobileDestinationClaimManifest(
    allCanonicalIds,
    routeProfileScreenIds,
  );
  if (destinationClaimManifest.length > 0) {
    logger.log(`[mobile:scenarios] destinationClaimManifest claims=${destinationClaimManifest.length}`);
  } else {
    logger.log(`[mobile:scenarios] destinationClaimManifest claims=0 (no authoritative requirement→destination binding)`);
  }

  const scenarios: MobileGeneratedScenario[] = [];
  const rejected: MobileRejectedIssue[] = [];
  const criterionCoverage: CriterionCoverage[] = [];
  const diagnosticsByIssue: MobileScenarioGenerationResult["diagnosticsByIssue"] = {};

  for (const [issueIndex, issue] of issues.entries()) {
    const issueStartedAtMs = Date.now();
    const issueStartedAt = new Date(issueStartedAtMs).toISOString();
    deps.onIssueStart?.({
      issueKey: issue.key,
      index: issueIndex,
      total: issues.length,
      startedAt: issueStartedAt,
    });
    logger.log(`[mobile:scenarios] generating steps for issue=${issue.key}`);
    try {
      const provider = await createProvider();
      const huText = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
      const learnedScreens = selectRelevantMobileKnowledge(knowledge, huText);
      if (learnedScreens.length > 0) {
        logger.log(`[mobile:scenarios] issue=${issue.key} injecting ${learnedScreens.length} learned screen(s) from previous runs`);
      }
      const messages = buildMobileScenarioMessages(issue, routeProfile, learnedScreens, destinationClaimManifest);
      const response = await provider.completeJson({
        messages,
        purpose: "scenario_generation",
        requireJson: true
      });

      const parsed = parseAiScenarios(
        response.parsedJson,
        issue.key,
        routeProfile,
        knowledge,
        destinationClaimManifest,
      );
      const issueScenarios = parsed.scenarios;
      const issueRejected = parsed.rejected;
      let classifiedReason: string | undefined;
      const issueAccepted: MobileGeneratedScenario[] = [];
      const canonicalIds = extractCriterionIds(issue.acceptanceCriteria || issue.description || "");
      const blockedForCoverage: Array<{ coveredCriteria?: string[]; reasonCode?: string }> = [];

      if (issueScenarios.length === 0 && issueRejected.length === 0) {
        if (!parsed.diagnostics.contractValid) {
          classifiedReason = "ai_contract_mismatch";
        } else if (parsed.diagnostics.normalizationDroppedCount > 0) {
          classifiedReason = "all_scenarios_dropped";
        } else if ((response.rawText ?? "").trim().length === 0) {
          classifiedReason = "ai_empty_output";
        } else {
          classifiedReason = "ai_empty_output";
        }
        rejected.push({ sourceIssueKey: issue.key, reason: classifiedReason });
      } else {
        const precheckExcluded: MobileRejectedIssue[] = [];
        for (const scenario of issueScenarios) {
          const precheck = evaluateScenarioPrecheck(scenario.steps, appSlug, scenario.expectedResult, scenario.requiredDataProfile);
          if (precheck.blocked) {
            precheckExcluded.push({
              sourceIssueKey: issue.key,
              reason: `${precheck.reasonCode}:${precheck.detail}`,
              coveredCriteria: scenario.coveredCriteria,
            });
            blockedForCoverage.push({ coveredCriteria: scenario.coveredCriteria, reasonCode: precheck.reasonCode });
            console.log(`[mobile-scenarios:precheck] excluded=${scenario.scenarioId} reasonCode=${precheck.reasonCode} detail=${precheck.detail}`);
          } else {
            const functionalData = precheck.functionalData;
            if (functionalData?.status === "manual_data_required") {
              scenario.requiresManualData = true;
              console.log(`[mobile-scenarios:precheck] manualDataRequired=${scenario.scenarioId} reasonCode=${functionalData.reasonCode} detail=${functionalData.detail}`);
            } else if (functionalData?.status === "resolved") {
              scenario.requiresManualData = false;
              console.log(`[mobile-scenarios:precheck] functionalDataResolved=${scenario.scenarioId}`);
            }
            if (scenario.stepRequirementRefs && canonicalIds.length > 0) {
              scenario.stepRequirementRefs = validateStepRequirementRefs(scenario.stepRequirementRefs, canonicalIds);
            }
            // Validate destination expectations against stepRequirementRefs (fail-closed).
            if (scenario.stepDestinationExpectations && scenario.stepDestinationExpectations.length > 0) {
              scenario.stepDestinationExpectations = validateStepDestinationExpectations(
                scenario.stepDestinationExpectations,
                scenario.stepRequirementRefs,
              );
              if (scenario.stepDestinationExpectations.length === 0) {
                scenario.stepDestinationExpectations = undefined;
              }
            }
            scenarios.push(scenario);
            issueAccepted.push(scenario);
          }
        }
        rejected.push(...issueRejected, ...precheckExcluded);
      }

      const issueCoverage = buildCriterionCoverage(
        extractCriterionIds(issue.acceptanceCriteria || issue.description || ""),
        issueAccepted,
        issueRejected,
        blockedForCoverage,
      );
      criterionCoverage.push(...issueCoverage);
      const missingCriteria = issueCoverage.filter((c) => c.status === "missing");
      const hasMissing = missingCriteria.length > 0;
      logger.log(
        `[mobile:scenarios:coverage] issue=${issue.key} complete=${!hasMissing} criteria=${issueCoverage.length} covered=${issueCoverage.filter((c) => c.status === "covered").length} blocked=${issueCoverage.filter((c) => c.status === "blocked").length} rejected=${issueCoverage.filter((c) => c.status === "rejected").length} missing=${missingCriteria.length} missingIds=${missingCriteria.map((c) => c.criterionId).join(",") || "-"}`,
      );

      const finalRejectedCount = issueRejected.length + (classifiedReason ? 1 : 0);
      const issueDiagnostics = {
        providerExitCode: response.diagnostics?.exitCode,
        rawOutputLength: response.rawText?.length ?? 0,
        parsed: parsed.diagnostics.parsed,
        contractValid: parsed.diagnostics.contractValid,
        rawScenarioCount: parsed.diagnostics.rawScenarioCount,
        rawRejectedCount: parsed.diagnostics.rawRejectedCount,
        normalizationDroppedCount: parsed.diagnostics.normalizationDroppedCount,
        dropReasons: parsed.diagnostics.dropReasons,
        finalScenarioCount: issueScenarios.length,
        finalRejectedCount,
        classifiedReason,
      };
      diagnosticsByIssue[issue.key] = issueDiagnostics;
      logger.log(
        `[mobile:scenarios:diag] issue=${issue.key} providerExitCode=${response.diagnostics?.exitCode ?? "n/a"} rawOutputLength=${response.rawText?.length ?? 0} parsed=${parsed.diagnostics.parsed} contractValid=${parsed.diagnostics.contractValid} rawScenarioCount=${parsed.diagnostics.rawScenarioCount} rawRejectedCount=${parsed.diagnostics.rawRejectedCount} normalizationDroppedCount=${parsed.diagnostics.normalizationDroppedCount} dropReasons=${parsed.diagnostics.dropReasons.join(",") || "-"} finalScenarioCount=${issueScenarios.length} finalRejectedCount=${finalRejectedCount} classifiedReason=${classifiedReason ?? "-"}`,
      );
      logger.log(`[mobile:scenarios] issue=${issue.key} scenarios=${issueScenarios.length} rejected=${finalRejectedCount}`);

      // ── hu_declared knowledge persistence (shared with Web) ────────────
      if (appSlug) {
        try {
          const huText = [issue.summary, issue.description, issue.acceptanceCriteria].filter(Boolean).join(" ");
          const requirementAccounting = buildRequirementAccounting([], [], huText, issue.key);
          const result = await persistHuDeclaredKnowledge(appSlug, requirementAccounting, [], issue.key);
          logger.log(
            `[mobile:hu-declared] appSlug=${appSlug} issueKey=${issue.key} derived=${result.derived} inserted=${result.inserted} updated=${result.updated} deduped=${result.deduped}`,
          );
        } catch (err) {
          console.warn(
            `[mobile:hu-declared] appSlug=${appSlug} issueKey=${issue.key} reason=persist_failed err=${(err as Error).message}`,
          );
        }
      }

      const issueFinishedAtMs = Date.now();
      const issueFinishedAt = new Date(issueFinishedAtMs).toISOString();
      deps.onIssueCompleted?.({
        issueKey: issue.key,
        index: issueIndex,
        total: issues.length,
        status: "completed",
        startedAt: issueStartedAt,
        finishedAt: issueFinishedAt,
        durationMs: issueFinishedAtMs - issueStartedAtMs,
        scenarios: issueScenarios,
        rejected: classifiedReason ? [...issueRejected, { sourceIssueKey: issue.key, reason: classifiedReason }] : issueRejected,
        criterionCoverage: issueCoverage,
        diagnostics: issueDiagnostics,
        classifiedReason,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const classifiedReason = classifyProviderError(err);
      rejected.push({ sourceIssueKey: issue.key, reason: classifiedReason });
      const issueDiagnostics = {
        providerExitCode: readErrorExitCode(err),
        rawOutputLength: readErrorOutputLength(err),
        parsed: false,
        contractValid: false,
        rawScenarioCount: 0,
        rawRejectedCount: 0,
        normalizationDroppedCount: 0,
        dropReasons: [],
        finalScenarioCount: 0,
        finalRejectedCount: 1,
        classifiedReason,
      };
      diagnosticsByIssue[issue.key] = issueDiagnostics;
      const issueCoverage = buildCriterionCoverage(
        extractCriterionIds(issue.acceptanceCriteria || issue.description || ""),
        [],
        [],
        [],
      );
      criterionCoverage.push(...issueCoverage);
      logger.error(`[mobile:scenarios] issue=${issue.key} generation failed reason=${classifiedReason} message=${message}`);
      logger.log(
        `[mobile:scenarios:diag] issue=${issue.key} providerExitCode=${readErrorExitCode(err) ?? "n/a"} rawOutputLength=${readErrorOutputLength(err)} parsed=false contractValid=false rawScenarioCount=0 rawRejectedCount=0 normalizationDroppedCount=0 dropReasons=- finalScenarioCount=0 finalRejectedCount=1 classifiedReason=${classifiedReason}`,
      );
      const issueCoverageMissing = issueCoverage.filter((c) => c.status === "missing").length;
      logger.log(
        `[mobile:scenarios:coverage] issue=${issue.key} complete=${issueCoverageMissing === 0} criteria=${issueCoverage.length} covered=0 blocked=0 rejected=0 missing=${issueCoverageMissing} missingIds=${issueCoverage.filter((c) => c.status === "missing").map((c) => c.criterionId).join(",") || "-"}`,
      );
      const issueFinishedAtMs = Date.now();
      const issueFinishedAt = new Date(issueFinishedAtMs).toISOString();
      deps.onIssueCompleted?.({
        issueKey: issue.key,
        index: issueIndex,
        total: issues.length,
        status: "failed",
        startedAt: issueStartedAt,
        finishedAt: issueFinishedAt,
        durationMs: issueFinishedAtMs - issueStartedAtMs,
        scenarios: [],
        rejected: [{ sourceIssueKey: issue.key, reason: classifiedReason }],
        criterionCoverage: issueCoverage,
        diagnostics: issueDiagnostics,
        classifiedReason,
        errorMessage: message,
      });
    }
  }

  return { scenarios, rejected, issuesFound: issues.length, criterionCoverage, diagnosticsByIssue };
}

/**
 * Converts an AI-generated mobile scenario into the shape the (unmodified, reused)
 * web TestRail publish pipeline expects. `steps` becomes one human-readable row per
 * MobileStep (its `description`), matching how web scenario steps are already plain
 * strings — the structured MobileStep[] (locators/values) stays with the caller for
 * execution, it is not needed by TestRail.
 */
export function mobileScenarioToLaunchScenario(s: MobileGeneratedScenario): LaunchScenario {
  const setupSteps = (s.prerequisiteSteps ?? [])
    .map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim());
  const scenarioSteps = s.steps.map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim());
  const metadata: Record<string, unknown> = {};
  if (s.requiresRouteLearning) metadata.requiresRouteLearning = true;
  if (s.prerequisiteSteps?.length) metadata.prerequisiteSteps = s.prerequisiteSteps.length;
  if (s.requiredDataProfile) metadata.requiredDataProfile = s.requiredDataProfile;
  return {
    scenarioId: s.scenarioId,
    title: s.title,
    steps: [...setupSteps, ...scenarioSteps],
    expectedResult: s.expectedResult,
    preconditions: s.preconditions,
    sourceIssueKey: s.sourceIssueKey,
    // The shared launch orchestrator classifies anything without `mcpExecutable === true` as
    // "adaptive", and then blocks it for lacking targetScreen/actualChain/requiredChain —
    // web-only fields a mobile scenario never has. Every mobile scenario therefore fell out as
    // "no launchable scenarios", no matter how well it had been learned. Mobile readiness is
    // decided before this adapter runs: the route already excluded everything still requiring
    // route learning, so what reaches here is exactly the executable set.
    mcpExecutable: s.requiresRouteLearning !== true,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}
