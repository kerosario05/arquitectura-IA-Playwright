"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRecordingExecutionActionIndices = normalizeRecordingExecutionActionIndices;
exports.evaluateNegativeScenarioOracle = evaluateNegativeScenarioOracle;
exports.hydrateCanonicalInteractionsFromSemanticModel = hydrateCanonicalInteractionsFromSemanticModel;
exports.buildScenarioRuntimeDataset = buildScenarioRuntimeDataset;
exports.evaluateRecordedScenarioExecutionReadiness = evaluateRecordedScenarioExecutionReadiness;
exports.isMaskActivation = isMaskActivation;
exports.buildCanonicalInteractions = buildCanonicalInteractions;
exports.validateInteractionStateSequence = validateInteractionStateSequence;
exports.materializeRuntimeInputRequirements = materializeRuntimeInputRequirements;
exports.applyRuntimeDatasetValues = applyRuntimeDatasetValues;
exports.evaluateRecordingReadiness = evaluateRecordingReadiness;
exports.buildEntityActionBlocks = buildEntityActionBlocks;
exports.detectMutationOpportunities = detectMutationOpportunities;
exports.classifyRepeatFieldForClone = classifyRepeatFieldForClone;
exports.evaluateMutationPreconditionValidity = evaluateMutationPreconditionValidity;
exports.materializedSemanticSignature = materializedSemanticSignature;
exports.mutationEffectDiagnostics = mutationEffectDiagnostics;
exports.materializeScenarioMutation = materializeScenarioMutation;
exports.enrichRecordedScenarioContract = enrichRecordedScenarioContract;
exports.deriveExpectedRouteBefore = deriveExpectedRouteBefore;
exports.toSharedMcpScenario = toSharedMcpScenario;
const compound_value_1 = require("./compound-value");
const human_step_renderer_1 = require("./human-step-renderer");
/** Assigns runtime ordering at the structured-contract boundary. */
function normalizeRecordingExecutionActionIndices(actions) {
    return actions.map((action, index) => ({ ...action, stepIndex: index + 1 }));
}
function evaluateNegativeScenarioOracle(oracle, observation) {
    const reasons = [];
    if (observation.entityCount !== undefined && observation.entityCount !== oracle.expectedState.entityCount) {
        reasons.push("entity_count_mismatch");
    }
    if (observation.canSubmit !== undefined && observation.canSubmit !== oracle.expectedState.canSubmit) {
        reasons.push("submit_capability_mismatch");
    }
    if (observation.terminalActionApplicable !== undefined
        && observation.terminalActionApplicable !== oracle.terminalActionApplicable) {
        reasons.push("terminal_action_applicability_mismatch");
    }
    return { valid: reasons.length === 0, reasons };
}
/**
 * Rehydrates persisted canonical interactions with the semantic editing session that owns
 * their final value. This is a read-model migration: the trace and its capture events are
 * untouched, while old scenario JSON can still consume the same canonical authority as a
 * newly-derived scenario.
 */
function hydrateCanonicalInteractionsFromSemanticModel(scenario, model) {
    const persistedInteractions = scenario.canonicalInteractions;
    if (!persistedInteractions?.length)
        return scenario;
    const canonicalInteractions = persistedInteractions.map((interaction) => {
        if (interaction.action !== "fill")
            return interaction;
        const session = model.editingSessions.find((candidate) => candidate.editingSessionId === interaction.editingSessionRef)
            ?? model.editingSessions.find((candidate) => candidate.semanticField === interaction.semanticField
                && candidate.compoundRole === "amount_or_text")
            ?? model.editingSessions.find((candidate) => interaction.sourceEventRefs.some((ref) => candidate.rawEventRefs.includes(ref)));
        const value = clean(session?.finalValue) ?? clean(session?.committedValue);
        const selection = persistedInteractions.find((candidate) => candidate.action === "select"
            && candidate.entityScope === interaction.entityScope
            && candidate.semanticField === interaction.semanticField
            && clean(candidate.recordedValue));
        const logicalValue = (0, compound_value_1.logicalCompoundChildValue)(value, selection?.recordedValue)
            ?? (value === clean(selection?.recordedValue) ? undefined : value);
        return logicalValue === undefined ? interaction : { ...interaction, recordedValue: logicalValue };
    });
    // Older persisted projections could retain the trigger click while losing a
    // portalized option note during materialization. Rehydrate only the missing
    // canonical selection from the current semantic model; mutation-specific
    // interactions and their original IDs remain untouched.
    const missingSelections = scenario.mutation?.mutationType === "ALTERNATIVE_SELECTION"
        ? []
        : (model.canonicalInteractions ?? []).filter((candidate) => candidate.action === "select"
            && typeof candidate.recordedValue === "string"
            && !canonicalInteractions.some((existing) => existing.action === "select"
                && existing.entityScope === candidate.entityScope
                && existing.semanticField === candidate.semanticField
                && existing.recordedValue === candidate.recordedValue));
    for (const selection of missingSelections) {
        const triggerIndex = canonicalInteractions.findIndex((interaction) => interaction.entityScope === selection.entityScope
            && interaction.semanticField === selection.semanticField
            && ["click", "check", "uncheck"].includes(interaction.action));
        const nextInteractionIndex = canonicalInteractions.findIndex((interaction) => interaction.entityScope === selection.entityScope
            && triggerIndex >= 0
            && canonicalInteractions.indexOf(interaction) > triggerIndex
            && (interaction.action === "fill" || interaction.action === "select"));
        const insertionIndex = nextInteractionIndex >= 0 ? nextInteractionIndex : triggerIndex >= 0 ? triggerIndex + 1 : canonicalInteractions.length;
        const existingIds = new Set(canonicalInteractions.map((interaction) => interaction.id));
        const id = existingIds.has(selection.id) ? `${selection.id}:rehydrated` : selection.id;
        canonicalInteractions.splice(insertionIndex, 0, { ...selection, id });
    }
    const requiredData = [...scenario.requiredData];
    for (const selection of missingSelections) {
        if (!selection.valueKey || requiredData.some((field) => field.key === selection.valueKey))
            continue;
        requiredData.push({
            key: selection.valueKey,
            label: selection.semanticField ?? selection.valueKey,
            ...(selection.entityScope ? { entityScope: selection.entityScope } : {}),
            stepIndex: Math.max(0, scenario.testRailSteps.length - 1),
            technicalTargetRefs: [...selection.technicalTargetRefs],
            sourceEventRefs: [...selection.sourceEventRefs],
            exampleValue: selection.recordedValue,
            sensitive: false,
            valueRole: "action_input",
            source: "RECORDED_CONFIRMED",
            ...(selection.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) ? { validatedByInteraction: true } : {}),
        });
    }
    return { ...scenario, canonicalInteractions, requiredData };
}
function buildScenarioRuntimeDataset(scenario) {
    const requirements = scenario.runtimeInputRequirements?.length
        ? scenario.runtimeInputRequirements
        : materializeRuntimeInputRequirements(scenario);
    return {
        scenarioId: scenario.scenarioId,
        requirements,
        resolvedValues: Object.fromEntries(requirements.filter((requirement) => requirement.resolved && typeof requirement.value === "string").map((requirement) => [requirement.valueKey, requirement.value])),
        missingValues: requirements.filter((requirement) => requirement.required && !requirement.resolved),
    };
}
/**
 * Authoritative execution audit for recorded scenarios. TestRail publication deliberately
 * does not use this result; the replay/spec entry point does.
 */
