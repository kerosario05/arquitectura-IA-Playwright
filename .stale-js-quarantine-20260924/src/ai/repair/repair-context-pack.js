"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRepairContextPack = buildRepairContextPack;
const SECRET_PATTERNS = [
    /password/gi,
    /contrasena/gi,
    /otp/gi,
    /token/gi,
    /api[-_ ]?key/gi,
    /authorization/gi,
    /secret/gi
];
function redactSecrets(value) {
    let result = value;
    for (const pattern of SECRET_PATTERNS) {
        result = result.replace(pattern, "[REDACTED]");
    }
    return result;
}
function safeClone(value) {
    if (value === null || value === undefined)
        return value;
    if (typeof value === "string")
        return redactSecrets(value);
    if (typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.map(safeClone);
    const obj = value;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = redactSecrets(k);
        out[key] = safeClone(v);
    }
    return out;
}
function buildRepairContextPack(input) {
    const filteredCandidates = input.candidates
        .filter((candidate) => candidate.visible)
        .map((candidate) => ({
        candidateId: candidate.candidateId,
        role: candidate.role,
        name: candidate.name ? redactSecrets(candidate.name) : undefined,
        text: candidate.text ? redactSecrets(candidate.text) : undefined,
        visible: candidate.visible,
        enabled: candidate.enabled,
        clickable: candidate.clickable,
        editable: candidate.editable,
        semanticRelation: candidate.semanticRelation,
        score: candidate.score,
        sensitive: candidate.sensitive
    }));
    const pack = {
        appSlug: input.appSlug,
        failure: redactSecrets(input.failure),
        currentStep: redactSecrets(input.currentStep),
        currentUrl: input.currentUrl,
        snapshotSummary: safeClone(input.snapshotSummary),
        candidates: filteredCandidates,
        runtimeEvidenceTrace: safeClone(input.runtimeEvidenceTrace),
        structuralEvidence: safeClone(input.structuralEvidence),
        feedbackEvidence: safeClone(input.feedbackEvidence),
        pendingAssertions: input.pendingAssertions?.map(redactSecrets),
        previousActions: input.previousActions?.map(redactSecrets),
        previousFills: input.previousFills?.map(redactSecrets),
        constraints: input.constraints?.map(redactSecrets),
        // Route recovery fields
        failureType: input.failureType,
        targetRoute: input.targetRoute ? redactSecrets(input.targetRoute) : undefined,
        currentScreen: input.currentScreen ? {
            url: input.currentScreen.url,
            title: redactSecrets(input.currentScreen.title),
            visibleHeadings: input.currentScreen.visibleHeadings?.map(redactSecrets),
            visibleNavItems: input.currentScreen.visibleNavItems?.map(redactSecrets),
            visibleActions: input.currentScreen.visibleActions?.map(redactSecrets),
            visibleTextSummary: input.currentScreen.visibleTextSummary?.map(redactSecrets),
            visibleDialogs: input.currentScreen.visibleDialogs?.map(redactSecrets),
            visibleForms: input.currentScreen.visibleForms?.map(redactSecrets),
            visibleLists: input.currentScreen.visibleLists?.map(redactSecrets)
        } : undefined,
        routeHistory: input.routeHistory ? {
            failedRoutePaths: input.routeHistory.failedRoutePaths,
            visitedUrls: input.routeHistory.visitedUrls?.map(redactSecrets)
        } : undefined,
        // Assertion resolution fields
        assertionTarget: input.assertionTarget ? redactSecrets(input.assertionTarget) : undefined,
        assertionText: input.assertionText ? redactSecrets(input.assertionText) : undefined,
        evidenceCandidates: input.evidenceCandidates?.map((e) => ({
            evidenceId: e.evidenceId,
            type: e.type,
            text: e.text ? redactSecrets(e.text) : undefined,
            visible: e.visible,
            source: e.source,
            confidence: e.confidence,
            sensitive: e.sensitive
        })),
        // Selection resolution fields
        selectionTarget: input.selectionTarget ? redactSecrets(input.selectionTarget) : undefined,
        selectionIntent: input.selectionIntent ? redactSecrets(input.selectionIntent) : undefined,
        selectionCandidates: input.selectionCandidates?.map((c) => ({
            candidateId: c.candidateId,
            role: c.role,
            name: c.name ? redactSecrets(c.name) : undefined,
            text: c.text ? redactSecrets(c.text) : undefined,
            visible: c.visible,
            enabled: c.enabled,
            clickable: c.clickable,
            semanticRelation: c.semanticRelation,
            score: c.score,
            sensitive: c.sensitive,
            // Enriched fields for AI selection
            cardText: c.cardText ? redactSecrets(c.cardText) : undefined,
            nearbyText: c.nearbyText ? redactSecrets(c.nearbyText) : undefined,
            priceText: c.priceText,
            categoryHeading: c.categoryHeading ? redactSecrets(c.categoryHeading) : undefined,
            position: c.position
        }))
    };
    const serialized = JSON.stringify(pack);
    if (serialized.length <= input.maxChars)
        return pack;
    const compact = {
        ...pack,
        runtimeEvidenceTrace: undefined,
        structuralEvidence: undefined,
        feedbackEvidence: undefined,
        previousActions: pack.previousActions?.slice(-5),
        previousFills: pack.previousFills?.slice(-5),
        candidates: pack.candidates.slice(0, 30)
    };
    const compactSerialized = JSON.stringify(compact);
    if (compactSerialized.length <= input.maxChars)
        return compact;
    return {
        ...compact,
        snapshotSummary: { truncated: true },
        candidates: compact.candidates.slice(0, 10),
        pendingAssertions: compact.pendingAssertions?.slice(0, 5)
    };
}
