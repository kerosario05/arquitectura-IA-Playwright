"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStructuralFingerprint = buildStructuralFingerprint;
exports.buildTechnicalScreenKey = buildTechnicalScreenKey;
exports.scanCurrentPage = scanCurrentPage;
const locator_candidate_builder_1 = require("./locator-candidate-builder");
const data_hint_extractor_1 = require("./data-hint-extractor");
const snapshot_sanitizer_1 = require("./snapshot-sanitizer");
const node_crypto_1 = require("node:crypto");
const control_identity_1 = require("../types/control-identity");
const MAX_ELEMENTS = 300;
function buildStructuralFingerprint(elements) {
    const canonical = elements.map((element) => [
        element.type,
        element.role ?? "",
        element.tagName ?? "",
        element.inputType ?? "",
        element.required === true,
        element.disabled === true,
    ].join("|")).sort().join(";");
    return (0, node_crypto_1.createHash)("sha256").update(canonical).digest("hex");
}
function buildTechnicalScreenKey(url, structuralFingerprint) {
    if (!structuralFingerprint)
        return undefined;
    try {
        const parsed = new URL(url);
        return (0, node_crypto_1.createHash)("sha256")
            .update(`${parsed.origin}\n${parsed.pathname}\n${structuralFingerprint}`)
            .digest("hex")
            .slice(0, 16);
    }
    catch {
        return undefined;
    }
}
function getSummary(elements) {
    return {
        totalElements: elements.length,
        buttons: elements.filter((item) => item.type === "button").length,
        links: elements.filter((item) => item.type === "link").length,
        inputs: elements.filter((item) => item.type === "input" || item.type === "textarea" || item.type === "checkbox" || item.type === "radio").length,
        selects: elements.filter((item) => item.type === "select").length,
        tables: elements.filter((item) => item.type === "table").length,
        dialogs: elements.filter((item) => item.type === "dialog").length,
        headings: elements.filter((item) => item.type === "heading").length
    };
}
async function scanCurrentPage(page) {
    const rawElements = await page.evaluate((maxElements) => {
        const selectors = [
            "button",
            "a[href]",
            "input",
            "textarea",
            "select",
            "table",
            "dialog",
            "[role='dialog']",
            "[role='alertdialog']",
            "h1,h2,h3,h4,h5,h6",
            "img[alt]",
            "section",
            "article",
            "[role='button']",
            "[role='link']",
            "[role='textbox']",
            "p",
            "span"
        ];
        const nodes = Array.from(document.querySelectorAll(selectors.join(",")));
        const items = [];
        for (let i = 0; i < nodes.length; i += 1) {
            const el = nodes[i];
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) {
                continue;
            }
            const tagName = el.tagName.toLowerCase();
            const role = (el.getAttribute("role") || "").toLowerCase() || undefined;
            const inputType = el.type?.toLowerCase();
            let type = "text";
            if (tagName === "button" || role === "button") {
                type = "button";
            }
            else if (tagName === "a" || role === "link") {
                type = "link";
            }
            else if (tagName === "textarea") {
                type = "textarea";
            }
            else if (tagName === "select") {
                type = "select";
            }
            else if (tagName === "table") {
                type = "table";
            }
            else if (tagName === "dialog" || role === "dialog" || role === "alertdialog") {
                type = "dialog";
            }
            else if (/^h[1-6]$/.test(tagName)) {
                type = "heading";
            }
            else if (tagName === "img") {
                type = "image";
            }
            else if (tagName === "section") {
                type = "section";
            }
            else if (tagName === "article") {
                type = "card";
            }
            else if (tagName === "input") {
                if (inputType === "checkbox") {
                    type = "checkbox";
                }
                else if (inputType === "radio") {
                    type = "radio";
                }
                else {
                    type = "input";
                }
            }
            else if (role === "textbox") {
                type = "input";
            }
            const text = (el.textContent || "").replace(/\s+/g, " ").trim() || undefined;
            const placeholder = el.placeholder || undefined;
            const name = el.getAttribute("aria-label") || el.getAttribute("name") || undefined;
            const idAttr = el.getAttribute("id");
            let label;
            if (idAttr) {
                const labelByFor = document.querySelector(`label[for="${idAttr}"]`);
                label = labelByFor?.textContent?.trim() || undefined;
            }
            if (!label) {
                label = el.closest("label")?.textContent?.trim() || undefined;
            }
            const domId = el.getAttribute("id") || undefined;
            const inputTypeRaw = el.type || undefined;
            const required = el.required || undefined;
            const disabled = el.disabled || undefined;
            const nearbyText = el.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
            const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || undefined;
            const href = el.href || undefined;
            const ariaLabel = el.getAttribute("aria-label") || undefined;
            const ariaControls = el.getAttribute("aria-controls") || undefined;
            const controlName = el.getAttribute("name") || undefined;
            const titleAttr = el.getAttribute("title") || undefined;
            const altAttr = el.alt || undefined;
            const className = el.getAttribute("class") || undefined;
            const score = type === "button" ||
                type === "link" ||
                type === "input" ||
                type === "textarea" ||
                type === "select" ||
                type === "checkbox" ||
                type === "radio"
                ? 2
                : 1;
            items.push({
                id: `el-${i + 1}`,
                elementType: type,
                text,
                label,
                placeholder,
                name,
                role,
                tagName,
                inputType: inputTypeRaw,
                required,
                disabled,
                visible: true,
                nearbyText,
                testId,
                domId,
                href,
                ariaLabel,
                ariaControls,
                controlName,
                title: titleAttr,
                alt: altAttr,
                className,
                score
            });
        }
        items.sort((a, b) => b.score - a.score);
        return items.slice(0, maxElements).map(({ score: _score, ...rest }) => rest);
    }, MAX_ELEMENTS);
    const elements = rawElements.map((raw) => {
        const text = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(raw.text ?? "") || undefined;
        const label = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(raw.label ?? "") || undefined;
        const placeholder = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(raw.placeholder ?? "") || undefined;
        const name = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(raw.name ?? "") || undefined;
        const nearbyText = (0, snapshot_sanitizer_1.sanitizeSnapshotText)(raw.nearbyText ?? "") || undefined;
        const candidateLocators = (0, locator_candidate_builder_1.buildCandidateLocators)({
            tagName: raw.tagName,
            role: raw.role,
            text,
            label,
            placeholder,
            name,
            id: raw.domId,
            testId: raw.testId,
            inputType: raw.inputType
        });
        const hintsText = [text, label, placeholder, name, nearbyText].filter(Boolean).join(" ");
        return {
            id: raw.id,
            type: raw.elementType,
            text,
            label,
            placeholder,
            name,
            role: raw.role,
            tagName: raw.tagName,
            inputType: raw.inputType,
            required: raw.required,
            disabled: raw.disabled,
            visible: true,
            nearbyText,
            candidateLocators,
            dataHints: (0, data_hint_extractor_1.extractDataHintsFromElementText)(hintsText),
            href: raw.href,
            ariaLabel: raw.ariaLabel,
            title: raw.title,
            alt: raw.alt,
            dataTestid: raw.testId,
            className: raw.className,
            domId: raw.domId,
            controlIdentity: (0, control_identity_1.buildRuntimeControlIdentity)({
                tagName: raw.tagName,
                inputType: raw.inputType,
                role: raw.role,
                name: raw.controlName,
                id: raw.domId,
                ariaControls: raw.ariaControls,
                candidateLocator: candidateLocators[0],
                snapshotId: raw.id,
            }) ?? undefined
        };
    });
    const structuralFingerprint = buildStructuralFingerprint(elements);
    return {
        version: "1.0",
        url: page.url(),
        title: await page.title(),
        capturedAt: new Date().toISOString(),
        structuralFingerprint,
        technicalScreenKey: buildTechnicalScreenKey(page.url(), structuralFingerprint),
        elements,
        summary: getSummary(elements)
    };
}
