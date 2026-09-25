"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stableControlIdentity = stableControlIdentity;
exports.buildEditingSessions = buildEditingSessions;
exports.reconstructLogicalInputBuffer = reconstructLogicalInputBuffer;
exports.normalizeEvents = normalizeEvents;
exports.isGenericUnresolvedLabel = isGenericUnresolvedLabel;
exports.segmentTrace = segmentTrace;
exports.summarizeTrace = summarizeTrace;
const GENERIC_UNRESOLVED_LABELS = new Set([
    "campo", "field", "control", "input", "textbox", "indicar", "indicar...", "seleccionar fila",
]);
function isGenericUnresolvedLabel(value) {
    const normalized = value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/…/g, "...").replace(/\.+$/g, "").trim();
    return !normalized || GENERIC_UNRESOLVED_LABELS.has(normalized);
}
/** Identity of the control an event addressed, for comparing consecutive events. */
function firstAttribute(target, names) {
    for (const name of names) {
        const value = target.attributes?.[name]?.trim();
        if (!value)
            continue;
        // Portal libraries commonly generate ids per render. They are useful raw evidence but
        // cannot be the durable identity of a control across executions.
        if (name === "id" && /^(?:radix-|:r|headlessui-|mui-)/i.test(value))
            continue;
        return value;
    }
    return undefined;
}
function stableRef(value) {
    const clean = value?.trim();
    if (!clean || clean.length > 80 || /\s{2,}/.test(clean))
        return undefined;
    return clean;
}
function durableDomId(value) {
    const clean = stableRef(value);
    return clean && !/^(?:radix-|:r|headlessui-|mui-)/i.test(clean) ? clean : undefined;
}
function stableStructuralRef(value) {
    const clean = stableRef(value);
    if (!clean)
        return undefined;
    // A fallback such as `row:<entire rendered row>` or `cell:<header>:<row text>` is
    // technically present but changes after every edit. Explicit ids and the recorder's
    // ordinal fallbacks remain compact and have no whitespace.
    return /^(?:row|cell):/.test(clean) && /[\s,;]/.test(clean) ? undefined : clean;
}
function yAnchor(target) {
    const y = target.bounds?.y ?? target.beforeState?.bounds?.y ?? target.afterState?.bounds?.y;
    return typeof y === "number" ? `y:${Math.round(y / 4) * 4}` : undefined;
}
/** Identity deliberately excludes timestamp, event sequence and live parent text. */
function stableControlIdentity(event) {
    const target = event.target;
    if (!target)
        return "";
    const state = target.afterState ?? target.beforeState;
    const explicit = firstAttribute(target, ["data-testid", "data-test-id", "data-qa", "id", "name"])
        || durableDomId(state?.id)
        || state?.name;
    const grid = stableRef(target.gridRef);
    const row = stableStructuralRef(target.rowRef) || stableStructuralRef(target.rowIdentity);
    const cell = stableStructuralRef(target.cellRef);
    const header = stableRef(target.headerRef) || stableRef(target.headerContext) || stableRef(state?.label);
    const label = stableRef(target.label) || stableRef(state?.label);
    const field = stableRef(target.associatedField) || header || stableRef(target.attributes?.["aria-labelledby"]) || label;
    const stateRole = state?.role?.trim();
    const stateTag = state?.tag?.trim();
    const role = target.compoundRole
        || (target.interactionType === "select" ? "selection" : undefined)
        || (target.role === "input" || target.role === "textbox" || target.tag === "input" || target.tag === "textarea"
            || stateRole === "input" || stateRole === "textbox" || stateTag === "input" || stateTag === "textarea" ? "amount_or_text" : target.role?.trim() || stateRole)
        || "control";
    const locator = target.locators?.[0] ? `${target.locators[0].strategy}:${target.locators[0].value}` : undefined;
    // Prefer the strongest durable identity and only fall back to a locator/position. Do not
    // concatenate every signal: a locator can legitimately change after a DOM replacement while
    // the id, grid cell, or associated field remains the same control.
    const primary = explicit || (cell && header ? `${cell}:${header}` : undefined) || field || locator || role;
    return [event.screenKey, grid, row, cell, header, primary, role]
        .filter(Boolean)
        .join("|");
}
function targetKey(event) {
    return stableControlIdentity(event);
}
function incompleteTechnicalIdentity(event) {
    if (event.kind !== "note")
        return false;
    const target = event.target;
    if (!target || target.associatedField || target.compoundRole)
        return false;
    const signal = `${target.label ?? ""} ${target.headerContext ?? ""}`.trim().toLowerCase().replace(/…/g, "...");
    const generic = new Set(["campo", "control", "input", "textbox", "indicar", "indicar..."]);
    const looksLikeFormatMask = (token) => /^(?:0{2,}[\d\-/:]*|d{2,}[\d\-/:]*)$/i.test(token);
    const label = (target.label ?? "").trim().toLowerCase().replace(/…/g, "...");
    const labelTokens = label.split(/\s+/).filter(Boolean);
    const unstableLabel = !label || labelTokens.every((token) => generic.has(token) || looksLikeFormatMask(token));
    const tokens = signal.split(/\s+/).filter(Boolean);
    const genericOrMask = tokens.length > 0 && tokens.every((token) => generic.has(token) || looksLikeFormatMask(token));
    return !signal || unstableLabel || genericOrMask;
}
function nearestTechnicalSessionIdentity(event, grouped) {
    const anchor = yAnchor(event.target);
    if (!anchor)
        return undefined;
    return [...grouped.values()]
        .filter((entry) => entry.session.screenIdentity === event.screenKey)
        .filter((entry) => entry.lastEventAt <= event.t && event.t - entry.lastEventAt <= 1_000)
        .filter((entry) => entry.session.controlIdentity.includes(anchor))
        .sort((a, b) => b.lastEventAt - a.lastEventAt)[0]?.session.controlIdentity;
}
function valueEvidence(event) {
    const target = event.target;
    const snapshot = target?.afterState;
    const present = (value) => isUsefulValue(value) ? value : undefined;
    return {
        rawTyped: present(target?.rawTypedValue),
        input: present(target?.inputValue ?? (event.kind === "fill" ? event.value ?? snapshot?.value : undefined)),
        committed: present(target?.committedValue ?? (event.observationType === "post_action" ? snapshot?.value : undefined)),
        display: present(target?.displayValue),
    };
}
function aggregateDisplayValue(value) {
    return Boolean(value && /^(?:[A-Z]{3})\s+\d/.test(value.trim()));
}
function isEditingEvidence(event) {
    if (event.kind === "fill")
        return true;
    if (event.kind === "tap") {
        return event.target?.interactionType === "select" || event.target?.compoundRole === "selection";
    }
    if (event.kind !== "note" || !["pointer", "focus", "before_input", "post_action", "dom_mutation"].includes(event.observationType ?? "")) {
        return false;
    }
    const target = event.target;
    const role = (target?.role ?? target?.afterState?.role ?? target?.beforeState?.role)?.toLowerCase();
    const tag = (target?.tag ?? target?.afterState?.tag ?? target?.beforeState?.tag)?.toLowerCase();
    return target?.compoundRole === "selection"
        || target?.compoundRole === "amount_or_text"
        || ["input", "textarea", "select", "textbox", "combobox", "listbox", "option"].includes(role ?? "")
        || ["input", "textarea", "select"].includes(tag ?? "")
        || Boolean(target?.inputValue !== undefined || target?.committedValue !== undefined);
}
function isUsefulValue(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function selectionOptionEvidence(event, events) {
    const label = event.target?.label?.trim();
    if (!label)
        return undefined;
    return events
        .filter((candidate) => candidate.kind === "note")
        .filter((candidate) => candidate.target?.compoundRole === "selection")
        .filter((candidate) => candidate.target?.afterValue === label || candidate.target?.dynamicLifecycle?.selectedOption === label)
        .filter((candidate) => Math.abs(candidate.t - event.t) <= 15_000)
        .sort((a, b) => Math.abs(a.t - event.t) - Math.abs(b.t - event.t))[0];
}
function promoteDynamicSelection(event, index, events) {
    const evidence = selectionOptionEvidence(event, events);
    const lifecycle = event.target?.dynamicLifecycle;
    const hasDynamicSurface = Boolean(event.target?.observedOptions?.length || lifecycle?.options?.length || lifecycle?.selectedOption || lifecycle?.committedState);
    if (event.kind !== "tap")
        return event;
    if ((event.target?.interactionType === "select" || event.target?.compoundRole === "selection")
        && (event.target?.afterValue !== undefined || !hasDynamicSurface))
        return event;
    if (!evidence && !hasDynamicSurface)
        return event;
    const followingEditable = events.slice(index + 1).find((candidate) => candidate.kind === "fill" && candidate.target?.associatedField && candidate.t - event.t <= 15_000);
    const optionTarget = evidence?.target;
    return {
        ...event,
        target: {
            ...event.target,
            interactionType: "select",
            compoundRole: "selection",
            associatedField: event.target?.associatedField || followingEditable?.target?.associatedField,
            headerContext: event.target?.headerContext || followingEditable?.target?.headerContext,
            afterValue: event.target?.afterValue ?? optionTarget?.afterValue ?? optionTarget?.dynamicLifecycle?.selectedOption ?? lifecycle?.selectedOption ?? lifecycle?.committedState,
            observedOptions: event.target?.observedOptions?.length ? event.target.observedOptions : optionTarget?.observedOptions ?? lifecycle?.options,
            dynamicLifecycle: {
                ...lifecycle,
                ...optionTarget?.dynamicLifecycle,
                triggerTechnicalTarget: event.target?.containerIdentity || event.target?.label,
                activatedTechnicalTarget: optionTarget?.dynamicLifecycle?.activatedTechnicalTarget || optionTarget?.label,
            },
        },
    };
}
function buildEditingSessions(events) {
    const grouped = new Map();
    for (const [index, original] of events.entries()) {
        const event = promoteDynamicSelection(original, index, events);
        if (!isEditingEvidence(event))
            continue;
        const identity = incompleteTechnicalIdentity(event)
            ? nearestTechnicalSessionIdentity(event, grouped) ?? targetKey(event)
            : targetKey(event);
        if (!identity)
            continue;
        const evidence = valueEvidence(event);
        const value = evidence.committed ?? evidence.input ?? event.target?.afterValue;
        let entry = grouped.get(identity);
        if (!entry) {
            entry = {
                session: {
                    editingSessionId: `edit-${grouped.size + 1}`,
                    controlIdentity: identity,
                    screenIdentity: event.screenKey,
                    startedAt: event.t,
                    endedAt: event.t,
                    rawEventRefs: [],
                    intermediateValues: [],
                    commitReason: "observed_final_value",
                    technicalTargetRefs: [],
                    compoundRole: event.target?.compoundRole,
                },
                lastEventAt: event.t,
                values: [],
            };
            grouped.set(identity, entry);
        }
        entry.session.endedAt = Math.max(entry.session.endedAt, event.t);
        entry.lastEventAt = event.t;
        entry.session.rawEventRefs.push(`event-${event.seq + 1}`);
        const technicalRef = `${event.screenKey}:${event.target?.locators?.[0]
            ? `${event.target.locators[0].strategy}:${event.target.locators[0].value}`
            : identity}`;
        if (!entry.session.technicalTargetRefs.includes(technicalRef))
            entry.session.technicalTargetRefs.push(technicalRef);
        if (event.target?.eventTargetRef && !entry.session.eventTargetRef)
            entry.session.eventTargetRef = event.target.eventTargetRef;
        if (event.target?.currentTargetRef && !entry.session.currentTargetRef)
            entry.session.currentTargetRef = event.target.currentTargetRef;
        if (event.target?.deepestEditableTargetRef && !entry.session.deepestEditableTargetRef) {
            entry.session.deepestEditableTargetRef = event.target.deepestEditableTargetRef;
        }
        if (event.target?.composedPathRefs?.length) {
            const refs = new Set(entry.session.composedPathRefs ?? []);
            for (const ref of event.target.composedPathRefs)
                refs.add(ref);
            entry.session.composedPathRefs = [...refs].slice(0, 16);
        }
        const initial = event.target?.beforeState?.value ?? event.target?.beforeValue;
        if (entry.session.initialValue === undefined && isUsefulValue(initial))
            entry.session.initialValue = initial;
        if (isUsefulValue(value)) {
            if (!entry.values.includes(value))
                entry.values.push(value);
            if (aggregateDisplayValue(value) && event.target?.compoundRole === "amount_or_text") {
                entry.session.needsReview = true;
                entry.session.reviewReason = "parent_or_formatted_aggregate_without_separate_inner_editor_value";
            }
        }
        if (evidence.input !== undefined)
            entry.session.inputValue = evidence.input;
        if (evidence.rawTyped !== undefined)
            entry.session.rawTypedValue = evidence.rawTyped;
        if (event.target?.inputEventData?.length) {
            entry.session.inputEventData = [...(entry.session.inputEventData ?? []), ...event.target.inputEventData];
        }
        if (event.target?.inputTypes?.length) {
            entry.session.inputTypes = [...(entry.session.inputTypes ?? []), ...event.target.inputTypes];
        }
        if (evidence.committed !== undefined)
            entry.session.committedValue = evidence.committed;
        if (evidence.display !== undefined)
            entry.session.displayValue = evidence.display;
        if (event.target?.associatedField)
            entry.session.semanticField = event.target.associatedField;
    }
    return [...grouped.values()].map(({ session, values }) => {
        session.logicalBuffer = reconstructLogicalInputBuffer(session);
        const last = values.at(-1);
        session.intermediateValues = values.slice(0, -1);
        // A committed/post-blur control value is authoritative for native and masked fields.
        // Amount children are the exception when the committed value is an aggregate display:
        // rawTypedValue is the recorder's logical child session and is not obtained by parsing
        // the display string.
        const committedIsAggregate = aggregateDisplayValue(session.committedValue);
        const insertedValue = session.rawTypedValue
            ? reconstructInsertedInputValue(session)
            : reconstructLogicalInputBuffer(session);
        const logicalChildValue = session.compoundRole === "amount_or_text"
            && (session.needsReview || session.deepestEditableTargetRef !== session.currentTargetRef)
            && insertedValue
            && (!session.rawTypedValue || session.rawTypedValue.endsWith(insertedValue))
            ? insertedValue
            : undefined;
        session.finalValue = logicalChildValue
            ?? (session.compoundRole === "amount_or_text" && committedIsAggregate
                ? session.rawTypedValue ?? undefined
                : session.committedValue
                    ?? (session.displayValue && !aggregateDisplayValue(session.displayValue) ? session.displayValue : undefined)
                    ?? session.rawTypedValue
                    ?? (session.needsReview && aggregateDisplayValue(last) ? undefined : last));
        if (session.compoundRole === "selection")
            session.commitReason = "change";
        else if (session.committedValue !== undefined)
            session.commitReason = "change";
        else
            session.commitReason = "stabilization_timeout";
        return session;
    });
}
/**
 * Returns the distinct user insert stream. Browser recorders commonly emit the same
 * before-input payload twice; preserving that transport duplication would contaminate the
 * logical value while the raw/committed control state remains authoritative for ordinary
 * fields. This models edit evidence only and never parses a rendered control value.
 */
function reconstructInsertedInputValue(session) {
    const data = session.inputEventData ?? [];
    const types = session.inputTypes ?? [];
    if (data.length === 0)
        return undefined;
    const duplicatedPairs = data.length % 2 === 0
        && data.every((entry, index) => index % 2 === 0 || entry === data[index - 1])
        && types.every((entry, index) => index % 2 === 0 || entry === types[index - 1]);
    let value = "";
    for (let index = 0; index < data.length; index += duplicatedPairs ? 2 : 1) {
        const current = data[index] ?? "";
        const inputType = types[index] ?? "insertText";
        if (inputType === "insertReplacementText" || inputType === "insertFromPaste")
            value = current;
        else if (inputType === "insertText")
            value += current;
        else if (inputType === "deleteContentBackward")
            value = value.slice(0, -1);
    }
    return value || undefined;
}
/**
 * Reconstructs the user's edit stream from input events. This is deliberately generic:
 * it models editing operations, not currencies, masks, or a component's display text.
 */
function reconstructLogicalInputBuffer(session) {
    const data = session.inputEventData ?? [];
    const types = session.inputTypes ?? [];
    if (data.length === 0)
        return undefined;
    let buffer = session.initialValue ?? "";
    for (let index = 0; index < data.length; index += 1) {
        const inputType = types[index] ?? "insertText";
        const value = data[index] ?? "";
        if (inputType === "deleteContentBackward") {
            buffer = buffer.slice(0, -1);
        }
        else if (inputType === "deleteContentForward") {
            // Without a selection range the forward delete has no safe character authority.
            continue;
        }
        else if (inputType === "insertReplacementText") {
            buffer = value;
        }
        else if (inputType === "insertFromPaste") {
            buffer = value;
        }
        else if (inputType === "insertText") {
            buffer += value;
        }
    }
    return buffer.length > 0 ? buffer : undefined;
}
function hasMeaningfulStateDelta(event) {
    const target = event.target;
    if (!target)
        return false;
    if (target.afterValue !== undefined && target.afterValue !== target.beforeValue)
        return true;
    if (target.stateDelta && Object.values(target.stateDelta).some((value) => value !== undefined && value !== false && value !== ""))
        return true;
    if (target.dynamicLifecycle?.selectedOption || target.dynamicLifecycle?.committedState)
        return true;
    return false;
}
function selectedValueOf(event) {
    return event.target?.afterValue ?? event.target?.dynamicLifecycle?.selectedOption ?? event.target?.dynamicLifecycle?.committedState;
}
function sameStructuralContext(left, right) {
    const l = left.target;
    const r = right.target;
    const keys = ["gridRef", "rowIdentity", "rowRef", "cellRef"];
    const shared = keys.filter((key) => l?.[key] && r?.[key]).some((key) => l?.[key] === r?.[key]);
    return shared || Boolean(l?.eventTargetRef && r?.dynamicLifecycle?.triggerTechnicalTarget && l.eventTargetRef === r.dynamicLifecycle.triggerTechnicalTarget);
}
/** Promotes an option observation into a normalized action while retaining the raw note. */
function promoteSelectionNotes(events) {
    const promoted = [];
    const seen = new Set();
    for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        promoted.push(event);
        const value = selectedValueOf(event);
        const committedByPointer = event.observationType === "pointer"
            && event.target?.afterValue !== undefined
            && Boolean(event.target.dynamicLifecycle?.selectedOption || event.target.afterState?.selected === true);
        const committedByState = event.target?.afterState?.selected === true
            || event.target?.stateDelta?.selected === true
            || Boolean(event.target?.dynamicLifecycle?.committedState);
        // Focus is navigation evidence, not a selection commit. Promote only an activation or a
        // positive selection-state transition; the raw focus note remains available to Technical.
        if (event.kind !== "note" || event.target?.compoundRole !== "selection" || !value || (!committedByPointer && !committedByState))
            continue;
        const options = [...new Set(event.target.observedOptions ?? event.target.dynamicLifecycle?.options ?? [])].filter(Boolean);
        // Radix-style option events can lose the grid/cell context when the popup is rendered in a
        // portal. The preceding selection-control observation still carries that context, so use it
        // as the bridge back to the real parent trigger instead of guessing from the option label.
        const selectionParent = events
            .slice(Math.max(0, index - 40), index)
            .reverse()
            .find((candidate) => candidate.kind === "note"
            && candidate.target?.interactionType === "click"
            // A portalized option often has no cell/grid identity of its own. The
            // nearest structured click observation is the causal trigger even when
            // its role is still a display/button observation rather than selection.
            && Boolean(candidate.target.gridRef || candidate.target.cellRef || candidate.target.rowIdentity));
        const triggerContext = selectionParent ?? event;
        const trigger = events
            .slice(0, index)
            .filter((candidate) => candidate.kind === "tap" && candidate.screenKey === event.screenKey)
            .filter((candidate) => {
            const candidateTarget = candidate.target;
            const parentTarget = triggerContext.target;
            return Boolean(parentTarget?.cellRef && candidateTarget?.cellRef && parentTarget.cellRef === candidateTarget.cellRef)
                || Boolean(parentTarget?.eventTargetRef && candidateTarget?.eventTargetRef && parentTarget.eventTargetRef === candidateTarget.eventTargetRef)
                || Boolean(parentTarget?.associatedField && candidateTarget?.associatedField && parentTarget.associatedField === candidateTarget.associatedField
                    && candidateTarget?.compoundRole === "selection");
        })
            .sort((left, right) => Math.abs(left.t - event.t) - Math.abs(right.t - event.t))[0];
        const fallbackTrigger = trigger
            ?? (selectionParent ? { ...selectionParent, kind: "tap" } : undefined);
        if (!fallbackTrigger?.target)
            continue;
        const identity = `${fallbackTrigger.target.eventTargetRef ?? fallbackTrigger.target.locators[0]?.value ?? fallbackTrigger.target.associatedField ?? fallbackTrigger.target.label}|${value}`;
        if (seen.has(identity))
            continue;
        seen.add(identity);
        promoted.push({
            ...fallbackTrigger,
            seq: event.seq,
            t: event.t,
            kind: "tap",
            target: {
                ...fallbackTrigger.target,
                label: selectionParent?.target?.label ?? fallbackTrigger.target.associatedField ?? event.target.label,
                associatedField: selectionParent?.target?.associatedField ?? fallbackTrigger.target.associatedField ?? event.target.associatedField ?? event.target.headerContext,
                headerContext: selectionParent?.target?.headerContext ?? fallbackTrigger.target.headerContext ?? event.target.headerContext,
                interactionType: "select",
                compoundRole: "selection",
                afterValue: value,
                observedOptions: options,
                dynamicLifecycle: { ...event.target.dynamicLifecycle, activatedTechnicalTarget: event.target.dynamicLifecycle?.activatedTechnicalTarget, options },
            },
            note: `Selección promovida desde ${event.observationType ?? "observación"}`,
        });
    }
    return promoted;
}
function targetWithSession(first, last, session) {
    if (!first && !last)
        return undefined;
    const merged = { ...first, ...last };
    return {
        ...merged,
        beforeState: first?.beforeState ?? last?.beforeState,
        afterState: last?.afterState ?? first?.afterState,
        activeElementBefore: first?.activeElementBefore ?? last?.activeElementBefore,
        activeElementAfter: last?.activeElementAfter ?? first?.activeElementAfter,
        stateDelta: { ...first?.stateDelta, ...last?.stateDelta },
        editingSessionRef: session.editingSessionId,
        inputValue: session.inputValue,
        rawTypedValue: session.rawTypedValue,
        inputEventData: session.inputEventData,
        inputTypes: session.inputTypes,
        committedValue: session.committedValue,
        displayValue: session.displayValue ?? last?.displayValue,
        // A formatted/aggregate parent value is technical evidence only. The semantic event gets
        // an unresolved value and the raw observations retain the visible display for diagnosis.
        afterValue: session.finalValue,
    };
}
/**
 * Collapses capture noise by stable control identity and editing session, while preserving all
 * technical notes. Raw traces remain untouched in RecordingStore; this projection is the only
 * stream consumed by scenario/dataset derivation.
 */
