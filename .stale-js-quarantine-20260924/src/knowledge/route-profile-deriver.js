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
exports.loadRouteKnowledge = loadRouteKnowledge;
exports.deriveRouteProfileFromKnowledge = deriveRouteProfileFromKnowledge;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const project_reader_1 = require("../db/project-reader");
function knowledgePath(appSlug) {
    return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}
/**
 * Read knowledge items for an app. SQL ProjectKnowledge is the source of truth;
 * materialized app.knowledge.json is only a legacy fallback when SQL is unavailable.
 */
async function loadRouteKnowledge(appSlug) {
    try {
        const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(appSlug);
        if (cfg) {
            const raw = cfg.knowledge?.knowledgeJson;
            if (raw) {
                const parsed = JSON.parse(raw);
                const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
                return { items, projectType: cfg.projectType };
            }
            return { items: [], projectType: cfg.projectType };
        }
    }
    catch (err) {
        console.warn(`[route-bootstrap] sqlKnowledgeUnavailable appSlug=${appSlug} err=${err.message}`);
    }
    try {
        const p = knowledgePath(appSlug);
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
            const items = parsed && Array.isArray(parsed.items) ? parsed.items : [];
            return { items, projectType: 0 };
        }
    }
    catch {
        /* ignore corrupted fallback */
    }
    return { items: [], projectType: 0 };
}
function urlDepth(u) {
    const s = String(u ?? "");
    if (!/^https?:\/\//.test(s))
        return 999;
    return s.replace(/^https?:\/\//, "").split("/").filter(Boolean).length;
}
/**
 * Derive a minimal McpRouteProfile strictly from route_menu_snapshot evidence.
 * Never invents routes: entry/visibleControls come from observed clickTargets,
 * domainTerms from observed assertionTargets, intermediates per screenKey only
 * when that screen has click targets. Returns null when evidence is insufficient.
 */
function deriveRouteProfileFromKnowledge(items) {
    const snapshots = items.filter((i) => i.knowledgeKind === "route_menu_snapshot" &&
        Array.isArray(i.clickTargets) &&
        i.clickTargets.length > 0);
    if (snapshots.length === 0)
        return null;
    const visibleControls = [];
    const seen = new Set();
    const assertionTerms = [];
    const intermediates = {};
    // Observed transition graph: sourceScreenKey → { action label → destScreenKey }.
    // Only runtime observation creates transitions (route_transition items); the
    // graph is the ONLY basis for coherent navigation paths.
    const transitions = items.filter((i) => i.knowledgeKind === "route_transition" &&
        i.validationStatus === "validated" &&
        i.trustedForReuse === true &&
        i.sourceScreenKey &&
        i.destinationScreenKey &&
        String(i.actionBusinessLabel ?? "").trim());
    const graph = new Map();
    const transitionScreens = new Set();
    for (const tr of transitions) {
        const src = String(tr.sourceScreenKey);
        const dest = String(tr.destinationScreenKey);
        const action = String(tr.actionBusinessLabel).trim();
        if (!graph.has(src))
            graph.set(src, []);
        graph.get(src).push({ action, dest });
        transitionScreens.add(src);
        transitionScreens.add(dest);
    }
    const screenTargets = new Map();
    for (const s of snapshots) {
        const sk = s.screenKey;
        if (!sk)
            continue;
        const clicks = s.clickTargets ?? [];
        const business = (s.businessLabels ?? []).length === clicks.length
            ? s.businessLabels
            : clicks;
        screenTargets.set(sk, business);
    }
    for (const s of snapshots) {
        const clicks = s.clickTargets ?? [];
        // Prefer business labels (clean primary) for semantic/generation surfaces;
        // fall back to the observed locator identity when not recorded.
        const business = (s.businessLabels ?? []).length === clicks.length
            ? s.businessLabels
            : clicks;
        for (const t of business) {
            const k = String(t).trim();
            if (k && !seen.has(k)) {
                seen.add(k);
                visibleControls.push(k);
            }
        }
        const at = s.assertionTargets;
        if (Array.isArray(at)) {
            for (const a of at) {
                const v = String(a).trim();
                if (v && !assertionTerms.includes(v))
                    assertionTerms.push(v);
            }
        }
        const sk = s.screenKey;
        // Legacy flat fallback ONLY for screens never reached via observed
        // transitions — it is never used to fabricate a navigation chain.
        if (sk && !transitionScreens.has(sk) && Array.isArray(clicks) && clicks.length > 0) {
            intermediates[sk] = business.slice(0, 10);
        }
    }
    if (visibleControls.length === 0)
        return null;
    const sorted = [...snapshots].sort((a, b) => urlDepth(a.url) - urlDepth(b.url));
    const firstSnapshot = sorted[0];
    const firstClicks = firstSnapshot?.clickTargets ?? [];
    const firstBusiness = (firstSnapshot?.businessLabels ?? []).length === firstClicks.length
        ? firstSnapshot?.businessLabels
        : firstClicks;
    const landingTargets = firstBusiness.slice(0, 8);
    const entry = landingTargets.map((t) => ({ businessLabel: t, visibleLabel: t }));
    // Evidence-backed aliases: bridge the clean business label (used in scenarios
    // and prompt) and the full locator identity (used to resolve the DOM). A
    // required branch action or route step is MCP-executable ONLY when its label
    // is linked to an observed clickTarget through this map — never from Jira.
    const aliases = {};
    for (const s of snapshots) {
        const clicks = s.clickTargets ?? [];
        const business = (s.businessLabels ?? []).length === clicks.length
            ? s.businessLabels
            : clicks;
        for (let i = 0; i < clicks.length; i++) {
            const locator = String(clicks[i]).trim();
            const label = String(business[i] ?? clicks[i]).trim();
            if (!locator || !label || label === locator)
                continue;
            aliases[label] = locator;
            aliases[locator] = label;
        }
    }
    // Derive REAL navigation paths from the observed transition graph (D/E). A
    // target on a screen reachable from the entry screen via observed transitions
    // gets an explicit path (entry → … → screen) with confidence high. Assertions
    // never act as navigation intermediates — only clicks recorded as transitions.
    const targetPaths = {};
    const derivedIntermediates = {};
    const entryScreen = firstSnapshot?.screenKey ? String(firstSnapshot.screenKey) : "";
    const pathToScreen = new Map();
    if (entryScreen) {
        pathToScreen.set(entryScreen, []);
        const queue = [entryScreen];
        const visited = new Set([entryScreen]);
        while (queue.length > 0) {
            const current = queue.shift();
            for (const edge of graph.get(current) ?? []) {
                if (visited.has(edge.dest))
                    continue;
                visited.add(edge.dest);
                pathToScreen.set(edge.dest, [...(pathToScreen.get(current) ?? []), edge.action]);
                queue.push(edge.dest);
            }
        }
    }
    for (const [screenKey, business] of screenTargets) {
        const path = pathToScreen.get(screenKey);
        if (!path)
            continue;
        for (const label of business) {
            const l = String(label).trim();
            if (!l)
                continue;
            derivedIntermediates[l] = [...path, l];
            targetPaths[l] = {
                target: l,
                requiredIntermediates: path,
                confidence: "high",
                source: "runtime_transitions",
            };
            console.log(`[route-path] branch="${l}" screens=${path.length + 1} actions=[${path.join(",")}] coherent=true reason=runtime_transitions`);
        }
    }
    const profile = {
        name: "derived_runtime",
        entry,
        aliases,
        intermediates: { ...intermediates, ...derivedIntermediates },
        targetPaths,
        domainTerms: Object.fromEntries(assertionTerms.map((t) => [t, t])),
        visibleControls: visibleControls.slice(0, 20),
        representativeFixture: {},
        notes: ["Derived at runtime from ProjectKnowledge route_menu_snapshot + route_transition evidence"],
        entrySteps: landingTargets.map((t) => ({ action: "click", target: t, when: "start" })),
    };
    return profile;
}
