"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scenarioStepMetrics = scenarioStepMetrics;
exports.scoreGoalRelevance = scoreGoalRelevance;
exports.deduplicateGoalSuggestions = deduplicateGoalSuggestions;
exports.evaluateRecordingSuggestionQuality = evaluateRecordingSuggestionQuality;
exports.materializeRecordingSuggestion = materializeRecordingSuggestion;
exports.filterGoalScopedSuggestions = filterGoalScopedSuggestions;
exports.buildHappyPathScenario = buildHappyPathScenario;
exports.materializeObservedPrimaryScenario = materializeObservedPrimaryScenario;
exports.materializeRecordedScenario = materializeRecordedScenario;
exports.buildGateNegatives = buildGateNegatives;
exports.capTitle = capTitle;
exports.buildSegmentScenarios = buildSegmentScenarios;
exports.buildAlternativePathScenarios = buildAlternativePathScenarios;
const semantic_recording_1 = require("./semantic-recording");
const trace_normalizer_1 = require("./trace-normalizer");
const compound_value_1 = require("./compound-value");
const human_step_renderer_1 = require("./human-step-renderer");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const MOBILE_STRATEGIES = new Set([
    "accessibilityId",
    "id",
    "xpath",
    "androidUiAutomator",
    "className",
]);
function toMobileTarget(event) {
    const locator = event.target?.locators?.[0];
    if (!locator)
        return undefined;
    if (!MOBILE_STRATEGIES.has(locator.strategy))
        return undefined;
    return { strategy: locator.strategy, value: locator.value };
}
function slugifyKey(label) {
    return label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40) || "campo";
}
/** Row identity is the recording's structural entity evidence; it is not a product label. */
function entityScopeForTarget(target) {
    if (target?.entityScope?.trim())
        return target.entityScope.trim();
    if (target?.gridRef && (target.rowIdentity || target.rowRef))
        return "entity_1";
    return undefined;
}
function valueKeyFor(event, label) {
    const explicit = event.redactedKey?.trim();
    const key = explicit ? slugifyKey(explicit) : slugifyKey(label);
    const entityScope = entityScopeForTarget(event.target);
    return entityScope && !key.startsWith(`${entityScope}.`)
        ? `${entityScope}.${key}`
        : key;
}
function isCompoundValueEditor(event) {
    const target = event.target;
    if (target?.compoundRole !== "amount_or_text")
        return false;
    const label = target.label?.trim().toLowerCase();
    const generic = !label || ["campo", "control", "input", "textbox"].includes(label.replace(/…/g, "..."));
    return Boolean(target.displayValue)
        || generic;
}
function stableScenarioInstanceSuffix(event) {
    const target = event.target;
    const structural = [target?.rowIdentity ?? target?.rowRef, target?.cellRef, target?.columnIdentity ?? target?.headerRef]
        .map((value) => value?.trim())
        .filter((value) => typeof value === "string" && value.length <= 80 && !/\s{2,}/.test(value));
    return structural.length > 0 ? slugifyKey(structural.join(" ")).slice(0, 36) : undefined;
}
function fieldForEvent(event, ordinal) {
    const resolution = (0, semantic_recording_1.resolveRecordedField)(event.target, ordinal);
    const suffix = event.target?.compoundRole === "selection"
        ? "selección"
        : isCompoundValueEditor(event)
            ? "valor"
            : undefined;
    const base = resolution.semanticField ?? event.target?.associatedField ?? event.target?.headerContext;
    if (!suffix || !base)
        return resolution;
    return {
        ...resolution,
        semanticField: base,
        displayLabel: base,
        valueKey: `${slugifyKey(base)}_${suffix}`,
    };
}
function uniqueValueKeyFor(event, label, fields) {
    const base = valueKeyFor(event, label);
    if (!fields.some((field) => field.key === base))
        return base;
    const instance = stableScenarioInstanceSuffix(event);
    return instance && !fields.some((field) => field.key === `${base}_${instance}`)
        ? `${base}_${instance}`
        : base;
}
/**
 * The text that proves the app landed where the walkthrough went next.
 *
 * A screen's title is the strongest single assertion available, but a title that is only the
 * screen's internal key proves nothing to a reader, so a real visible text is preferred when
 * the title is not one.
 */