function normalizeEvents(events, options = {}) {
    const debounce = options.tapDebounceMs ?? 400;
    const dropUnidentified = options.dropUnidentifiedTaps !== false;
    // Pass 1 — a screen_change that did not change the screen is a poller artifact.
    const realTransitions = events.filter((e) => e.kind !== "screen_change" || (e.toScreenKey && e.toScreenKey !== e.screenKey));
    const sessions = buildEditingSessions(realTransitions);
    const sessionByIdentity = new Map(sessions.map((session) => [session.controlIdentity, session]));
    const emittedSessions = new Set();
    const consolidated = [];
    let lastFunctionalAction;
    for (const [index, original] of realTransitions.entries()) {
        const event = promoteDynamicSelection(original, index, realTransitions);
        if (event.kind === "fill") {
            const identity = targetKey(event);
            const session = sessionByIdentity.get(identity);
            if (session && emittedSessions.has(session.editingSessionId))
                continue;
            if (session) {
                emittedSessions.add(session.editingSessionId);
                const sameSessionFills = realTransitions.filter((candidate) => candidate.kind === "fill" && targetKey(candidate) === identity);
                const lastFill = sameSessionFills.at(-1) ?? event;
                const value = session.finalValue;
                const consolidatedEvent = {
                    ...lastFill,
                    seq: event.seq,
                    t: lastFill.t,
                    value,
                    target: targetWithSession(event.target, lastFill.target, session),
                };
                consolidated.push(consolidatedEvent);
                lastFunctionalAction = consolidatedEvent;
            }
            else {
                consolidated.push(event);
                lastFunctionalAction = event;
            }
            continue;
        }
        if (event.kind === "tap") {
            const nextMeaningful = realTransitions.slice(index + 1).find((candidate) => candidate.kind === "tap" || candidate.kind === "fill");
            if (nextMeaningful?.kind === "fill"
                && targetKey(event) !== ""
                && targetKey(event) === targetKey(nextMeaningful)
                && !hasMeaningfulStateDelta(event)) {
                // Clicking an input before typing is focus evidence, not a separate business action.
                // The raw tap stays in the trace and remains available to Technical Knowledge.
                continue;
            }
            const previousTap = lastFunctionalAction?.kind === "tap" ? lastFunctionalAction : undefined;
            if (previousTap
                && targetKey(previousTap) === targetKey(event)
                && targetKey(event) !== ""
                && event.t - previousTap.t < debounce
                && !hasMeaningfulStateDelta(previousTap)
                && !hasMeaningfulStateDelta(event)
                && previousTap.target?.afterValue === event.target?.afterValue)
                continue;
            consolidated.push(event);
            lastFunctionalAction = event;
            continue;
        }
        // Pointer/focus/beforeinput/post_action/mutation records remain available to TechnicalKnowledge.
        consolidated.push(event);
    }
    // Pass 4 — a tap nobody can locate is not reproducible; keep it as a note so the
    // narrative still shows the human did something there, but never as a step.
    const cleaned = consolidated.map((event) => {
        if (!dropUnidentified)
            return event;
        if (event.kind !== "tap")
            return event;
        if ((event.target?.locators?.length ?? 0) > 0)
            return event;
        if (event.target?.compoundRole === "selection" && event.target.afterValue !== undefined
            && (event.observationType === "pointer" || event.target.afterState?.selected === true || event.target.dynamicLifecycle?.committedState))
            return event;
        // Preserve trusted Capture V2 physical taps for observed projection; readiness remains fail-closed.
        if (event.interactionId && event.target?.label && !isGenericUnresolvedLabel(event.target.label))
            return event;
        return {
            ...event,
            kind: "note",
            note: event.target?.label
                ? `Toque sin locator utilizable sobre "${event.target.label}"`
                : "Toque en una zona sin elemento identificable",
        };
    });
    return promoteSelectionNotes(cleaned).map((event, index) => ({ ...event, seq: index }));
}
/**
 * Splits the walkthrough into one segment per screen visited.
 *
 * Segments are what make a long recording readable and what a flow is built from: each one
 * is "on this screen, the user did X, Y, then left for Z".
 */
