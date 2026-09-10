import type { Locator, Page } from "@playwright/test";
import { analyzeSupportingCandidates, type AnalyzeSupportingCandidatesInput, type ObservedSupportingControl, type SupportingCandidateResult } from "../discovery/supporting-candidate-analyzer";
import { resolveSyntheticValue } from "../data/synthetic-value-resolver";
import { ensureSupportingCheckbox, ensureSupportingMultiselect, resolveSupportingDate, selectSupportingAutocomplete, selectSupportingCombobox, selectSupportingOption, selectSupportingRadio } from "./runtime-field-capability";
import type { RuntimeInputRequirement } from "../testrail/testrail-runtime-transformer";
import type { ExecutionPlanStep } from "../types/execution-plan.types";

export type ResolvableObservedControl = ObservedSupportingControl & { locator: Locator };

export type SupportingAutofillResolution = SupportingCandidateResult & {
  source: "synthetic" | "runtime_strategy" | "trusted_required" | "unresolved" | "none";
  result: "resolved" | "skipped" | "blocked" | "unresolved";
};

export type SupportingAutofillInput = {
  page: Page;
  executionPlan: ExecutionPlanStep[];
  runtimeRequirements: RuntimeInputRequirement[];
  observedControls: ResolvableObservedControl[];
  dependentAction?: AnalyzeSupportingCandidatesInput["dependentAction"];
  executionSeed: string | number;
  retryDependentAction?: () => Promise<void>;
};

export type SupportingAutofillResult = {
  resolutions: SupportingAutofillResolution[];
  retryAttempted: boolean;
};

function strategyKind(kind: string | undefined): boolean {
  return ["select", "radio", "checkbox", "combobox", "autocomplete", "date", "datetime", "datepicker", "multiselect"].includes(kind ?? "");
}

async function resolveDynamic(locator: Locator, kind: string): Promise<boolean> {
  if (kind === "select") {
    const value = await selectSupportingOption(locator, { strategy: "first_valid" });
    await locator.selectOption(value);
    return true;
  }
  if (kind === "radio") return selectSupportingRadio(locator, { strategy: "first_valid" });
  if (kind === "checkbox") return ensureSupportingCheckbox(locator, { strategy: "ensure_checked" });
  if (kind === "combobox") return selectSupportingCombobox(locator, { strategy: "first_valid" });
  if (kind === "autocomplete") return selectSupportingAutocomplete(locator, { strategy: "first_valid" });
  if (["date", "datetime", "datepicker"].includes(kind)) return resolveSupportingDate(locator, { strategy: "valid_in_range" });
  if (kind === "multiselect") return ensureSupportingMultiselect(locator, { strategy: "ensure_valid_selection" });
  return false;
}

function provenance(result: SupportingCandidateResult, source: SupportingAutofillResolution["source"], outcome: SupportingAutofillResolution["result"]): SupportingAutofillResolution {
  return { ...result, source, result: outcome };
}

export async function resolveSupportingAutofill(input: SupportingAutofillInput): Promise<SupportingAutofillResult> {
  void input.page;
  const controlsForAnalysis = input.observedControls.map(({ locator: _locator, ...control }) => control);
  const candidates = analyzeSupportingCandidates({
    runtimeRequirements: input.runtimeRequirements,
    observedControls: controlsForAnalysis,
    executionPlan: input.executionPlan,
    dependentAction: input.dependentAction,
  });
  const resolutions: SupportingAutofillResolution[] = [];
  let changed = false;

  for (const candidate of candidates) {
    if (candidate.decision !== "supporting_candidate" && candidate.decision !== "trusted_required") {
      resolutions.push(provenance(candidate, "none", "skipped"));
      continue;
    }
    const observed = input.observedControls.find((control) => control.controlIdentity?.fingerprint === candidate.controlIdentity?.fingerprint);
    if (!observed) {
      resolutions.push(provenance({ ...candidate, decision: "unresolved", reason: "runtime_control_locator_unresolved" }, "unresolved", "unresolved"));
      continue;
    }
    if (candidate.decision === "trusted_required") {
      resolutions.push(provenance(candidate, "trusted_required", "blocked"));
      continue;
    }

    const requirement = input.runtimeRequirements.find((item) => item.key === candidate.requirementRef);
    const kind = candidate.fieldCapability?.kind;
    if (!requirement || !kind) {
      resolutions.push(provenance({ ...candidate, decision: "unresolved", reason: "supporting_requirement_unresolved" }, "unresolved", "unresolved"));
      continue;
    }

    try {
      if (strategyKind(kind)) {
        const didResolve = await resolveDynamic(observed.locator, kind);
        changed = changed || didResolve;
        resolutions.push(provenance(candidate, "runtime_strategy", didResolve ? "resolved" : "skipped"));
        continue;
      }
      const synthetic = resolveSyntheticValue({ requirement, seed: `${String(input.executionSeed)}:${candidate.controlIdentity?.fingerprint ?? "unknown"}` });
      if (synthetic.status !== "generated") {
        resolutions.push(provenance(candidate, "unresolved", "unresolved"));
        continue;
      }
      await observed.locator.fill(String(synthetic.value));
      changed = true;
      resolutions.push(provenance(candidate, "synthetic", "resolved"));
    } catch {
      resolutions.push(provenance(candidate, "unresolved", "unresolved"));
    }
  }

  let retryAttempted = false;
  if (changed && input.retryDependentAction) {
    retryAttempted = true;
    await input.retryDependentAction();
  }
  return { resolutions, retryAttempted };
}