function assertionTextFor(screen) {
    if (!screen)
        return undefined;
    const title = screen.title?.trim();
    if (title && title !== screen.screenKey && title.length > 2 && !isTechnicalTitle(title))
        return title;
    return screen.texts.find((t) => t.trim().length > 3)?.trim();
}
function isTechnicalTitle(value) {
    return /hash|fingerprint|^[a-f0-9]{8,}$/i.test(value.trim()) || /^(?:screen|pantalla)[-_ ]?[a-f0-9]{6,}$/i.test(value.trim());
}
function humanScreenTitle(screen, fallback) {
    const title = screen?.title?.trim();
    return title && !isTechnicalTitle(title) ? title : fallback;
}
function describeTap(event) {
    const label = event.target?.label?.trim();
    return label ? `Presionar "${label}"` : "Presionar el control indicado";
}
function describeFillTemplate(label, valueKey) {
    return `Ingresar [${valueKey}] en "${label}"`;
}
function recordedLogicalValue(event, editingSession, compoundSelectionValue) {
    const target = event.target;
    if (target?.compoundRole === "amount_or_text") {
        // The child editing session is authoritative. Parent display/formatting is evidence only;
        // it is never parsed to reconstruct the logical amount.
        const separateEditableEvidence = Boolean(target.deepestEditableTargetRef &&
            (target.eventTargetRef ?? editingSession?.eventTargetRef) &&
            target.deepestEditableTargetRef !== (target.currentTargetRef ?? editingSession?.currentTargetRef)) || Boolean(editingSession?.deepestEditableTargetRef && editingSession.technicalTargetRefs.length > 0);
        if (!separateEditableEvidence)
            return undefined;
        const logicalBuffer = editingSession?.finalValue
            ?? editingSession?.rawTypedValue
            ?? editingSession?.logicalBuffer
            ?? (editingSession ? (0, trace_normalizer_1.reconstructLogicalInputBuffer)(editingSession) : undefined);
        if (logicalBuffer !== undefined) {
            return (0, compound_value_1.logicalCompoundChildValue)(logicalBuffer, compoundSelectionValue)
                ?? ((0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? undefined : logicalBuffer);
        }
        const committedChildValue = target.committedValue
            ?? target.afterState?.committedValue
            ?? editingSession?.committedValue
            ?? editingSession?.finalValue;
        if (committedChildValue) {
            return (0, compound_value_1.logicalCompoundChildValue)(committedChildValue, compoundSelectionValue)
                ?? ((0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? undefined : committedChildValue);
        }
        const childValue = target.rawTypedValue ?? editingSession?.rawTypedValue;
        if (childValue) {
            return (0, compound_value_1.logicalCompoundChildValue)(childValue, compoundSelectionValue)
                ?? ((0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? undefined : childValue);
        }
        if ((0, semantic_recording_1.aggregateTextUsedAsValue)(event))
            return undefined;
        return target.inputValue ?? event.value;
    }
    return target?.committedValue
        ?? target?.afterState?.committedValue
        ?? target?.rawTypedValue
        ?? target?.inputValue
        ?? event.value;
}
function describeFillRendered(event, label, template, trace, editingSession, compoundSelectionValue) {
    const sensitive = (0, semantic_recording_1.isSensitiveRecordedEvent)(event);
    const canMaterializeSecret = (0, semantic_recording_1.normalizeRecordingDataPolicy)(trace.recordingDataPolicy).persistQaCredentials;
    const logicalValue = recordedLogicalValue(event, editingSession, compoundSelectionValue);
    if (sensitive && (!canMaterializeSecret || logicalValue === undefined))
        return `Ingresar el valor seguro asociado a "${label}"`;
    if (logicalValue !== undefined)
        return `Ingresar ${(0, human_step_renderer_1.quoteHumanValue)(logicalValue)} en "${label}"`;
    return template;
}
function selectionValueKey(event, label) {
    const base = slugifyKey(event.target?.associatedField?.trim() || label);
    const key = event.target?.interactionType === "select" || event.target?.compoundRole === "selection"
        ? `${base}_seleccion`
        : base;
    const entityScope = entityScopeForTarget(event.target);
    return entityScope ? `${entityScope}.${key}` : key;
}
function describeSelectionRendered(event, label, template) {
    return event.target?.afterValue === undefined
        ? template
        : `Seleccionar ${(0, human_step_renderer_1.quoteHumanValue)(event.target.afterValue)} en "${label}"`;
}
function scenarioStepMetrics(steps) {
    const nonUserSetupSteps = steps.filter((step) => step.isSetup === true).length;
    const functionalActionCount = steps.filter((step) => !step.isSetup && step.classification === "FUNCTIONAL_ACTION").length;
    return {
        scenarioStepCount: steps.length,
        functionalActionCount,
        nonUserSetupSteps,
        reasonForDifference: nonUserSetupSteps > 0
            ? "El contador funcional excluye filas de setup/navegación inicial visibles en el preview."
            : "Todas las filas del escenario son acciones funcionales.",
    };
}
function canonicalForStep(step, interactions) {
    return step.interactionId ? interactions.find((interaction) => interaction.id === step.interactionId) : undefined;
}
function attachStateOwnership(steps, interactions) {
    return steps.map((step) => {
        const interaction = canonicalForStep(step, interactions);
        if (!interaction)
            return step;
        return {
            ...step,
            ...(interaction.screenBeforeRef ? { screenBeforeRef: interaction.screenBeforeRef } : {}),
            ...(interaction.screenAfterRef ? { screenAfterRef: interaction.screenAfterRef } : {}),
            ...(interaction.routeBefore ? { routeBefore: interaction.routeBefore } : {}),
            ...(interaction.routeAfter ? { routeAfter: interaction.routeAfter } : {}),
            ...(interaction.stateScope ? { stateScope: interaction.stateScope } : {}),
        };
    });
}
function numberScenarioSteps(steps) {
    return steps.map((step, index) => ({ ...step, stepNumber: index + 1 }));
}
function normalizeGoalToken(value) {
    const stop = new Set(["el", "la", "los", "las", "un", "una", "de", "del", "en", "para", "por", "y", "a", "con"]);
    return value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2 && !stop.has(token));
}
/** Scores suggestions from structural evidence, never from an application-specific vocabulary. */
function scoreGoalRelevance(goal, candidate) {
    const goalTokens = new Set(normalizeGoalToken(goal ?? ""));
    if (goalTokens.size === 0)
        return { score: 0.5, reasons: ["goal_not_declared"] };
    const candidateText = [
        candidate.title,
        candidate.description,
        ...candidate.requiredData.map((field) => field.label),
        // The preamble is how a derived case reaches a screen, not what makes the candidate
        // relevant. Including it made an unrelated menu option inherit the goal vocabulary from
        // the happy path and pass on a misleading token overlap.
        candidate.testRailSteps.at(-1)?.content ?? "",
    ].join(" ");
    const candidateTokens = new Set(normalizeGoalToken(candidateText));
    const overlap = [...goalTokens].filter((token) => candidateTokens.has(token));
    const reasons = overlap.length > 0 ? [`shared_semantic_tokens:${overlap.length}`] : [];
    // One shared noun is not evidence that a candidate tests the declared operation. A
    // navigation item such as "Registro Digital Nuevos Colaboradores" shares "colaboradores"
    // with "Agregar varios colaboradores" but abandons the operation under test.
    const coverage = overlap.length / Math.max(goalTokens.size, 1);
    const operationEvidence = [...candidateTokens].some((token) => /^(crear|agregar|editar|validar|eliminar|registrar|actualizar|seleccionar|seleccionar|elegir|completar|consultar|gestionar|anadir)$/.test(token));
    const navigationOnly = [...candidateTokens].some((token) => /^(menu|inicio|registro|digital|ayuda|contacto|productos|configurar|navegar|volver)$/.test(token))
        && ![...candidateTokens].some((token) => /^(crear|agregar|editar|validar|eliminar|registrar|actualizar|completar|consultar|gestionar|anadir)$/.test(token));
    const score = navigationOnly ? 0.05 : overlap.length === 0 ? 0.05 : operationEvidence
        ? Math.min(0.95, 0.45 + coverage * 0.5)
        : Math.min(0.55, coverage * 0.55);
    if (candidate.requiredData.length > 0)
        reasons.push("candidate_has_observed_data");
    if (!operationEvidence && overlap.length > 0)
        reasons.push("shared_entity_without_operation_evidence");
    if (navigationOnly)
        reasons.push("navigation_alternative_abandons_declared_operation");
    return { score, reasons };
}
function deduplicateGoalSuggestions(suggestions) {
    const seen = new Set();
    const result = [];
    for (const suggestion of suggestions) {
        const identity = [
            suggestion.suggestionCategory ?? "DERIVED_ALTERNATIVE",
            suggestion.requiredData.map((field) => field.key).sort().join(","),
            suggestion.testRailSteps.map((step) => normalizeGoalToken(step.content).join(" ")).join("|"),
        ].join("::");
        if (seen.has(identity))
            continue;
        seen.add(identity);
        result.push(suggestion);
    }
    return { suggestions: result, duplicatesRemoved: suggestions.length - result.length };
}
const VAGUE_SETUP_STEP = /(?:completar|llenar|rellenar).*?(?:dem[aá]s|otros|resto|todos).*?(?:campos|datos)|datos +requeridos|continuar +normalmente/i;
const DEFINITIVE_UNSUPPORTED_ORACLE = /(?:el sistema|la aplicaci[oó]n).{0,40}(?:rechaza|solicita corregir|muestra un error|impide|bloquea)/i;
function proposalEvidenceRefsAreObserved(proposal, primary) {
    const observed = new Set(primary.sourceEventRefs ?? []);
    return proposal.sourceEvidenceRefs.length > 0
        && proposal.sourceEvidenceRefs.every((ref) => /^event-\d+$/.test(ref) && observed.has(ref));
}
function hasReliableConstraintEvidence(trace, proposal) {
    const refs = new Set(proposal.sourceEvidenceRefs);
    const events = trace.events.filter((_, index) => refs.has(`event-${index + 1}`));
    if (events.some((event) => event.target?.enabled === false))
        return true;
    if (events.some((event) => Object.keys(event.target?.attributes ?? {}).some((key) => /required|pattern|min|max|length|step/i.test(key))))
        return true;
    const visibleEvidence = trace.screens.flatMap((screen) => screen.texts).join(" ");
    return /(?:error|inv[aá]lid|obligatorio|requerido|validaci[oó]n|formato incorrecto|debe completar)/i.test(visibleEvidence);
}
function candidateMentionsOnlyObservedControls(proposal, trace, primary) {
    const observedText = [
        ...trace.events.flatMap((event) => [event.target?.label, event.target?.associatedField, event.target?.headerContext]),
        ...trace.screens.flatMap((screen) => screen.controls.map((control) => control.label)),
        ...primary.requiredData.map((field) => field.label),
        ...primary.testRailSteps.map((step) => step.content),
    ].filter((value) => Boolean(value)).join(" ").toLocaleLowerCase();
    const candidateText = [...proposal.scenarioSpecificSteps, ...proposal.steps].map((step) => step.content).join(" ");
    const quoted = [...candidateText.matchAll(/["“]([^"”]+)["”]/g)].map((match) => match[1].trim()).filter((value) => value.length > 2);
    return quoted.every((value) => observedText.includes(value.toLocaleLowerCase()));
}
function sharedSetupForProposal(proposal, primary) {
    const evidenceIndexes = proposal.sourceEvidenceRefs
        .map((ref) => Number(ref.replace("event-", "")))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
    if (evidenceIndexes.length === 0)
        return [...primary.testRailSteps];
    const ratio = Math.min(0.92, Math.max(0.2, (evidenceIndexes[0] - 1) / Math.max(primary.sourceEventRefs?.length ?? evidenceIndexes[0], 1)));
    const setupCount = Math.min(primary.testRailSteps.length, Math.max(1, Math.floor(primary.testRailSteps.length * ratio)));
    return primary.testRailSteps.slice(0, setupCount);
}
function evaluateRecordingSuggestionQuality(goal, trace, primary, proposal) {
    const candidate = {
        title: proposal.title,
        description: proposal.rationale,
        requiredData: [],
        testRailSteps: proposal.scenarioSpecificSteps,
    };
    const relevance = scoreGoalRelevance(goal, candidate);
    const hasGoalContext = proposal.goalRelated && relevance.score >= 0.6;
    const sharedSetup = sharedSetupForProposal(proposal, primary);
    const materialized = proposal.steps.length > 0 && proposal.steps.length >= sharedSetup.length
        ? proposal.steps
        : [...sharedSetup, ...proposal.scenarioSpecificSteps];
    const hasReachableSetup = proposal.sharedSetupRef === primary.scenarioId
        && sharedSetup.length > 0
        && materialized.slice(0, sharedSetup.length).every((step, index) => step.content === sharedSetup[index]?.content);
    const hasScenarioSpecificIntent = proposal.scenarioSpecificSteps.length > 0
        && proposal.scenarioSpecificSteps.every((step) => step.content.trim().length > 3 && !VAGUE_SETUP_STEP.test(step.content));
    const hasEvidence = proposalEvidenceRefsAreObserved(proposal, primary);
    const hasOracleAuthorityOrReview = proposal.oracleAuthority !== "MISSING" || proposal.needsReview;
    const noInventedControl = candidateMentionsOnlyObservedControls(proposal, trace, primary);
    const constraintEvidence = hasReliableConstraintEvidence(trace, proposal);
    const genericFieldNegative = proposal.type === "DERIVED_VALIDATION" && !constraintEvidence;
    const noGenericNegativeFromFieldOnly = !genericFieldNegative;
    const noUnsupportedExpectedResult = !DEFINITIVE_UNSUPPORTED_ORACLE.test(proposal.expectedResultCandidate)
        || (proposal.oracleAuthority !== "AI_HYPOTHESIS" && proposal.oracleAuthority !== "MISSING" && constraintEvidence)
        || (proposal.needsReview && (proposal.oracleAuthority === "AI_HYPOTHESIS" || proposal.oracleAuthority === "MISSING"));
    const critical = [
        hasGoalContext,
        hasReachableSetup,
        hasScenarioSpecificIntent,
        hasEvidence,
        hasOracleAuthorityOrReview,
        noInventedControl,
        noUnsupportedExpectedResult,
        noGenericNegativeFromFieldOnly,
    ];
    let rejectionReason;
    if (!hasGoalContext)
        rejectionReason = "goal_coherence_failed";
    else if (!hasReachableSetup)
        rejectionReason = "suggestion_not_materialized_from_primary_setup";
    else if (!hasScenarioSpecificIntent)
        rejectionReason = "vague_or_incomplete_scenario_specific_steps";
    else if (!hasEvidence)
        rejectionReason = "missing_observed_evidence_refs";
    else if (!noInventedControl)
        rejectionReason = "control_not_observed_in_recording";
    else if (!noGenericNegativeFromFieldOnly)
        rejectionReason = "generic_negative_without_constraint_or_validation_evidence";
    else if (!noUnsupportedExpectedResult)
        rejectionReason = "unsupported_authoritative_expected_result";
    return {
        hasGoalContext,
        hasReachableSetup,
        hasScenarioSpecificIntent,
        hasEvidence,
        hasOracleAuthorityOrReview,
        noInventedControl,
        noUnsupportedExpectedResult,
        noGenericNegativeFromFieldOnly,
        finalDecision: critical.every(Boolean) ? "accepted" : "rejected",
        ...(rejectionReason ? { rejectionReason } : {}),
    };
}
function materializeRecordingSuggestion(primary, proposal, quality) {
    const goal = primary.scenarioGoal?.trim() || primary.title.trim();
    const genericTitle = /^(?:comprobar varias entidades|opci[oó]n alternativa|repetir entidad|zero_entity|alternative_selection)$/i.test(proposal.title.trim());
    const humanTitle = genericTitle
        ? `${goal}: ${proposal.type === "DERIVED_VALIDATION" ? "comprobar el comportamiento de la variante observada" : "comprobar la alternativa observada"}`
        : proposal.title;
    const sharedSetupSteps = sharedSetupForProposal(proposal, primary);
    const materializedSteps = proposal.steps.length >= sharedSetupSteps.length
        && proposal.steps.slice(0, sharedSetupSteps.length).every((step, index) => step.content === sharedSetupSteps[index]?.content)
        ? proposal.steps
        : [...sharedSetupSteps, ...proposal.scenarioSpecificSteps];
    const hypothesis = proposal.oracleAuthority === "AI_HYPOTHESIS" || proposal.oracleAuthority === "MISSING" || proposal.hypothesis;
    const safeSteps = materializedSteps.map((step, index) => ({
        ...step,
        // Keep the observed setup oracle intact. Only the unexecuted variant is explicitly
        // marked for review when the provider cannot support its expected result.
        expected: hypothesis && index >= sharedSetupSteps.length
            ? "Resultado por confirmar: la grabación no observó esta variante"
            : step.expected,
    }));
    const numberedSafeSteps = numberScenarioSteps(safeSteps);
    return {
        ...primary,
        scenarioId: `${primary.scenarioId}-AI-${humanTitle.toLocaleLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 24) || "proposal"}`,
        title: capTitle(humanTitle),
        description: proposal.rationale,
        preconditions: [...primary.preconditions, `Setup común: ${primary.scenarioId}`],
        kind: proposal.type === "DERIVED_VALIDATION" ? "negative" : "happy_path",
        provenance: "derived",
        mobileSteps: [],
        webSteps: [],
        testRailSteps: numberedSafeSteps,
        requiredData: [],
        stepTargets: [],
        sourceRecordingId: primary.sourceRecordingId,
        hasUncertainSteps: true,
        primary: false,
        sourceEventRefs: proposal.sourceEvidenceRefs,
        traceBacked: true,
        containsUnexecutedActions: true,
        functionalReadiness: true,
        technicalReadiness: false,
        suggestionCategory: proposal.type,
        confidence: proposal.confidence,
        rationale: proposal.rationale,
        expectedResultCandidate: hypothesis ? "Resultado por confirmar; requiere revisión humana" : proposal.expectedResultCandidate,
        oracleAuthority: "review_required",
        sharedSetupRef: primary.scenarioId,
        sharedSetupSteps,
        scenarioSpecificSteps: proposal.scenarioSpecificSteps,
        quality,
        ...scenarioStepMetrics(numberedSafeSteps),
    };
}
function filterGoalScopedSuggestions(goal, suggestions, threshold = 0.6, primary) {
    const scored = suggestions.map((suggestion) => {
        const relevance = scoreGoalRelevance(goal, suggestion);
        return {
            ...suggestion,
            primary: false,
            goalRelevanceScore: relevance.score,
            goalRelevanceReasons: relevance.reasons,
            confidence: suggestion.confidence ?? (suggestion.hasUncertainSteps ? 0.6 : 0.85),
            rationale: suggestion.rationale ?? "Derivado de evidencia observada y separado del recorrido principal.",
            suggestionCategory: suggestion.suggestionCategory
                ?? (suggestion.kind === "negative" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE"),
            traceBacked: true,
            containsUnexecutedActions: true,
            functionalReadiness: suggestion.testRailSteps.length > 0,
            technicalReadiness: !suggestion.hasUncertainSteps,
            oracleAuthority: "review_required",
        };
    });
    const primarySignature = primary ? (0, canonical_recording_contract_1.materializedSemanticSignature)(primary) : undefined;
    const mutationNoEffect = primarySignature
        ? scored.filter((suggestion) => (0, canonical_recording_contract_1.materializedSemanticSignature)(suggestion) === primarySignature)
        : [];
    const noEffectIds = new Set(mutationNoEffect.map((suggestion) => suggestion.scenarioId));
    const relevant = scored.filter((suggestion) => !noEffectIds.has(suggestion.scenarioId) && (Boolean(suggestion.mutation) || (suggestion.goalRelevanceScore ?? 0) >= threshold));
    for (const suggestion of relevant) {
        if (!suggestion.runtimeInputRequirements)
            continue;
        const readiness = (0, canonical_recording_contract_1.evaluateRecordingReadiness)({
            functionalReadiness: suggestion.testRailSteps.length > 0,
            technicalReadiness: suggestion.technicalReadiness === true,
            oracleReadiness: suggestion.oracleAuthority === "observed_only",
            runtimeInputRequirements: suggestion.runtimeInputRequirements,
            publicationRequiresOracle: true,
        });
        Object.assign(suggestion, {
            readiness,
            functionalReadiness: readiness.functionalReadiness,
            technicalReadiness: readiness.technicalReadiness,
        });
    }
    const deduped = deduplicateGoalSuggestions(relevant);
    return {
        suggestions: deduped.suggestions,
        irrelevantCandidatesRejected: scored.length - relevant.length,
        duplicatesRemoved: deduped.duplicatesRemoved,
        rejectedBecause: mutationNoEffect.length > 0 ? ["MUTATION_NO_EFFECT"] : [],
    };
}
/**
 * Converts the normalized walkthrough into one happy-path scenario.
 *
 * Assertions are inserted at every screen transition rather than only at the end: a recording
 * of a five-screen flow that only asserts the final screen passes even when the app took a
 * completely different route to get there, which is exactly the failure a recorded test is
 * supposed to catch.
 */
function buildHappyPathScenario(trace, events, options = {}) {
    const screenById = new Map(trace.screens.map((s) => [s.screenKey, s]));
    const mobileSteps = [];
    const webSteps = [];
    const testRailSteps = [];
    const requiredData = [];
    const stepTargets = [];
    let hasUncertainSteps = false;
    const semanticModel = (0, semantic_recording_1.buildSemanticRecordingModel)(trace, events);
    const canonicalEvents = (0, canonical_recording_contract_1.buildCanonicalInteractions)(events, semanticModel.editingSessions);
    const editingSessionsByRef = new Map(semanticModel.editingSessions.map((session) => [session.editingSessionId, session]));
    const canonicalByEvent = new Map(canonicalEvents.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => [ref, interaction])));
    const isMobile = trace.platform === "android";
    const recordingDataPolicy = (0, semantic_recording_1.normalizeRecordingDataPolicy)(trace.recordingDataPolicy);
    if (isMobile) {
        mobileSteps.push({
            action: "launchApp",
            description: `Abrir la aplicación ${trace.appPackage ?? trace.appSlug}`,
        });
    }
    else if (trace.baseUrl) {
        webSteps.push({
            action: "navigate",
            value: trace.baseUrl,
            description: `Navegar a ${trace.baseUrl}`,
        });
    }
    testRailSteps.push({
        content: isMobile ? "Abrir la aplicación configurada" : "Abrir la aplicación configurada del proyecto",
        expected: "La aplicación carga su pantalla inicial",
        classification: "FUNCTIONAL_ACTION",
        isSetup: true,
    });
    for (const [eventIndex, event] of events.entries()) {
        if (event.kind === "note" || event.kind === "launch")
            continue;
        const canonical = canonicalByEvent.get(`event-${eventIndex + 1}`);
        // Recording Stop is the boundary. A state transition can end one screen and open the
        // next one; it is not a reason to discard later user actions. Only evidence explicitly
        // classified as technical-only is omitted from the executable projection.
        if (canonical?.technicalOnly && event.kind !== "screen_change")
            continue;
        if ((0, canonical_recording_contract_1.isMaskActivation)(events, eventIndex))
            continue;
        const nextMeaningful = events.slice(eventIndex + 1).find((candidate) => candidate.kind === "tap" || candidate.kind === "fill");
        const classification = (0, semantic_recording_1.classifySemanticEvent)(event, nextMeaningful);
        if (classification === "FOCUS_ONLY" || classification === "DYNAMIC_EDITOR_INTERNAL")
            continue;
        if (event.kind === "screen_change") {
            const destination = screenById.get(event.toScreenKey ?? "");
            const text = assertionTextFor(destination);
            if (!text)
                continue;
            if (isMobile) {
                mobileSteps.push({
                    action: "assertVisible",
                    target: { strategy: "androidUiAutomator", value: `new UiSelector().textContains("${text.replace(/"/g, '\\"')}")` },
                    description: `Verificar que se muestra "${text}"`,
                });
            }
            else {
                webSteps.push({
                    action: "assert",
                    target: { strategy: "text", value: text },
                    description: `Verificar que se muestra "${text}"`,
                });
            }
            testRailSteps.push({
                content: `El sistema muestra "${text}"`,
                expected: `Se muestra "${text}"`,
                classification: "FUNCTIONAL_ASSERTION",
            });
            continue;
        }
        const target = event.target;
        if (!target)
            continue;
        if (!target.locators?.length) {
            // A recorder may still have a confirmed value when the technical locator was lost during
            // a DOM replacement. Keep the human/TestRail evidence and its dataset binding, but do not
            // invent an executable web target. The missing locator remains visible through the
            // scenario's technical readiness flag.
            if (event.kind === "tap" && event.target?.compoundRole === "selection" && event.target.afterValue !== undefined) {
                const selectionResolution = fieldForEvent(event, eventIndex + 1);
                const selectionLabel = selectionResolution.semanticField ?? event.target.associatedField ?? event.target.label;
                const selectionKey = selectionValueKey(event, selectionLabel);
                const description = `Seleccionar [${selectionKey}] en "${selectionLabel}"`;
                if (!requiredData.some((field) => field.key === selectionKey))
                    requiredData.push({
                        key: selectionKey,
                        label: selectionLabel,
                        ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                        stepIndex: testRailSteps.length,
                        technicalTargetRefs: [],
                        sourceEventRefs: [`event-${eventIndex + 1}`],
                        exampleValue: event.target.afterValue,
                        sensitive: false,
                        valueRole: "action_input",
                        source: "RECORDED_CONFIRMED",
                    });
                testRailSteps.push({ content: description, stepTemplate: description, renderedStep: describeSelectionRendered(event, selectionLabel, description), valueKey: selectionKey, entityScope: entityScopeForTarget(event.target), interactionId: `interaction-${eventIndex + 1}`, sourceEventRefs: [`event-${eventIndex + 1}`], expected: "", classification: "FUNCTIONAL_ACTION" });
                hasUncertainSteps = true;
            }
            if (event.kind === "fill") {
                const resolution = fieldForEvent(event, eventIndex + 1);
                const label = resolution.displayLabel;
                const stepIndex = testRailSteps.length;
                const sensitive = (0, semantic_recording_1.isSensitiveRecordedEvent)(event);
                const valueKey = uniqueValueKeyFor(event, resolution.valueKey, requiredData);
                const stepTemplate = describeFillTemplate(label, valueKey);
                requiredData.push({
                    key: valueKey,
                    label,
                    ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                    stepIndex,
                    technicalTargetRefs: event.target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`),
                    sourceEventRefs: [`event-${eventIndex + 1}`],
                    exampleValue: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), (0, compound_value_1.confirmedCompoundSelectionBefore)(events, eventIndex, event.target)),
                    sensitive,
                    valueRole: sensitive ? "secure_input" : "action_input",
                    source: sensitive ? "secure" : "RECORDED_CONFIRMED",
                    validatedByInteraction: event.target?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) === true,
                    confidence: resolution.needsReview ? 0.4 : 0.9,
                    semanticField: resolution.semanticField,
                    needsReview: resolution.needsReview || (0, semantic_recording_1.aggregateTextUsedAsValue)(event),
                    reviewReason: (0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? "aggregate_compound_text_without_separate_control_evidence" : resolution.reason,
                    ...(resolution.formatHint ? { formatHint: resolution.formatHint } : {}),
                });
                testRailSteps.push({
                    content: stepTemplate,
                    ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                    sourceEventRefs: [`event-${eventIndex + 1}`],
                    stepTemplate,
                    renderedStep: describeFillRendered(event, label, stepTemplate, trace, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), (0, compound_value_1.confirmedCompoundSelectionBefore)(events, eventIndex, event.target)),
                    valueKey,
                    interactionId: `interaction-${eventIndex + 1}`,
                    sensitive,
                    // Filling is an action, not an oracle. The control's state is retained in Technical
                    // Knowledge; a functional TestRail step must not carry a tautological expectation.
                    expected: "",
                    classification: "FUNCTIONAL_ACTION",
                });
                hasUncertainSteps = true;
            }
            if (event.kind === "tap") {
                // Preserve a real observed tap in the functional projection even when no
                // technical locator survived. This is display-only; no executable target is fabricated.
                const label = event.target?.label?.trim();
                const associatedField = event.target?.associatedField?.trim();
                const displayLabel = label && !(0, trace_normalizer_1.isGenericUnresolvedLabel)(label)
                    ? label
                    : associatedField && !(0, trace_normalizer_1.isGenericUnresolvedLabel)(associatedField)
                        ? associatedField
                        : undefined;
                const description = displayLabel ? `Presionar "${displayLabel}"` : "Presionar el control indicado";
                testRailSteps.push({
                    content: description,
                    sourceEventRefs: [`event-${eventIndex + 1}`],
                    renderedStep: description,
                    interactionId: `interaction-${eventIndex + 1}`,
                    expected: "",
                    classification: "FUNCTIONAL_ACTION",
                });
                hasUncertainSteps = true;
            }
            continue;
        }
        // Ambiguous is checked on its own and not left to the confidence it carries: a locator
        // pinned to a position is executable but positional, and a reviewer has to see that even
        // if the confidence scale is ever retuned.
        const best = target.locators[0];
        if (best.ambiguous || (best.confidence !== undefined && best.confidence < 0.7)) {
            hasUncertainSteps = true;
        }
        if (event.kind === "tap") {
            const label = target.label?.trim() || "el control";
            const selection = (target.interactionType === "select" && target.afterValue !== undefined) || target.afterValue !== undefined;
            const checkbox = target.role?.toLowerCase() === "checkbox";
            const checkboxChecked = target.afterState?.selected !== false && target.afterState?.aria?.["aria-checked"] !== "false" && target.stateDelta?.checked !== false;
            const selectionResolution = selection ? fieldForEvent(event, eventIndex + 1) : undefined;
            const selectionLabel = selectionResolution?.semanticField
                ? selectionResolution.semanticField
                : selection ? `${label} · selección` : label;
            const selectionKey = selection ? selectionValueKey(event, selectionResolution?.semanticField ?? label) : undefined;
            const description = selection ? `Seleccionar [${selectionKey}] en "${selectionLabel}"` : checkbox ? `${checkboxChecked ? "Marcar" : "Desmarcar"} "${label}"` : describeTap(event);
            const renderedStep = selection ? describeSelectionRendered(event, selectionLabel, description) : description;
            if (selection && selectionKey && !requiredData.some((field) => field.key === selectionKey)) {
                requiredData.push({
                    key: selectionKey,
                    label: selectionLabel,
                    ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
                    stepIndex: isMobile ? mobileSteps.length : webSteps.length,
                    technicalTargetRefs: target.locators.map((locator) => `${locator.strategy}:${locator.value}`),
                    sourceEventRefs: [`event-${eventIndex + 1}`],
                    exampleValue: target.afterValue,
                    sensitive: false,
                    valueRole: "action_input",
                    source: "RECORDED_CONFIRMED",
                });
            }
            if (isMobile) {
                const t = toMobileTarget(event);
                if (!t)
                    continue;
                mobileSteps.push({ action: "click", target: t, description });
                stepTargets.push({ stepIndex: mobileSteps.length - 1, description, ...t, ambiguous: best.ambiguous });
            }
            else {
                webSteps.push({
                    action: "click",
                    target: { strategy: best.strategy, value: best.value },
                    ...(selectionKey ? { valueKey: selectionKey } : {}),
                    description,
                    ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
                    interactionId: `interaction-${eventIndex + 1}`,
                });
                stepTargets.push({
                    stepIndex: webSteps.length - 1,
                    description,
                    strategy: best.strategy,
                    value: best.value,
                    ambiguous: best.ambiguous,
                });
            }
            testRailSteps.push({
                content: description,
                ...(entityScopeForTarget(target) ? { entityScope: entityScopeForTarget(target) } : {}),
                sourceEventRefs: [`event-${eventIndex + 1}`],
                stepTemplate: selection ? description : undefined,
                renderedStep: selection ? renderedStep : description,
                valueKey: selectionKey,
                interactionId: `interaction-${eventIndex + 1}`,
                sensitive: false,
                expected: target.enabled === false
                    ? "El control permanece deshabilitado hasta cumplir su condición"
                    : "",
                classification: "FUNCTIONAL_ACTION",
            });
            continue;
        }
        if (event.kind === "fill") {
            const resolution = fieldForEvent(event, eventIndex + 1);
            const label = resolution.displayLabel;
            const stepIndex = isMobile ? mobileSteps.length : webSteps.length;
            const sensitive = (0, semantic_recording_1.isSensitiveRecordedEvent)(event);
            const applicationDerived = event.valueSource === "application";
            const valueKey = uniqueValueKeyFor(event, resolution.valueKey, requiredData);
            const stepTemplate = describeFillTemplate(label, valueKey);
            const compoundSelectionValue = (0, compound_value_1.confirmedCompoundSelectionBefore)(events, eventIndex, event.target);
            const renderedStep = describeFillRendered(event, label, stepTemplate, trace, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), compoundSelectionValue);
            requiredData.push({
                key: valueKey,
                label,
                ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                stepIndex,
                technicalTargetRefs: event.target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`),
                sourceEventRefs: [`event-${eventIndex + 1}`],
                exampleValue: sensitive && !recordingDataPolicy.persistQaCredentials ? undefined : recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), (0, compound_value_1.confirmedCompoundSelectionBefore)(events, eventIndex, event.target)),
                sensitive,
                valueRole: applicationDerived ? "runtime_derived_oracle" : sensitive ? "secure_input" : "action_input",
                source: applicationDerived ? "OBSERVED" : sensitive ? "secure" : "RECORDED_CONFIRMED",
                validatedByInteraction: event.target?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) === true,
                confidence: resolution.needsReview || (0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? 0.4 : 0.9,
                semanticField: resolution.semanticField,
                needsReview: resolution.needsReview || (0, semantic_recording_1.aggregateTextUsedAsValue)(event),
                reviewReason: (0, semantic_recording_1.aggregateTextUsedAsValue)(event) ? "aggregate_compound_text_without_separate_control_evidence" : resolution.reason,
                ...(resolution.formatHint ? { formatHint: resolution.formatHint } : {}),
            });
            if (isMobile) {
                const t = toMobileTarget(event);
                if (!t)
                    continue;
                mobileSteps.push({ action: "fill", target: t, value: recordedLogicalValue(event, editingSessionsByRef.get(event.target?.editingSessionRef ?? ""), compoundSelectionValue) ?? "", description: stepTemplate });
                stepTargets.push({ stepIndex: mobileSteps.length - 1, description: stepTemplate, ...t, ambiguous: best.ambiguous });
            }
            else {
                webSteps.push({
                    action: "fill",
                    target: { strategy: best.strategy, value: best.value },
                    // Web execution must bind through the semantic key. The human materialization lives
                    // only on the review/TestRail step and never becomes a literal in a generated spec.
                    value: undefined,
                    valueKey,
                    description: stepTemplate,
                    ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                    interactionId: `interaction-${eventIndex + 1}`,
                });
                stepTargets.push({
                    stepIndex: webSteps.length - 1,
                    description: stepTemplate,
                    strategy: best.strategy,
                    value: best.value,
                    ambiguous: best.ambiguous,
                });
            }
            testRailSteps.push({
                content: stepTemplate,
                ...(entityScopeForTarget(event.target) ? { entityScope: entityScopeForTarget(event.target) } : {}),
                sourceEventRefs: [`event-${eventIndex + 1}`],
                stepTemplate,
                renderedStep,
                valueKey,
                interactionId: `interaction-${eventIndex + 1}`,
                sensitive,
                expected: "",
                classification: "FUNCTIONAL_ACTION",
            });
            continue;
        }
        if (event.kind === "navigate" && !isMobile && event.url) {
            webSteps.push({ action: "navigate", value: event.url, description: "Abrir la aplicación configurada del proyecto" });
            testRailSteps.push({ content: "Abrir la aplicación configurada del proyecto", expected: "La página carga correctamente", classification: "FUNCTIONAL_ACTION" });
        }
    }
    const lastScreen = trace.screens[trace.screens.length - 1];
    const title = trace.recordingGoal?.declaredGoal?.trim() ||
        trace.recordingGoal?.normalizedGoal?.trim() ||
        options.title?.trim() ||
        trace.label?.trim() ||
        (lastScreen ? `Recorrido ${trace.platform === "web" ? "web" : "móvil"} observado` : "Recorrido observado");
    const executableCanonical = canonicalEvents.filter((interaction) => !interaction.technicalOnly && interaction.action !== "system_observation");
    const ownedTestRailSteps = attachStateOwnership(testRailSteps, executableCanonical);
    const numberedTestRailSteps = numberScenarioSteps(ownedTestRailSteps);
    const stepMetrics = scenarioStepMetrics(numberedTestRailSteps);
    const stateValidation = (0, canonical_recording_contract_1.validateInteractionStateSequence)(executableCanonical);
    const scenario = {
        scenarioId: `${options.scenarioIdPrefix ?? "REC"}-${trace.recordingId.slice(0, 8).toUpperCase()}-01`,
        title: capTitle(title),
        description: buildFallbackStory(trace, events),
        preconditions: buildPreconditions(trace),
        kind: "happy_path",
        provenance: "observed",
        scope: "end_to_end",
        mobileSteps,
        webSteps,
        testRailSteps: numberedTestRailSteps,
        requiredData,
        stepTargets,
        sourceRecordingId: trace.recordingId,
        hasUncertainSteps,
        primary: true,
        sourceEventRefs: events.map((_, index) => `event-${index + 1}`),
        traceBacked: true,
        containsUnexecutedActions: false,
        functionalReadiness: testRailSteps.length > 0,
        technicalReadiness: !hasUncertainSteps && stateValidation.stateSequenceValid,
        expectedResultCandidate: [...testRailSteps].reverse().find((step) => step.expected.trim().length > 0)?.expected,
        oracleAuthority: "observed_only",
        confidence: 0.95,
        ...stepMetrics,
        scenarioGoal: trace.recordingGoal?.declaredGoal ?? trace.recordingGoal?.normalizedGoal,
        stateSequenceValid: stateValidation.stateSequenceValid,
        stateSequenceIssues: stateValidation.stateSequenceIssues,
        postGoalObservations: canonicalEvents.filter((interaction) => interaction.postGoalObservation).flatMap((interaction) => interaction.sourceEventRefs),
        goalContract: {
            nonGeneric: Boolean(trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim()),
            goalCoherent: Boolean(trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim()),
            mutationIntentExpressed: true,
        },
    };
    // Keep navigation/state-transition interactions in the contract so downstream
    // mutations can prove reachability. They remain technical-only and are not
    // rendered as user actions.
    return (0, canonical_recording_contract_1.enrichRecordedScenarioContract)(scenario, canonicalEvents, [], semanticModel);
}
/**
 * Materializes only the primary path that the user actually walked.
 *
 * This is intentionally a separate deterministic lane from `deriveScenarios`: it builds from
 * the persisted trace/semantic authority and never calls an AI provider or creates suggestions.
 * Incomplete recordings return null instead of becoming falsely executable scenarios.
 */
function materializeObservedPrimaryScenario(trace, events = trace.events) {
    const primary = buildHappyPathScenario(trace, events);
    const functionalActionCount = primary.functionalActionCount
        ?? primary.testRailSteps.filter((step) => step.classification === "FUNCTIONAL_ACTION" && !step.isSetup).length;
    // Persist the observed path even when an action remains non-executable; readiness is
    // evaluated separately and no locator is synthesized by this persistence lane.
    const technicalTargetRefs = (primary.canonicalInteractions ?? [])
        .filter((interaction) => !interaction.technicalOnly && interaction.action !== "system_observation" && interaction.action !== "navigation")
        .every((interaction) => interaction.resolutionState === "certified"
        || interaction.technicalTargetRefs.length > 0
        || (interaction.technicalTargetCandidates?.length ?? 0) > 0);
    const hasTerminalOracle = primary.oracleAuthority === "observed_only"
        && Boolean(primary.expectedResultCandidate?.trim())
        && (primary.testRailSteps.some((step) => step.classification === "FUNCTIONAL_ASSERTION" && step.expected.trim().length > 0)
            || primary.testRailSteps.at(-1)?.expected.trim().length);
    const hasObservedTerminalAuthority = (primary.canonicalInteractions ?? []).some((interaction) => interaction.postTerminalAction === true
        || interaction.causedTransition === true
        || interaction.transitionObserved === true) || Boolean([...(primary.canonicalInteractions ?? [])].reverse().find((interaction) => !interaction.technicalOnly
        && interaction.action !== "system_observation"
        && interaction.action !== "navigation"
        && (interaction.technicalTargetRefs.length > 0 || (interaction.technicalTargetCandidates?.length ?? 0) > 0)));
    const hasLineage = primary.sourceRecordingId === trace.recordingId
        && primary.traceBacked === true
        && (primary.sourceEventRefs?.length ?? 0) > 0;
    // Persistence of the path the QA actually walked must not depend on a generated
    // oracle. A directly observed terminal action/transition is sufficient authority
    // to materialize the Primary; oracle readiness remains a separate replay gate.
    if (functionalActionCount <= 0 || !technicalTargetRefs || (!hasTerminalOracle && !hasObservedTerminalAuthority) || !hasLineage)
        return null;
    return materializeRecordedScenario(primary, primary.runtimeDataset?.resolvedValues ?? {});
}
/** Applies current reviewer values to human-facing steps without changing execution templates. */
function materializeRecordedScenario(scenario, values = {}) {
    return {
        ...scenario,
        testRailSteps: scenario.testRailSteps.map((step) => {
            if (!step.valueKey || values[step.valueKey] === undefined)
                return step;
            const template = step.stepTemplate ?? step.content;
            const marker = `[${step.valueKey}]`;
            return {
                ...step,
                renderedStep: (0, human_step_renderer_1.renderHumanStepValue)(template, step.valueKey, values[step.valueKey]),
            };
        }),
    };
}
function buildPreconditions(trace) {
    const preconditions = [];
    if (trace.platform === "android") {
        preconditions.push(`Aplicación ${trace.appPackage ?? trace.appSlug} instalada en el dispositivo`);
    }
    else if (trace.baseUrl) {
        preconditions.push("Acceso a la aplicación configurada del proyecto");
    }
    preconditions.push("Datos de prueba válidos disponibles para el proyecto");
    return preconditions;
}
/** The functional story a recording tells, without leaking technical route identity. */
function buildFallbackStory(trace, events) {
    const goal = trace.recordingGoal?.declaredGoal?.trim() || trace.recordingGoal?.normalizedGoal?.trim();
    const actionCount = events.filter((event, index) => (0, semantic_recording_1.classifySemanticEvent)(event, events[index + 1]) === "FUNCTIONAL_ACTION").length;
    if (goal) {
        return `Recorrido observado para completar "${goal}". Se registraron ${actionCount} acciones funcionales.`;
    }
    return `Recorrido funcional observado en la aplicación. Se registraron ${actionCount} acciones funcionales.`;
}
/**
 * Derives negative scenarios from what the recording proved about the app's gates.
 *
 * A control observed DISABLED during the walkthrough is direct evidence of a precondition
 * the app enforces, so a scenario that reaches it without satisfying that precondition is a
 * real test — not an invented one. Nothing is generated for gates the recording never saw.
 */
function buildGateNegatives(trace, segments, happyPath) {
    const seen = new Set();
    const negatives = [];
    for (const segment of segments) {
        for (const event of segment.events) {
            const target = event.target;
            if (!target || target.enabled !== false)
                continue;
            const label = target.label?.trim();
            if (!label || seen.has(label))
                continue;
            seen.add(label);
            const upToGate = happyPath.testRailSteps.slice(0, Math.max(1, happyPath.testRailSteps.findIndex((s) => s.content.includes(label))));
            negatives.push({
                scenarioId: `${happyPath.scenarioId}-NEG-${negatives.length + 1}`,
                title: capTitle(`${segment.title}: "${label}" permanece deshabilitado sin cumplir su condición`),
                description: `Durante la grabación el control "${label}" se observó deshabilitado en la pantalla ` +
                    `"${segment.title}". Este escenario verifica que la aplicación mantiene ese bloqueo.`,
                preconditions: buildPreconditions(trace),
                kind: "negative",
                // The steps up to the gate were walked, but forcing the gate was not: nobody tried.
                provenance: "derived",
                mobileSteps: [],
                webSteps: [],
                testRailSteps: [
                    ...upToGate,
                    {
                        content: `Intentar continuar sin completar los requisitos de "${label}"`,
                        expected: `El control "${label}" permanece deshabilitado y el flujo no avanza`,
                    },
                ],
                requiredData: [],
                stepTargets: [],
                sourceRecordingId: trace.recordingId,
                hasUncertainSteps: false,
                suggestionCategory: "DERIVED_VALIDATION",
            });
        }
    }
    return negatives;
}
/**
 * The longest title TestRail accepts on a case.
 *
 * Enforced here rather than at publish time because a title this long is unreadable in the
 * panel too — and because the alternative is what actually happened: a case rejected with
 * `:title es demasiado largo` after the other eleven had already been created.
 */
const MAX_TITLE_LENGTH = 250;
/**
 * Caps a scenario title at what TestRail accepts.
 *
 * The overflow comes from control labels: Android concatenates a container's children into
 * one `content-desc`, so a single "label" can be a whole screen's worth of text, and every
 * title that interpolates one is unbounded.
 */
function capTitle(title) {
    const clean = title.trim().replace(/\s+/g, " ");
    if (clean.length <= MAX_TITLE_LENGTH)
        return clean;
    return `${clean.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}
/** Shortens a screen title so it reads as a scenario name rather than a paragraph. */
function shortTitle(title, max = 48) {
    const clean = title.trim().replace(/\s+/g, " ");
    if (clean.length <= max)
        return clean;
    const cut = clean.slice(0, max);
    const lastSpace = cut.lastIndexOf(" ");
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
function isAction(event) {
    return event.kind === "tap" || event.kind === "fill";
}
/**
 * One scenario per block of the walkthrough, on top of the end-to-end one.
 *
 * A single recording usually covers several things a QA would file separately — reaching the
 * contact-data screen is one case, completing it is another — and a suite made of one long
 * case can only ever fail as a whole. Each scenario is the run TRUNCATED at the end of a
 * block, not the block in isolation, because the steps that got there are what make it
 * executable; every step in it was still performed by the person recorded.
 *
 * The last block is skipped: truncating there reproduces the end-to-end scenario exactly.
 */
function buildSegmentScenarios(trace, events, segments, happyPath) {
    if (segments.length < 2)
        return [];
    const scenarios = [];
    let consumed = 0;
    segments.forEach((segment, index) => {
        consumed += segment.events.length;
        if (index === segments.length - 1)
            return;
        if (!segment.events.some(isAction))
            return;
        const upToHere = events.slice(0, consumed);
        const scenario = buildHappyPathScenario(trace, upToHere, {
            title: `${trace.label?.trim() || "Bloque observado"} ${index + 1}`,
        });
        // A truncation that kept every step is the end-to-end scenario under another name.
        if (scenario.testRailSteps.length >= happyPath.testRailSteps.length)
            return;
        scenarios.push({
            ...scenario,
            scenarioId: `${happyPath.scenarioId}-SEG-${scenarios.length + 1}`,
            description: `Bloque del recorrido que termina en "${isTechnicalTitle(segment.title) ? "la pantalla observada" : shortTitle(segment.title, 80)}". ` +
                `Cubre ${scenario.testRailSteps.length} de los ${happyPath.testRailSteps.length} pasos del flujo completo.`,
            scope: "segment",
            provenance: "observed",
        });
    });
    return scenarios;
}
/** Labels the walkthrough actually pressed, per screen. */
function tappedLabelsByScreen(events) {
    const byScreen = new Map();
    for (const event of events) {
        if (event.kind !== "tap")
            continue;
        const label = event.target?.label?.trim();
        if (!label)
            continue;
        const set = byScreen.get(event.screenKey) ?? new Set();
        set.add(label);
        byScreen.set(event.screenKey, set);
    }
    return byScreen;
}
function toStepTarget(locators) {
    const locator = locators[0];
    if (!locator || !MOBILE_STRATEGIES.has(locator.strategy))
        return undefined;
    return { strategy: locator.strategy, value: locator.value };
}
/** How many alternative paths one screen may contribute, and the whole recording. */
const MAX_ALTERNATIVES_PER_SCREEN = 3;
const MAX_ALTERNATIVES_TOTAL = 6;
/**
 * Scenarios for the controls the recording SAW but the person never pressed.
 *
 * A walkthrough is one path through a screen that offered several. The other options are
 * real — they were captured with their own locators, on a screen the recording actually
 * reached — and they are the cases a QA writes next. What the recording cannot supply is
 * what they DO, so the expected result is left explicitly open and the scenario is marked
 * `derived`: it must not be run automatically as if it had been observed.
 */
function buildAlternativePathScenarios(trace, events, happyPath) {
    const tapped = tappedLabelsByScreen(events);
    const isMobile = trace.platform === "android";
    const scenarios = [];
    for (const screen of trace.screens) {
        if (scenarios.length >= MAX_ALTERNATIVES_TOTAL)
            break;
        const firstIndex = events.findIndex((e) => e.screenKey === screen.screenKey);
        if (firstIndex < 0)
            continue;
        const exercised = tapped.get(screen.screenKey) ?? new Set();
        const untouched = screen.controls
            .filter((c) => c.enabled !== false)
            .filter((c) => c.label.trim().length > 2 && !exercised.has(c.label.trim()))
            .slice(0, MAX_ALTERNATIVES_PER_SCREEN);
        for (const control of untouched) {
            if (scenarios.length >= MAX_ALTERNATIVES_TOTAL)
                break;
            // Everything the person did before arriving here is what makes the case reachable.
            const preamble = buildHappyPathScenario(trace, events.slice(0, firstIndex), {
                title: control.label,
            });
            const target = toStepTarget(control.locators);
            const locator = control.locators[0];
            const description = `Seleccionar "${control.label}"`;
            const mobileSteps = [...preamble.mobileSteps];
            const webSteps = [...preamble.webSteps];
            if (isMobile && target) {
                mobileSteps.push({ action: "click", target, description });
            }
            else if (!isMobile && locator) {
                webSteps.push({
                    action: "click",
                    target: { strategy: locator.strategy, value: locator.value },
                    description,
                });
            }
            scenarios.push({
                scenarioId: `${happyPath.scenarioId}-ALT-${scenarios.length + 1}`,
                title: capTitle(`Alternativa observada ${scenarios.length + 1}: ${control.label}`),
                description: `La pantalla "${humanScreenTitle(screen, "la pantalla observada")}" ofrece "${control.label}", que el recorrido grabado ` +
                    `no ejercitó. El resultado esperado debe confirmarse antes de automatizar este caso.`,
                preconditions: preamble.preconditions,
                kind: "happy_path",
                provenance: "derived",
                mobileSteps,
                webSteps,
                testRailSteps: [
                    ...preamble.testRailSteps,
                    { content: description, expected: "Por confirmar: la grabación no recorrió esta opción" },
                ],
                requiredData: preamble.requiredData,
                stepTargets: locator
                    ? [
                        ...preamble.stepTargets,
                        {
                            stepIndex: (isMobile ? mobileSteps.length : webSteps.length) - 1,
                            description,
                            strategy: locator.strategy,
                            value: locator.value,
                            ambiguous: locator.ambiguous,
                        },
                    ]
                    : preamble.stepTargets,
                sourceRecordingId: trace.recordingId,
                hasUncertainSteps: true,
                suggestionCategory: "DERIVED_ALTERNATIVE",
            });
        }
    }
    return scenarios;
}
