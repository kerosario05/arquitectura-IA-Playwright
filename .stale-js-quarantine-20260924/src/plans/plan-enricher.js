"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichExecutionPlanWithSnapshot = enrichExecutionPlanWithSnapshot;
const data_resolver_1 = require("../data/data-resolver");
const execution_plan_validator_1 = require("./execution-plan-validator");
const step_intent_classifier_1 = require("./step-intent-classifier");
const snapshot_step_matcher_1 = require("./snapshot-step-matcher");
const candidate_locator_adapter_1 = require("./candidate-locator-adapter");
function clonePlan(plan) {
    return JSON.parse(JSON.stringify(plan));
}
function bestLocatorOfElement(snapshotElement) {
    return [...snapshotElement.candidateLocators].sort((a, b) => b.confidence - a.confidence)[0];
}
function enrichExecutionPlanWithSnapshot(input) {
    const plan = clonePlan(input.plan);
    const decisions = [];
    let convertedSteps = 0;
    let resolvedData = 0;
    let missingData = 0;
    for (const required of plan.requiredData) {
        const resolution = (0, data_resolver_1.resolveDataForField)({ fieldName: required.key, label: required.reason }, input.dataContext, input.aliases, input.missingInputBehavior);
        if (resolution.status === "resolved") {
            required.resolved = true;
            required.sensitive = resolution.sensitive;
            required.source = resolution.matchedBy;
            resolvedData += 1;
            decisions.push({
                type: "required_data_resolved",
                message: `Required data key '${required.key}' resolved.`,
                dataKey: resolution.key,
                confidence: resolution.confidence
            });
        }
        else {
            required.resolved = false;
            missingData += 1;
            decisions.push({
                type: "required_data_missing",
                message: `Required data key '${required.key}' is missing.`,
                dataKey: required.key
            });
        }
    }
    for (const step of plan.steps) {
        if (step.action !== "noop") {
            continue;
        }
        const text = step.description ?? "";
        const intent = (0, step_intent_classifier_1.classifyStepIntent)(text);
        if (intent === "fill") {
            const best = (0, snapshot_step_matcher_1.findBestElementForStep)(text, input.snapshot, ["input", "textarea", "select"]);
            if (!best.element || best.confidence < 0.7) {
                decisions.push({
                    type: best.confidence > 0 ? "low_confidence" : "kept_noop",
                    stepIndex: step.index,
                    confidence: best.confidence,
                    message: "Could not confidently map fill step to element."
                });
                continue;
            }
            const locator = bestLocatorOfElement(best.element);
            if (!locator) {
                decisions.push({ type: "kept_noop", stepIndex: step.index, message: "Element has no candidate locators." });
                continue;
            }
            const dataResolution = (0, data_resolver_1.resolveDataForField)({
                fieldName: best.element.name,
                label: best.element.label,
                placeholder: best.element.placeholder,
                nearbyText: best.element.nearbyText,
                inputType: best.element.inputType
            }, input.dataContext, input.aliases, input.missingInputBehavior);
            if (dataResolution.status !== "resolved") {
                missingData += 1;
                decisions.push({
                    type: "required_data_missing",
                    stepIndex: step.index,
                    elementId: best.element.id,
                    message: "No data resolved for fill step field."
                });
                continue;
            }
            step.action = best.element.type === "select" ? "select" : "fill";
            step.target = (0, candidate_locator_adapter_1.candidateLocatorToPlanTarget)(locator);
            step.valueKey = dataResolution.key;
            step.evidence = true;
            convertedSteps += 1;
            decisions.push({
                type: "converted_noop_to_fill",
                stepIndex: step.index,
                elementId: best.element.id,
                dataKey: dataResolution.key,
                confidence: best.confidence,
                message: "NOOP step converted to fill/select action."
            });
            continue;
        }
        if (intent === "click") {
            const best = (0, snapshot_step_matcher_1.findBestElementForStep)(text, input.snapshot, ["button", "link", "card", "text"]);
            if (!best.element || best.confidence < 0.7) {
                decisions.push({
                    type: best.confidence > 0 ? "low_confidence" : "kept_noop",
                    stepIndex: step.index,
                    confidence: best.confidence,
                    message: "Could not confidently map click step to element."
                });
                continue;
            }
            const locator = bestLocatorOfElement(best.element);
            if (!locator) {
                decisions.push({ type: "kept_noop", stepIndex: step.index, message: "Element has no candidate locators." });
                continue;
            }
            step.action = "click";
            step.target = (0, candidate_locator_adapter_1.candidateLocatorToPlanTarget)(locator);
            step.evidence = true;
            convertedSteps += 1;
            decisions.push({
                type: "converted_noop_to_click",
                stepIndex: step.index,
                elementId: best.element.id,
                confidence: best.confidence,
                message: "NOOP step converted to click action."
            });
            continue;
        }
        if (intent === "assert") {
            const best = (0, snapshot_step_matcher_1.findBestElementForStep)(text, input.snapshot, ["heading", "text", "table", "dialog"]);
            if (!best.element || best.confidence < 0.65) {
                decisions.push({
                    type: "kept_noop",
                    stepIndex: step.index,
                    confidence: best.confidence,
                    message: "Could not confidently map assert step to element."
                });
                continue;
            }
            const locator = bestLocatorOfElement(best.element);
            if (!locator) {
                decisions.push({ type: "kept_noop", stepIndex: step.index, message: "Element has no candidate locators." });
                continue;
            }
            step.action = "assertVisible";
            step.target = (0, candidate_locator_adapter_1.candidateLocatorToPlanTarget)(locator);
            step.evidence = true;
            convertedSteps += 1;
            decisions.push({
                type: "converted_noop_to_assert",
                stepIndex: step.index,
                elementId: best.element.id,
                confidence: best.confidence,
                message: "NOOP step converted to assertVisible action."
            });
            continue;
        }
        if (intent === "wait") {
            step.action = "waitFor";
            step.timeoutMs = 1000;
            convertedSteps += 1;
            decisions.push({
                type: "converted_noop_to_assert",
                stepIndex: step.index,
                message: "NOOP step converted to waitFor action."
            });
            continue;
        }
        decisions.push({ type: "kept_noop", stepIndex: step.index, message: `Intent '${intent}' kept as noop.` });
    }
    const unresolvedNoopCount = plan.steps.filter((step) => step.action === "noop").length;
    let status = plan.status;
    if (missingData > 0 || plan.requiredData.some((entry) => entry.required && !entry.resolved)) {
        status = "needs_data";
    }
    else if (unresolvedNoopCount > 0) {
        status = "needs_discovery";
        decisions.push({ type: "needs_discovery", message: "Plan still contains unresolved noop steps." });
    }
    else {
        status = "validated";
    }
    plan.status = status;
    const validation = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    if (!validation.valid) {
        plan.status = "invalid";
        for (const issue of validation.issues) {
            decisions.push({
                type: issue.level === "error" ? "needs_discovery" : "low_confidence",
                stepIndex: issue.stepIndex,
                message: `${issue.code}: ${issue.message}`
            });
        }
    }
    return {
        plan,
        decisions,
        summary: {
            totalSteps: plan.steps.length,
            convertedSteps,
            unresolvedSteps: unresolvedNoopCount,
            resolvedData,
            missingData,
            needsDiscovery: plan.status === "needs_discovery" || plan.status === "invalid"
        }
    };
}
