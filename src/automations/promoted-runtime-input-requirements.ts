import fs from "node:fs/promises";
import path from "node:path";
import type { ExecutionPlan, ExecutionPlanStep } from "../types/execution-plan.types";
import type { PromotedAutomationIndex, PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import type { TestScenario } from "../types/testrail.types";
import type { RuntimeInputRequirement } from "../testrail/testrail-runtime-transformer";
import { loadAutomationIndex } from "./automation-index";
import { validatePromotedArtifactForReuse } from "./automation-reuse";
import { validateExecutionPlan } from "../plans/execution-plan-validator";

function normalize(value: string): string {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function humanize(value: string): string {
  return value
    .replace(/^jira_step_(\d+)$/i, "Paso $1")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toLocaleUpperCase());
}

function inputLabel(key: string, step: ExecutionPlanStep | undefined, scenario: TestScenario, plan: ExecutionPlan): string {
  const sourceStepIndex = jiraSourceInputStepIndex(key);
  if (sourceStepIndex !== undefined) {
    const jiraStepDescription = jiraSourceStepDescription(plan, key);
    if (jiraStepDescription) return jiraStepDescription;
    const observedTargetLabel = jiraTargetLabel(step);
    if (observedTargetLabel) return observedTargetLabel;
    const authoredStep = scenario.steps.find((candidate) => candidate.index === sourceStepIndex);
    if (authoredStep?.action.trim()) return authoredStep.action.trim();
  }
  if (step?.description?.trim()) {
    const description = step.description.trim().replace(/^(?:fill|select)\s+/i, "");
    if (!/^\[[^\]]+\]$/.test(description)) return description;
  }
  return humanize(key);
}

function jiraSourceInputStepIndex(key: string): number | undefined {
  const match = key.match(/^jira_step_(\d+)$/i)
    ?? key.match(/^jira_edit_[a-f0-9]{8,}_(\d+)$/i);
  if (!match) return undefined;
  const stepIndex = Number(match[1]);
  return Number.isSafeInteger(stepIndex) && stepIndex > 0 ? stepIndex : undefined;
}

function jiraSourceStepDescription(plan: ExecutionPlan, key: string): string | undefined {
  const sourceSteps = (plan as ExecutionPlan & { sourceScenario?: { steps?: Array<Record<string, unknown>> } }).sourceScenario?.steps;
  const sourceStep = sourceSteps?.find((candidate) => candidate.valueKey === key);
  const description = typeof sourceStep?.description === "string" ? sourceStep.description.trim() : "";
  return description && !/^\[[^\]]+\]$/.test(description) ? description : undefined;
}

function humanizeTargetIdentifier(value: string): string | undefined {
  const tokens = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[._\-\s]+/)
    .filter((token) => token && !/^\d+$/.test(token))
    .filter((token) => !/^(?:transaction|details|field|input|control|payment)$/i.test(token));
  if (tokens.length === 0) return undefined;
  const localized: Record<string, string> = {
    amount: "Monto",
    source: "Origen",
    origin: "Origen",
    destination: "Destino",
    account: "Cuenta",
    username: "Usuario",
    password: "Contraseña",
    token: "Token",
    code: "Código",
    clave: "Contraseña",
  };
  return tokens.map((token) => localized[token.toLowerCase()] ?? token).join(" ");
}

