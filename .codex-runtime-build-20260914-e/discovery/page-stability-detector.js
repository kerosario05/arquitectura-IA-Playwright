"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForStablePageState = waitForStablePageState;
const page_scanner_1 = require("../explorer/page-scanner");
const transient_screen_detector_1 = require("./transient-screen-detector");
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_POLL_MS = 300;
const DEFAULT_STABLE_FOR_MS = 800;
function normalizeText(text) {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function hasLandingHints(snapshot, hints) {
    if (!hints || hints.length === 0)
        return true;
    const texts = [];
    if (snapshot?.elements) {
        for (const el of snapshot.elements) {
            if (el.text)
                texts.push(el.text);
            if (el.nearbyText)
                texts.push(el.nearbyText);
        }
    }
    const normalizedTexts = texts.map(normalizeText);
    return hints.some((hint) => normalizedTexts.some((text) => text.includes(normalizeText(hint))));
}
async function waitForStablePageState(page, options = {}) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const stableForMs = options.stableForMs ?? DEFAULT_STABLE_FOR_MS;
    const landingHints = options.expectedLandingHints ?? [];
    const result = {
        waited: false,
        reason: "already_stable",
        evidence: [],
        durationMs: 0,
        finalUrl: page.url(),
        finalStable: true,
        transientDetections: []
    };
    const startTime = Date.now();
    let lastStableAt = Date.now();
    let lastUrl = page.url();
    let consecutiveStable = 0;
    let waited = false;
    while (Date.now() - startTime < timeoutMs) {
        const snapshot = await (0, page_scanner_1.scanCurrentPage)(page);
        const detection = (0, transient_screen_detector_1.detectTransientScreen)(snapshot);
        result.transientDetections.push(detection);
        const currentUrl = page.url();
        const urlChanged = currentUrl !== lastUrl;
        const isTransient = detection.transient;
        const hasHints = hasLandingHints(snapshot, landingHints);
        if (isTransient || urlChanged) {
            waited = true;
            lastStableAt = Date.now();
            consecutiveStable = 0;
            lastUrl = currentUrl;
            if (isTransient && detection.reason) {
                result.reason = detection.reason;
                result.evidence = [...detection.evidence];
            }
            else if (urlChanged) {
                result.reason = "url_changing";
                result.evidence = [`URL changed to: ${currentUrl}`];
            }
            await page.waitForTimeout(pollMs);
            continue;
        }
        if (!isTransient && !urlChanged) {
            consecutiveStable += pollMs;
            if (consecutiveStable >= stableForMs && (landingHints.length === 0 || hasHints)) {
                result.waited = waited;
                result.durationMs = Date.now() - startTime;
                result.finalUrl = currentUrl;
                result.finalStable = true;
                if (!waited) {
                    result.reason = "already_stable";
                }
                else {
                    result.reason = "stabilized";
                }
                return result;
            }
        }
        await page.waitForTimeout(pollMs);
    }
    result.waited = waited;
    result.durationMs = Date.now() - startTime;
    result.finalUrl = page.url();
    result.finalStable = false;
    result.reason = "timeout";
    return result;
}