function segmentTrace(events, trace) {
    const titleOf = new Map(trace.screens.map((s) => [s.screenKey, s.title]));
    const segments = [];
    for (const event of events) {
        const current = segments[segments.length - 1];
        if (!current || current.screenKey !== event.screenKey) {
            segments.push({
                index: segments.length,
                screenKey: event.screenKey,
                title: titleOf.get(event.screenKey) ?? event.screenKey,
                events: [event],
            });
        }
        else {
            current.events.push(event);
        }
        if (event.kind === "screen_change" && event.toScreenKey) {
            const seg = segments[segments.length - 1];
            seg.exitsTo = event.toScreenKey;
        }
    }
    return segments;
}
function isProjectionOnlyTap(event) {
    if (event.kind !== "tap")
        return false;
    const label = event.target?.label
        ?.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/…/g, "...")
        .trim();
    return label === "indicar..." || label === "indicar" || label === "seleccionar fila";
}
/** Headline numbers for the recording panel — cheap enough to recompute on every poll. */
function summarizeTrace(events, trace) {
    const taps = events.filter((e) => e.kind === "tap" && !isProjectionOnlyTap(e)).length;
    const fills = events.filter((e) => e.kind === "fill").length;
    const transitions = events.filter((e) => e.kind === "screen_change").length;
    const unidentified = events.filter((e) => e.kind === "note").length;
    const last = events[events.length - 1];
    return {
        actions: taps + fills,
        taps,
        fills,
        transitions,
        screens: trace.screens.length,
        unidentified,
        durationMs: trace.durationMs ?? (last ? last.t : 0),
    };
}
