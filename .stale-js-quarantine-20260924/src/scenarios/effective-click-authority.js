"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectBranchRequiredClicks = collectBranchRequiredClicks;
exports.mergeEffectiveAllowedClicks = mergeEffectiveAllowedClicks;
function normalizeClickTarget(target) {
    return target.normalize("NFC").toLowerCase().trim();
}
function collectBranchRequiredClicks(functionalBranches) {
    if (!functionalBranches || functionalBranches.length === 0)
        return [];
    const unique = new Set();
    const clicks = [];
    for (const branch of functionalBranches) {
        const sourceLabel = branch.sourceLabel?.trim();
        if (!sourceLabel)
            continue;
        const normalized = normalizeClickTarget(sourceLabel);
        if (unique.has(normalized))
            continue;
        unique.add(normalized);
        clicks.push(sourceLabel);
    }
    return clicks;
}
function mergeEffectiveAllowedClicks(baseAllowedClicks, _branchRequiredClicks, protectedClicks = []) {
    const effectiveAllowedClicks = [...baseAllowedClicks];
    const seen = new Set(effectiveAllowedClicks.map((target) => normalizeClickTarget(target)));
    let addedFromProtected = 0;
    for (const target of protectedClicks) {
        const normalized = normalizeClickTarget(target);
        if (seen.has(normalized))
            continue;
        seen.add(normalized);
        effectiveAllowedClicks.push(target);
        addedFromProtected++;
    }
    return {
        effectiveAllowedClicks,
        addedFromBranchRequired: 0,
        addedFromProtected,
    };
}
