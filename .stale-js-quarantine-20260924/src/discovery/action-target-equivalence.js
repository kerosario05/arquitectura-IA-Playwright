"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.areEquivalentActionTargets = areEquivalentActionTargets;
function normalizeIdentityText(value) {
    return String(value ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function stableControlIdentity(value) {
    if (value === undefined || value === null)
        return "";
    if (typeof value !== "object")
        return normalizeIdentityText(String(value));
    return JSON.stringify(value, Object.keys(value).sort());
}
/**
 * Consecutive actions are equivalent only when their structured execution
 * identity is equal. A target label alone is presentation text and is not a
 * safe deduplication key (for example select+fill and check+click).
 */
function areEquivalentActionTargets(left, right) {
    const leftRefs = [...(left.technicalTargetRefs ?? [])].map(normalizeIdentityText).sort();
    const rightRefs = [...(right.technicalTargetRefs ?? [])].map(normalizeIdentityText).sort();
    return JSON.stringify({
        actionType: normalizeIdentityText(left.actionType) === normalizeIdentityText(right.actionType)
            ? normalizeIdentityText(left.actionType)
            : "__different__",
        recordingActionType: normalizeIdentityText(left.recordingActionType) === normalizeIdentityText(right.recordingActionType)
            ? normalizeIdentityText(left.recordingActionType)
            : "__different__",
        target: normalizeIdentityText(left.target) === normalizeIdentityText(right.target)
            ? normalizeIdentityText(left.target)
            : "__different__",
        valueKey: normalizeIdentityText(left.valueKey) === normalizeIdentityText(right.valueKey)
            ? normalizeIdentityText(left.valueKey)
            : "__different__",
        value: normalizeIdentityText(left.value) === normalizeIdentityText(right.value)
            ? normalizeIdentityText(left.value)
            : "__different__",
        valueSource: normalizeIdentityText(left.valueSource) === normalizeIdentityText(right.valueSource)
            ? normalizeIdentityText(left.valueSource)
            : "__different__",
        entityScope: normalizeIdentityText(left.entityScope) === normalizeIdentityText(right.entityScope)
            ? normalizeIdentityText(left.entityScope)
            : "__different__",
        associatedField: normalizeIdentityText(left.associatedField) === normalizeIdentityText(right.associatedField)
            ? normalizeIdentityText(left.associatedField)
            : "__different__",
        selectionField: normalizeIdentityText(left.selectionField) === normalizeIdentityText(right.selectionField)
            ? normalizeIdentityText(left.selectionField)
            : "__different__",
        technicalTargetRefs: JSON.stringify(leftRefs) === JSON.stringify(rightRefs) ? leftRefs : ["__different__"],
        controlIdentity: stableControlIdentity(left.controlIdentity) === stableControlIdentity(right.controlIdentity)
            ? stableControlIdentity(left.controlIdentity)
            : "__different__",
    }).includes('"__different__"') === false;
}
