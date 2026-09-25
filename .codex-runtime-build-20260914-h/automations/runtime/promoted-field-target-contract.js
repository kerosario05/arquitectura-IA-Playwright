"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.identityFromContractStep = identityFromContractStep;
exports.resolvePromotedFieldIdentityFromPersistedContract = resolvePromotedFieldIdentityFromPersistedContract;
exports.parseTechnicalTargetRefs = parseTechnicalTargetRefs;
exports.semanticNameFromRef = semanticNameFromRef;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function nonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
function entityScopeFromValueKey(valueKey) {
    const match = valueKey?.match(/^(entity_\d+)\./i);
    return match?.[1];
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}
function normalizeAlias(value) {
    return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}
function stepTarget(step) {
    if (typeof step.target === "string")
        return nonEmptyString(step.target);
    if (step.target && typeof step.target === "object") {
        const target = step.target;
        return nonEmptyString(target.value) ?? nonEmptyString(target.text) ?? nonEmptyString(target.label);
    }
    return undefined;
}
function identityFromContractStep(step) {
    const technicalTargetRefs = stringArray(step.technicalTargetRefs);
    const valueKey = nonEmptyString(step.valueKey);
    const targetIdentity = nonEmptyString(step.targetIdentity)
        ?? nonEmptyString(step.canonicalTargetIdentity)
        ?? nonEmptyString(step.recordingResolvedTargetIdentity);
    if (technicalTargetRefs.length === 0 && !targetIdentity && !valueKey)
        return undefined;
    return {
        valueKey,
        technicalTargetRefs,
        entityScope: nonEmptyString(step.entityScope) ?? entityScopeFromValueKey(valueKey),
        rowRelation: typeof step.rowRelation === "string" || step.rowRelation === null ? step.rowRelation : undefined,
        targetIdentity,
        surfaceIdentity: nonEmptyString(step.surfaceIdentity),
        containerIdentity: nonEmptyString(step.containerIdentity),
        fieldIdentity: nonEmptyString(step.fieldIdentity),
        semanticType: nonEmptyString(step.semanticType) ?? (step.operation === "select" ? "selection" : undefined),
        valueRole: nonEmptyString(step.valueRole),
        controlIdentity: nonEmptyString(step.controlIdentity),
        expectedOutcomeKind: step.expectedOutcomeKind === "route_transition" || step.expectedOutcomeKind === "in_place_transition"
            ? step.expectedOutcomeKind
            : undefined,
        expectedRouteTransition: step.expectedRouteTransition === true,
        expectedInPlaceTransition: step.expectedInPlaceTransition === true,
        expectedRouteAfter: nonEmptyString(step.expectedRouteAfter),
    };
}
function isMatchingStep(step, stepIndex, target) {
    const candidateIndex = Number(step.scenarioStepIndex ?? step.stepIndex);
    if (!Number.isFinite(candidateIndex) || candidateIndex !== stepIndex)
        return false;
    const candidateTarget = stepTarget(step);
    return !candidateTarget || normalizeAlias(candidateTarget) === normalizeAlias(target);
}
function planMatchesScenario(plan, scenarioId) {
    if (!scenarioId)
        return true;
    const externalId = nonEmptyString(plan.scenario?.externalId);
    return !externalId || normalizeAlias(externalId) === normalizeAlias(scenarioId);
}
function caseDirectoryCandidates() {
    const appSlug = nonEmptyString(process.env.APP_SLUG);
    if (!appSlug)
        return [];
    const sectionSlug = nonEmptyString(process.env.SECTION_SLUG) ?? "default-section";
    const root = node_path_1.default.resolve(process.cwd(), "automations", "apps", appSlug, "sections", sectionSlug, "cases");
    if (!node_fs_1.default.existsSync(root))
        return [];
    return node_fs_1.default.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => node_path_1.default.join(root, entry.name, "plan.json"))
        .filter((planPath) => node_fs_1.default.existsSync(planPath));
}
function recordingCandidates() {
    const appSlug = nonEmptyString(process.env.APP_SLUG);
    if (!appSlug)
        return [];
    const root = node_path_1.default.resolve(process.cwd(), "automations", "apps", appSlug, "recordings");
    if (!node_fs_1.default.existsSync(root))
        return [];
    return node_fs_1.default.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => node_path_1.default.join(root, entry.name, "semantic-recording.json"))
        .filter((recordingPath) => node_fs_1.default.existsSync(recordingPath));
}
function structuralRefFromRecordingCandidate(candidate) {
    if (!candidate || typeof candidate !== "object")
        return undefined;
    const item = candidate;
    if (item.strategy !== "structural" || typeof item.value !== "string" || item.value.trim() === "")
        return undefined;
    return `structural:${item.value.trim()}`;
}
function identityFromRecordingForValueKey(plan, valueKey, target) {
    const title = nonEmptyString(plan.scenario?.title);
    const recordingId = nonEmptyString(process.env.RECORDING_ID);
    for (const recordingPath of recordingCandidates()) {
        try {
            const recording = JSON.parse(node_fs_1.default.readFileSync(recordingPath, "utf8"));
            if (recordingId && nonEmptyString(recording.recordingId) !== recordingId)
                continue;
            const recordingTitle = nonEmptyString(recording.primaryScenario?.title);
            if (!recordingId && title && recordingTitle && normalizeAlias(title) !== normalizeAlias(recordingTitle))
                continue;
            const interactions = Array.isArray(recording.canonicalInteractions) ? recording.canonicalInteractions : [];
            const interaction = interactions.find((candidate) => nonEmptyString(candidate.valueKey) === valueKey
                && (!candidate.semanticField || normalizeAlias(String(candidate.semanticField)) === normalizeAlias(target))
                && (candidate.action === "select" || candidate.action === "fill" || candidate.action === "click"));
            if (!interaction)
                continue;
            const routeBefore = nonEmptyString(interaction.routeBefore);
            const routeAfter = nonEmptyString(interaction.routeAfter);
            const expectedRouteTransition = Boolean(routeBefore && routeAfter && routeBefore !== routeAfter);
            const expectedInPlaceTransition = interaction.transitionObserved === true && !expectedRouteTransition;
            const candidates = Array.isArray(interaction.technicalTargetCandidates)
                ? interaction.technicalTargetCandidates
                : [];
            const locatorCandidates = candidates.flatMap((candidate) => Array.isArray(candidate.locatorCandidates) ? candidate.locatorCandidates : []);
            const technicalTargetRefs = locatorCandidates
                .map(structuralRefFromRecordingCandidate)
                .filter((ref) => Boolean(ref));
            const persistedTechnicalTargetRefs = stringArray(interaction.technicalTargetRefs);
            const effectiveTechnicalTargetRefs = technicalTargetRefs.length > 0
                ? technicalTargetRefs
                : persistedTechnicalTargetRefs;
            if (effectiveTechnicalTargetRefs.length === 0)
                continue;
            return {
                valueKey,
                technicalTargetRefs: Array.from(new Set(effectiveTechnicalTargetRefs)),
                semanticType: nonEmptyString(interaction.action === "select" ? "selection" : "amount_or_text"),
                valueRole: nonEmptyString(interaction.valueRole),
                entityScope: nonEmptyString(interaction.entityScope),
                surfaceIdentity: nonEmptyString(interaction.optionSurfaceId),
                containerIdentity: nonEmptyString(interaction.gridRef),
                controlIdentity: nonEmptyString(interaction.controlIdentity),
                expectedOutcomeKind: expectedRouteTransition ? "route_transition" : expectedInPlaceTransition ? "in_place_transition" : undefined,
                expectedRouteTransition,
                expectedInPlaceTransition,
                expectedRouteAfter: routeAfter,
            };
        }
        catch {
            // A malformed recording must not break promoted execution.
        }
    }
    return undefined;
}
function resolvePromotedFieldIdentityFromPersistedContract(stepIndex, target, options) {
    const scenarioId = nonEmptyString(process.env.SCENARIO_ID);
    const suppliedRefs = stringArray(options?.technicalTargetRefs);
    const suppliedValueKey = nonEmptyString(options?.valueKey);
    for (const planPath of caseDirectoryCandidates()) {
        try {
            const plan = JSON.parse(node_fs_1.default.readFileSync(planPath, "utf8"));
            if (!planMatchesScenario(plan, scenarioId))
                continue;
            const steps = Array.isArray(plan.executionContract?.steps) ? plan.executionContract.steps : [];
            const step = steps.find((candidate) => isMatchingStep(candidate, stepIndex, target));
            const identity = step ? identityFromContractStep(step) : undefined;
            if (identity?.valueKey) {
                const recordingIdentity = identityFromRecordingForValueKey(plan, identity.valueKey, target);
                if (recordingIdentity) {
                    return {
                        ...identity,
                        ...recordingIdentity,
                        entityScope: recordingIdentity.entityScope ?? identity.entityScope,
                    };
                }
                return identity;
            }
            if (identity?.technicalTargetRefs.length)
                return identity;
        }
        catch {
            // A malformed or transient plan must not break legacy promoted execution.
        }
    }
    if (suppliedRefs.length > 0 || suppliedValueKey) {
        return { technicalTargetRefs: suppliedRefs, valueKey: suppliedValueKey };
    }
    return undefined;
}
function parseTechnicalTargetRefs(refs) {
    const parsed = {};
    for (const ref of refs) {
        if (ref.startsWith("role:input|")) {
            parsed.inputHint = ref.slice("role:input|".length);
            continue;
        }
        if (!ref.startsWith("structural:"))
            continue;
        for (const part of ref.slice("structural:".length).split("|")) {
            const separator = part.indexOf("=");
            if (separator < 0)
                continue;
            const key = part.slice(0, separator);
            const value = part.slice(separator + 1);
            if (key === "grid")
                parsed.gridRef = value;
            if (key === "row")
                parsed.rowRef = value;
            if (key === "cell")
                parsed.cellRef = value;
            if (key === "header")
                parsed.headerRef = value;
            if (key === "role")
                parsed.semanticRole = value;
        }
    }
    return parsed;
}
function semanticNameFromRef(ref) {
    if (!ref)
        return undefined;
    const colon = ref.indexOf(":");
    if (colon < 0)
        return undefined;
    const name = ref.slice(colon + 1).split(":row:")[0].trim();
    return name || undefined;
}