function jiraTargetLabel(step: ExecutionPlanStep | undefined): string | undefined {
  const target = step?.target;
  if (!target || typeof target !== "object") return undefined;
  const metadata = target.metadata;
  const explicitName = [target.name, target.hint, metadata?.resolvedTargetName, metadata?.originalTarget]
    .find((candidate): candidate is string => typeof candidate === "string"
      && candidate.trim().length > 0
      && !(target.strategy === "semantic" && /(?:segmented|otp|code)\s+(?:code\s+)?input\s+group/i.test(candidate)));
  if (explicitName) return explicitName.trim();

  const value = typeof target.value === "string" ? target.value.trim() : "";
  if (!value) return undefined;
  if (["label", "placeholder", "text", "testId"].includes(target.strategy)) return value;

  if (target.strategy === "xpath") {
    const textMatch = value.match(/normalize-space\s*\(\s*\.\s*\)\s*=\s*(['"])(.*?)\1/i);
    if (textMatch?.[2]?.trim()) return textMatch[2].trim();
  }
  if (target.strategy === "css") {
    const idMatch = value.match(/(?:\[\s*id\s*=\s*['"]|#)([\w.-]+)/i);
    if (idMatch?.[1]) return humanizeTargetIdentifier(idMatch[1].split("__").at(-1) ?? idMatch[1]);
  }
  return undefined;
}

function inputControlType(key: string, step: ExecutionPlanStep | undefined): string {
  if (step?.action === "select") return "select";
  if (/(^|[._-])(password|pass|contrasena|clave)([._-]|$)/i.test(normalize(key))) return "password";
  // Sensitive test values remain visible/editable in this controlled QA workflow.
  // Sensitivity is metadata for replay policy; it does not make RNC, OTP, token,
  // or account values password fields.
  return "text";
}

export function buildPromotedRuntimeInputRequirements(
  plan: ExecutionPlan,
  scenario: TestScenario,
): RuntimeInputRequirement[] {
  const requiredData = Array.isArray(plan.requiredData) ? plan.requiredData : [];
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const stepByKey = new Map<string, ExecutionPlanStep>();
  for (const step of steps) {
    if ((step.action === "fill" || step.action === "select") && typeof step.valueKey === "string" && step.valueKey.trim()) {
      if (!stepByKey.has(normalize(step.valueKey))) stepByKey.set(normalize(step.valueKey), step);
    }
  }

  const keys = new Map<string, { key: string; required: boolean; sensitive: boolean }>();
  for (const requirement of requiredData) {
    if (!requirement?.key?.trim() || requirement.valueRole === "expected_oracle" || requirement.valueRole === "runtime_derived_oracle") continue;
    const normalized = normalize(requirement.key);
    keys.set(normalized, {
      key: requirement.key.trim(),
      required: requirement.required === true,
      sensitive: requirement.sensitive === true,
    });
  }
  for (const [normalized, step] of stepByKey) {
    const existing = keys.get(normalized);
    keys.set(normalized, {
      key: existing?.key ?? step.valueKey!,
      required: existing?.required ?? true,
      sensitive: existing?.sensitive ?? false,
    });
  }

  return [...keys.values()].map(({ key, required, sensitive }) => {
    const step = stepByKey.get(normalize(key));
    const controlType = inputControlType(key, step);
    const label = inputLabel(key, step, scenario, plan);
    return {
      key,
      label,
      displayLabel: label,
      technicalLabel: key,
      controlType,
      required,
      sensitive,
      editable: true,
      source: "contract",
      provenance: "contract_declaration",
      valueRole: "runtime_input",
      inputRole: "scenario",
      inputUsage: ["action"],
      fieldCapability: { kind: controlType === "select" ? "select" : controlType === "password" ? "password" : "text" },
      valuePolicy: "scenario_controlled",
      scenarioDataPolicy: sensitive ? "trusted_required" : "explicit_value",
    } satisfies RuntimeInputRequirement;
  });
}

export function findExactPromotedAutomation(
  index: PromotedAutomationIndex,
  appSlug: string,
  caseId: number,
): PromotedAutomationIndexEntry | undefined {
  const matching = index.automations.filter((entry) =>
    entry.caseId === caseId
    && entry.status === "active"
    && entry.specVerificationStatus === "passed"
    && (entry.appSlug ?? entry.appProfile)?.trim().toLowerCase() === appSlug.trim().toLowerCase(),
  );
  return matching.length === 1 ? matching[0] : undefined;
}

export function isPromotedPlanCompatibleWithCase(plan: ExecutionPlan, caseId: number): boolean {
  return (plan.scenario.source === "jira" || plan.scenario.source === "testrail")
    && (plan.scenario.caseId === undefined || plan.scenario.caseId === caseId);
}

export async function loadPromotedRuntimeInputRequirements(input: {
  appSlug: string;
  caseId: number;
  scenario: TestScenario;
  index?: PromotedAutomationIndex;
  loadIndex?: (indexPath?: string) => Promise<PromotedAutomationIndex>;
}): Promise<RuntimeInputRequirement[]> {
  const appSlug = input.appSlug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appSlug) || !Number.isSafeInteger(input.caseId) || input.caseId <= 0) return [];
  try {
    const indexPath = path.join("automations", "apps", appSlug, "index.json");
    const index = input.index ?? await (input.loadIndex ?? loadAutomationIndex)(indexPath);
    const entry = findExactPromotedAutomation(index, appSlug, input.caseId);
    if (!entry || !entry.promotionPersisted) return [];

    const appRoot = path.resolve("automations", "apps", appSlug);
    const resolveInsideApp = (candidate: string) => {
      const resolved = path.resolve(candidate.replace(/[\\/]+/g, path.sep));
      const relative = path.relative(appRoot, resolved);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved : undefined;
    };
    const specPath = resolveInsideApp(entry.specPath);
    const planPath = resolveInsideApp(entry.planPath);
    if (!specPath || !planPath) return [];
    const specText = await fs.readFile(specPath, "utf8");
    const sectionSlug = specPath.match(/[\\/]sections[\\/]([^\\/]+)[\\/]cases[\\/]/i)?.[1] ?? "";
    const reuse = validatePromotedArtifactForReuse(entry, {
      specPath,
      specExists: true,
      specText,
      appSlug,
      sectionSlug,
      caseId: input.caseId,
    });
    if (!reuse.valid) return [];

    const plan = JSON.parse(await fs.readFile(planPath, "utf8")) as ExecutionPlan;
    if (!validateExecutionPlan(plan).valid || !isPromotedPlanCompatibleWithCase(plan, input.caseId)) return [];
    return buildPromotedRuntimeInputRequirements(plan, input.scenario);
  } catch {
    return [];
  }
}
