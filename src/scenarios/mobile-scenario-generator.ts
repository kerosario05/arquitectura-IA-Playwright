import { loadJiraIssues } from "./jira-scenario-source";
import { createScenarioAiProvider } from "../ai/ai-provider-factory";
import { AiProviderError } from "../ai/ai-provider.types";
import { buildMobileScenarioMessages } from "./mobile-scenario-prompt-builder";
import { loadMobileRouteProfile } from "../mobile/mobile-route-profile";
import { evaluateScenarioPrecheck } from "../mobile/mobile-execution-precheck";
import { loadMobileKnowledge, selectRelevantMobileKnowledge } from "../mobile/mobile-knowledge-resolver";
import { repairUtf8Mojibake } from "../mobile/mobile-text-normalization";
import type { RequiredJiraRuntimeConfig } from "../types/jira.types";
import { isSensitiveDataLabel, slugifyDataKey, type MobileStep, type MobileDataField, type MobileStepTarget } from "../mobile/mobile-step-types";
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
  /** Name of a functional data profile this scenario depends on (business/backend state). */
  requiredDataProfile?: string;
  /** True when the scenario declared a profile that is missing/unresolved — it still runs,
   *  but the user must supply the data manually (dataOverrides) before execution. */
  requiresManualData?: boolean;
  /** Acceptance-criterion identifiers from the HU that this scenario covers (e.g. ["CA01"]). */
  coveredCriteria?: string[];
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
  routeProfile?: MobileRouteProfile | null
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
    scenarios.push({
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
      coveredCriteria: parseCriterionIds(rawScenario.coveredCriteria)
    });
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
    logger.log(`[mobile:scenarios] routeProfile appSlug=${appSlug} found=${routeProfile !== null} screens=${routeProfile ? Object.keys(routeProfile.screens).length : 0} knowledgeItems=${knowledge.items.length}`);
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
      const messages = buildMobileScenarioMessages(issue, routeProfile, learnedScreens);
      const response = await provider.completeJson({
        messages,
        purpose: "scenario_generation",
        requireJson: true
      });

      const parsed = parseAiScenarios(
        response.parsedJson,
        issue.key,
        routeProfile
      );
      const issueScenarios = parsed.scenarios;
      const issueRejected = parsed.rejected;
      let classifiedReason: string | undefined;
      const issueAccepted: MobileGeneratedScenario[] = [];
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
  return {
    scenarioId: s.scenarioId,
    title: s.title,
    steps: s.steps.map((st) => st.description?.trim() || `${st.action} ${st.target?.value ?? st.value ?? ""}`.trim()),
    expectedResult: s.expectedResult,
    preconditions: s.preconditions,
    sourceIssueKey: s.sourceIssueKey
  };
}
