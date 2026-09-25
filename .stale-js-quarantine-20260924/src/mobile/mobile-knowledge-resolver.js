"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENERATOR_READABLE_SCREEN_KINDS = void 0;
exports.isGeneratorReadableScreenItem = isGeneratorReadableScreenItem;
exports.loadMobileKnowledge = loadMobileKnowledge;
exports.selectRelevantMobileKnowledge = selectRelevantMobileKnowledge;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
/**
 * Screen-observation kinds the generator can read.
 *
 * `persistRuntimeSnapshot` writes these as "route_menu_snapshot"; "screen_observed" only ever
 * existed in a log line and in this filter, so no item ever matched, the prompt's learned-screen
 * block was always empty, and the generator reported having no screen evidence at all. Both names
 * are accepted so files written before the fix still read.
 */
exports.GENERATOR_READABLE_SCREEN_KINDS = ["route_menu_snapshot", "screen_observed"];
/**
 * The single gate deciding whether a learned screen reaches the generator. Exported so the
 * knowledge health check asks the exact same question the prompt does \u2014 a check that answered it
 * separately could go green while the generator saw nothing, which is precisely how the mismatch
 * above survived unnoticed.
 */
function isGeneratorReadableScreenItem(item) {
    return (exports.GENERATOR_READABLE_SCREEN_KINDS.includes(item.knowledgeKind) &&
        item.trustedForReuse === true &&
        item.validationStatus === "validated" &&
        Array.isArray(item.clickTargets));
}
function normalize(s) {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function readKnowledgeFile(filePath) {
    try {
        if (!fs.existsSync(filePath))
            return [];
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return Array.isArray(parsed?.items) ? parsed.items : [];
    }
    catch {
        return [];
    }
}
/**
 * Loads an app's mobile knowledge from `app.knowledge.json`.
 *
 * That is where every runtime observation lands — route learning, test runs, and the SQL
 * materialization all write it. This resolver had regressed to reading `mobile.knowledge.json`
 * instead, a legacy file most projects do not even have, so it returned an empty item list:
 * the locator authority gate then had no evidence to check against and marked every generated
 * locator unbacked, no matter how thoroughly the app had actually been walked, leaving every
 * story permanently stuck on route learning. The tests in this module already asserted the
 * correct source (and the legacy file's deliberate isolation) before the regression.
 */
function loadMobileKnowledge(appSlug) {
    const kp = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
    return { items: readKnowledgeFile(kp) };
}
/**
 * Selects the trusted screen observations most relevant to a story, so the generator
 * can ground steps in real screens that were never hand-declared in mobile.config.json.
 * Only validated + trusted items are eligible (same gate as the web resolver). Scored by
 * keyword overlap of the story text against each screen's texts, plus trust signals.
 */
function selectRelevantMobileKnowledge(knowledge, huText, limit = 5) {
    const huTokens = new Set(normalize(huText).split(/[^a-z0-9]+/).filter((t) => t.length >= 4));
    const scored = knowledge.items
        .filter((i) => isGeneratorReadableScreenItem(i))
        .map((i) => {
        const texts = [...(i.clickTargets ?? []), ...(i.assertionTargets ?? [])];
        const bag = normalize(texts.join(" "));
        let overlap = 0;
        for (const tok of huTokens)
            if (bag.includes(tok))
                overlap++;
        const trust = (i.trustedForReuse ? 10 : 0) + Math.min(i.runCount ?? 0, 5) - (i.failureCount ?? 0) * 3;
        return { item: i, score: overlap * 10 + trust };
    })
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    return scored.map(({ item }) => ({
        screenKey: item.screenKey,
        title: item.title ?? item.screenKey,
        clickTargets: item.clickTargets ?? [],
        assertionTargets: item.assertionTargets ?? [],
        runCount: item.runCount ?? 1,
        disabledTargets: Array.isArray(item.observedControls)
            ? Array.from(new Set(item.observedControls
                .filter((c) => c.enabled === false)
                .map((c) => String(c.label ?? ""))
                .filter(Boolean)))
            : []
    }));
}
