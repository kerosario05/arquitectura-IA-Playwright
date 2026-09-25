"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyVariantCandidates = classifyVariantCandidates;
exports.requiredFieldsSatisfied = requiredFieldsSatisfied;
exports.discoverAuthVariants = discoverAuthVariants;
const auth_variant_persister_1 = require("./auth-variant-persister");
const SAFE_SELECTOR_RE = /\b(tab|radio|option|select|variant|mode|tipo|tipo_de)\b/i;
const DANGEROUS_RE = /\b(submit|confirm|accept|agree|login|iniciar|entrar|enviar|send|next|siguiente|guardar|save|delete|remove|otp|password|token)\b/i;
/**
 * Classify observed controls into safe variant candidates.
 * Only tab/radio/option/select-type selectors are safe to test.
 * Arbitrary buttons, submit actions, and credential fields are excluded.
 * If no candidates can be distinguished as safe, returns empty (fail-closed).
 */
function classifyVariantCandidates(controls, sourceScreenKey) {
    const candidates = [];
    for (const c of controls) {
        const text = (c.value || c.label || "").trim();
        if (!text)
            continue;
        if (DANGEROUS_RE.test(text))
            continue;
        let safety = 0;
        const strategy = (c.strategy || "").toLowerCase();
        if (strategy === "tab" || strategy === "radio" || strategy === "option" || strategy === "select") {
            safety = 1;
        }
        else if (SAFE_SELECTOR_RE.test(text)) {
            safety = 0.8;
        }
        else if (/^[A-Z\u00C0-\u024F]/.test(text) && text.length < 40) {
            safety = 0.5;
        }
        if (safety > 0) {
            candidates.push({
                label: c.label,
                locatorIdentity: c.locatorIdentity,
                strategy: c.strategy || "accessibilityId",
                value: c.value || c.label,
                sourceScreenKey,
                safety,
            });
        }
    }
    candidates.sort((a, b) => b.safety - a.safety);
    return candidates;
}
/**
 * Compare observed fields before/after a variant selection against required fields.
 * A field is considered satisfied if it appears in `after` (whether or not it was in `before`).
 */
function requiredFieldsSatisfied(observedBefore, observedAfter, requiredFields) {
    const afterSet = new Set(observedAfter.map((f) => f.toLowerCase().trim()));
    const matched = [];
    const missing = [];
    for (const rf of requiredFields) {
        if (afterSet.has(rf.toLowerCase().trim()))
            matched.push(rf);
        else
            missing.push(rf);
    }
    return { satisfied: missing.length === 0, matched, missing };
}
/**
 * Discover auth variants by controlled exploration:
 * 1. Snapshot initial state
 * 2. Classify safe variant candidates from observed controls
 * 3. For each candidate (highest safety first): click → snapshot → compare requiredFields
 * 4. If matches: persist phase 1 observation
 * 5. Restore state before next candidate
 * 6. Fail closed if no candidates can be safely classified
 */
async function discoverAuthVariants(config) {
    const { requiredFields, appSlug, sourceScreenKey, issueKey, observedControls, page } = config;
    const candidates = classifyVariantCandidates(observedControls, sourceScreenKey);
    if (candidates.length === 0) {
        console.log("[auth-variant-discovery] status=no_variant reason=no_classifiable_candidates");
        return { status: "no_variant", persistedIds: [], testedCount: 0 };
    }
    const initialSnapshot = await page.snapshotFields();
    const persistedIds = [];
    for (const candidate of candidates) {
        if (candidate.safety < 0.5) {
            console.log(`[auth-variant-discovery] skip candidate="${candidate.label}" safety=${candidate.safety} reason=low_safety`);
            continue;
        }
        console.log(`[auth-variant-discovery] testing candidate="${candidate.label}" locatorIdentity=${candidate.locatorIdentity ?? "-"} safety=${candidate.safety}`);
        const beforeSnapshot = await page.snapshotFields();
        const afterFingerprint = await page.clickCandidate(candidate);
        const afterSnapshot = await page.snapshotFields();
        const { satisfied, matched, missing } = requiredFieldsSatisfied(initialSnapshot, afterSnapshot, requiredFields);
        console.log(`[auth-variant-discovery] candidate="${candidate.label}" satisfied=${satisfied} matched=${matched.length} missing=${missing.length}`);
        if (satisfied) {
            const obs = {
                variantLabel: candidate.label,
                locatorIdentity: candidate.locatorIdentity,
                sourceScreenKey,
                observedFieldsBefore: beforeSnapshot,
                observedFieldsAfter: afterSnapshot,
                requiredFieldsMatched: matched,
                postSelectionFingerprint: afterFingerprint ?? undefined,
            };
            const item = await (0, auth_variant_persister_1.persistAuthVariant)(appSlug, obs, { phase: 1, issueKey });
            persistedIds.push(String(item.id ?? ""));
            console.log(`[auth-variant-discovery] persisted id=${item.id} label="${candidate.label}" matched=${matched.join(",")}`);
        }
        else {
            console.log(`[auth-variant-discovery] candidate="${candidate.label}" not_satisfied missing=${missing.join(",")}`);
        }
        // Restore state before testing next candidate
        await page.restoreState(afterFingerprint);
    }
    return {
        status: persistedIds.length > 0 ? "variant_found" : "no_variant",
        persistedIds,
        testedCount: candidates.filter((c) => c.safety >= 0.5).length,
    };
}
