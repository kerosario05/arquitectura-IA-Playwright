"use strict";
/**
 * Scenario Preview in-flight / single-flight guard.
 *
 * Prevents two equivalent Scenario Preview requests from triggering two
 * simultaneous AI generations. Only active while generation is running —
 * this is NOT a permanent cache. Once the generation settles (success or
 * failure), the key is removed and a later request can generate again.
 *
 * Local to the current Node process. Redis/SQL locks are intentionally NOT
 * used; they would only be needed for multiple Automation Engine instances.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScenarioPreviewInFlightKey = buildScenarioPreviewInFlightKey;
exports.scenarioInFlightHas = scenarioInFlightHas;
exports.getScenarioInFlightCount = getScenarioInFlightCount;
exports.runScenarioPreviewInFlight = runScenarioPreviewInFlight;
const node_crypto_1 = require("node:crypto");
const inFlight = new Map();
/**
 * Deterministic, generic key for an equivalent generation.
 *
 * Built from request parameters that materially change generation. `huFingerprint`
 * is a short hash of the loaded HUs' `updated` timestamps (preferred) or content —
 * included so that same issue key + different HU content produces a different key
 * and avoids a stale join. selectedIssueKeys are sorted so order does not alter
 * equivalence.
 */
function buildScenarioPreviewInFlightKey(input) {
    const parts = [
        input.appSlug ?? "",
        input.projectKey,
        String(input.sprintId ?? 0),
        input.activeSprint ? "active" : "explicit",
        input.status ?? "",
        (input.selectedIssueKeys ?? []).slice().sort().join("|"),
        String(input.maxResults ?? 50),
        input.generationMode ?? "",
        input.huFingerprint ?? "",
    ];
    return (0, node_crypto_1.createHash)("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}
/** Whether a generation for `key` is currently active. */
function scenarioInFlightHas(key) {
    return inFlight.has(key);
}
/** Number of currently active generations (test/observability helper). */
function getScenarioInFlightCount() {
    return inFlight.size;
}
/**
 * Run `fn` single-flight for `key`.
 *
 * - No entry for `key`: starts generation, registers the promise.
 * - Entry exists: joins the in-flight promise (no second AI call).
 * - finally: removes `key` from the registry so a later request can generate again.
 * - On rejection: the same finally releases the key — no orphan locks.
 */
async function runScenarioPreviewInFlight(key, fn) {
    const existing = inFlight.get(key);
    if (existing) {
        console.log(`[scenario-generation:inflight] key=${key} action=joined`);
        return existing;
    }
    console.log(`[scenario-generation:inflight] key=${key} action=started`);
    const tracked = Promise.resolve()
        .then(() => fn())
        .finally(() => {
        if (inFlight.get(key) === tracked) {
            inFlight.delete(key);
        }
        console.log(`[scenario-generation:inflight] key=${key} action=released`);
    });
    inFlight.set(key, tracked);
    return tracked;
}