function evaluateRecordedScenarioExecutionReadiness(scenario) {
    const interactions = (scenario.canonicalInteractions ?? []).filter((interaction) => !interaction.technicalOnly
        && interaction.action !== "system_observation"
        && interaction.action !== "navigation");
    const requirements = new Map((scenario.runtimeInputRequirements ?? []).map((requirement) => [requirement.valueKey, requirement]));
    // `readiness` is a persisted projection and may be stale after a materialization repair.
    // The state timeline is the authority for this auditor; do not let an old technical flag
    // turn a valid state sequence into a blocker.
    const stateReady = scenario.stateSequenceValid !== false;
    const requirementForInteraction = (interaction) => {
        if (!interaction.valueKey)
            return undefined;
        const exact = requirements.get(interaction.valueKey);
        if (exact)
            return exact;
        const comparable = comparableValueKey(interaction.valueKey);
        return [...requirements.values()].find((requirement) => comparableValueKey(requirement.valueKey) === comparable);
    };
    const actions = interactions.map((interaction) => {
        const targetCount = (interaction.technicalTargetCandidates?.length ?? 0) || interaction.technicalTargetRefs.length;
        const reResolutionPossible = (interaction.technicalTargetCandidates ?? []).some((candidate) => candidate.locatorCandidates.length > 0
            && Boolean(candidate.structuralContext || candidate.stableAttributes)) || interaction.technicalTargetRefs.length > 0;
        const requirement = requirementForInteraction(interaction);
        const requiresRuntimeValue = interaction.action === "fill" || interaction.action === "select";
        const runtimeValueResolved = !requiresRuntimeValue
            || !interaction.valueKey
            || Boolean(requirement?.resolved && requirement.value !== null)
            || typeof interaction.recordedValue === "string";
        const blockReasons = [];
        if (targetCount === 0)
            blockReasons.push("missing_technical_target");
        if (!reResolutionPossible)
            blockReasons.push("no_structural_reresolution_strategy");
        if (!runtimeValueResolved)
            blockReasons.push(`unresolved_runtime_value:${interaction.valueKey}`);
        if (!stateReady)
            blockReasons.push("state_sequence_invalid");
        return {
            actionId: interaction.id,
            actionType: interaction.action,
            ...(interaction.semanticField ? { semanticField: interaction.semanticField } : {}),
            ...(interaction.valueKey ? { valueKey: interaction.valueKey } : {}),
            runtimeValueResolved,
            technicalTargetCount: targetCount,
            reResolutionPossible,
            stateCompatible: stateReady,
            ready: blockReasons.length === 0,
            blockReasons,
        };
    });
    const readyActions = actions.filter((action) => action.ready).length;
    const compoundReady = !scenario.mutationDiagnostics?.rejectionReason;
    const mutationReady = !scenario.mutationDiagnostics?.rejectionReason;
    const functionalReady = scenario.testRailSteps.length > 0;
    const dataReady = scenario.readiness?.dataReadiness !== false && actions.every((action) => action.runtimeValueResolved);
    const technicalReady = actions.every((action) => action.technicalTargetCount > 0 && action.reResolutionPossible);
    const blockReasons = [...new Set([
            ...actions.flatMap((action) => action.blockReasons),
            ...(!compoundReady ? [scenario.mutationDiagnostics?.rejectionReason ?? "mutation_contract_invalid"] : []),
            ...(!mutationReady ? [scenario.mutationDiagnostics?.rejectionReason ?? "mutation_contract_invalid"] : []),
        ])];
    const executionReady = functionalReady && dataReady && technicalReady && stateReady && compoundReady && mutationReady;
    return {
        functionalReady,
        dataReady,
        technicalReady,
        stateReady,
        compoundReady,
        mutationReady,
        executionReady,
        technicalCoveragePercent: actions.length === 0 ? 100 : Math.round((readyActions / actions.length) * 100),
        actions,
        blockReasons,
    };
}
function entityScopeOfTarget(target) {
    if (target?.entityScope?.trim())
        return target.entityScope.trim();
    if (target?.gridRef && (target.rowIdentity || target.rowRef))
        return "entity_1";
    return undefined;
}
function clean(value) {
    const result = value?.trim();
    return result || undefined;
}
function keyPart(value) {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "campo";
}
function scopeOf(target) {
    return entityScopeOfTarget(target);
}
function fieldOf(target) {
    return clean(target?.associatedField ?? target?.headerContext ?? target?.label);
}
function stableControlOf(event) {
    const target = event.target;
    return [event.screenKey, target?.gridRef, scopeOf(target), target?.cellRef, fieldOf(target), target?.locators?.[0]?.strategy, target?.locators?.[0]?.value]
        .filter(Boolean)
        .join("|") || `event-${event.seq + 1}`;
}
function selectorControlOf(event, target) {
    if (!target || target.compoundRole !== "selection")
        return undefined;
    return target.eventTargetRef
        ?? target.cellRef
        ?? target.currentTargetRef
        ?? `${event.screenKey}|${target.gridRef ?? ""}|${scopeOf(target) ?? ""}|${fieldOf(target) ?? target.label}`;
}
function actionEvent(event) {
    return ["tap", "fill", "navigate", "back"].includes(event.kind);
}
function stateScopeOf(event, target) {
    const parts = [
        event.screenKey,
        target?.containerIdentity,
        target?.gridRef,
        target?.rowIdentity ?? target?.rowRef,
        target?.cellRef,
        entityScopeOfTarget(target),
    ].filter((part) => Boolean(part?.trim()));
    return parts.length > 0 ? parts.join("|") : undefined;
}
function transitionAfter(events, index) {
    for (let cursor = index + 1; cursor < events.length; cursor += 1) {
        const candidate = events[cursor];
        if (candidate.kind === "screen_change" && candidate.toScreenKey && candidate.toScreenKey !== candidate.screenKey) {
            return { event: candidate };
        }
        if (candidate.kind === "navigate" && candidate.url && events[index].url && candidate.url !== events[index].url) {
            return { event: candidate };
        }
        if (actionEvent(candidate))
            return { nextActionIndex: cursor };
    }
    return {};
}
function ownershipForEvent(events, index) {
    const event = events[index];
    const target = event.target;
    const transition = transitionAfter(events, index);
    const transitionEvent = transition.event;
    const screenAfterRef = transitionEvent?.toScreenKey
        ?? (transitionEvent?.kind === "navigate" ? transitionEvent.screenKey : undefined);
    const routeAfter = transitionEvent?.url;
    const changed = Boolean(screenAfterRef && screenAfterRef !== event.screenKey)
        || Boolean(routeAfter && event.url && routeAfter !== event.url);
    return {
        screenBeforeRef: event.screenKey,
        ...(changed && screenAfterRef ? { screenAfterRef } : { screenAfterRef: event.screenKey }),
        ...(event.url ? { routeBefore: event.url } : {}),
        ...(changed && routeAfter ? { routeAfter } : {}),
        ...(target?.containerIdentity ? { containerRef: target.containerIdentity } : {}),
        ...(target?.gridRef ? { gridRef: target.gridRef } : {}),
        ...(stateScopeOf(event, target) ? { stateScope: stateScopeOf(event, target) } : {}),
        ...(changed ? { transitionObserved: true, causedTransition: true, terminalForContext: true } : {}),
    };
}
function isDerivedDisplayClick(events, index) {
    const event = events[index];
    if (event.kind !== "tap" || event.target?.interactionType === "select" || event.target?.afterValue !== undefined)
        return false;
    const target = event.target;
    if (!target)
        return false;
    const priorInput = [...events.slice(Math.max(0, index - 25), index)].reverse()
        .find((candidate) => candidate.kind === "fill" && candidate.screenKey === event.screenKey && candidate.target?.associatedField && event.t - candidate.t <= 15_000);
    const noDelta = !target.stateDelta || Object.values(target.stateDelta).every((value) => value === undefined || value === false || value === "");
    const noMeaningfulAfterState = !target.afterState || (!target.afterState.value && !target.afterState.committedValue && target.afterState.selected !== true);
    const targetLooksLikeUserControl = target.role?.toLowerCase() === "button"
        || target.role?.toLowerCase() === "checkbox"
        || target.interactionType === "select";
    const targetLooksDerived = event.valueSource === "application"
        || (!targetLooksLikeUserControl && priorInput && target.label && target.label !== priorInput.target?.label && target.label.length > 20 && !target.locators.some((locator) => locator.strategy === "label"));
    return Boolean(priorInput && targetLooksDerived && noDelta && noMeaningfulAfterState);
}
function isMaskActivation(events, index) {
    const event = events[index];
    if (event.kind !== "tap" || isSelection(event) || !event.target)
        return false;
    const mask = event.target.placeholder ?? event.target.label;
    if (!mask || !/^[0-9x#*a]+(?:[\s./_:-][0-9x#*a]+)+$/i.test(mask))
        return false;
    const field = fieldOf(event.target);
    const scope = scopeOf(event.target);
    const nextFill = events.slice(index + 1, index + 20).find((candidate) => candidate.kind === "fill"
        && candidate.screenKey === event.screenKey
        && fieldOf(candidate.target) === field
        && scopeOf(candidate.target) === scope);
    const hasDelta = Object.values(event.target.stateDelta ?? {}).some((value) => value !== undefined && value !== false && value !== "");
    return Boolean(nextFill && !hasDelta && !event.target.afterValue);
}
function isSelection(event) {
    return event.kind === "tap"
        && (event.target?.interactionType === "select"
            || event.target?.compoundRole === "selection"
            || event.target?.afterValue !== undefined
            || event.target?.dynamicLifecycle?.selectedOption !== undefined);
}
function checkboxAction(target) {
    const ariaChecked = target?.afterState?.aria?.["aria-checked"];
    if (target?.afterState?.selected === false || ariaChecked === "false" || target?.stateDelta?.checked === false)
        return "uncheck";
    return "check";
}
function logicalValue(event, editingSessions = [], compoundSelectionValue) {
    const target = event.target;
    const eventRef = `event-${event.seq + 1}`;
    const editingSession = editingSessions.find((session) => session.editingSessionId === target?.editingSessionRef)
        ?? editingSessions.find((session) => session.semanticField === fieldOf(target)
            && session.compoundRole === target?.compoundRole)
        ?? editingSessions.find((session) => session.rawEventRefs.includes(eventRef));
    if (editingSession?.finalValue !== undefined) {
        return (0, compound_value_1.logicalCompoundChildValue)(editingSession.finalValue, compoundSelectionValue)
            ?? (target?.compoundRole === "amount_or_text" && compoundSelectionValue ? undefined : clean(editingSession.finalValue));
    }
    // Amount editors expose a logical child value separately from the formatted compound
    // display. The recorder's rawTypedValue is already the child session value; using the
    // parent display here would reintroduce the currency prefix into the amount dataset.
    if (target?.compoundRole === "amount_or_text"
        && /^(?:[A-Z]{3})\s+\d/.test(target.rawTypedValue ?? target.committedValue ?? target.afterValue ?? ""))
        return undefined;
    if (target?.compoundRole === "amount_or_text" && clean(target.rawTypedValue)) {
        return (0, compound_value_1.logicalCompoundChildValue)(target.rawTypedValue, compoundSelectionValue)
            ?? (compoundSelectionValue ? undefined : clean(target.rawTypedValue));
    }
    return clean(target?.committedValue)
        ?? clean(target?.afterState?.committedValue)
        ?? clean(target?.rawTypedValue)
        ?? clean(target?.inputValue)
        ?? clean(event.value);
}
/** Converts normalized events to the stable interaction vocabulary used by all downstream consumers. */
function buildCanonicalInteractions(events, editingSessions = []) {
    const result = [];
    for (const [index, event] of events.entries()) {
        const target = event.target;
        if (event.kind === "note" || event.kind === "launch" || event.kind === "screen_change")
            continue;
        if (event.kind === "navigate" || event.kind === "back") {
            const ownership = ownershipForEvent(events, index);
            result.push({
                id: `interaction-${index + 1}`,
                controlIdentity: stableControlOf(event),
                action: "navigation",
                sourceEventRefs: [`event-${index + 1}`],
                technicalTargetRefs: target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`) ?? [],
                description: target?.label ? `Presionar "${target.label}"` : undefined,
                ...ownership,
                technicalOnly: true,
                confidence: 0.9,
            });
            continue;
        }
        if (event.kind !== "tap" && event.kind !== "fill")
            continue;
        if (isMaskActivation(events, index))
            continue;
        const selection = isSelection(event);
        const derivedDisplayClick = isDerivedDisplayClick(events, index);
        const action = selection
            ? "select"
            : event.kind === "fill"
                ? "fill"
                : target?.role?.toLowerCase() === "checkbox"
                    ? checkboxAction(target)
                    : "click";
        const value = selection
            ? clean(target?.afterValue ?? target?.dynamicLifecycle?.selectedOption)
            : logicalValue(event, editingSessions, (0, compound_value_1.confirmedCompoundSelectionBefore)(events, index, target));
        const semanticField = fieldOf(target);
        const scope = scopeOf(target);
        const valueKey = semanticField
            ? `${scope ? `${scope}.` : ""}${keyPart(semanticField)}${selection ? "_seleccion" : target?.compoundRole === "amount_or_text" ? "_valor" : ""}`
            : undefined;
        const ownership = ownershipForEvent(events, index);
        result.push({
            id: `interaction-${index + 1}`,
            controlIdentity: stableControlOf(event),
            ...(semanticField ? { semanticField } : {}),
            ...(scope ? { entityScope: scope } : {}),
            action,
            ...(valueKey ? { valueKey } : {}),
            ...(value ? { recordedValue: value } : {}),
            ...(event.kind === "fill" && target?.rawTypedValue ? { rawTypedValue: target.rawTypedValue } : {}),
            ...(target?.committedValue ? { committedValue: target.committedValue } : {}),
            ...(target?.displayValue ? { displayValue: target.displayValue } : {}),
            sourceEventRefs: [`event-${index + 1}`],
            technicalTargetRefs: target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`) ?? [],
            ...(target?.editingSessionRef ? { editingSessionRef: target.editingSessionRef } : {}),
            ...(selectorControlOf(event, target) ? {
                selectorControlId: selectorControlOf(event, target),
                optionSurfaceId: `${event.screenKey}|${selectorControlOf(event, target)}|option-surface`,
            } : {}),
            ...(target?.observedOptions?.length ? { observedOptions: [...new Set(target.observedOptions)] } : {}),
            ...(target?.technicalTargetCandidates?.length ? { technicalTargetCandidates: target.technicalTargetCandidates } : {}),
            ...(target?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) ? { validatedByInteraction: true } : {}),
            ...(target?.label ? { description: action === "select" ? `Seleccionar en "${semanticField ?? target.label}"` : `Ingresar en "${semanticField ?? target.label}"` } : {}),
            ...ownership,
            ...(derivedDisplayClick ? { technicalOnly: true, postGoalObservation: true } : {}),
            confidence: target?.locators?.[0]?.confidence ?? 0.7,
        });
    }
    // A focus/pointer trace may report the same committed option more than once. Keep a
    // functional selection once per stable control/value/lifecycle while retaining every raw note.
    const deduped = [];
    for (const interaction of result) {
        if (interaction.action === "select") {
            const duplicate = deduped.find((candidate) => candidate.action === "select"
                && candidate.controlIdentity === interaction.controlIdentity
                && candidate.entityScope === interaction.entityScope
                && candidate.recordedValue === interaction.recordedValue
                && !candidate.transitionObserved && !interaction.transitionObserved);
            if (duplicate) {
                duplicate.sourceEventRefs = [...new Set([...duplicate.sourceEventRefs, ...interaction.sourceEventRefs])];
                duplicate.technicalTargetRefs = [...new Set([...duplicate.technicalTargetRefs, ...interaction.technicalTargetRefs])];
                continue;
            }
        }
        deduped.push(interaction);
    }
    return deduped;
}
function validateInteractionStateSequence(interactions) {
    // Navigation/state-transition evidence is part of the reachability proof even though it is
    // not a user step. It must bridge route A -> loading -> route B for the next real action.
    const executable = interactions.filter((interaction) => interaction.action !== "system_observation"
        && (!interaction.technicalOnly || interaction.action === "navigation"));
    const issues = [];
    for (let index = 1; index < executable.length; index += 1) {
        const previous = executable[index - 1];
        const current = executable[index];
        const sameRoute = !previous.routeAfter || !current.routeBefore || previous.routeAfter === current.routeBefore;
        if (previous.screenAfterRef && current.screenBeforeRef && previous.screenAfterRef !== current.screenBeforeRef && !sameRoute) {
            issues.push(`${previous.id}:${previous.screenAfterRef}->${current.id}:${current.screenBeforeRef}`);
            continue;
        }
        if (previous.routeAfter && current.routeBefore && previous.routeAfter !== current.routeBefore) {
            issues.push(`${previous.id}:${previous.routeAfter}->${current.id}:${current.routeBefore}`);
        }
    }
    return { stateSequenceValid: issues.length === 0, stateSequenceIssues: issues };
}
function requirementFromField(field, canonical, canonicalValueOverride) {
    const persistedValue = clean(field.exampleValue) ?? null;
    const derived = field.valueRole === "runtime_derived_oracle";
    const canonicalValue = canonicalValueOverride !== undefined
        ? canonicalValueOverride === null ? null : clean(canonicalValueOverride) ?? null
        : clean(canonical?.recordedValue) ?? clean(canonical?.committedValue) ?? null;
    const value = canonicalValue ?? persistedValue;
    const canonicalAuthority = clean(canonical?.recordedValue)
        ? "canonical_logical"
        : canonicalValue
            ? "canonical_committed"
            : undefined;
    const datasetAuthorityMismatch = Boolean(canonicalValue !== null
        && persistedValue !== null
        && persistedValue.trim().toLocaleLowerCase() !== canonicalValue.trim().toLocaleLowerCase());
    return {
        valueKey: field.key,
        semanticField: field.semanticField ?? field.label ?? null,
        ...(field.entityScope ? { entityScope: field.entityScope } : {}),
        valueRole: field.valueRole ?? (field.sensitive ? "secure_input" : "action_input"),
        required: !derived,
        value,
        source: derived ? "RECORDED_CONFIRMED" : value === null ? "unresolved" : field.source === "secure" ? "secure" : "RECORDED_CONFIRMED",
        resolved: derived || value !== null,
        sensitive: field.sensitive,
        stepIndex: field.stepIndex,
        ...(field.formatHint ? { controlType: field.formatHint } : {}),
        ...(field.constraints?.length ? { constraints: field.constraints } : {}),
        ...(field.allowedValues?.length ? { allowedValues: [...field.allowedValues] } : {}),
        ...(field.validatedByInteraction ? { validatedByInteraction: true } : {}),
        readOnly: derived,
        editable: !derived && value === null,
        ...(canonicalAuthority ? { authority: canonicalAuthority, authorityValue: canonicalValue, datasetAuthorityMismatch } : {
            authority: value === null ? "unresolved" : "recorded_confirmed",
            authorityValue: null,
            datasetAuthorityMismatch: false,
        }),
    };
}
function comparableValueKey(valueKey) {
    return valueKey.replace(/_valor$/, "");
}
function canonicalForField(field, interactions) {
    const exact = interactions.find((interaction) => interaction.valueKey === field.key && (interaction.action === "fill" || interaction.action === "select"));
    if (exact)
        return exact;
    const comparable = comparableValueKey(field.key);
    return interactions.find((interaction) => {
        if (interaction.action !== "fill" && interaction.action !== "select")
            return false;
        const interactionKey = interaction.valueKey ? comparableValueKey(interaction.valueKey) : "";
        if (interactionKey && interactionKey === comparable)
            return true;
        return Boolean(interaction.entityScope === field.entityScope
            && interaction.semanticField
            && field.semanticField
            && interaction.semanticField === field.semanticField);
    });
}
function canonicalLogicalValueForField(field, interactions) {
    const canonical = canonicalForField(field, interactions);
    if (!canonical)
        return undefined;
    const value = clean(canonical.recordedValue) ?? clean(canonical.committedValue);
    if (canonical.action !== "fill" || !canonical.valueKey?.endsWith("_valor"))
        return value;
    const selection = interactions.find((interaction) => interaction.action === "select"
        && interaction.entityScope === canonical.entityScope
        && interaction.semanticField === canonical.semanticField
        && clean(interaction.recordedValue));
    if (!selection)
        return value;
    // A compound amount is authoritative only as the child value. If the source
    // exposes only an aggregate, keep it unresolved rather than promoting display text.
    return (0, compound_value_1.logicalCompoundChildValue)(value, selection.recordedValue)
        ?? (value === clean(selection.recordedValue) ? null : value);
}
function materializeRuntimeInputRequirements(scenario) {
    const byKey = new Map();
    const scopedSuffixes = new Set(scenario.requiredData
        .map((field) => field.key)
        .filter((key) => key.includes("."))
        .map((key) => key.slice(key.indexOf(".") + 1)));
    for (const field of scenario.requiredData) {
        // Old persisted scenarios could contain both `field` and `entity_1.field`. Once the
        // scoped canonical key exists, the unscoped entry is a migration alias, not another
        // logical runtime input.
        if (!field.key.includes(".") && scopedSuffixes.has(field.key))
            continue;
        const interactions = scenario.canonicalInteractions ?? [];
        const requirement = requirementFromField(field, canonicalForField(field, interactions), canonicalLogicalValueForField(field, interactions));
        if (requirement.valueRole === "runtime_derived_oracle" && !requirement.readOnly)
            continue;
        const previous = byKey.get(requirement.valueKey);
        if (!previous) {
            byKey.set(requirement.valueKey, requirement);
            continue;
        }
        byKey.set(requirement.valueKey, {
            ...previous,
            value: previous.value ?? requirement.value,
            resolved: previous.resolved || requirement.resolved,
            source: previous.resolved ? previous.source : requirement.source,
            technicalTargetRefs: [...new Set([...(previous.technicalTargetRefs ?? []), ...(requirement.technicalTargetRefs ?? [])])],
            sourceEventRefs: [...new Set([...(previous.sourceEventRefs ?? []), ...(requirement.sourceEventRefs ?? [])])],
            validatedByInteraction: previous.validatedByInteraction || requirement.validatedByInteraction,
            authority: previous.authority ?? requirement.authority,
            authorityValue: previous.authorityValue ?? requirement.authorityValue,
            datasetAuthorityMismatch: previous.datasetAuthorityMismatch || requirement.datasetAuthorityMismatch,
            constraints: previous.constraints ?? requirement.constraints,
        });
    }
    return [...byKey.values()];
}
/** Applies the single QA dataset authority and recalculates all readiness dimensions. */
function applyRuntimeDatasetValues(scenario, values) {
    const persistedValues = scenario.runtimeDataset?.resolvedValues ?? {};
    const persistedQaValues = Object.fromEntries((scenario.runtimeInputRequirements ?? [])
        .filter((requirement) => requirement.authority === "explicit_qa_edit" && typeof requirement.value === "string")
        .map((requirement) => [requirement.valueKey, requirement.value]));
    const repeatLineageValues = scenario.mutation?.mutationType === "REPEAT_ENTITY"
        ? Object.fromEntries((scenario.runtimeInputRequirements ?? [])
            .filter((requirement) => requirement.sourceValueKey && persistedValues[requirement.sourceValueKey] !== undefined)
            .map((requirement) => [requirement.valueKey, persistedValues[requirement.sourceValueKey]]))
        : {};
    // A derived repeat scenario may already contain a confirmed base dataset. Preserve that
    // authority for the source entity and its clones; canonical capture values remain the
    // authority for the primary scenario and for explicit QA edits.
    // Explicit QA edits outrank cloned lineage on every rehydration. The lineage remains
    // the fallback only until QA supplies the editable target value.
    const effectiveValues = { ...(scenario.mutation?.mutationType === "REPEAT_ENTITY" ? persistedValues : {}), ...repeatLineageValues, ...persistedQaValues, ...values };
    const requiredData = scenario.requiredData.map((field) => {
        if (effectiveValues[field.key] !== undefined)
            return { ...field, exampleValue: effectiveValues[field.key], source: "RECORDED_CONFIRMED" };
        const canonicalValue = canonicalLogicalValueForField(field, scenario.canonicalInteractions ?? []) ?? null;
        return canonicalValue === null ? field : { ...field, exampleValue: canonicalValue, source: "RECORDED_CONFIRMED" };
    });
    const materializedRequirements = materializeRuntimeInputRequirements({ ...scenario, requiredData });
    const existingLineage = new Map((scenario.runtimeInputRequirements ?? []).map((requirement) => [requirement.valueKey, requirement]));
    const runtimeInputRequirements = materializedRequirements.map((requirement) => {
        const lineage = existingLineage.get(requirement.valueKey);
        const withLineage = lineage ? {
            ...requirement,
            ...(lineage.sourceValueKey ? { sourceValueKey: lineage.sourceValueKey } : {}),
            ...(lineage.sourceAuthority ? { sourceAuthority: lineage.sourceAuthority } : {}),
            ...(lineage.repeatCloneDisposition ? { repeatCloneDisposition: lineage.repeatCloneDisposition } : {}),
            ...(lineage.authority ? { authority: lineage.authority } : {}),
            ...(lineage.authorityValue !== undefined ? { authorityValue: lineage.authorityValue } : {}),
        } : requirement;
        const explicitQaEdit = values[requirement.valueKey] !== undefined || withLineage.authority === "explicit_qa_edit";
        return effectiveValues[requirement.valueKey] === undefined ? withLineage : {
            ...withLineage,
            value: effectiveValues[requirement.valueKey] ?? null,
            source: (explicitQaEdit ? "QA_EDIT" : requirement.source === "secure" ? "secure" : "RECORDED_CONFIRMED"),
            resolved: effectiveValues[requirement.valueKey] !== undefined,
            authority: values[requirement.valueKey] !== undefined || withLineage.authority === "explicit_qa_edit"
                ? "explicit_qa_edit"
                : "recorded_confirmed",
            authorityValue: effectiveValues[requirement.valueKey] ?? null,
            editable: explicitQaEdit || withLineage.editable === true || withLineage.authority === "unresolved",
            ...(explicitQaEdit && withLineage.entityScope && scenario.mutation?.mutationType === "REPEAT_ENTITY"
                ? { sourceAuthority: "EXPLICIT_MUTATION" }
                : {}),
            datasetAuthorityMismatch: false,
        };
    });
    const uniqueConstraintResolutions = scenario.mutation?.mutationType === "REPEAT_ENTITY"
        ? revalidateRepeatUniqueConstraints(runtimeInputRequirements, scenario.repeatConstraintResolutions ?? [])
        : { requirements: runtimeInputRequirements, resolutions: scenario.repeatConstraintResolutions ?? [], valid: true };
    const validatedRuntimeInputRequirements = uniqueConstraintResolutions.requirements;
    const readiness = evaluateRecordingReadiness({
        functionalReadiness: scenario.functionalReadiness !== false && scenario.testRailSteps.length > 0,
        technicalReadiness: scenario.technicalReadiness !== false && !scenario.hasUncertainSteps,
        oracleReadiness: scenario.oracleAuthority !== "review_required"
            || (scenario.reviewStatus === "APPROVED" && Boolean(scenario.reviewedExpectedResult?.trim())),
        runtimeInputRequirements: validatedRuntimeInputRequirements,
        publicationRequiresOracle: true,
    });
    const valuesByKey = new Map(validatedRuntimeInputRequirements
        .filter((requirement) => typeof requirement.value === "string")
        .map((requirement) => [requirement.valueKey, requirement.value]));
    const testRailSteps = scenario.testRailSteps.map((step) => {
        if (!step.valueKey)
            return step;
        const value = valuesByKey.get(step.valueKey);
        if (value === undefined)
            return step;
        const template = step.stepTemplate ?? step.content;
        return { ...step, renderedStep: (0, human_step_renderer_1.renderHumanStepValue)(template, step.valueKey, value) };
    });
    const existingDiagnostics = scenario.mutationDiagnostics;
    const mutationDiagnostics = scenario.mutation?.mutationType === "REPEAT_ENTITY"
        ? {
            ...existingDiagnostics,
            ...(uniqueConstraintResolutions.valid && existingDiagnostics?.rejectionReason === "RUNTIME_DATA_CONSTRAINT_VIOLATION"
                ? { rejectionReason: undefined }
                : !uniqueConstraintResolutions.valid
                    ? { rejectionReason: "RUNTIME_DATA_CONSTRAINT_VIOLATION" }
                    : {}),
        }
        : existingDiagnostics;
    const mutationRejected = Boolean(mutationDiagnostics?.rejectionReason);
    const effectfulReadiness = mutationRejected
        ? { ...readiness, publicationContentReadiness: false, publicationReadiness: false }
        : readiness;
    const runtimeExecutionBlockedByData = scenario.mutation?.mutationType === "REPEAT_ENTITY"
        && (!uniqueConstraintResolutions.valid || validatedRuntimeInputRequirements.some((requirement) => requirement.required && !requirement.resolved));
    return {
        ...scenario,
        requiredData,
        runtimeInputRequirements: validatedRuntimeInputRequirements,
        runtimeDataset: buildScenarioRuntimeDataset({ ...scenario, requiredData, runtimeInputRequirements: validatedRuntimeInputRequirements }),
        testRailSteps,
        readiness: effectfulReadiness,
        functionalReadiness: effectfulReadiness.functionalReadiness,
        technicalReadiness: effectfulReadiness.technicalReadiness,
        ...(scenario.mutation?.mutationType === "REPEAT_ENTITY" ? {
            mutationDiagnostics,
            repeatConstraintResolutions: uniqueConstraintResolutions.resolutions,
            runtimeExecutionBlockedByData,
            replayEligible: !mutationRejected,
        } : {}),
    };
}
/** Re-checks the runtime-supplied value against the active entity collection. */
function revalidateRepeatUniqueConstraints(requirements, existingResolutions) {
    const uniqueRequirements = requirements.filter((requirement) => (requirement.constraints ?? []).some(isUniqueWithinCollection));
    if (uniqueRequirements.length === 0)
        return { requirements: [...requirements], resolutions: [...existingResolutions], valid: true };
    const resolutions = existingResolutions.map((resolution) => ({ ...resolution }));
    let valid = true;
    const updated = requirements.map((requirement) => {
        const constraint = (requirement.constraints ?? []).find(isUniqueWithinCollection);
        if (!constraint)
            return requirement;
        const current = clean(requirement.value);
        const logicalKey = logicalFieldKey(requirement.valueKey);
        const activeValues = new Set(requirements
            .filter((candidate) => candidate.valueKey !== requirement.valueKey && logicalFieldKey(candidate.valueKey) === logicalKey)
            .map((candidate) => clean(candidate.value))
            .filter((value) => Boolean(value))
            .map((value) => value.toLocaleLowerCase()));
        const distinct = Boolean(current) && !activeValues.has(current.toLocaleLowerCase());
        const previous = resolutions.find((resolution) => resolution.valueKey === requirement.valueKey);
        const nextResolution = {
            valueKey: requirement.valueKey,
            constraintType: constraint.type,
            activeValueCount: activeValues.size,
            candidateCount: current ? Math.max(1, previous?.candidateCount ?? 0) : previous?.candidateCount ?? 0,
            distinctCandidateCount: distinct ? 1 : 0,
            resolutionSource: requirement.authority === "explicit_qa_edit" ? "runtime_dataset" : previous?.resolutionSource ?? "none",
            resolved: distinct,
        };
        const index = resolutions.findIndex((resolution) => resolution.valueKey === requirement.valueKey);
        if (index >= 0)
            resolutions[index] = nextResolution;
        else
            resolutions.push(nextResolution);
        valid &&= distinct;
        return distinct
            ? { ...requirement, resolved: true, editable: requirement.editable ?? false }
            : {
                ...requirement,
                resolved: false,
                source: "unresolved",
                editable: true,
                authority: requirement.authority === "explicit_qa_edit" ? "explicit_qa_edit" : "unresolved",
                authorityValue: current,
                sourceAuthority: "UNRESOLVED",
            };
    });
    return { requirements: updated, resolutions, valid };
}
function evaluateRecordingReadiness(input) {
    const missingByKey = new Map();
    for (const requirement of input.runtimeInputRequirements) {
        if (requirement.required && !requirement.resolved && !missingByKey.has(requirement.valueKey))
            missingByKey.set(requirement.valueKey, requirement);
    }
    const missingInputs = [...missingByKey.values()];
    const mismatchByKey = new Map();
    for (const requirement of input.runtimeInputRequirements) {
        if (requirement.datasetAuthorityMismatch && !mismatchByKey.has(requirement.valueKey))
            mismatchByKey.set(requirement.valueKey, requirement);
    }
    const datasetAuthorityMismatches = [...mismatchByKey.values()];
    const dataReadiness = missingInputs.length === 0 && datasetAuthorityMismatches.length === 0;
    const runtimeDataRequired = missingInputs.some((requirement) => requirement.source === "unresolved"
        || requirement.authority === "unresolved"
        || requirement.sourceAuthority === "UNRESOLVED");
    const dataReadinessReasons = [
        ...missingInputs.map((requirement) => `missing_runtime_input:${requirement.valueKey}`),
        ...(runtimeDataRequired ? ["RUNTIME_DATA_REQUIRED"] : []),
        ...(datasetAuthorityMismatches.length > 0 ? ["dataset_authority_mismatch"] : []),
    ];
    const executionReadiness = input.functionalReadiness && dataReadiness && input.technicalReadiness;
    const publicationContentReadiness = input.publicationContentReadiness ?? input.functionalReadiness;
    return {
        functionalReadiness: input.functionalReadiness,
        dataReadiness,
        technicalReadiness: input.technicalReadiness,
        oracleReadiness: input.oracleReadiness,
        reviewReadiness: input.oracleReadiness,
        publicationContentReadiness,
        executionReadiness,
        publicationReadiness: input.functionalReadiness && dataReadiness && publicationContentReadiness,
        missingInputs,
        datasetAuthorityMismatches,
        dataReadinessReasons,
    };
}
function stepEntityScope(step) {
    const valueKey = clean(step.valueKey);
    return clean(step.entityScope) ?? (valueKey?.includes(".") ? clean(valueKey.split(".")[0]) : undefined);
}
function buildEntityActionBlocks(scenario, interactions, technicalKnowledgeRefs = []) {
    const scopes = new Set();
    scenario.requiredData.forEach((field) => { if (field.entityScope)
        scopes.add(field.entityScope); });
    scenario.testRailSteps.forEach((step) => { const scope = stepEntityScope(step); if (scope)
        scopes.add(scope); });
    return [...scopes].map((entityScope) => {
        const firstEntityIndex = interactions.findIndex((interaction) => interaction.entityScope === entityScope);
        const stateBoundary = firstEntityIndex >= 0
            ? interactions.findIndex((interaction, index) => index > firstEntityIndex && interaction.causedTransition)
            : -1;
        // Entity ownership is the form/context block, not every later row action in the
        // recording. A post-transition action remains in Primary but is not cloned into entity_2.
        const semanticActions = interactions.filter((interaction, index) => interaction.entityScope === entityScope
            && (stateBoundary < 0 || index <= stateBoundary));
        const dataRequirements = materializeRuntimeInputRequirements(scenario).filter((requirement) => requirement.entityScope === entityScope);
        const relevantRefs = new Set(semanticActions.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => {
            const match = ref.match(/^event-(\d+)$/);
            return match ? `obs-${match[1]}` : ref;
        })));
        return {
            entityScope,
            semanticActions,
            dataRequirements: dataRequirements.filter((requirement) => requirement.valueRole !== "runtime_derived_oracle"),
            runtimeDerivedOracles: dataRequirements.filter((requirement) => requirement.valueRole === "runtime_derived_oracle"),
            technicalKnowledgeRefs: technicalKnowledgeRefs.filter((ref) => relevantRefs.has(ref)),
        };
    });
}
function hasRepeatEvidence(model) {
    const repeatLabel = /repeat|repetir|\badd\b|agregar|a\u00f1adir|anadir|another|\botro\b|duplicar/i;
    const technical = model?.technicalObservations.some((observation) => {
        const label = observation.label?.trim() ?? "";
        const text = [label, observation.associatedField, ...(observation.dynamicLifecycle?.mutationSummary ?? [])].filter(Boolean).join(" ");
        return (label.length <= 80 || Boolean(observation.associatedField && observation.associatedField.length <= 80))
            && repeatLabel.test(text);
    });
    const components = model?.semanticComponents.some((component) => (component.label?.length ?? 0) <= 80 && repeatLabel.test(component.label ?? ""));
    return Boolean(technical || components);
}
function humanizeGoal(value) {
    const words = value.trim().replace(/[_.\/-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Recorrido grabado";
}
function humanMutationTitle(primary, mutationType, entityType, alternativeValue) {
    const goal = humanizeGoal(primary.scenarioGoal?.trim() || primary.title.trim());
    const subject = humanizeGoal(entityType?.trim() || "entidades");
    if (mutationType === "REPEAT_ENTITY")
        return `${goal}: registrar varias ${subject.toLowerCase()} en un mismo proceso`;
    if (mutationType === "ZERO_ENTITY")
        return `${goal}: comprobar el proceso sin registrar ${subject.toLowerCase()}`;
    if (mutationType === "ALTERNATIVE_SELECTION" && alternativeValue?.trim())
        return `${goal}: registrar usando ${alternativeValue.trim()}`;
    if (mutationType === "ALTERNATIVE_SELECTION")
        return `${goal}: comprobar una opción observada alternativa`;
    if (mutationType === "FIELD_OMISSION")
        return `${goal}: comprobar la omisión de un dato`;
    return `${goal}: comprobar una variante del proceso`;
}
function detectMutationOpportunities(primary, model) {
    const blocks = primary.entityActionBlocks ?? [];
    const opportunities = [];
    const primaryEvents = primary.sourceEventRefs ?? [];
    if (blocks.length > 0 && hasRepeatEvidence(model)) {
        const source = blocks[0];
        const repeatLabel = /repeat|repetir|\badd\b|agregar|a\u00f1adir|anadir|another|\botro\b|duplicar/i;
        const sourceScreen = source.semanticActions.at(-1)?.screenBeforeRef;
        const affordance = model?.technicalObservations.find((observation) => observation.screenIdentity === sourceScreen
            && (observation.label?.length ?? 0) <= 80
            && Boolean(observation.locatorCandidates.length)
            && repeatLabel.test(observation.label ?? ""))
            ?? model?.technicalObservations.find((observation) => (observation.label?.length ?? 0) <= 80
                && Boolean(observation.locatorCandidates.length)
                && repeatLabel.test(observation.label ?? ""))
            ?? model?.technicalObservations.find((observation) => (observation.associatedField?.length ?? 0) <= 80
                && Boolean(observation.locatorCandidates.length)
                && repeatLabel.test(observation.associatedField ?? ""));
        const repeatAction = {
            id: `repeat-affordance-${affordance?.observationId ?? "observed"}`,
            controlIdentity: affordance?.technicalTargetRef ?? "observed-repeat-affordance",
            action: "click",
            sourceEventRefs: affordance ? [affordance.observationId] : [],
            technicalTargetRefs: affordance?.locatorCandidates.map((locator) => `${locator.strategy}:${locator.value}`) ?? [],
            screenBeforeRef: affordance?.screenIdentity ?? sourceScreen,
            screenAfterRef: affordance?.screenIdentity ?? sourceScreen,
            ...(affordance ? { routeBefore: model?.semanticScreens.find((screen) => screen.screenIdentity === affordance.screenIdentity)?.url } : {}),
            ...(affordance ? { routeAfter: model?.semanticScreens.find((screen) => screen.screenIdentity === affordance.screenIdentity)?.url } : {}),
            stateScope: affordance?.screenIdentity,
            goalRelevant: true,
            ...(affordance?.label ? { description: `Presionar "${affordance.label}"` } : {}),
            confidence: affordance?.confidence ?? 0.7,
        };
        opportunities.push({
            opportunityId: `${primary.scenarioId}:repeat_entity`,
            title: humanMutationTitle(primary, "REPEAT_ENTITY", source.entityType),
            mutationType: "REPEAT_ENTITY",
            basePrimaryScenarioId: primary.scenarioId,
            operations: [
                { type: "insert_action", action: repeatAction, afterInteractionId: source.semanticActions.at(-1)?.id },
                { type: "clone_entity", sourceEntityScope: source.entityScope, targetEntityScope: `${source.entityScope.replace(/[_-]?\d+$/, "") || source.entityScope}_2` },
            ],
            evidenceRefs: primaryEvents,
            rationale: "El recorrido observó un affordance de repetición/agregado y existe un bloque de entidad completo.",
            oracleAuthority: "MISSING",
            confidence: 0.8,
            needsReview: true,
        });
    }
    if (blocks.length > 0 && primary.testRailSteps.some((step) => /final|continuar|guardar|enviar|confirmar/i.test(step.content))) {
        opportunities.push({
            opportunityId: `${primary.scenarioId}:zero_entity`,
            title: humanMutationTitle(primary, "ZERO_ENTITY", blocks[0].entityType),
            mutationType: "ZERO_ENTITY",
            basePrimaryScenarioId: primary.scenarioId,
            operations: [{ type: "remove_entity", entityScope: blocks[0].entityScope }],
            evidenceRefs: primaryEvents,
            rationale: "La grabación alcanzó una acción final desde el contexto de la entidad; el resultado de omitirla requiere revisión.",
            oracleAuthority: "MISSING",
            confidence: 0.55,
            needsReview: true,
        });
    }
    const actionInputs = materializeRuntimeInputRequirements(primary).filter((requirement) => requirement.valueRole === "action_input");
    if (actionInputs.length > 1) {
        opportunities.push({
            opportunityId: `${primary.scenarioId}:field_omission`,
            title: humanMutationTitle(primary, "FIELD_OMISSION"),
            mutationType: "FIELD_OMISSION",
            basePrimaryScenarioId: primary.scenarioId,
            operations: [{ type: "remove_action", interactionId: primary.canonicalInteractions?.find((interaction) => interaction.valueKey === actionInputs[0].valueKey)?.id ?? "" }],
            evidenceRefs: primaryEvents,
            rationale: "Existen varios inputs observados; se propone una omisión agrupada sin inventar el resultado.",
            oracleAuthority: "MISSING",
            confidence: 0.5,
            needsReview: true,
        });
    }
    // Options are scoped to the selector/surface that opened them. A selected option's label
    // is not itself an inventory, and no global option pool is allowed to manufacture a
    // replacement for another control.
    const legacyInventories = (model?.selectorOptionInventories?.length ? [] : (model?.technicalObservations ?? []).map((observation) => ({
        selectorRef: observation.selectorControlId ?? observation.technicalTargetRef,
        semanticField: observation.semanticField ?? null,
        ...(observation.entityScope ? { entityScope: observation.entityScope } : {}),
        surfaceRef: observation.optionSurfaceId ?? observation.technicalTargetRef,
        options: [...new Set(observation.observedOptions ?? observation.dynamicLifecycle?.options ?? [])].filter(Boolean),
        ...(observation.dynamicLifecycle?.selectedOption ?? observation.afterValue ? { selectedOption: observation.dynamicLifecycle?.selectedOption ?? observation.afterValue } : {}),
        observationRefs: [observation.observationId],
    }))) ?? [];
    const inventories = model?.selectorOptionInventories?.length ? model.selectorOptionInventories : legacyInventories;
    const alternatives = inventories.flatMap((inventory) => {
        if (inventory.options.length < 2)
            return [];
        const primarySelection = primary.canonicalInteractions?.find((interaction) => interaction.action === "select"
            && (model?.selectorOptionInventories?.length
                ? interaction.selectorControlId === inventory.selectorRef && interaction.optionSurfaceId === inventory.surfaceRef
                : true)
            && (interaction.semanticField ?? null) === inventory.semanticField
            && (!inventory.entityScope || interaction.entityScope === inventory.entityScope));
        if (!primarySelection)
            return [];
        const selected = inventory.selectedOption ?? primarySelection.recordedValue;
        if (!selected)
            return [];
        return inventory.options
            .filter((option) => option !== selected)
            .map((option) => ({ inventory, primarySelection, option }));
    });
    if (alternatives.length > 0) {
        const alternative = alternatives[0];
        opportunities.push({
            opportunityId: `${primary.scenarioId}:alternative_selection`,
            title: humanMutationTitle(primary, "ALTERNATIVE_SELECTION", undefined, alternative.option),
            mutationType: "ALTERNATIVE_SELECTION",
            basePrimaryScenarioId: primary.scenarioId,
            operations: [{ type: "replace_selection", interactionId: alternative.primarySelection.id, value: alternative.option }],
            evidenceRefs: alternative.inventory.observationRefs,
            rationale: "La opción alternativa fue observada técnicamente en la misma superficie de selección.",
            oracleAuthority: "MISSING",
            confidence: 0.75,
            needsReview: true,
        });
    }
    return opportunities;
}
function scopedKey(valueKey, targetScope) {
    const parts = valueKey.split(".");
    return parts.length > 1 ? `${targetScope}.${parts.slice(1).join(".")}` : `${targetScope}.${valueKey}`;
}
function classifyRepeatFieldForClone(field) {
    if (field.repeatClonePolicy)
        return field.repeatClonePolicy;
    if (field.valueRole === "runtime_derived_oracle")
        return "SYSTEM_GENERATED";
    if (field.valueRole === "secure_input" || field.sensitive)
        return "REQUIRE_NEW_VALUE";
    if (field.valueRole === "action_input")
        return "CLONE_SAME_VALUE";
    return "NOT_APPLICABLE";
}
function cloneDataField(field, targetScope, sourceRequirement, disposition = classifyRepeatFieldForClone(field)) {
    const reusable = disposition === "CLONE_SAME_VALUE" || disposition === "DERIVE_FROM_ALLOWED_SOURCE";
    return {
        ...field,
        key: scopedKey(field.key, targetScope),
        entityScope: targetScope,
        exampleValue: reusable && sourceRequirement?.resolved ? sourceRequirement.value ?? undefined : undefined,
        source: "RECORDED_CONFIRMED",
        needsReview: false,
        reviewReason: undefined,
    };
}
function isUniqueWithinCollection(constraint) {
    const normalized = constraint.type.trim().toLowerCase().replace(/[\s-]/g, "_");
    return constraint.uniqueWithinCollection === true
        || ["unique_within_collection", "distinct_within_collection"].includes(normalized);
}
function logicalFieldKey(valueKey) {
    const parts = valueKey.split(".");
    return parts.length > 1 ? parts.slice(1).join(".") : valueKey;
}
function resolveRepeatConstraintValue(field, sourceRequirement, activeData) {
    const constraint = (sourceRequirement?.constraints ?? field.constraints ?? []).find(isUniqueWithinCollection);
    if (!constraint)
        return {};
    const activeValues = new Set(activeData
        .filter((candidate) => logicalFieldKey(candidate.key) === logicalFieldKey(field.key))
        .map((candidate) => clean(candidate.exampleValue))
        .filter((value) => Boolean(value)));
    const candidates = [...new Set((sourceRequirement?.allowedValues ?? field.allowedValues ?? [])
            .map((value) => clean(value))
            .filter((value) => Boolean(value)))];
    const distinctCandidates = candidates.filter((candidate) => !activeValues.has(candidate));
    const resolution = {
        valueKey: field.key,
        constraintType: constraint.type,
        activeValueCount: activeValues.size,
        candidateCount: candidates.length,
        distinctCandidateCount: distinctCandidates.length,
        resolutionSource: candidates.length > 0 ? "allowed_values" : "none",
        resolved: distinctCandidates.length === 1,
    };
    return distinctCandidates.length === 1 ? { value: distinctCandidates[0], resolution } : { resolution };
}
function replaceStepKey(step, sourceScope, targetScope, cloneIndex) {
    const oldKey = step.valueKey;
    const valueKey = oldKey && (step.entityScope === sourceScope || oldKey.startsWith(`${sourceScope}.`)) ? scopedKey(oldKey, targetScope) : oldKey;
    const template = step.stepTemplate ?? step.content;
    const content = valueKey && oldKey && valueKey !== oldKey ? template.replaceAll(`[${oldKey}]`, `[${valueKey}]`) : template;
    return { ...step, content, stepTemplate: content, renderedStep: content, valueKey, entityScope: targetScope,
        ...(cloneIndex !== undefined && step.interactionId ? { interactionId: `${step.interactionId}-clone-${cloneIndex + 1}` } : {}) };
}
function cloneWebStep(step, sourceScope, targetScope, cloneIndex) {
    const valueKey = step.valueKey && (step.entityScope === sourceScope || step.valueKey.startsWith(`${sourceScope}.`)) ? scopedKey(step.valueKey, targetScope) : step.valueKey;
    return { ...step, valueKey, entityScope: targetScope, description: valueKey && step.valueKey !== valueKey ? step.description.replaceAll(`[${step.valueKey}]`, `[${valueKey}]`) : step.description,
        ...(cloneIndex !== undefined && step.interactionId ? { interactionId: `${step.interactionId}-clone-${cloneIndex + 1}` } : {}) };
}
function stepSignature(step) {
    return [step.interactionId ?? "", step.entityScope ?? "", step.valueKey ?? "", step.classification ?? "", step.content].join("|");
}
function dateOnly(value) {
    const normalized = value === null ? undefined : clean(value);
    return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}
function todayDateOnly() {
    const now = new Date();
    return `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
}
function evaluateConstraint(constraint, value) {
    const type = constraint.type.trim().toLowerCase().replace(/[-\s]/g, "_");
    if (["not_future", "date_not_future", "max_today"].includes(type)) {
        const candidate = dateOnly(value);
        return candidate ? (candidate <= todayDateOnly() ? "valid" : "invalid") : "unknown";
    }
    if (["min", "minimum", "min_date"].includes(type)) {
        const bound = clean(constraint.value);
        return bound && value >= bound ? "valid" : bound ? "invalid" : "unknown";
    }
    if (["max", "maximum", "max_date"].includes(type)) {
        const bound = clean(constraint.value);
        return bound && value <= bound ? "valid" : bound ? "invalid" : "unknown";
    }
    return "unknown";
}
/** Validates a mutation's data preconditions without knowing product field names. */
function evaluateMutationPreconditionValidity(mutation, requirements) {
    if (mutation.mutationType !== "REPEAT_ENTITY") {
        return { status: "valid", checkedValueKeys: [], invalidValueKeys: [], reasons: [] };
    }
    const checkedValueKeys = [];
    const invalidValueKeys = [];
    const reasons = [];
    let unknown = false;
    for (const requirement of requirements) {
        const isClonedReusable = requirement.sourceAuthority === "CLONED_CONFIRMED_VALUE"
            && (requirement.repeatCloneDisposition === "CLONE_SAME_VALUE" || requirement.repeatCloneDisposition === "DERIVE_FROM_ALLOWED_SOURCE");
        if (isClonedReusable || requirement.constraints?.length)
            checkedValueKeys.push(requirement.valueKey);
        if (isClonedReusable && (!requirement.resolved || requirement.value === null)) {
            invalidValueKeys.push(requirement.valueKey);
            reasons.push(`unresolved_repeat_precondition:${requirement.valueKey}`);
        }
        for (const constraint of requirement.constraints ?? []) {
            if (isUniqueWithinCollection(constraint))
                continue;
            if (requirement.value === null || !requirement.resolved) {
                invalidValueKeys.push(requirement.valueKey);
                reasons.push(`unresolved_constraint_value:${requirement.valueKey}`);
                continue;
            }
            const result = evaluateConstraint(constraint, requirement.value);
            if (result === "invalid") {
                invalidValueKeys.push(requirement.valueKey);
                reasons.push(`constraint_not_satisfied:${requirement.valueKey}:${constraint.type}`);
            }
            else if (result === "unknown") {
                unknown = true;
                reasons.push(`constraint_unverified:${requirement.valueKey}:${constraint.type}`);
            }
        }
    }
    const uniqueInvalidValueKeys = [...new Set(invalidValueKeys)];
    return {
        status: uniqueInvalidValueKeys.length > 0 ? "invalid" : unknown ? "unknown" : "valid",
        checkedValueKeys: [...new Set(checkedValueKeys)],
        invalidValueKeys: uniqueInvalidValueKeys,
        reasons: [...new Set(reasons)],
    };
}
function materializedSemanticSignature(scenario) {
    const interactions = (scenario.canonicalInteractions ?? [])
        .map((interaction) => [interaction.action, interaction.controlIdentity, interaction.entityScope ?? "", interaction.valueKey ?? "", interaction.recordedValue ?? "", interaction.description ?? ""].join("|"));
    const steps = scenario.testRailSteps.map(stepSignature);
    const values = scenario.requiredData.map((field) => field.key).sort();
    return JSON.stringify({ interactions, steps, values });
}
function mutationEffectDiagnostics(primary, materialized) {
    const primarySteps = new Map(primary.testRailSteps.map((step) => [stepSignature(step), (primary.testRailSteps.filter((item) => stepSignature(item) === stepSignature(step)).length)]));
    const materializedSteps = new Map(materialized.testRailSteps.map((step) => [stepSignature(step), (materialized.testRailSteps.filter((item) => stepSignature(item) === stepSignature(step)).length)]));
    const countDelta = (left, right) => [...left.entries()].reduce((total, [key, count]) => total + Math.max(0, count - (right.get(key) ?? 0)), 0);
    const primaryKeys = new Set(primary.requiredData.map((field) => field.key));
    const materializedKeys = new Set(materialized.requiredData.map((field) => field.key));
    const primaryScopes = new Set((primary.canonicalInteractions ?? []).map((interaction) => interaction.entityScope).filter(Boolean));
    const materializedScopes = new Set((materialized.canonicalInteractions ?? []).map((interaction) => interaction.entityScope).filter(Boolean));
    const stepsReplaced = [...new Set((primary.canonicalInteractions ?? []).map((interaction) => interaction.id))].filter((id) => {
        const before = primary.canonicalInteractions?.find((interaction) => interaction.id === id);
        const after = materialized.canonicalInteractions?.find((interaction) => interaction.id === id);
        return Boolean(before && after && JSON.stringify([before.action, before.valueKey, before.recordedValue]) !== JSON.stringify([after.action, after.valueKey, after.recordedValue]));
    }).length;
    const signature = materializedSemanticSignature(materialized);
    const primarySignature = materializedSemanticSignature(primary);
    const diagnostics = {
        materializedSemanticSignature: signature,
        primarySemanticSignature: primarySignature,
        stepsAdded: countDelta(materializedSteps, primarySteps),
        stepsRemoved: countDelta(primarySteps, materializedSteps),
        stepsReplaced,
        entityScopesAdded: [...materializedScopes].filter((scope) => !primaryScopes.has(scope)),
        valueKeysAdded: [...materializedKeys].filter((key) => !primaryKeys.has(key)),
        valueKeysRemoved: [...primaryKeys].filter((key) => !materializedKeys.has(key)),
    };
    if (signature === primarySignature)
        diagnostics.rejectionReason = "MUTATION_NO_EFFECT";
    return diagnostics;
}
/** Materializes a complete scenario from a mutation. It never copies source entity values. */
function materializeScenarioMutation(primary, mutation) {
    const repeat = mutation.operations.find((operation) => operation.type === "clone_entity");
    const remove = new Set(mutation.operations.filter((operation) => operation.type === "remove_action").map((operation) => operation.interactionId));
    const removeEntities = new Set(mutation.operations.filter((operation) => operation.type === "remove_entity").map((operation) => operation.entityScope));
    const inserts = mutation.operations.filter((operation) => operation.type === "insert_action");
    const replacement = mutation.operations.find((operation) => operation.type === "replace_selection");
    let testRailSteps = [...primary.testRailSteps];
    let webSteps = [...primary.webSteps];
    let requiredData = [...primary.requiredData];
    let canonicalInteractions = [...(primary.canonicalInteractions ?? [])];
    let stepTargets = [...(primary.stepTargets ?? [])];
    const repeatLineage = new Map();
    const repeatConstraintResolutions = [];
    const resolvedRepeatValues = new Map();
    if (remove.size > 0) {
        const removed = new Set(canonicalInteractions.filter((interaction) => remove.has(interaction.id)).flatMap((interaction) => interaction.sourceEventRefs));
        canonicalInteractions = canonicalInteractions.filter((interaction) => !remove.has(interaction.id));
        testRailSteps = testRailSteps.filter((step) => !step.sourceEventRefs?.some((ref) => removed.has(ref)));
        webSteps = webSteps.filter((step) => !step.interactionId || !remove.has(step.interactionId));
        stepTargets = stepTargets.filter((target) => {
            const interactionId = primary.webSteps[target.stepIndex]?.interactionId;
            return !interactionId || !remove.has(interactionId);
        });
    }
    if (removeEntities.size > 0) {
        const originalCanonical = canonicalInteractions;
        const entityBlockIds = new Set((primary.entityActionBlocks ?? [])
            .filter((block) => removeEntities.has(block.entityScope))
            .flatMap((block) => block.semanticActions.map((interaction) => interaction.id)));
        const lastRemovedEntityIndex = Math.max(-1, ...originalCanonical.map((interaction, index) => entityBlockIds.has(interaction.id) ? index : -1));
        const uncertainDownstreamBoundary = originalCanonical.findIndex((interaction, index) => index > lastRemovedEntityIndex && interaction.causedTransition);
        const removed = new Set(canonicalInteractions.filter((interaction) => interaction.entityScope && removeEntities.has(interaction.entityScope)).flatMap((interaction) => interaction.sourceEventRefs));
        canonicalInteractions = canonicalInteractions.filter((interaction) => !interaction.entityScope || !removeEntities.has(interaction.entityScope));
        testRailSteps = testRailSteps.filter((step) => !step.entityScope || !removeEntities.has(step.entityScope));
        webSteps = webSteps.filter((step) => !step.entityScope || !removeEntities.has(step.entityScope));
        stepTargets = stepTargets.filter((target) => !removeEntities.has(primary.webSteps[target.stepIndex]?.entityScope ?? ""));
        requiredData = requiredData.filter((field) => !field.entityScope || !removeEntities.has(field.entityScope));
        if (removed.size > 0) {
            testRailSteps = testRailSteps.filter((step) => !step.sourceEventRefs?.some((ref) => removed.has(ref)));
        }
        // ZERO_ENTITY is exploratory: after removing the entity, a downstream functional
        // transition is not applicable unless the recording structurally proved it remains
        // independent. Stop before that transition; technical reachability evidence may remain.
        if (uncertainDownstreamBoundary >= 0) {
            const boundaryId = originalCanonical[uncertainDownstreamBoundary]?.id;
            const boundaryInteraction = originalCanonical[uncertainDownstreamBoundary];
            const functionalBoundary = Boolean(boundaryInteraction
                && !boundaryInteraction.technicalOnly
                && boundaryInteraction.action !== "navigation"
                && boundaryInteraction.action !== "system_observation");
            const boundaryRailIndex = testRailSteps.findIndex((step) => step.interactionId === boundaryId);
            if (boundaryRailIndex >= 0)
                testRailSteps = testRailSteps.slice(0, functionalBoundary ? boundaryRailIndex : boundaryRailIndex + 1);
            const boundaryWebIndex = webSteps.findIndex((step) => step.interactionId === boundaryId);
            if (boundaryWebIndex >= 0)
                webSteps = webSteps.slice(0, functionalBoundary ? boundaryWebIndex : boundaryWebIndex + 1);
            canonicalInteractions = canonicalInteractions.filter((interaction) => {
                const originalIndex = originalCanonical.findIndex((candidate) => candidate.id === interaction.id);
                return originalIndex < 0 || originalIndex < uncertainDownstreamBoundary || !functionalBoundary && originalIndex === uncertainDownstreamBoundary;
            });
        }
    }
    if (replacement) {
        canonicalInteractions = canonicalInteractions.map((interaction) => interaction.id === replacement.interactionId ? { ...interaction, recordedValue: replacement.value } : interaction);
        const replacementKey = canonicalInteractions.find((interaction) => interaction.id === replacement.interactionId)?.valueKey;
        if (replacementKey)
            requiredData = requiredData.map((field) => field.key === replacementKey
                ? { ...field, exampleValue: replacement.value, source: "RECORDED_CONFIRMED" }
                : field);
        testRailSteps = testRailSteps.map((step) => step.interactionId === replacement.interactionId && step.valueKey ? { ...step, renderedStep: (step.stepTemplate ?? step.content).replace(`[${step.valueKey}]`, JSON.stringify(replacement.value)) } : step);
    }
    if (repeat) {
        const sourceData = requiredData.filter((field) => field.entityScope === repeat.sourceEntityScope);
        const sourceBlock = primary.entityActionBlocks?.find((block) => block.entityScope === repeat.sourceEntityScope);
        // The persisted entity block can be an older/partial projection of the
        // canonical contract. Clone the canonical source actions when available so
        // compound controls (for example click + select) are not silently lost.
        const canonicalSourceInteractions = canonicalInteractions.filter((interaction) => interaction.entityScope === repeat.sourceEntityScope);
        const sourceInteractions = canonicalSourceInteractions.length > 0
            ? canonicalSourceInteractions
            : (sourceBlock?.semanticActions ?? []);
        const sourceRequirements = materializeRuntimeInputRequirements({ requiredData: sourceData, canonicalInteractions: sourceInteractions });
        const clonedData = sourceData.map((field) => {
            const sourceRequirement = sourceRequirements.find((requirement) => requirement.valueKey === field.key);
            const persistedSourceValue = primary.runtimeDataset?.resolvedValues[field.key];
            const lineageRequirement = persistedSourceValue === undefined || !sourceRequirement
                ? sourceRequirement
                : {
                    ...sourceRequirement,
                    value: persistedSourceValue,
                    resolved: true,
                    authority: "recorded_confirmed",
                    authorityValue: persistedSourceValue,
                    datasetAuthorityMismatch: false,
                };
            const repeatCloneDisposition = classifyRepeatFieldForClone(field);
            const constraintResolution = resolveRepeatConstraintValue(field, sourceRequirement, requiredData);
            if (constraintResolution.resolution)
                repeatConstraintResolutions.push({
                    ...constraintResolution.resolution,
                    valueKey: scopedKey(field.key, repeat.targetEntityScope),
                });
            if (constraintResolution.value)
                resolvedRepeatValues.set(scopedKey(field.key, repeat.targetEntityScope), constraintResolution.value);
            const cloned = {
                ...cloneDataField(field, repeat.targetEntityScope, lineageRequirement, repeatCloneDisposition),
                ...(constraintResolution.value ? {
                    exampleValue: constraintResolution.value,
                    source: "RECORDED_CONFIRMED",
                } : {}),
            };
            repeatLineage.set(cloned.key, {
                sourceValueKey: field.key,
                sourceAuthority: repeatCloneDisposition === "SYSTEM_GENERATED"
                    ? "SYSTEM_GENERATED"
                    : (repeatCloneDisposition === "CLONE_SAME_VALUE" || repeatCloneDisposition === "DERIVE_FROM_ALLOWED_SOURCE") && lineageRequirement?.resolved
                        ? "CLONED_CONFIRMED_VALUE"
                        : "UNRESOLVED",
                repeatCloneDisposition,
            });
            return cloned;
        });
        requiredData = [...requiredData, ...clonedData];
        const sourceInteractionIds = new Set(sourceInteractions.map((interaction) => interaction.id));
        const hasExplicitSourceBlock = sourceInteractions.length > 0;
        const sourceRail = testRailSteps.filter((step) => step.entityScope === repeat.sourceEntityScope
            && (!hasExplicitSourceBlock || !step.interactionId || sourceInteractionIds.has(step.interactionId)));
        const sourceWeb = webSteps.filter((step) => step.entityScope === repeat.sourceEntityScope
            && (!hasExplicitSourceBlock || !step.interactionId || sourceInteractionIds.has(step.interactionId)));
        const sourceInteractionId = sourceBlock?.semanticActions.at(-1)?.id
            ?? canonicalInteractions.filter((interaction) => interaction.entityScope === repeat.sourceEntityScope).at(-1)?.id;
        const clonedRail = sourceRail.map((step, index) => replaceStepKey(step, repeat.sourceEntityScope, repeat.targetEntityScope, index));
        const clonedWeb = sourceWeb.map((step, index) => cloneWebStep(step, repeat.sourceEntityScope, repeat.targetEntityScope, index));
        const sourceRailLastIndex = Math.max(-1, ...testRailSteps.map((step, index) => step.interactionId === sourceInteractionId ? index : -1));
        const terminalRailIndex = testRailSteps.findIndex((step, index) => index > sourceRailLastIndex && (() => {
            const interaction = step.interactionId ? canonicalInteractions.find((candidate) => candidate.id === step.interactionId) : undefined;
            return Boolean(interaction?.causedTransition);
        })());
        const railIndex = sourceRailLastIndex >= 0
            ? sourceRailLastIndex
            : terminalRailIndex >= 0 ? terminalRailIndex - 1 : -1;
        const repeatOperations = inserts.filter((operation) => operation.afterInteractionId === sourceInteractionId);
        const repeatSteps = repeatOperations.map((operation) => ({
            content: operation.action.description ?? "Presionar el control observado de repetición",
            renderedStep: operation.action.description ?? "Presionar el control observado de repetición",
            stepTemplate: operation.action.description ?? "Presionar el control observado de repetición",
            expected: "",
            classification: "FUNCTIONAL_ACTION",
            interactionId: operation.action.id,
            sourceEventRefs: operation.action.sourceEventRefs,
            ...(operation.action.screenBeforeRef ? { screenBeforeRef: operation.action.screenBeforeRef } : {}),
            ...(operation.action.screenAfterRef ? { screenAfterRef: operation.action.screenAfterRef } : {}),
            ...(operation.action.routeBefore ? { routeBefore: operation.action.routeBefore } : {}),
            ...(operation.action.routeAfter ? { routeAfter: operation.action.routeAfter } : {}),
            ...(operation.action.stateScope ? { stateScope: operation.action.stateScope } : {}),
        }));
        testRailSteps.splice(railIndex + 1, 0, ...repeatSteps, ...clonedRail);
        const sourceWebLastIndex = Math.max(-1, ...webSteps.map((step, index) => step.interactionId === sourceInteractionId ? index : -1));
        const terminalWebIndex = webSteps.findIndex((step, index) => index > sourceWebLastIndex && step.interactionId && canonicalInteractions.find((candidate) => candidate.id === step.interactionId)?.causedTransition);
        const webIndex = sourceWebLastIndex >= 0
            ? sourceWebLastIndex
            : terminalWebIndex >= 0 ? terminalWebIndex - 1 : -1;
        const repeatWebSteps = repeatOperations.map((operation) => {
            const targetRef = operation.action.technicalTargetRefs[0];
            const separator = targetRef?.indexOf(":");
            return {
                action: "click",
                ...(targetRef && separator !== undefined && separator > 0 ? { target: { strategy: targetRef.slice(0, separator), value: targetRef.slice(separator + 1) } } : {}),
                description: operation.action.description ?? "Presionar el control observado de repetición",
                interactionId: operation.action.id,
                ...(operation.action.screenBeforeRef ? { screenBeforeRef: operation.action.screenBeforeRef } : {}),
                ...(operation.action.screenAfterRef ? { screenAfterRef: operation.action.screenAfterRef } : {}),
                ...(operation.action.routeBefore ? { routeBefore: operation.action.routeBefore } : {}),
                ...(operation.action.routeAfter ? { routeAfter: operation.action.routeAfter } : {}),
                ...(operation.action.stateScope ? { stateScope: operation.action.stateScope } : {}),
            };
        });
        webSteps.splice(webIndex + 1, 0, ...repeatWebSteps, ...clonedWeb);
        const clonedInteractions = sourceInteractions.map((interaction, index) => ({
            ...interaction,
            id: `${interaction.id}-clone-${index + 1}`,
            entityScope: repeat.targetEntityScope,
            rowRelation: "added",
            valueKey: interaction.valueKey ? scopedKey(interaction.valueKey, repeat.targetEntityScope) : undefined,
            recordedValue: interaction.valueKey
                ? resolvedRepeatValues.get(scopedKey(interaction.valueKey, repeat.targetEntityScope))
                : undefined,
            rawTypedValue: undefined,
            committedValue: undefined,
            sourceEventRefs: [],
            confidence: Math.min(interaction.confidence, 0.7),
        }));
        // Entity blocks may be reconstructed during hydration, so their interaction
        // objects are not guaranteed to retain reference identity with the canonical
        // array. Resolve the insertion boundary by the stable interaction id.
        const sourceLastInteractionId = sourceInteractions.at(-1)?.id;
        const sourceLastIndex = sourceLastInteractionId
            ? canonicalInteractions.findIndex((interaction) => interaction.id === sourceLastInteractionId)
            : -1;
        const canonicalTerminalIndex = canonicalInteractions.findIndex((interaction, index) => index > sourceLastIndex && interaction.causedTransition);
        const canonicalInsertIndex = canonicalTerminalIndex >= 0 ? canonicalTerminalIndex : canonicalInteractions.length;
        canonicalInteractions.splice(canonicalInsertIndex, 0, ...repeatOperations.map((operation) => operation.action), ...clonedInteractions);
    }
    if (inserts.length > 0 && !repeat) {
        for (const operation of inserts) {
            const index = operation.afterInteractionId ? canonicalInteractions.findIndex((interaction) => interaction.id === operation.afterInteractionId) + 1 : canonicalInteractions.length;
            canonicalInteractions.splice(Math.max(0, index), 0, operation.action);
        }
    }
    // A mutation may be persisted from an older projection that retained functional
    // interactions after the observed terminal transition. Keep the first functional
    // transition as the scenario terminal and remove everything after it coherently.
    let terminalIndex = -1;
    for (let index = canonicalInteractions.length - 1; index >= 0; index -= 1) {
        const interaction = canonicalInteractions[index];
        if (!interaction.technicalOnly
            && interaction.action !== "navigation"
            && interaction.action !== "system_observation"
            && interaction.causedTransition) {
            terminalIndex = index;
            break;
        }
    }
    if (mutation.mutationType === "ALTERNATIVE_SELECTION" && terminalIndex >= 0) {
        const terminalId = canonicalInteractions[terminalIndex].id;
        const terminalRailIndex = testRailSteps.findIndex((step) => step.interactionId === terminalId);
        if (terminalRailIndex >= 0)
            testRailSteps = testRailSteps.slice(0, terminalRailIndex + 1);
        const terminalWebIndex = webSteps.findIndex((step) => step.interactionId === terminalId);
        if (terminalWebIndex >= 0)
            webSteps = webSteps.slice(0, terminalWebIndex + 1);
        canonicalInteractions = canonicalInteractions.slice(0, terminalIndex + 1);
    }
    let runtimeInputRequirements = materializeRuntimeInputRequirements({ requiredData, canonicalInteractions });
    runtimeInputRequirements = runtimeInputRequirements.map((requirement) => {
        const lineage = repeatLineage.get(requirement.valueKey);
        const lineageValueKey = lineage?.sourceValueKey ?? requirement.valueKey;
        const persistedSourceValue = repeat && primary.runtimeDataset?.resolvedValues[lineageValueKey];
        return lineage
            ? {
                ...requirement,
                ...(persistedSourceValue !== undefined ? {
                    value: persistedSourceValue,
                    resolved: true,
                    authority: "recorded_confirmed",
                    authorityValue: persistedSourceValue,
                    datasetAuthorityMismatch: false,
                } : {}),
                ...lineage,
            }
            : repeat && persistedSourceValue !== undefined && requirement.entityScope === repeat.sourceEntityScope
                ? { ...requirement, value: persistedSourceValue, resolved: true, authority: "recorded_confirmed", authorityValue: persistedSourceValue, datasetAuthorityMismatch: false }
                : requirement;
    });
    const unresolvedRepeatValueKeys = new Set(repeatConstraintResolutions.filter((resolution) => !resolution.resolved).map((resolution) => resolution.valueKey));
    if (unresolvedRepeatValueKeys.size > 0) {
        runtimeInputRequirements = runtimeInputRequirements.map((requirement) => unresolvedRepeatValueKeys.has(requirement.valueKey)
            ? {
                ...requirement,
                required: true,
                value: null,
                resolved: false,
                source: "unresolved",
                authority: "unresolved",
                authorityValue: null,
                sourceAuthority: "UNRESOLVED",
                datasetAuthorityMismatch: false,
            }
            : requirement);
    }
    const runtimeDataset = buildScenarioRuntimeDataset({ ...primary, scenarioId: `${primary.scenarioId}-MUT-${mutation.mutationType.toLowerCase()}`, requiredData, runtimeInputRequirements });
    const targetByInteraction = new Map();
    for (const target of primary.stepTargets ?? []) {
        const interactionId = primary.webSteps[target.stepIndex]?.interactionId;
        if (interactionId)
            targetByInteraction.set(interactionId, target);
    }
    stepTargets = webSteps.flatMap((step, index) => {
        if (!step.target)
            return [];
        const previous = step.interactionId ? targetByInteraction.get(step.interactionId) : undefined;
        return [{
                ...(previous ?? {}),
                stepIndex: index,
                description: step.description,
                strategy: step.target.strategy,
                value: step.target.value,
            }];
    });
    const stateValidation = validateInteractionStateSequence(canonicalInteractions);
    const readiness = evaluateRecordingReadiness({
        functionalReadiness: testRailSteps.length > 0,
        technicalReadiness: (primary.readiness?.technicalReadiness ?? primary.technicalReadiness ?? false) && stateValidation.stateSequenceValid,
        oracleReadiness: mutation.oracleAuthority !== "MISSING",
        runtimeInputRequirements,
        publicationRequiresOracle: true,
    });
    const materializedTechnicalRefs = [...new Set([...(primary.technicalKnowledgeRefs ?? []), ...inserts.flatMap((operation) => operation.action.sourceEventRefs)])];
    const entityActionBlocks = buildEntityActionBlocks({ requiredData, testRailSteps, sourceRecordingId: primary.sourceRecordingId }, canonicalInteractions, materializedTechnicalRefs);
    const numberedSteps = testRailSteps.map((step, index) => ({ ...step, stepNumber: index + 1 }));
    const diagnostics = mutationEffectDiagnostics(primary, { ...primary, testRailSteps: numberedSteps, canonicalInteractions, requiredData });
    if (replacement) {
        const primaryTarget = primary.canonicalInteractions?.find((interaction) => interaction.id === replacement.interactionId);
        if (primaryTarget?.recordedValue === replacement.value)
            diagnostics.rejectionReason = "MUTATION_NO_EFFECT";
    }
    const mutationPreconditionValidity = evaluateMutationPreconditionValidity(mutation, runtimeInputRequirements);
    diagnostics.mutationPreconditionValidity = mutationPreconditionValidity;
    if (diagnostics.rejectionReason === undefined
        && mutation.mutationType === "REPEAT_ENTITY"
        && repeatConstraintResolutions.some((resolution) => !resolution.resolved)) {
        diagnostics.rejectionReason = "RUNTIME_DATA_CONSTRAINT_VIOLATION";
    }
    if (diagnostics.rejectionReason === undefined && mutationPreconditionValidity.status !== "valid") {
        diagnostics.rejectionReason = mutationPreconditionValidity.status === "invalid"
            ? "MUTATION_PRECONDITION_INVALID"
            : "MUTATION_PRECONDITION_UNKNOWN";
    }
    const effectfulReadiness = diagnostics.rejectionReason ? {
        ...readiness,
        publicationContentReadiness: false,
        publicationReadiness: false,
    } : readiness;
    const runtimeExecutionBlockedByData = mutation.mutationType === "REPEAT_ENTITY" && unresolvedRepeatValueKeys.size > 0;
    const materializedTitle = diagnostics.rejectionReason === "MUTATION_NO_EFFECT"
        ? primary.title
        : mutation.title;
    return {
        ...primary,
        scenarioId: `${primary.scenarioId}-MUT-${mutation.mutationType.toLowerCase()}`,
        title: materializedTitle,
        description: mutation.rationale,
        provenance: "derived",
        primary: false,
        replayEligible: diagnostics.rejectionReason === undefined,
        containsUnexecutedActions: true,
        // The cloned controls reuse validated technical references from the source block. The
        // missing values are a data gate, not a locator-confidence failure.
        hasUncertainSteps: primary.hasUncertainSteps,
        testRailSteps: numberedSteps,
        stepTargets,
        webSteps,
        requiredData,
        canonicalInteractions,
        entityActionBlocks,
        technicalKnowledgeRefs: materializedTechnicalRefs,
        runtimeInputRequirements,
        runtimeDataset,
        readiness: effectfulReadiness,
        runtimeExecutionBlockedByData,
        mutation,
        expectedResultCandidate: mutation.expectedResultCandidate,
        oracleAuthority: mutation.oracleAuthority === "OBSERVED" ? "observed_only" : "review_required",
        reviewStatus: mutation.oracleAuthority === "OBSERVED" ? "APPROVED" : "PENDING",
        functionalReadiness: readiness.functionalReadiness,
        technicalReadiness: readiness.technicalReadiness,
        stateSequenceValid: stateValidation.stateSequenceValid,
        stateSequenceIssues: stateValidation.stateSequenceIssues,
        suggestionCategory: mutation.mutationType === "FIELD_OMISSION" || mutation.mutationType === "ZERO_ENTITY" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE",
        scenarioSpecificSteps: numberedSteps,
        mutationDiagnostics: diagnostics,
        repeatConstraintResolutions: repeatConstraintResolutions.length > 0 ? repeatConstraintResolutions : undefined,
        mutationPreconditionValidity,
        ...(mutation.mutationType === "ZERO_ENTITY" ? {
            negativeOracle: {
                kind: "negative",
                source: "mutation_precondition_graph",
                expectedState: { entityCount: 0, canSubmit: false },
                terminalActionApplicable: false,
            },
        } : {}),
        scenarioStepCount: numberedSteps.length,
        functionalActionCount: numberedSteps.filter((step) => !step.isSetup && step.classification === "FUNCTIONAL_ACTION").length,
        nonUserSetupSteps: numberedSteps.filter((step) => step.isSetup === true).length,
        reasonForDifference: numberedSteps.some((step) => step.isSetup) ? "El contador funcional excluye filas de setup/navegación inicial visibles en el preview." : "Todas las filas del escenario son acciones funcionales.",
    };
}
function enrichRecordedScenarioContract(scenario, interactions, technicalKnowledgeRefs = [], model) {
    const runtimeInputRequirements = materializeRuntimeInputRequirements({ ...scenario, canonicalInteractions: interactions });
    const readiness = evaluateRecordingReadiness({
        functionalReadiness: scenario.testRailSteps.length > 0,
        technicalReadiness: scenario.technicalReadiness !== false && !scenario.hasUncertainSteps,
        oracleReadiness: scenario.oracleAuthority !== "review_required"
            || (scenario.reviewStatus === "APPROVED" && Boolean(scenario.reviewedExpectedResult?.trim())),
        runtimeInputRequirements,
        publicationRequiresOracle: true,
    });
    const executableInteractions = interactions.filter((interaction) => !interaction.technicalOnly && interaction.action !== "system_observation");
    const relevantRefs = new Set(executableInteractions.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => {
        const match = ref.match(/^event-(\d+)$/);
        return match ? `obs-${match[1]}` : ref;
    })));
    const scopedTechnicalRefs = technicalKnowledgeRefs.filter((ref) => relevantRefs.has(ref));
    const stateValidation = validateInteractionStateSequence(interactions);
    const entityActionBlocks = buildEntityActionBlocks({ ...scenario, canonicalInteractions: interactions }, executableInteractions, scopedTechnicalRefs);
    // Keep technical navigation interactions in the canonical contract as reachability
    // evidence. They are not rendered as user steps, but they bridge route/state ownership
    // for actions that occur after a screen transition.
    const withContract = { ...scenario, replayEligible: scenario.replayEligible ?? !scenario.mutationDiagnostics?.rejectionReason, canonicalInteractions: interactions, entityActionBlocks, readiness: { ...readiness, technicalReadiness: readiness.technicalReadiness && stateValidation.stateSequenceValid, executionReadiness: readiness.executionReadiness && stateValidation.stateSequenceValid }, technicalReadiness: (scenario.technicalReadiness !== false) && stateValidation.stateSequenceValid, technicalKnowledgeRefs: scopedTechnicalRefs, stateSequenceValid: stateValidation.stateSequenceValid, stateSequenceIssues: stateValidation.stateSequenceIssues, runtimeInputRequirements, runtimeDataset: buildScenarioRuntimeDataset({ ...scenario, runtimeInputRequirements }), mutationOpportunities: [] };
    return { ...withContract, mutationOpportunities: detectMutationOpportunities(withContract, model) };
}
/** Adapter into the same MCP scenario shape used by Jira/HU and TestRail. */
/**
 * The route reached by the immediately preceding executable transition is the
 * runtime route authority for the next action. A stale captured routeBefore is
 * retained in the canonical interaction for auditability, but must not block
 * replay when the observed transition provides the current route.
 */
function deriveExpectedRouteBefore(interaction, previousExecutableInteraction) {
    return previousExecutableInteraction?.routeAfter ?? interaction.routeBefore;
}
function toSharedMcpScenario(scenario, appSlug, datasetValues = {}) {
    const materialized = applyRuntimeDatasetValues(scenario, datasetValues);
    const requirements = materialized.runtimeInputRequirements ?? materializeRuntimeInputRequirements(materialized);
    const datasetBindings = Object.fromEntries(requirements.map((requirement) => [requirement.valueKey, requirement.value]));
    const readiness = materialized.readiness ?? evaluateRecordingReadiness({
        functionalReadiness: materialized.testRailSteps.length > 0,
        technicalReadiness: materialized.technicalReadiness !== false,
        oracleReadiness: materialized.oracleAuthority !== "review_required"
            || (materialized.reviewStatus === "APPROVED" && Boolean(materialized.reviewedExpectedResult?.trim())),
        runtimeInputRequirements: requirements,
        publicationRequiresOracle: true,
    });
    const mutationEffectOk = !materialized.mutationDiagnostics?.rejectionReason;
    const executionAudit = evaluateRecordedScenarioExecutionReadiness(materialized);
    const requirementsByKey = new Map(requirements.map((requirement) => [requirement.valueKey, requirement]));
    const testRailStepByInteractionId = new Map(materialized.testRailSteps
        .filter((step) => Boolean(step.interactionId))
        .map((step) => [step.interactionId, step]));
    const executableInteractionsForRoute = (materialized.canonicalInteractions ?? [])
        .filter((interaction) => !interaction.technicalOnly && interaction.action !== "system_observation" && interaction.action !== "navigation");
    const executableInteractions = executableInteractionsForRoute
        .map((interaction, actionOrder) => {
        const previousExecutableInteraction = actionOrder > 0 ? executableInteractionsForRoute[actionOrder - 1] : undefined;
        const expectedRouteBefore = deriveExpectedRouteBefore(interaction, previousExecutableInteraction);
        const humanStep = interaction.id ? testRailStepByInteractionId.get(interaction.id) : undefined;
        // A rendered step is presentation-only. The template supplies the safe human
        // description while the canonical interaction supplies execution authority.
        const candidateValueKeys = [humanStep?.valueKey, interaction.valueKey]
            .filter((key) => Boolean(key?.trim()));
        const valueKey = candidateValueKeys.find((key) => requirementsByKey.has(key))
            ?? candidateValueKeys
                .map((key) => key.replace(/_valor$/i, ""))
                .find((key) => requirementsByKey.has(key))
            ?? candidateValueKeys[0];
        const requirement = valueKey ? requirementsByKey.get(valueKey) : undefined;
        return {
            actionType: interaction.action,
            interactionId: interaction.id,
            ...(humanStep?.stepTemplate ?? humanStep?.content ? { humanStep: humanStep.stepTemplate ?? humanStep.content } : {}),
            ...(interaction.semanticField ? { semanticField: interaction.semanticField } : {}),
            targetRef: interaction.controlIdentity,
            ...(interaction.technicalTargetRefs[0] ? { technicalTargetRef: interaction.technicalTargetRefs[0] } : {}),
            ...(interaction.technicalTargetRefs.length > 0 ? { technicalTargetRefs: [...interaction.technicalTargetRefs] } : {}),
            ...(interaction.technicalTargetCandidates?.length ? { technicalTargetCandidates: interaction.technicalTargetCandidates } : {}),
            ...(valueKey ? { valueKey } : {}),
            ...(requirement && (interaction.action === "fill" || interaction.action === "select") && typeof requirement.value === "string"
                ? { value: requirement.value }
                : {}),
            ...(requirement?.valueRole ? { valueRole: requirement.valueRole } : {}),
            ...(interaction.action === "fill" || interaction.action === "select" ? { runtimeValueSource: "dataset" } : {}),
            // The structured contract owns executable ordering. TestRail step
            // numbers are presentation metadata and may repeat around compound
            // interactions, so they cannot be used as runtime indices.
            stepIndex: actionOrder + 1,
            ...(interaction.entityScope ? { entityScope: interaction.entityScope } : {}),
            ...(interaction.rowRelation ? { rowRelation: interaction.rowRelation } : {}),
            ...(interaction.stateScope ? { expectedState: interaction.stateScope } : {}),
            ...(expectedRouteBefore ? { expectedRouteBefore } : {}),
        };
    });
    const recordingExecutionContract = {
        actions: normalizeRecordingExecutionActionIndices(executableInteractions),
        runtimeInputRequirements: requirements.map((requirement) => ({ ...requirement })),
        datasetBindings,
    };
    return {
        sourceIssueKey: `REC-${materialized.sourceRecordingId.slice(0, 8).toUpperCase()}`,
        title: materialized.title,
        steps: materialized.testRailSteps.map((step) => step.renderedStep ?? step.content),
        preconditions: materialized.preconditions,
        expectedResult: materialized.reviewedExpectedResult ?? materialized.expectedResultCandidate ?? materialized.testRailSteps.at(-1)?.expected ?? "Resultado esperado por confirmar",
        caseOracle: materialized.oracleAuthority,
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "recorded_session",
        setupStrategy: "recorded_walkthrough",
        appSlug,
        routeProfile: "",
        dataRequirements: requirements.filter((requirement) => requirement.required).map((requirement) => requirement.valueKey).join(", "),
        nonExecutableCriteria: executionAudit.executionReady
            ? ""
            : executionAudit.blockReasons.join(", ") || readiness.missingInputs.map((requirement) => `${requirement.entityScope ?? "global"}.${requirement.semanticField ?? requirement.valueKey}`).join(", "),
        mcpExecutable: mutationEffectOk && executionAudit.executionReady,
        executionReadiness: mutationEffectOk && executionAudit.executionReady ? "ready" : "blocked_execution_contract",
        publishableToTestManagement: mutationEffectOk && readiness.publicationReadiness,
        publicationClassification: mutationEffectOk && readiness.publicationReadiness ? "executable" : "blocked",
        scenarioId: materialized.scenarioId,
        recordingId: materialized.sourceRecordingId,
        recordedScenarioId: materialized.scenarioId,
        ...(materialized.mutation?.basePrimaryScenarioId ? { basePrimaryScenarioId: materialized.mutation.basePrimaryScenarioId } : {}),
        canonicalInteractions: materialized.canonicalInteractions ?? [],
        entityActionBlocks: materialized.entityActionBlocks ?? [],
        runtimeInputRequirements: requirements,
        datasetBindings,
        technicalKnowledgeRefs: materialized.technicalKnowledgeRefs ?? [],
        stateSequenceValid: materialized.stateSequenceValid !== false,
        stateSequenceIssues: materialized.stateSequenceIssues ?? [],
        oracleAuthority: materialized.oracleAuthority === "review_required" ? "MISSING" : "OBSERVED",
        ...(materialized.negativeOracle ? { negativeOracle: materialized.negativeOracle } : {}),
        executionReadinessAudit: executionAudit,
        recordingExecutionContract,
    };
}
