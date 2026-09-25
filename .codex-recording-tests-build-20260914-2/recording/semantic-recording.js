"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RECORDING_DATA_POLICY = void 0;
exports.normalizeRecordingDataPolicy = normalizeRecordingDataPolicy;
exports.normalizeRecordingGoal = normalizeRecordingGoal;
exports.isSensitiveRecordedEvent = isSensitiveRecordedEvent;
exports.detectFormatMask = detectFormatMask;
exports.aggregateTextUsedAsValue = aggregateTextUsedAsValue;
exports.resolveRecordedField = resolveRecordedField;
exports.classifySemanticEvent = classifySemanticEvent;
exports.buildSemanticRecordingModel = buildSemanticRecordingModel;
exports.attachScenarioSuggestions = attachScenarioSuggestions;
exports.semanticChangeSignature = semanticChangeSignature;
exports.hasSignificantSemanticChange = hasSignificantSemanticChange;
const trace_normalizer_1 = require("./trace-normalizer");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const compound_value_1 = require("./compound-value");
exports.DEFAULT_RECORDING_DATA_POLICY = {
    persistRecordedValues: true,
    persistQaCredentials: true,
    includeQaCredentialsInTestRail: true,
};
function normalizeRecordingDataPolicy(policy) {
    return {
        persistRecordedValues: policy?.persistRecordedValues !== false,
        // Recording policy is an invariant. Legacy clients may omit or send false, but they
        // cannot disable the QA credential capture contract anymore.
        persistQaCredentials: true,
        includeQaCredentialsInTestRail: true,
    };
}
function normalizeRecordingGoal(declaredGoal, provenance = "USER_DECLARED") {
    const declared = declaredGoal?.trim().replace(/\s+/g, " ");
    if (!declared)
        return undefined;
    const normalizedGoal = declared
        .replace(/^(?:quiero|vamos a|necesito)\s+/i, "")
        .replace(/[.!?]+$/, "")
        .trim();
    return {
        declaredGoal: declared,
        normalizedGoal: normalizedGoal || declared,
        provenance,
        needsReview: provenance === "LEGACY_LABEL" || normalizedGoal.length < declared.length * 0.5,
    };
}
/** Conservative, platform-neutral classification for credentials captured by older traces. */
function isSensitiveRecordedEvent(event) {
    if (event.target?.inputType?.toLowerCase() === "password")
        return true;
    const label = [event.target?.label, event.target?.role, event.target?.locators?.[0]?.value]
        .filter(Boolean).join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (/(?:password|contrasena|clave|pin|otp|token|cvv|secret)/i.test(label))
        return true;
    // Identifiers and usernames are ordinary action inputs. Older traces marked them as
    // sensitive by label; recover their useful recorded values without weakening true secret
    // detection or any explicit custom sensitive label on a different field.
    if (/(?:usuario|username|identificacion|identificador|empresa|company)/i.test(label))
        return false;
    return Boolean(event.redactedKey || event.target?.sensitive);
}
function slugify(value) {
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48) || "campo";
}
function cleanSemanticText(value) {
    const clean = value?.replace(/\s+/g, " ").trim();
    return clean || undefined;
}
/** Format hints are useful technical evidence, but never business field identity. */
function detectFormatMask(value) {
    const clean = value?.trim();
    if (!clean)
        return false;
    const normalized = clean.toLowerCase();
    if (/^(?:(?:d{1,4}|m{1,4}|y{2,4})[\s./-]){1,3}(?:d{1,4}|m{1,4}|y{2,4})$/.test(normalized))
        return true;
    if (/^(?:[0-9x#*a](?:[\s./_:-]|$)){3,}$/i.test(clean) && /[0-9x#*]/i.test(clean))
        return true;
    const tokens = clean.split(/[\s./_:-]+/).filter(Boolean);
    return tokens.length >= 2 && tokens.every((token) => /^[0-9x#*]+$/i.test(token));
}
function genericSemanticLabel(value) {
    const normalized = value
        ?.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/…/g, "...")
        .replace(/\.+$/g, "")
        .trim();
    return !normalized || normalized === "campo" || normalized === "field" || normalized === "indicar" || normalized === "seleccionar fila";
}
function isCompoundValueEditor(target) {
    if (target?.compoundRole !== "amount_or_text")
        return false;
    const label = target.label?.trim().toLowerCase();
    return Boolean(target.displayValue)
        || !label
        || ["campo", "control", "input", "textbox"].includes(label);
}
/** A compound editor's aggregate display text is evidence of ambiguity, not a split value. */
function aggregateTextUsedAsValue(event) {
    const logicalValue = event.target?.rawTypedValue ?? event.target?.committedValue;
    return event.kind === "fill"
        && Boolean(event.value?.trim())
        && (!logicalValue || /^(?:[A-Z]{3})\s+\d/.test(logicalValue.trim()))
        && /^(?:[A-Z]{3})\s+\d/.test(event.value.trim())
        && genericSemanticLabel(event.target?.label);
}
function usableSemanticCandidate(value) {
    const clean = cleanSemanticText(value);
    return Boolean(clean && !genericSemanticLabel(clean) && !detectFormatMask(clean) && clean.length <= 120 && !/[\n\r]/.test(clean));
}
/**
 * Resolves a recorded editor from evidence, never from a generic accessible name alone.
 * The order intentionally mirrors the evidence hierarchy used by the recorder contract.
 */
function resolveRecordedField(target, ordinal = 1) {
    const label = cleanSemanticText(target?.label);
    const formatHint = target?.inputType?.toLowerCase() === "date"
        ? "date"
        : [target?.placeholder, label].find(detectFormatMask);
    const candidates = [
        ["explicit_associated_label", target?.associatedField],
        ["aria_label_or_labelledby", target?.attributes?.["aria-label"] ?? target?.attributes?.["aria-labelledby"]],
        ["grid_header_relationship", target?.headerContext],
        ["form_field_or_container_label", target?.containerContext],
        ["stable_business_context", target?.columnIdentity],
        ["meaningful_placeholder", target?.placeholder],
        ["stable_business_label", label],
    ];
    for (const [reason, candidate] of candidates) {
        if (!usableSemanticCandidate(candidate))
            continue;
        const displayLabel = cleanSemanticText(candidate);
        return {
            semanticField: displayLabel,
            displayLabel,
            valueKey: slugify(displayLabel),
            needsReview: false,
            reason,
            ...(formatHint ? { formatHint } : {}),
        };
    }
    const reason = formatHint
        ? "format_mask_without_business_field"
        : genericSemanticLabel(label)
            ? "generic_control_label_without_structural_context"
            : "no_durable_semantic_field_evidence";
    return {
        semanticField: null,
        displayLabel: "Campo pendiente de identificar",
        valueKey: `unresolved_value_${ordinal}`,
        needsReview: true,
        reason,
        ...(formatHint ? { formatHint } : {}),
    };
}
function isFocusOnlyEvent(event, next) {
    if (event.kind !== "tap" || !next || next.kind !== "fill")
        return false;
    const currentKey = event.target?.locators?.[0]?.value ?? event.target?.label;
    const nextKey = next.target?.locators?.[0]?.value ?? next.target?.label;
    return Boolean(currentKey && nextKey && currentKey === nextKey);
}
function isDynamicEditorInternalEvent(event) {
    const label = event.target?.label?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/…/g, "...").trim();
    return event.kind === "tap" && event.target?.interactionType !== "select"
        && (label === "indicar..." || label === "indicar" || label === "seleccionar fila");
}
function classifySemanticEvent(event, next) {
    if (event.kind === "screen_change")
        return "SCREEN_TECHNICAL_TRANSITION";
    if (event.kind === "note")
        return "TECHNICAL_NOISE";
    if (isFocusOnlyEvent(event, next))
        return "FOCUS_ONLY";
    if (isDynamicEditorInternalEvent(event))
        return "DYNAMIC_EDITOR_INTERNAL";
    if (event.kind === "fill" || event.kind === "tap")
        return "FUNCTIONAL_ACTION";
    return "TECHNICAL_NOISE";
}
function componentType(target) {
    if (target?.compoundRole === "selection")
        return "select/combobox";
    if (target?.compoundRole === "amount_or_text")
        return "textbox";
    const role = target?.role?.toLowerCase();
    const locator = target?.locators?.[0]?.strategy;
    if (role === "dialog" || role === "alertdialog")
        return "dialog";
    if (role === "grid" || role === "table")
        return "grid";
    if (role === "row")
        return "row";
    if (role === "gridcell" || role === "cell")
        return "cell";
    if (role === "combobox" || locator === "select")
        return "select/combobox";
    if (role === "checkbox")
        return "checkbox";
    if (role === "textbox" || role === "input")
        return "textbox";
    if (role === "button")
        return "button";
    if (role === "navigation")
        return "navigation";
    return target?.role || "control";
}
function affordance(target) {
    if (target?.compoundRole === "selection")
        return "selectable";
    if (target?.compoundRole === "amount_or_text")
        return "editable";
    const role = target?.role?.toLowerCase();
    if (role === "combobox" || role === "listbox" || role === "option")
        return "selectable";
    if (role === "textbox" || role === "input")
        return "editable";
    if (role === "button")
        return "clickable";
    return "observable_control";
}
function cleanTitle(screen) {
    const title = screen?.title?.trim();
    if (!title || title === screen?.screenKey)
        return undefined;
    if (/hash|fingerprint|^[a-f0-9]{8,}$/i.test(title))
        return undefined;
    return title;
}
function classifyScreen(event, previous) {
    if (event.url && previous?.url && new URL(event.url, "http://recording.invalid").pathname !== new URL(previous.url, "http://recording.invalid").pathname) {
        return "ROUTE_NAVIGATION";
    }
    if (event.kind === "screen_change")
        return event.url === previous?.url ? "DYNAMIC_COMPONENT_STATE" : "SCREEN_TRANSITION";
    return "SAME_SCREEN_MUTATION";
}
function resolutionForEvent(event, ordinal) {
    const resolution = resolveRecordedField(event.target, ordinal);
    const target = event.target;
    const suffix = target?.compoundRole === "selection"
        ? "selección"
        : isCompoundValueEditor(target)
            ? "valor"
            : undefined;
    const base = resolution.semanticField ?? target?.associatedField ?? target?.headerContext;
    if (!suffix || !base)
        return resolution;
    return {
        ...resolution,
        // The field name is the human identity. Compound roles belong in the value key so the
        // dataset can contain separate selection and value children without polluting
        // the label shown in the inspector or scenario editor.
        semanticField: base,
        displayLabel: base,
        valueKey: `${slugify(base)}_${suffix}`,
    };
}
function selectionResolutionForEvent(event, ordinal) {
    const resolution = resolutionForEvent(event, ordinal);
    const base = resolution.semanticField ?? event.target?.associatedField ?? event.target?.headerContext;
    if (!base)
        return resolution;
    return { ...resolution, semanticField: base, displayLabel: base, valueKey: `${slugify(base)}_seleccion` };
}
function datasetForObservation(observation, datasets) {
    const suffix = observation.selectable
        ? "_seleccion"
        : observation.compoundRole === "amount_or_text"
            ? "_valor"
            : "";
    const candidates = [...datasets.values()].filter((dataset) => dataset.semanticField === observation.semanticField
        && (!suffix || dataset.valueKey.endsWith(suffix)));
    return candidates.find((dataset) => dataset.instanceIdentity === observation.technicalTargetRef)
        ?? candidates[0]
        ?? [...datasets.values()].find((dataset) => dataset.semanticField === observation.semanticField);
}
function stableTechnicalTargetRef(event, target) {
    const locator = target.locators[0];
    const identity = (0, trace_normalizer_1.stableControlIdentity)(event) || target.cellRef || target.rowRef || target.containerIdentity || "unidentified";
    return `${event.screenKey}:${target.compoundRole ?? target.interactionType ?? "control"}:${locator ? `${locator.strategy}:${locator.value}` : identity}`;
}
function datasetKeyForEvent(baseKey, event, semanticField, datasets) {
    const instanceIdentity = event.target ? stableTechnicalTargetRef(event, event.target) : undefined;
    const existing = [...datasets.values()].filter((dataset) => dataset.semanticField === semanticField);
    const sameInstance = instanceIdentity && existing.find((dataset) => dataset.instanceIdentity === instanceIdentity);
    if (sameInstance)
        return { valueKey: sameInstance.valueKey, instanceIdentity };
    if (!existing.some((dataset) => dataset.valueKey === baseKey))
        return { valueKey: baseKey, instanceIdentity };
    const target = event.target;
    const structural = [target?.rowIdentity ?? target?.rowRef, target?.cellRef, target?.columnIdentity ?? target?.headerRef]
        .map((value) => value?.trim())
        .filter((value) => typeof value === "string" && value.length <= 80 && !/\s{2,}/.test(value));
    if (structural.length === 0)
        return { valueKey: baseKey, instanceIdentity };
    const suffix = slugify(structural.join(" ")).slice(0, 42);
    let valueKey = `${baseKey}_${suffix}`;
    while (datasets.has(valueKey) && datasets.get(valueKey)?.instanceIdentity !== instanceIdentity) {
        valueKey = `${baseKey}_${suffix}_${stableIdentityDigest(instanceIdentity ?? structural.join("|"))}`;
        break;
    }
    return { valueKey, instanceIdentity };
}
function componentIdentity(event, target, field) {
    // A compound field's children can have different DOM identities. Stable grid/cell/container
    // structure is the component identity; semantic label is only a fallback when structure is
    // absent, never the grouping key by itself.
    const controlPart = [field, target.associatedField, target.role, target.tag, target.compoundRole, (0, trace_normalizer_1.stableControlIdentity)(event)]
        .map((value) => value?.trim())
        .find(Boolean) ?? "unidentified";
    if (target.cellRef)
        return `${event.screenKey}:cell:${target.cellRef}:control:${controlPart}`;
    const durableContainer = target.containerIdentity && !/(?:radix-|headlessui-|mui-|:r\b)/i.test(target.containerIdentity)
        ? target.containerIdentity
        : undefined;
    if (durableContainer)
        return `${event.screenKey}:container:${durableContainer}:control:${controlPart}`;
    if (target.rowIdentity && field)
        return `${event.screenKey}:row:${target.rowIdentity}:field:${field}`;
    const identity = (0, trace_normalizer_1.stableControlIdentity)(event) || field || target.role || "unidentified";
    return `${event.screenKey}:control:${identity}`;
}
function stableIdentityDigest(value) {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36).slice(0, 8);
}
function shouldMaterializeTechnicalComponent(event, target) {
    if (event.kind !== "note")
        return true;
    const hasStableTarget = target.locators.length > 0
        || Object.keys(target.attributes ?? {}).some((key) => ["id", "name", "data-testid", "data-test-id", "data-qa"].includes(key))
        || Boolean(target.cellRef || target.rowRef || target.headerRef || target.associatedField || target.compoundRole);
    // Keep the raw note itself, but do not turn a body/form aggregate into a new semantic
    // component on every snapshot.
    return hasStableTarget && (target.label?.length ?? 0) <= 120;
}
function selectorContextForEvent(events, index) {
    const event = events[index];
    const target = event.target;
    if (!target || target.compoundRole !== "selection")
        return {};
    const parent = target.role?.toLowerCase() === "option"
        ? events.slice(Math.max(0, index - 40), index).reverse().find((candidate) => {
            const candidateTarget = candidate.target;
            const role = candidateTarget?.role?.toLowerCase();
            return candidate.screenKey === event.screenKey
                && candidateTarget?.compoundRole === "selection"
                && role !== "option"
                && Boolean(candidateTarget?.associatedField || candidateTarget?.cellRef || candidateTarget?.gridRef);
        })
        : undefined;
    const selectorTarget = parent?.target ?? target;
    const selectorControlId = selectorTarget.eventTargetRef
        ?? selectorTarget.cellRef
        ?? selectorTarget.currentTargetRef
        ?? (0, trace_normalizer_1.stableControlIdentity)({ ...event, target: selectorTarget });
    const semanticField = selectorTarget.associatedField
        ?? selectorTarget.headerContext
        ?? (target.role?.toLowerCase() === "option" ? undefined : target.label);
    const entityScope = selectorTarget.entityScope ?? target.entityScope;
    return {
        selectorControlId,
        optionSurfaceId: `${event.screenKey}|${selectorControlId}|option-surface`,
        ...(semanticField ? { semanticField } : {}),
        ...(entityScope ? { entityScope } : {}),
    };
}
function buildSemanticRecordingModel(trace, inputEvents = (0, trace_normalizer_1.normalizeEvents)(trace.events)) {
    const rawEvents = [...trace.events];
    const events = [...inputEvents];
    const editingSessions = (0, trace_normalizer_1.buildEditingSessions)(rawEvents);
    const recordingDataPolicy = normalizeRecordingDataPolicy(trace.recordingDataPolicy);
    const screens = trace.screens.map((screen) => ({
        screenIdentity: screen.screenKey,
        title: cleanTitle(screen),
        url: screen.url,
        classification: "SCREEN_TRANSITION",
        sourceScreenKey: screen.screenKey,
    }));
    const screenByKey = new Map(screens.map((screen) => [screen.sourceScreenKey, screen]));
    const observations = [];
    const components = new Map();
    const datasets = new Map();
    const semanticEvents = [];
    const editingSessionById = new Map(editingSessions.map((session) => [session.editingSessionId, session]));
    const selectorInventories = new Map();
    for (const [index, event] of events.entries()) {
        const target = event.target;
        const fieldResolution = event.kind === "fill"
            ? resolutionForEvent(event, index + 1)
            : event.kind === "tap" && (target?.interactionType === "select" || target?.afterValue !== undefined)
                ? selectionResolutionForEvent(event, index + 1)
                : undefined;
        const field = fieldResolution?.semanticField ? fieldResolution.semanticField : undefined;
        const observationId = `obs-${index + 1}`;
        const technicalTargetRef = target ? stableTechnicalTargetRef(event, target) : `${event.screenKey}:event-${index + 1}`;
        const editingSession = target?.editingSessionRef ? editingSessionById.get(target.editingSessionRef) : undefined;
        const aggregateOnly = aggregateTextUsedAsValue(event) || editingSession?.needsReview === true;
        const selectorContext = selectorContextForEvent(events, index);
        const observationField = selectorContext.semanticField
            ?? fieldResolution?.semanticField
            ?? target?.associatedField
            ?? target?.headerContext;
        if (target) {
            const type = componentType(target);
            observations.push({
                observationId,
                status: event.kind === "tap" || event.kind === "fill" ? "VALIDATED" : "OBSERVED",
                screenIdentity: event.screenKey,
                componentType: type,
                label: target.label,
                tag: target.tag,
                role: target.role,
                attributes: target.attributes,
                placeholder: target.placeholder,
                containerContext: target.containerContext,
                headerContext: target.headerContext,
                rowContext: target.rowContext,
                rowIdentity: target.rowIdentity,
                entityScope: target.entityScope,
                columnIdentity: target.columnIdentity,
                associatedField: target.associatedField,
                gridRef: target.gridRef,
                cellRef: target.cellRef,
                headerRef: target.headerRef,
                containerIdentity: target.containerIdentity,
                beforeValue: target.beforeValue,
                afterValue: target.afterValue,
                observedOptions: target.observedOptions,
                compoundRole: target.compoundRole,
                semanticField: observationField,
                needsReview: fieldResolution ? fieldResolution.needsReview || aggregateOnly : undefined,
                reviewReason: aggregateOnly ? "aggregate_compound_text_without_separate_control_evidence" : fieldResolution?.reason,
                formatHint: fieldResolution?.formatHint,
                enabled: target.enabled,
                bounds: target.bounds,
                locatorCandidates: target.locators,
                technicalTargetCandidates: target.technicalTargetCandidates,
                confidence: target.locators[0]?.confidence ?? (target.locators.length > 0 ? 0.9 : 0.4),
                technicalTargetRef,
                dynamicLifecycle: target.dynamicLifecycle,
                validatedByInteraction: event.kind === "tap" || event.kind === "fill",
                editingSessionRef: target.editingSessionRef,
                inputValue: target.inputValue,
                committedValue: target.committedValue,
                displayValue: target.displayValue,
                ...selectorContext,
                ...(selectorContext.semanticField && (target.observedOptions?.length ?? 0) > 1 ? { optionInventoryObserved: true } : {}),
                ...(target.afterValue && target.role?.toLowerCase() === "option" ? { selectedOptionObserved: target.afterValue } : {}),
                selectable: affordance(target) === "selectable",
                editable: affordance(target) === "editable",
            });
            if (selectorContext.selectorControlId && target.compoundRole === "selection") {
                const options = [...new Set(target.observedOptions ?? target.dynamicLifecycle?.options ?? [])].filter(Boolean);
                const inventoryKey = `${selectorContext.optionSurfaceId}|${selectorContext.semanticField ?? ""}|${selectorContext.entityScope ?? ""}`;
                const inventory = selectorInventories.get(inventoryKey) ?? {
                    selectorRef: selectorContext.selectorControlId,
                    semanticField: selectorContext.semanticField ?? null,
                    ...(selectorContext.entityScope ? { entityScope: selectorContext.entityScope } : {}),
                    surfaceRef: selectorContext.optionSurfaceId ?? inventoryKey,
                    options: [],
                    observationRefs: [],
                };
                inventory.options = [...new Set([...inventory.options, ...options])];
                if (target.afterValue && target.role?.toLowerCase() === "option")
                    inventory.selectedOption = target.afterValue;
                inventory.observationRefs = [...new Set([...inventory.observationRefs, observationId])];
                selectorInventories.set(inventoryKey, inventory);
            }
            if (shouldMaterializeTechnicalComponent(event, target)) {
                const componentId = componentIdentity(event, target, field);
                const component = components.get(componentId) ?? {
                    componentId,
                    componentType: type,
                    screenIdentity: event.screenKey,
                    label: field ?? target.label,
                    associatedField: target.associatedField,
                    rowIdentity: target.rowIdentity,
                    entityScope: target.entityScope,
                    needsReview: fieldResolution?.needsReview || aggregateOnly,
                    reviewReason: aggregateOnly ? "aggregate_compound_text_without_separate_control_evidence" : fieldResolution?.reason,
                    observationRefs: [],
                };
                component.observationRefs.push(observationId);
                components.set(componentId, component);
            }
        }
        const role = target?.role?.toLowerCase();
        const valueKey = fieldResolution?.valueKey;
        if (event.kind === "fill" && fieldResolution) {
            const sensitive = isSensitiveRecordedEvent(event);
            const applicationDerived = event.valueSource === "application";
            const datasetKey = datasetKeyForEvent(fieldResolution.valueKey, event, fieldResolution.semanticField, datasets);
            const hasEditableChildEvidence = target?.compoundRole === "amount_or_text"
                && Boolean(editingSession?.deepestEditableTargetRef)
                && (target?.deepestEditableTargetRef !== target?.currentTargetRef || editingSession?.deepestEditableTargetRef !== editingSession?.currentTargetRef);
            const compoundSelectionValue = (0, compound_value_1.confirmedCompoundSelectionBefore)(events, index, target);
            const logicalChildValue = hasEditableChildEvidence || editingSession?.finalValue !== undefined
                ? (0, compound_value_1.logicalCompoundChildValue)(editingSession?.finalValue, compoundSelectionValue)
                    ?? (0, compound_value_1.logicalCompoundChildValue)(editingSession?.rawTypedValue, compoundSelectionValue)
                    ?? editingSession?.finalValue
                    ?? editingSession?.rawTypedValue
                    ?? editingSession?.logicalBuffer
                    ?? (0, trace_normalizer_1.reconstructLogicalInputBuffer)(editingSession ?? {})
                : undefined;
            const dependency = event.dependsOnEventRef
                ? semanticEvents.find((candidate) => candidate.eventRef === event.dependsOnEventRef)?.valueKey
                : undefined;
            datasets.set(datasetKey.valueKey, {
                valueKey: datasetKey.valueKey,
                semanticField: fieldResolution.semanticField,
                valueRole: applicationDerived ? "runtime_derived_oracle" : sensitive ? "secure_input" : "action_input",
                value: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : (logicalChildValue ?? target?.rawTypedValue ?? event.value),
                ...(logicalChildValue ? { rawTypedValue: logicalChildValue, committedValue: logicalChildValue } : {}),
                ...(target?.rawTypedValue ? { rawTypedValue: target.rawTypedValue } : {}),
                ...(target?.committedValue ? { committedValue: target.committedValue } : {}),
                ...(target?.displayValue ? { displayValue: target.displayValue } : {}),
                source: applicationDerived ? "OBSERVED" : sensitive ? "secure" : "RECORDED_CONFIRMED",
                verified: true,
                confidence: fieldResolution.needsReview || aggregateOnly ? 0.4 : 0.9,
                sensitive,
                generated: false,
                ...(datasetKey.instanceIdentity ? { instanceIdentity: datasetKey.instanceIdentity } : {}),
                ...(dependency ? { dependsOn: [dependency], dependencyConfidence: 0.9 } : {}),
                recordingId: trace.recordingId,
                needsReview: fieldResolution.needsReview || aggregateOnly,
                reviewReason: aggregateOnly ? "aggregate_compound_text_without_separate_control_evidence" : fieldResolution.reason,
                ...(fieldResolution.formatHint ? { formatHint: fieldResolution.formatHint } : {}),
            });
        }
        if (event.kind === "tap" && (target?.interactionType === "select" || target?.afterValue !== undefined) && target.afterValue !== undefined) {
            const selectionResolution = selectionResolutionForEvent(event, index + 1);
            const selectionField = selectionResolution.semanticField ?? "Campo pendiente de identificar";
            const datasetKey = datasetKeyForEvent(selectionResolution.valueKey, event, selectionField, datasets);
            const selectionKey = datasetKey.valueKey;
            datasets.set(selectionKey, {
                valueKey: selectionKey,
                semanticField: selectionField,
                valueRole: "action_input",
                value: target.afterValue,
                source: "RECORDED_CONFIRMED",
                verified: true,
                confidence: selectionResolution.needsReview ? 0.4 : 0.9,
                sensitive: false,
                generated: false,
                ...(datasetKey.instanceIdentity ? { instanceIdentity: datasetKey.instanceIdentity } : {}),
                recordingId: trace.recordingId,
                needsReview: selectionResolution.needsReview,
                reviewReason: selectionResolution.reason,
            });
        }
        semanticEvents.push({
            eventRef: `event-${index + 1}`,
            action: event.kind === "tap"
                ? target?.interactionType === "select" ? "select" : (role === "button" ? "click" : "activate")
                : event.kind === "fill" ? "fill" : event.kind === "navigate" ? "navigate" : "observe",
            screenIdentity: event.screenKey,
            componentType: target ? componentType(target) : undefined,
            field,
            associatedField: target?.associatedField,
            controlAffordance: target ? affordance(target) : undefined,
            valueKey: valueKey
                ? slugify(event.redactedKey ?? (event.kind === "fill" && fieldResolution
                    ? datasetKeyForEvent(fieldResolution.valueKey, event, fieldResolution.semanticField, datasets).valueKey
                    : valueKey))
                : undefined,
            valueRole: event.kind === "fill"
                ? event.valueSource === "application"
                    ? "runtime_derived_oracle"
                    : isSensitiveRecordedEvent(event) ? "secure_input" : "action_input"
                : undefined,
            technicalTargetRef: target ? technicalTargetRef : undefined,
            beforeState: target?.beforeState ? JSON.stringify(target.beforeState) : undefined,
            afterState: target?.afterState ? JSON.stringify(target.afterState) : target?.afterValue,
            provenance: "OBSERVED",
            confidence: target?.locators?.length ? 0.9 : 0.4,
            classification: classifySemanticEvent(event, events.slice(index + 1).find((candidate) => candidate.kind === "tap" || candidate.kind === "fill")),
        });
    }
    for (let i = 1; i < semanticEvents.length; i += 1) {
        const previous = semanticEvents[i - 1];
        const current = semanticEvents[i];
        if (previous.field && previous.field === current.field && previous.technicalTargetRef !== current.technicalTargetRef) {
            const observation = observations[i];
            if (observation) {
                observation.editorLifecycle = "dynamic";
                observation.stateTransitions = ["control_identity_changed"];
            }
        }
    }
    const previousByScreen = new Map();
    for (const event of events) {
        const screen = screenByKey.get(event.screenKey);
        if (screen)
            screen.classification = classifyScreen(event, previousByScreen.get(event.screenKey));
        previousByScreen.set(event.screenKey, event);
    }
    // Screen controls are evidence too, even when the person never activated them. Keeping
    // them separate from events lets the reviewer distinguish an observed control from an
    // executed action and gives the model enough structure to recognize grids and compounds.
    for (const screen of trace.screens) {
        const screenControls = screen.controls ?? [];
        const roleSet = new Set(screenControls.map((control) => control.role?.toLowerCase()).filter(Boolean));
        const gridEvidence = roleSet.has("combobox") && roleSet.has("checkbox") && screenControls.length >= 4;
        if (gridEvidence) {
            const componentId = `${screen.screenKey}:editable-grid`;
            components.set(componentId, {
                componentId,
                componentType: "editable_grid",
                screenIdentity: screen.screenKey,
                observationRefs: [],
            });
        }
        for (const [index, control] of screenControls.entries()) {
            const observationId = `screen-${screen.screenKey}-control-${index + 1}`;
            const type = componentType(control);
            const observation = {
                observationId,
                status: "OBSERVED",
                screenIdentity: screen.screenKey,
                componentType: type,
                label: control.label,
                tag: control.tag,
                role: control.role,
                attributes: control.attributes,
                placeholder: control.placeholder,
                containerContext: control.containerContext,
                headerContext: control.headerContext,
                rowContext: control.rowContext,
                rowIdentity: control.rowIdentity,
                gridRef: control.gridRef,
                cellRef: control.cellRef,
                headerRef: control.headerRef,
                containerIdentity: control.containerIdentity,
                associatedField: control.associatedField,
                observedOptions: undefined,
                semanticField: control.headerContext ?? control.associatedField ?? null,
                needsReview: !usableSemanticCandidate(control.headerContext ?? control.associatedField),
                reviewReason: usableSemanticCandidate(control.headerContext ?? control.associatedField) ? undefined : "no_durable_semantic_field_evidence",
                enabled: control.enabled,
                bounds: control.bounds,
                locatorCandidates: control.locators,
                confidence: control.locators[0]?.confidence ?? 0.4,
                technicalTargetRef: `${screen.screenKey}:control:${index + 1}`,
                selectable: affordance(control) === "selectable",
                editable: affordance(control) === "editable",
            };
            observations.push(observation);
            if (gridEvidence)
                components.get(`${screen.screenKey}:editable-grid`)?.observationRefs.push(observationId);
        }
    }
    // A richer Web trace can identify separate children in the same row/cell. Pair only when
    // that structural relationship is present; proximity or a column ordinal is not enough.
    const structuralGroups = new Map();
    for (const observation of observations) {
        const compact = (value) => {
            const clean = value?.trim();
            return clean && clean.length <= 80 && !/\s{2,}/.test(clean) ? clean : undefined;
        };
        const sameFieldKey = observation.associatedField ?? observation.headerContext;
        const key = compact(observation.cellRef)
            ? `${observation.screenIdentity}:cell:${compact(observation.cellRef)}`
            : compact(observation.rowIdentity)
                ? `${observation.screenIdentity}:row:${compact(observation.rowIdentity)}`
                : compact(observation.containerIdentity)
                    ? `${observation.screenIdentity}:container:${compact(observation.containerIdentity)}`
                    : sameFieldKey
                        ? `${observation.screenIdentity}:field:${sameFieldKey}`
                        : undefined;
        if (!key)
            continue;
        const group = structuralGroups.get(key) ?? [];
        group.push(observation);
        structuralGroups.set(key, group);
    }
    for (const [groupKey, group] of structuralGroups) {
        const selectable = group.find((item) => item.selectable || item.componentType === "select/combobox");
        const editable = group.find((item) => item.editable);
        if (!selectable || !editable || selectable.observationId === editable.observationId)
            continue;
        const selectableField = selectable.associatedField ?? selectable.headerContext;
        const editableField = editable.associatedField ?? editable.headerContext;
        const sameCell = Boolean(selectable.cellRef && editable.cellRef && selectable.cellRef === editable.cellRef);
        const sameField = Boolean(selectableField && editableField && selectableField === editableField);
        if (!sameCell && !sameField && selectableField && editableField)
            continue;
        const componentId = groupKey;
        const existing = components.get(componentId);
        components.set(componentId, {
            ...existing,
            componentId,
            componentType: "compound_field",
            screenIdentity: selectable.screenIdentity,
            rowIdentity: selectable.rowIdentity,
            associatedField: editable.semanticField ?? selectable.semanticField ?? undefined,
            label: editable.semanticField ?? selectable.semanticField ?? undefined,
            compoundField: true,
            children: [
                {
                    semanticRole: "selection",
                    affordance: "selectable",
                    technicalTargetRef: selectable.technicalTargetRef,
                    valueKey: datasetForObservation(selectable, datasets)?.valueKey,
                    recordedValue: datasetForObservation(selectable, datasets)?.value,
                    technicalObservationRefs: [selectable.observationId],
                    lifecycle: selectable.dynamicLifecycle,
                    confidence: selectable.confidence,
                    needsReview: selectable.needsReview,
                },
                {
                    semanticRole: "amount_or_text",
                    affordance: "editable",
                    technicalTargetRef: editable.technicalTargetRef,
                    valueKey: datasetForObservation(editable, datasets)?.valueKey,
                    recordedValue: datasetForObservation(editable, datasets)?.value,
                    technicalObservationRefs: [editable.observationId],
                    lifecycle: editable.dynamicLifecycle,
                    confidence: editable.confidence,
                    needsReview: editable.needsReview,
                },
            ],
            observationRefs: [...new Set([...(existing?.observationRefs ?? []), ...group.map((item) => item.observationId)])],
        });
    }
    // A generic DOM observation is useful raw evidence, but it must not become a second
    // component when the same label/control already has a stable semantic component. Keep
    // the observation in Technical Knowledge and remove only the duplicate component bucket.
    const componentEntries = [...components.entries()];
    const observationById = new Map(observations.map((observation) => [observation.observationId, observation]));
    const specificObservations = componentEntries
        .filter(([id, component]) => !/:control:(?:input|button|textbox|control)$/i.test(id) && !component.componentId.includes(":editable-grid"))
        .flatMap(([, component]) => component.observationRefs.map((ref) => observationById.get(ref)).filter((observation) => Boolean(observation)));
    const specificLabels = new Set(componentEntries
        .filter(([id, component]) => !/:control:(?:input|button|textbox|control)$/i.test(id)
        && Boolean(component.label && usableSemanticCandidate(component.label)))
        .map(([, component]) => `${component.screenIdentity}|${component.label?.trim().toLowerCase()}`));
    for (const [id, component] of componentEntries) {
        const isGenericBucket = /:control:(?:input|button|textbox|control)$/i.test(id);
        const labelKey = `${component.screenIdentity}|${component.label?.trim().toLowerCase()}`;
        const genericObservations = component.observationRefs.map((ref) => observationById.get(ref)).filter((observation) => Boolean(observation));
        const identityPrefix = id.split(":control:")[0];
        const stableSibling = isGenericBucket
            ? componentEntries.find(([candidateId, candidate]) => !/:control:(?:input|button|textbox|control)$/i.test(candidateId)
                && candidate.screenIdentity === component.screenIdentity
                && candidateId.split(":control:")[0] === identityPrefix)
            : undefined;
        const hasSpecificEvidenceMatch = isGenericBucket && genericObservations.length > 0 && genericObservations.every((generic) => specificObservations.some((specific) => {
            const sameLocator = generic.locatorCandidates.some((candidate) => specific.locatorCandidates.some((other) => candidate.strategy === other.strategy && candidate.value === other.value));
            const sameTechnicalTarget = generic.technicalTargetRef === specific.technicalTargetRef;
            const sameCell = Boolean(generic.cellRef && specific.cellRef && generic.cellRef === specific.cellRef);
            return generic.screenIdentity === specific.screenIdentity && sameCell && (sameLocator || sameTechnicalTarget);
        }));
        if (isGenericBucket && stableSibling) {
            stableSibling[1].observationRefs = [...new Set([...stableSibling[1].observationRefs, ...component.observationRefs])];
            components.delete(id);
            continue;
        }
        if (isGenericBucket && (specificLabels.has(labelKey) || hasSpecificEvidenceMatch))
            components.delete(id);
    }
    return {
        version: "1.0",
        recordingId: trace.recordingId,
        projectSlug: trace.projectSlug,
        appSlug: trace.appSlug,
        platform: trace.platform,
        recordingGoal: trace.recordingGoal,
        recordingDataPolicy,
        selectorOptionInventories: [...selectorInventories.values()].filter((inventory) => inventory.options.length > 0),
        semanticScreens: screens,
        semanticComponents: [...components.values()],
        semanticEvents,
        datasets: [...datasets.values()],
        technicalObservations: observations,
        editingSessions,
        scenarioSuggestions: [],
        canonicalInteractions: (0, canonical_recording_contract_1.buildCanonicalInteractions)(events, editingSessions),
        gridMetadata: trace.screens.reduce((summary, screen) => {
            const grid = screen.gridMetadata;
            if (!grid)
                return summary;
            summary.detected = summary.detected || grid.detected;
            summary.grids += grid.grids ?? (grid.detected ? 1 : 0);
            summary.rows += grid.rows;
            summary.cells += grid.cells;
            for (const header of grid.headers)
                if (!summary.headers.includes(header))
                    summary.headers.push(header);
            for (const relation of grid.headerRelationships) {
                if (!summary.headerRelationships.some((item) => item.header === relation.header && item.field === relation.field)) {
                    summary.headerRelationships.push(relation);
                }
            }
            return summary;
        }, { detected: false, grids: 0, rows: 0, cells: 0, headers: [], headerRelationships: [] }),
        source: "SessionTrace",
    };
}
function attachScenarioSuggestions(model, suggestions) {
    return { ...model, scenarioSuggestions: [...suggestions] };
}
/** Stable signal used by live polling to ignore focus/hover/duplicate noise. */
function semanticChangeSignature(events, screens) {
    const meaningful = events
        .filter((event) => ["launch", "tap", "fill", "navigate", "back", "screen_change"].includes(event.kind))
        .map((event) => [event.kind, event.screenKey, event.toScreenKey ?? "", event.target?.label ?? "", event.target?.associatedField ?? ""].join("|"));
    const screenKeys = screens.map((screen) => `${screen.screenKey}:${screen.controls.length}`).sort();
    return [...meaningful, ...screenKeys].join(";");
}
function hasSignificantSemanticChange(previous, next) {
    if (!previous)
        return true;
    return semanticChangeSignature(previous.events, previous.screens) !== semanticChangeSignature(next.events, next.screens);
}
