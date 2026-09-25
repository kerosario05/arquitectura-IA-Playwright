"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMobileScreenSnapshot = extractMobileScreenSnapshot;
const node_crypto_1 = require("node:crypto");
/** Decodes common XML entities and normalizes whitespace. */
function decodeXml(s) {
    return s
        .replace(/&#10;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}
/** Matches each XML element tag (self-closing or opening) with all its attributes. */
const ELEMENT_RE = /<([\w.]+)\b([^>]*?)\/?>/g;
function attr(attrs, name) {
    const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
    return m ? m[1] : undefined;
}
/**
 * Parses an Appium/UiAutomator2 page-source XML into a screen snapshot: the clickable
 * targets (what can be tapped) and assertion targets (visible text). Pure function on
 * the XML string — no Appium/browser dependency, so it's unit-testable.
 */
function extractMobileScreenSnapshot(pageSourceXml) {
    const clickTargets = [];
    const assertionTargets = [];
    const observedControls = [];
    const seenClick = new Set();
    const seenText = new Set();
    const headings = [];
    const packageCounts = new Map();
    let m;
    ELEMENT_RE.lastIndex = 0;
    while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
        const attrs = m[2];
        const pkg = attr(attrs, "package") || undefined;
        if (pkg)
            packageCounts.set(pkg, (packageCounts.get(pkg) ?? 0) + 1);
        const clickable = attr(attrs, "clickable") === "true";
        const displayed = attr(attrs, "displayed") !== "false";
        if (!displayed)
            continue;
        const desc = decodeXml(attr(attrs, "content-desc") ?? "");
        const text = decodeXml(attr(attrs, "text") ?? "");
        const resourceId = attr(attrs, "resource-id") || undefined;
        const className = attr(attrs, "class") || undefined;
        const label = desc || text;
        if (!label)
            continue;
        // Best technical identity: content-desc preferred, then resource-id.
        const locatorIdentity = desc || resourceId || undefined;
        const control = {
            label,
            businessLabel: label,
            sourceScreenKey: "",
            locatorIdentity,
        };
        if (desc)
            control.contentDesc = desc;
        if (resourceId)
            control.resourceId = resourceId;
        if (className)
            control.className = className;
        if (pkg)
            control.package = pkg;
        // Recorded whenever the source states it, not only for tappables.
        //
        // Restricting this to `clickable` controls looked like noise control and instead threw away
        // the one case that matters: this app renders a gated button as clickable="false", so the
        // disabled "Continuar" — the whole point of capturing gate state — was the single control
        // guaranteed to be skipped. Across a real run, 50 of 186 controls carried the flag and not
        // one of them was ever false.
        const enabledAttr = attr(attrs, "enabled");
        if (enabledAttr !== undefined)
            control.enabled = enabledAttr !== "false";
        observedControls.push(control);
        if (clickable) {
            if (!seenClick.has(label)) {
                seenClick.add(label);
                clickTargets.push(label);
            }
        }
        else {
            if (!seenText.has(label)) {
                seenText.add(label);
                assertionTargets.push(label);
            }
            if (attr(attrs, "heading") === "true")
                headings.push(label);
        }
    }
    const title = headings[0] || assertionTargets[0] || "unknown";
    const shortTitle = title.length > 0 && title.length <= 48;
    const screenKey = shortTitle
        ? title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "screen"
        : "screen_" + (0, node_crypto_1.createHash)("sha256").update(assertionTargets.slice(0, 8).join("|")).digest("hex").slice(0, 10);
    // Gate state is structural: the same screen with "Continuar" disabled and with it enabled are
    // two different states of the flow, and the second is the observable proof that the
    // preconditions were satisfied. Folding it into the fingerprint is what lets both be learned.
    const gateTokens = observedControls
        .filter((c) => c.enabled === false)
        .map((c) => `disabled:${c.label}`)
        .sort();
    const structuralTokens = [...clickTargets, ...assertionTargets].sort().concat(gateTokens).join("|");
    const fingerprint = "screen_" + (0, node_crypto_1.createHash)("sha256").update(structuralTokens).digest("hex").slice(0, 10);
    const dominantPackage = (() => {
        const sorted = [...packageCounts.entries()].sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0)
            return undefined;
        if (sorted.length >= 2 && sorted[0][1] === sorted[1][1])
            return undefined;
        return sorted[0][0];
    })();
    return { screenKey, title, clickTargets, assertionTargets, observedControls, fingerprint, dominantPackage };
}
