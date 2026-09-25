"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistMobileScreen = persistMobileScreen;
exports.persistMobileRoute = persistMobileRoute;
const runtime_knowledge_persister_1 = require("../knowledge/runtime-knowledge-persister");
function toRuntimeSnapshot(snapshot) {
    return {
        screenKey: snapshot.screenKey,
        url: `mobile://${snapshot.screenKey}`,
        clickTargets: snapshot.clickTargets,
        businessLabels: snapshot.clickTargets,
        observedControls: (snapshot.observedControls ?? []).map((c) => ({
            ...c,
            sourceScreenKey: snapshot.screenKey,
        })),
        assertionTargets: snapshot.assertionTargets,
        headings: [],
        inputLabels: [],
        selectLabels: [],
        capturedAt: new Date().toISOString(),
    };
}
/** Persists a screen observation via shared SQL-first persister (ProjectKnowledge → app.knowledge.json). */
async function persistMobileScreen(appSlug, snapshot, meta) {
    if (snapshot.clickTargets.length === 0 && snapshot.assertionTargets.length === 0)
        return;
    const before = Date.now();
    await (0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(appSlug, toRuntimeSnapshot(snapshot), {
        issueKey: meta.issueKey,
        scenarioTitle: meta.scenarioTitle,
        status: meta.status,
    });
    const isSuccess = meta.status === "passed" || meta.status === "partial";
    console.log(`[mobile:runtime-knowledge] appSlug=${appSlug} kind=screen_observed screenKey=${snapshot.screenKey} status=${meta.status} validationStatus=${isSuccess ? "validated" : "pending"} trustedForReuse=${isSuccess} ms=${Date.now() - before}`);
}
/** Persists a functional route via shared SQL-first persister; each transition becomes a route_transition. */
async function persistMobileRoute(appSlug, clickTargets, meta, transitions) {
    if (clickTargets.length < 1)
        return;
    await (0, runtime_knowledge_persister_1.persistRuntimeRoute)(appSlug, clickTargets, clickTargets, {
        issueKey: meta.issueKey,
        scenarioTitle: meta.scenarioTitle,
        status: meta.status,
    });
    if (transitions && meta.expectedAppPackage) {
        for (const t of transitions) {
            if (!t.screenBefore || !t.screenAfter || !t.action)
                continue;
            await (0, runtime_knowledge_persister_1.persistRuntimeTransition)(appSlug, {
                sourceScreenKey: t.screenBefore,
                destinationScreenKey: t.screenAfter,
                actionBusinessLabel: undefined,
                actionDescription: t.action,
                actionLocatorIdentity: t.actionLocatorIdentity ?? (t.actionTarget ? `${t.actionTarget.strategy}:${t.actionTarget.value}` : undefined),
                controlPackage: t.controlPackage,
                controlResourceId: t.controlResourceId,
                controlContentDesc: t.controlContentDesc,
                requirementIds: t.requirementIds,
                actionSemanticAuthority: t.actionSemanticAuthority,
                transitionValidated: t.transitionValidated,
                executionBacked: t.executionBacked,
                observedDestinationEvidence: t.observedDestinationEvidence,
                bindingCandidate: t.bindingCandidate,
            }, meta.expectedAppPackage);
        }
    }
    const isSuccess = meta.status === "passed";
    console.log(`[mobile:runtime-knowledge] appSlug=${appSlug} kind=route_observed clickTargets=${clickTargets.length} transitions=${transitions?.length ?? 0} status=${meta.status} validationStatus=${isSuccess ? "validated" : "pending"} trustedForReuse=${isSuccess}`);
}
