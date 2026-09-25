"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSupportingAutofill = resolveSupportingAutofill;
const supporting_candidate_analyzer_1 = require("../discovery/supporting-candidate-analyzer");
const synthetic_value_resolver_1 = require("../data/synthetic-value-resolver");
const runtime_field_capability_1 = require("./runtime-field-capability");
function strategyKind(kind) {
    return ["select", "radio", "checkbox", "combobox", "autocomplete", "date", "datetime", "datepicker", "multiselect"].includes(kind ?? "");
}
async function resolveDynamic(locator, kind) {
    if (kind === "select") {
        const value = await (0, runtime_field_capability_1.selectSupportingOption)(locator, { strategy: "first_valid" });
        await locator.selectOption(value);
        return true;
    }
    if (kind === "radio")
        return (0, runtime_field_capability_1.selectSupportingRadio)(locator, { strategy: "first_valid" });
    if (kind === "checkbox")
        return (0, runtime_field_capability_1.ensureSupportingCheckbox)(locator, { strategy: "ensure_checked" });
    if (kind === "combobox")
        return (0, runtime_field_capability_1.selectSupportingCombobox)(locator, { strategy: "first_valid" });
    if (kind === "autocomplete")
        return (0, runtime_field_capability_1.selectSupportingAutocomplete)(locator, { strategy: "first_valid" });
    if (["date", "datetime", "datepicker"].includes(kind))
        return (0, runtime_field_capability_1.resolveSupportingDate)(locator, { strategy: "valid_in_range" });
    if (kind === "multiselect")
        return (0, runtime_field_capability_1.ensureSupportingMultiselect)(locator, { strategy: "ensure_valid_selection" });
    return false;
}
function provenance(result, source, outcome) {
    return { ...result, source, result: outcome };
}
async function resolveSupportingAutofill(input) {
    void input.page;
    const controlsForAnalysis = input.observedControls.map(({ locator: _locator, ...control }) => control);
    const candidates = (0, supporting_candidate_analyzer_1.analyzeSupportingCandidates)({
        runtimeRequirements: input.runtimeRequirements,
        observedControls: controlsForAnalysis,
        executionPlan: input.executionPlan,
        dependentAction: input.dependentAction,
    });
    const resolutions = [];
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
            const synthetic = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement, seed: `${String(input.executionSeed)}:${candidate.controlIdentity?.fingerprint ?? "unknown"}` });
            if (synthetic.status !== "generated") {
                resolutions.push(provenance(candidate, "unresolved", "unresolved"));
                continue;
            }
            await observed.locator.fill(String(synthetic.value));
            changed = true;
            resolutions.push(provenance(candidate, "synthetic", "resolved"));
        }
        catch {
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
