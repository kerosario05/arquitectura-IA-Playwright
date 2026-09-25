"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS = exports.PromotedSpecRuntime = void 0;
exports.clickPromotedLocatorWithBoundedReresolution = clickPromotedLocatorWithBoundedReresolution;
exports.resolvePromotedFieldTarget = resolvePromotedFieldTarget;
exports.evaluatePromotedAssertionState = evaluatePromotedAssertionState;
exports.loadPromotedRuntimeConfigFromEnv = loadPromotedRuntimeConfigFromEnv;
exports.findBestActiveContainerForField = findBestActiveContainerForField;
exports.resolvePromotedFieldLocator = resolvePromotedFieldLocator;
exports.resolvePromotedClickableLocator = resolvePromotedClickableLocator;
exports.doesVisibleFieldSignalMatch = doesVisibleFieldSignalMatch;
exports.createPromotedSpecRuntime = createPromotedSpecRuntime;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const promoted_spec_helpers_1 = require("../../browser/promoted-spec-helpers");
const page_stability_detector_1 = require("../../discovery/page-stability-detector");
const evidence_recorder_1 = require("../../evidence/evidence-recorder");
const evidence_types_1 = require("../../evidence/evidence-types");
const semantic_text_normalization_1 = require("../semantic-text-normalization");
const semantic_target_matcher_1 = require("./semantic-target-matcher");
const target_resolver_1 = require("../../discovery/target-resolver");
const page_scanner_1 = require("../../explorer/page-scanner");
const promoted_field_target_contract_1 = require("./promoted-field-target-contract");
function effectiveExpectedEffect(requested, identity) {
    if (requested === "none")
        return "none";
    if (identity?.expectedRouteTransition)
        return "navigation";
    if (identity?.expectedInPlaceTransition)
        return "ui_change";
    if (requested === "navigation" || requested === "modal_or_form_or_navigation" || requested === "ui_change") {
        return requested;
    }
    // Legacy generated specs used human-readable expectedEffect text. The persisted interaction
    // remains the authority when available; without it, require a real DOM outcome rather than
    // treating a no-op as success.
    return "ui_change";
}
function isRetryableTargetClickError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /detached|not attached|intercepts pointer events|another element would receive the click|not receiving pointer events|target closed/i.test(message);
}
async function clickPromotedLocatorWithBoundedReresolution(resolved, resolveFresh, timeoutMs) {
    try {
        await withTimeout(resolved.locator.click({ timeout: timeoutMs, noWaitAfter: true }), timeoutMs, "native click");
        return { locator: resolved.locator, reResolved: false };
    }
    catch (error) {
        if (!isRetryableTargetClickError(error))
            throw error;
        const freshResolved = await resolveFresh();
        if (!freshResolved?.locator)
            throw error;
        await withTimeout(freshResolved.locator.click({ timeout: timeoutMs, noWaitAfter: true }), timeoutMs, "native click after bounded re-resolution");
        return { locator: freshResolved.locator, reResolved: true };
    }
}
async function capturePromotedActionSurfaceSnapshot(page, target) {
    const normalizedTarget = (0, semantic_text_normalization_1.normalizeSemanticText)(target).toLowerCase();
    return page.evaluate((expectedTarget) => {
        const normalize = (value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
        const visible = (element) => {
            const node = element;
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
        };
        const visibleControls = Array.from(document.querySelectorAll("button, a, [role=button], [role=link], [role=dialog], h1, h2, h3, h4, h5, h6"))
            .filter(visible)
            .map((element) => {
            const state = [
                element.getAttribute("aria-expanded") || "",
                element.getAttribute("aria-checked") || "",
                element.getAttribute("aria-selected") || "",
                element.getAttribute("aria-pressed") || "",
                element.getAttribute("data-state") || "",
                element.disabled ? "disabled" : "enabled",
                element.checked ? "checked" : "unchecked",
            ].join("/");
            return `${element.tagName.toLowerCase()}|${normalize(element.textContent || "")}|${state}`;
        })
            .filter((value) => value.length > 1);
        const targetVisible = visibleControls.some((value) => normalize(value).includes(expectedTarget));
        return {
            url: window.location.href,
            signature: visibleControls.slice(0, 250).join("\n"),
            targetVisible,
            surfaceCount: document.querySelectorAll("main, [role=main], [role=dialog], [role=grid], form").length,
        };
    }, normalizedTarget);
}
function normalizePromotedFieldAlias(value) {
    return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
}
function resolvePromotedFieldTarget(options) {
    const field = typeof options.field === "string" && options.field.trim() !== "" ? options.field : undefined;
    const target = typeof options.target === "string" && options.target.trim() !== "" ? options.target : undefined;
    if (field && target && normalizePromotedFieldAlias(field) !== normalizePromotedFieldAlias(target)) {
        throw new Error("conflicting_field_target: field and legacy target aliases differ");
    }
    const resolved = field ?? target;
    if (!resolved)
        throw new Error("invalid_context_action_target: field or target is required");
    return resolved;
}
function runtimeEnvNameForValueKey(valueKey) {
    const normalized = valueKey.trim().replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
    return `PROMOTED_${normalized}`;
}
function resolvePromotedRuntimeValue(valueKey) {
    if (!valueKey?.trim())
        return undefined;
    const direct = process.env[runtimeEnvNameForValueKey(valueKey)];
    if (typeof direct === "string" && direct.trim() !== "")
        return direct;
    const raw = process.env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON;
    if (!raw?.trim())
        return undefined;
    try {
        const parsed = JSON.parse(raw);
        const normalizedKey = valueKey.trim().toLowerCase();
        const found = Object.entries(parsed).find(([key, value]) => key.trim().toLowerCase() === normalizedKey && typeof value === "string" && value.trim() !== "");
        return found ? String(found[1]) : undefined;
    }
    catch {
        return undefined;
    }
}
function rowScopeFromPromotedRef(rowRef) {
    const match = rowRef?.match(/(?:^|:)row:(\d+)$/) ?? rowRef?.match(/(\d+)$/);
    if (!match)
        return undefined;
    const row = Number.parseInt(match[1], 10);
    return Number.isFinite(row) && row > 0 ? row : undefined;
}
function rowScopeFromEntityScope(entityScope) {
    const match = entityScope?.match(/(?:^|[_:])entity[_:]?(\d+)$/i);
    if (!match)
        return undefined;
    const row = Number.parseInt(match[1], 10);
    return Number.isFinite(row) && row > 0 ? row : undefined;
}
async function resolvePromotedSelectionOption(page, value, timeoutMs) {
    if (!value?.trim())
        return undefined;
    const candidates = [
        { strategy: "structured:selection-option-role", locator: () => page.getByRole("option", { name: value, exact: true }) },
        { strategy: "structured:selection-option-text", locator: () => page.getByText(value, { exact: true }) },
    ];
    for (const candidate of candidates) {
        try {
            const locator = candidate.locator();
            if (await locator.count() !== 1)
                continue;
            if (!(await locator.isVisible({ timeout: timeoutMs }).catch(() => false)))
                continue;
            if (await locator.isDisabled({ timeout: timeoutMs }).catch(() => false))
                continue;
            return { locator, strategy: candidate.strategy };
        }
        catch {
            // Try the next semantic option strategy.
        }
    }
    return undefined;
}
function evaluatePromotedAssertionState(currentUrl, descriptor) {
    if (descriptor.polarity !== "positive" && descriptor.polarity !== "negative") {
        throw new Error("PROMOTED_ASSERTION_POLARITY_UNRESOLVED");
    }
    if (typeof descriptor.expectedUrl !== "string" || descriptor.expectedUrl.trim() === "") {
        throw new Error("PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED");
    }
    const matchesExpected = currentUrl.includes(descriptor.expectedUrl);
    return descriptor.polarity === "positive" ? matchesExpected : !matchesExpected;
}
function boolFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    return raw.trim().toLowerCase() === "true";
}
function numberFromEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function stringFromEnv(...names) {
    for (const name of names) {
        const raw = process.env[name];
        if (typeof raw !== "string")
            continue;
        const trimmed = raw.trim();
        if (trimmed.length > 0)
            return trimmed;
    }
    return undefined;
}
function maskIfSensitive(value, sensitive) {
    if (!sensitive)
        return value;
    if (value.length <= 4)
        return "***";
    return `${"*".repeat(Math.min(8, value.length - 2))}${value.slice(-2)}`;
}
function loadPromotedRuntimeConfigFromEnv() {
    return {
        enabled: boolFromEnv("PROMOTED_RUNTIME_ENABLED", true),
        actionTimeoutMs: numberFromEnv("PROMOTED_RUNTIME_ACTION_TIMEOUT_MS", 15000),
        stabilityTimeoutMs: numberFromEnv("PROMOTED_RUNTIME_STABILITY_TIMEOUT_MS", 10000),
        retryEnabled: boolFromEnv("PROMOTED_RUNTIME_RETRY_ENABLED", true),
        captureDiagnostics: boolFromEnv("PROMOTED_RUNTIME_CAPTURE_DIAGNOSTICS", true),
        evidenceEnabled: boolFromEnv("EVIDENCE_ENABLED", true),
    };
}
async function withTimeout(promise, timeoutMs, label) {
    let timeoutRef;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutRef = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutRef)
            clearTimeout(timeoutRef);
    }
}
async function detectActiveContainer(page) {
    return page.evaluate(() => {
        const selector = [
            '[role="dialog"]',
            '[aria-modal="true"]',
            '.modal.show',
            'form:has(input, textarea, select)'
        ].join(",");
        const candidate = document.querySelector(selector);
        if (!candidate)
            return undefined;
        const id = candidate.id ? `#${candidate.id}` : "";
        const role = candidate.getAttribute("role") || candidate.tagName.toLowerCase();
        return `${role}${id}`;
    }).catch(() => undefined);
}
function normalizeText(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
async function findBestActiveContainerForField(page, fieldName) {
    const normalizedField = normalizeText((0, semantic_text_normalization_1.normalizeSemanticText)(fieldName ?? ""));
    const rawCandidates = await page.evaluate((field) => {
        const selectors = [
            '[role="dialog"]',
            '[aria-modal="true"]',
            '.modal.show',
            '.modal.in',
            '[data-drawer]',
            '[data-popup]',
            'form',
            '.drawer',
            '.popup',
            'table',
            '[role="grid"]'
        ];
        const isVisible = (el) => {
            const node = el;
            const style = window.getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0)
                return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const buildSelector = (el, idx) => {
            const node = el;
            if (node.id)
                return `#${node.id}`;
            const role = node.getAttribute("role");
            if (role)
                return `[role="${role}"]`;
            const marker = `container-${idx}`;
            node.setAttribute("data-promoted-runtime-container", marker);
            return `${node.tagName.toLowerCase()}[data-promoted-runtime-container="${marker}"]`;
        };
        const unique = new Set();
        for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
                unique.add(el);
            }
        }
        const list = [];
        let idx = 0;
        for (const container of Array.from(unique)) {
            idx += 1;
            const editableCount = container.querySelectorAll("input:not([disabled]), textarea:not([disabled]), select:not([disabled])").length;
            const visible = isVisible(container);
            const fieldSignals = [
                container.textContent || "",
                ...Array.from(container.querySelectorAll("input, textarea, select")).flatMap((item) => {
                    const node = item;
                    return [
                        node.name || "",
                        node.id || "",
                        node.getAttribute("aria-label") || "",
                        node.getAttribute("placeholder") || "",
                        node.getAttribute("data-testid") || "",
                    ];
                }),
            ];
            const role = container.getAttribute("role") || container.tagName.toLowerCase();
            const id = container.id ? `#${container.id}` : "";
            const descriptor = `${role}${id}`;
            const selector = buildSelector(container, idx);
            const rank = (visible ? 10 : 0) + editableCount;
            list.push({ selector, descriptor, visible, editableCount, matchingFieldFound: false, rank, fieldSignals });
        }
        list.sort((a, b) => b.rank - a.rank);
        return list;
    }, normalizedField);
    const candidates = rawCandidates.map(({ fieldSignals, ...candidate }) => ({
        ...candidate,
        matchingFieldFound: fieldName
            ? fieldSignals.some((signal) => normalizeText((0, semantic_text_normalization_1.normalizeSemanticText)(signal)).includes(normalizedField))
            : false,
    })).map((candidate) => ({
        ...candidate,
        rank: candidate.rank + (candidate.matchingFieldFound ? 100 : 0),
    })).sort((a, b) => b.rank - a.rank);
    const valid = candidates.filter((c) => c.visible && c.editableCount > 0);
    const best = valid.find((c) => (fieldName ? c.matchingFieldFound : true)) ?? valid[0];
    return { best, candidates };
}
/**
 * Resolves a field locator using multiple strategies within a container or page scope.
 * Returns the locator, strategy used, and field properties.
 */
async function resolvePromotedFieldLocator(page, field, options) {
    const normalizedField = normalizeText((0, semantic_text_normalization_1.normalizeSemanticText)(field));
    const timeoutMs = options?.timeoutMs ?? 5000;
    const container = options?.containerLocator
        ? page.locator(options.containerLocator)
        : undefined;
    const identity = options?.targetIdentity ?? (options?.technicalTargetRefs
        ? { technicalTargetRefs: options.technicalTargetRefs }
        : undefined);
    const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const validateEditableCandidate = async (locator, scope, strategy) => {
        const count = await locator.count().catch(() => 0);
        if (count !== 1)
            return undefined;
        const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible)
            return undefined;
        const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
        if (disabled)
            return undefined;
        const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (!["input", "textarea", "select"].includes(tagName))
            return undefined;
        return { locator, strategy, scope, visible: true, enabled: true, editable: true };
    };
    const resolveStructuredCandidate = async () => {
        if (!identity || identity.technicalTargetRefs.length === 0)
            return undefined;
        const parsed = (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(identity.technicalTargetRefs);
        const fieldFromIdentity = (0, promoted_field_target_contract_1.semanticNameFromRef)(parsed.cellRef) ?? (0, promoted_field_target_contract_1.semanticNameFromRef)(parsed.headerRef) ?? field;
        const hintedPlaceholder = parsed.inputHint;
        const gridLocators = [];
        if (parsed.gridRef) {
            const grids = page.locator('table, [role="grid"]');
            const gridCount = await grids.count().catch(() => 0);
            if (gridCount === 1) {
                gridLocators.push(grids);
            }
            else if (gridCount > 1 && fieldFromIdentity) {
                const matchingGrids = grids.filter({ hasText: new RegExp(escapeRegExp(fieldFromIdentity), "i") });
                if (await matchingGrids.count().catch(() => 0) === 1)
                    gridLocators.push(matchingGrids);
            }
        }
        const resolveStructuredTableCell = async () => {
            if (!parsed.gridRef || !fieldFromIdentity)
                return undefined;
            const marker = `promoted-runtime-cell-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const marked = await page.evaluate(({ headerName, markerName }) => {
                const normalize = (value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
                const isVisible = (element) => {
                    const node = element;
                    const style = window.getComputedStyle(node);
                    const rect = node.getBoundingClientRect();
                    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
                };
                const normalizedHeader = normalize(headerName);
                for (const table of Array.from(document.querySelectorAll("table, [role=grid]"))) {
                    if (!isVisible(table))
                        continue;
                    const rows = Array.from(table.querySelectorAll("tr, [role=row]"));
                    const headerRow = rows.find((row) => Array.from(row.children).some((cell) => {
                        const slot = cell.getAttribute("data-slot");
                        return cell.tagName.toLowerCase() === "th" || slot === "table-head";
                    }));
                    if (!headerRow)
                        continue;
                    const headerIndex = Array.from(headerRow.children).findIndex((cell) => {
                        const text = normalize(cell.textContent || "");
                        return text === normalizedHeader || text.includes(normalizedHeader);
                    });
                    if (headerIndex < 0)
                        continue;
                    const cells = rows
                        .filter((row) => row !== headerRow && isVisible(row) && row.children.length > headerIndex)
                        .map((row) => row.children[headerIndex])
                        .filter(isVisible);
                    if (cells.length !== 1)
                        continue;
                    cells[0].setAttribute("data-promoted-runtime-cell", markerName);
                    return true;
                }
                return false;
            }, { headerName: fieldFromIdentity, markerName: marker }).catch(() => false);
            if (!marked)
                return undefined;
            const cell = page.locator(`[data-promoted-runtime-cell="${marker}"]`);
            const control = cell.locator("button, [role=button]");
            if (await control.count().catch(() => 0) !== 1)
                return { cell };
            if (!(await control.isVisible({ timeout: timeoutMs }).catch(() => false)))
                return { cell };
            if (await control.isDisabled({ timeout: timeoutMs }).catch(() => true))
                return { cell };
            return { cell, control };
        };
        // Header/cell identity is the authority for dynamic grids. Resolve and
        // scope the editor to that cell before considering any page-wide input;
        // otherwise the only currently mounted editor can receive another field's
        // value while the requested display cell remains untouched.
        const structuralCell = await resolveStructuredTableCell();
        if (structuralCell) {
            const cell = structuralCell.cell;
            if (hintedPlaceholder) {
                const byPlaceholder = cell.getByPlaceholder(hintedPlaceholder, { exact: true });
                const resolved = await validateEditableCandidate(byPlaceholder, "container", "structured:grid-cell:placeholder");
                if (resolved)
                    return resolved;
            }
            const structuredFields = cell.locator("input, textarea, select");
            const resolved = await validateEditableCandidate(structuredFields, "container", "structured:grid-cell:editable");
            if (resolved)
                return resolved;
            if (structuralCell.control) {
                await structuralCell.control.click({ timeout: timeoutMs }).catch(() => undefined);
                if (hintedPlaceholder) {
                    const activatedField = cell.getByPlaceholder(hintedPlaceholder, { exact: true });
                    await activatedField.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
                    const activated = await validateEditableCandidate(activatedField, "container", "structured:grid-cell:activated-placeholder");
                    if (activated)
                        return activated;
                }
                const activatedFields = cell.locator("input, textarea, select");
                const activated = await validateEditableCandidate(activatedFields, "container", "structured:grid-cell:activated-editor");
                if (activated)
                    return activated;
            }
        }
        for (const grid of gridLocators) {
            let scope = grid;
            const cells = grid.locator('td, [role="gridcell"]');
            if (fieldFromIdentity) {
                const matchingCells = cells.filter({ hasText: new RegExp(escapeRegExp(fieldFromIdentity), "i") });
                if (await matchingCells.count().catch(() => 0) === 1)
                    scope = matchingCells;
            }
            if (hintedPlaceholder) {
                const byPlaceholder = scope.getByPlaceholder(hintedPlaceholder, { exact: true });
                const resolved = await validateEditableCandidate(byPlaceholder, "container", "structured:grid-cell:placeholder");
                if (resolved)
                    return resolved;
            }
            const structuredFields = scope.locator("input, textarea, select");
            const resolved = await validateEditableCandidate(structuredFields, "container", "structured:grid-cell:editable");
            if (resolved)
                return resolved;
        }
        const activation = await resolveStructuredTableCell();
        if (activation) {
            if (activation.control) {
                await activation.control.click({ timeout: timeoutMs });
                if (hintedPlaceholder) {
                    const activatedField = activation.cell.getByPlaceholder(hintedPlaceholder, { exact: true });
                    await activatedField.waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
                    const resolved = await validateEditableCandidate(activatedField, "page", "structured:grid-cell:activated-placeholder");
                    if (resolved)
                        return resolved;
                }
                const activatedFields = activation.cell.locator("input, textarea, select");
                const resolved = await validateEditableCandidate(activatedFields, "container", "structured:grid-cell:activated-editor");
                if (resolved)
                    return resolved;
            }
        }
        if (hintedPlaceholder) {
            const byPlaceholder = page.getByPlaceholder(hintedPlaceholder, { exact: true });
            const resolved = await validateEditableCandidate(byPlaceholder, "page", "structured:placeholder");
            if (resolved)
                return resolved;
        }
        return undefined;
    };
    const structured = await resolveStructuredCandidate();
    if (structured)
        return structured;
    // Dynamic grids may be re-mounted immediately after a preceding selection.
    // Re-observe the structural surface once before allowing a legacy callback
    // to take authority over the current contract.
    const identityRefs = identity?.technicalTargetRefs ?? [];
    if (identityRefs.length > 0 && (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(identityRefs).gridRef) {
        await page.locator('table, [role="grid"]').waitFor({ state: "visible", timeout: timeoutMs }).catch(() => undefined);
        const reobservedStructured = await resolveStructuredCandidate();
        if (reobservedStructured)
            return reobservedStructured;
    }
    const resolveSemanticCandidate = async (scopeLocator, scope) => {
        const fields = scopeLocator.locator("input, textarea, select");
        const count = await fields.count().catch(() => 0);
        const matches = [];
        for (let index = 0; index < count; index += 1) {
            const candidate = fields.nth(index);
            const signals = await candidate.evaluate((element) => {
                const node = element;
                const signals = [
                    node.getAttribute("aria-label") || "",
                    node.getAttribute("placeholder") || "",
                    node.getAttribute("name") || "",
                    node.id || "",
                ];
                if (node.id) {
                    const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
                    if (label?.textContent)
                        signals.push(label.textContent);
                }
                const ancestorLabel = node.closest("label");
                if (ancestorLabel?.textContent)
                    signals.push(ancestorLabel.textContent);
                return signals;
            }).catch(() => []);
            const matchesTarget = signals.some((signal) => typeof signal === "string"
                && signal.trim() !== ""
                && normalizeText((0, semantic_text_normalization_1.normalizeSemanticText)(signal)).includes(normalizedField));
            if (matchesTarget)
                matches.push(index);
        }
        if (matches.length !== 1)
            return { matched: matches.length > 0, ambiguous: matches.length > 1 };
        const locator = fields.nth(matches[0]);
        const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
        if (!visible)
            return { matched: true, ambiguous: false };
        const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
        if (disabled)
            return { matched: true, ambiguous: false };
        const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        if (!["input", "textarea", "select"].includes(tagName))
            return { matched: true, ambiguous: false };
        return {
            matched: true,
            ambiguous: false,
            result: { locator, strategy: `${scope}:semanticCandidate`, scope, visible: true, enabled: true, editable: true },
        };
    };
    if (container) {
        const containerCandidate = await resolveSemanticCandidate(container, "container");
        if (containerCandidate.ambiguous || containerCandidate.matched)
            return containerCandidate.result;
    }
    const pageCandidate = await resolveSemanticCandidate(page, "page");
    if (pageCandidate.ambiguous || pageCandidate.matched)
        return pageCandidate.result;
    const strategies = [
        // Container-scoped strategies (preferred when activeContainer is set)
        {
            name: "activeContainer:getByLabel",
            scope: "container",
            build: () => container?.getByLabel(new RegExp(normalizedField, "i"))
        },
        {
            name: "activeContainer:getByPlaceholder",
            scope: "container",
            build: () => container?.getByPlaceholder(new RegExp(normalizedField, "i"))
        },
        {
            name: "activeContainer:getByRoleTextboxName",
            scope: "container",
            build: () => container?.getByRole("textbox", { name: new RegExp(normalizedField, "i") })
        },
        {
            name: "activeContainer:inputByName",
            scope: "container",
            build: () => container?.locator(`input[name="${normalizedField}"], textarea[name="${normalizedField}"]`)
        },
        {
            name: "activeContainer:inputById",
            scope: "container",
            build: () => container?.locator(`input[id*="${normalizedField}"], textarea[id*="${normalizedField}"]`)
        },
        {
            name: "activeContainer:inputByAriaLabel",
            scope: "container",
            build: () => container?.locator(`[aria-label*="${normalizedField}"]`)
        },
        {
            name: "activeContainer:nearLabel",
            scope: "container",
            build: () => {
                const label = container?.getByText(new RegExp(normalizedField, "i"), { exact: false });
                return label?.locator("xpath=following-sibling::input | following-sibling::textarea | following::input[1] | following::textarea[1]");
            }
        },
        // Page-scoped fallback strategies
        {
            name: "page:getByLabel",
            scope: "page",
            build: () => page.getByLabel(new RegExp(normalizedField, "i"))
        },
        {
            name: "page:getByPlaceholder",
            scope: "page",
            build: () => page.getByPlaceholder(new RegExp(normalizedField, "i"))
        },
        {
            name: "page:getByRoleTextboxName",
            scope: "page",
            build: () => page.getByRole("textbox", { name: new RegExp(normalizedField, "i") })
        },
        {
            name: "page:inputByName",
            scope: "page",
            build: () => page.locator(`input[name="${normalizedField}"], textarea[name="${normalizedField}"]`)
        },
        {
            name: "page:inputById",
            scope: "page",
            build: () => page.locator(`input[id*="${normalizedField}"], textarea[id*="${normalizedField}"]`)
        }
    ];
    for (const strat of strategies) {
        // Skip container strategies if no container
        if (strat.scope === "container" && !container)
            continue;
        try {
            const locator = strat.build();
            if (!locator)
                continue;
            // Check if locator is valid
            const count = await locator.count();
            if (count === 0)
                continue;
            const element = locator.first();
            const visible = await element.isVisible({ timeout: timeoutMs }).catch(() => false);
            if (!visible)
                continue;
            const enabled = await element.isDisabled({ timeout: timeoutMs }).catch(() => true);
            if (enabled)
                continue; // isDisabled returns true if disabled, we want enabled
            // Check if editable (input, textarea, select)
            const tagName = await element.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
            const isEditable = ["input", "textarea", "select"].includes(tagName);
            if (!isEditable)
                continue;
            return {
                locator: element,
                strategy: strat.name,
                scope: strat.scope,
                visible: true,
                enabled: true,
                editable: true
            };
        }
        catch {
            // Try next strategy
            continue;
        }
    }
    return undefined;
}
/**
 * Resolves a clickable target locator (button, link, submit, action) using multiple strategies.
 * Returns the locator, strategy used, and element properties.
 */
async function resolvePromotedClickableLocator(page, target, options) {
    // Alias resolution for return_to_list intent
    // Maps various "back to list" phrases to the common "Volver" button
    let effectiveTarget = target;
    if (options?.actionIntent === "return_to_list") {
        const returnToListAliases = [
            /volver al listado/i,
            /volver al listado de productos/i,
            /volver al listado principal/i,
            /regresar al listado/i,
            /volver al list/i,
            /regresar al list/i,
            /back to list/i,
            /back to listing/i
        ];
        const normalizedTarget = normalizeText(target);
        if (returnToListAliases.some(alias => alias.test(target) || alias.test(normalizedTarget))) {
            // Try to find "Volver" button first
            const volverButton = page.getByRole('button', { name: 'Volver', exact: true });
            if (await volverButton.count() > 0) {
                const isVisible = await volverButton.isVisible().catch(() => false);
                if (isVisible) {
                    console.log(`[runtime:return_to_list] Mapped "${target}" -> "Volver" button (alias resolution)`);
                    return {
                        locator: volverButton,
                        strategy: "return_to_list_alias:Volver",
                        scope: "page",
                        visible: true,
                        enabled: true,
                        clickable: true
                    };
                }
            }
            // Fallback: "Atrás" button
            const atrasButton = page.getByRole('button', { name: /atrás|atras/i });
            if (await atrasButton.count() > 0) {
                const isVisible = await atrasButton.first().isVisible().catch(() => false);
                if (isVisible) {
                    console.log(`[runtime:return_to_list] Mapped "${target}" -> "Atrás" button (alias resolution)`);
                    return {
                        locator: atrasButton.first(),
                        strategy: "return_to_list_alias:Atrás",
                        scope: "page",
                        visible: true,
                        enabled: true,
                        clickable: true
                    };
                }
            }
            // Use normalized target for further resolution
            effectiveTarget = "Volver";
            console.log(`[runtime:return_to_list] Using fallback target "${effectiveTarget}" for "${target}"`);
        }
    }
    const normalizedTarget = normalizeText(effectiveTarget);
    const locatorTarget = (0, semantic_text_normalization_1.normalizeSemanticText)(effectiveTarget).trim() || effectiveTarget.trim();
    const escapedLocatorTarget = locatorTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const timeoutMs = options?.timeoutMs ?? 5000;
    const actionKind = options?.actionKind;
    const actionIntent = options?.actionIntent;
    const container = options?.containerLocator
        ? page.locator(options.containerLocator)
        : undefined;
    const resolveStructuredTableControl = async () => {
        const identity = options?.targetIdentity;
        const parsedIdentity = identity ? (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(identity.technicalTargetRefs) : {};
        const hasButtonReference = Boolean(identity?.technicalTargetRefs.some((ref) => ref.startsWith("role:button|")));
        const hasSelectionReference = parsedIdentity.semanticRole === "selection";
        if (!identity || (!hasButtonReference && !hasSelectionReference))
            return undefined;
        const marker = `promoted-runtime-target-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const marked = await page.evaluate(({ headerName, markerName }) => {
            const normalize = (value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
            const isVisible = (element) => {
                const node = element;
                const style = window.getComputedStyle(node);
                const rect = node.getBoundingClientRect();
                return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
            };
            const normalizedHeader = normalize(headerName);
            for (const table of Array.from(document.querySelectorAll("table, [role=grid]"))) {
                if (!isVisible(table))
                    continue;
                const rows = Array.from(table.querySelectorAll("tr, [role=row]"));
                const headerRows = rows.filter((row) => Array.from(row.children).some((cell) => {
                    const slot = cell.getAttribute("data-slot");
                    return cell.tagName.toLowerCase() === "th" || slot === "table-head";
                }));
                for (const headerRow of headerRows) {
                    const headerCells = Array.from(headerRow.children);
                    const headerIndex = headerCells.findIndex((cell) => {
                        const text = normalize(cell.textContent || "");
                        return text === normalizedHeader || text.includes(normalizedHeader);
                    });
                    if (headerIndex < 0)
                        continue;
                    const bodyRows = rows.filter((row) => row !== headerRow && isVisible(row) && row.children.length > headerIndex);
                    const controls = bodyRows.flatMap((row) => {
                        const cell = row.children[headerIndex];
                        return Array.from(cell.querySelectorAll("button, input, textarea, select")).filter(isVisible);
                    });
                    if (controls.length !== 1)
                        continue;
                    controls[0].setAttribute("data-promoted-runtime-target", markerName);
                    return true;
                }
            }
            return false;
        }, { headerName: effectiveTarget, markerName: marker }).catch(() => false);
        if (!marked)
            return undefined;
        const locator = page.locator(`[data-promoted-runtime-target="${marker}"]`);
        const count = await locator.count().catch(() => 0);
        if (count !== 1)
            return undefined;
        const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
        const disabled = await locator.isDisabled({ timeout: timeoutMs }).catch(() => true);
        if (!visible || disabled)
            return undefined;
        return { locator, strategy: "structured:table-header-column", scope: "page", visible: true, enabled: true, clickable: true };
    };
    const structuredTableControl = await resolveStructuredTableControl();
    if (structuredTableControl)
        return structuredTableControl;
    const strategies = [
        // Container-scoped strategies (preferred when activeContainer is set)
        {
            name: "activeContainer:getByRoleButtonName",
            scope: "container",
            build: () => container?.getByRole("button", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
        },
        {
            name: "activeContainer:getByRoleLinkName",
            scope: "container",
            build: () => container?.getByRole("link", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
        },
        {
            name: "activeContainer:getByTextExact",
            scope: "container",
            build: () => container?.getByText(locatorTarget, { exact: true })
        },
        {
            name: "activeContainer:buttonByText",
            scope: "container",
            build: () => container?.locator(`button:has-text("${normalizedTarget}"), input[type="button"]:has-text("${normalizedTarget}")`)
        },
        {
            name: "activeContainer:inputSubmitByValue",
            scope: "container",
            build: () => container?.locator(`input[type="submit"][value*="${normalizedTarget}"]`)
        },
        {
            name: "activeContainer:ariaLabel",
            scope: "container",
            build: () => container?.locator(`[aria-label*="${normalizedTarget}"]`)
        },
        {
            name: "activeContainer:testId",
            scope: "container",
            build: () => container?.locator(`[data-testid="${normalizedTarget}"]`)
        },
        // Page-scoped fallback strategies
        {
            name: "page:getByRoleButtonName",
            scope: "page",
            build: () => page.getByRole("button", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
        },
        {
            name: "page:getByRoleLinkName",
            scope: "page",
            build: () => page.getByRole("link", { name: new RegExp(escapedLocatorTarget, "i"), exact: false })
        },
        {
            name: "page:getByTextExact",
            scope: "page",
            build: () => page.getByText(locatorTarget, { exact: true })
        },
        {
            name: "page:buttonByText",
            scope: "page",
            build: () => page.locator(`button:has-text("${normalizedTarget}"), input[type="button"]:has-text("${normalizedTarget}")`)
        },
        {
            name: "page:inputSubmitByValue",
            scope: "page",
            build: () => page.locator(`input[type="submit"][value*="${normalizedTarget}"]`)
        },
        {
            name: "page:ariaLabel",
            scope: "page",
            build: () => page.locator(`[aria-label*="${normalizedTarget}"]`)
        },
        {
            name: "page:testId",
            scope: "page",
            build: () => page.locator(`[data-testid="${normalizedTarget}"]`)
        }
    ];
    for (const strat of strategies) {
        // Skip container strategies if no container
        if (strat.scope === "container" && !container)
            continue;
        try {
            const locator = strat.build();
            if (!locator)
                continue;
            // Check if locator is valid
            const count = await locator.count();
            if (count === 0)
                continue;
            const element = locator.first();
            const visible = await element.isVisible({ timeout: timeoutMs }).catch(() => false);
            if (!visible)
                continue;
            const disabled = await element.isDisabled({ timeout: timeoutMs }).catch(() => true);
            if (disabled)
                continue; // isDisabled returns true if disabled, skip disabled elements
            // Check if clickable (button, link, input[type=submit/button], or has click handler)
            const tagName = await element.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
            const type = await element.evaluate((el) => el.type || "").catch(() => "");
            const isClickable = ["button", "a", "input"].includes(tagName) ||
                (tagName === "input" && ["submit", "button", "reset"].includes(type)) ||
                await element.evaluate((el) => el.getAttribute("onclick") !== null || el.getAttribute("role") === "button").catch(() => false);
            if (!isClickable)
                continue;
            return {
                locator: element,
                strategy: strat.name,
                scope: strat.scope,
                visible: true,
                enabled: true,
                clickable: true
            };
        }
        catch {
            // Try next strategy
            continue;
        }
    }
    // Semantic fallback for category/product/item selection
    // Only apply semantic matching for navigation/selection intents, not for sensitive actions
    const semanticIntents = ["select_category", "select_product", "select_item_by_text", "select_visible_item_by_ordinal", "return_to_list", "select"];
    const intentForSemantic = actionIntent || (semanticIntents.includes(actionKind || "") ? actionKind : undefined);
    if (intentForSemantic && semanticIntents.includes(intentForSemantic)) {
        const semanticOptions = {
            timeoutMs: Math.min(timeoutMs, 3000),
            actionIntent: intentForSemantic,
            minScore: 0.65,
            allowAmbiguity: false,
            excludeSensitive: true
        };
        // Prefer categories/filters over product cards for category selection
        if (intentForSemantic === "select_category") {
            semanticOptions.preferTypes = ["button", "link", "heading"];
            semanticOptions.excludeTypes = ["card"];
        }
        else if (intentForSemantic === "select_product") {
            semanticOptions.preferTypes = ["card", "list_item", "button", "link"];
        }
        else if (intentForSemantic === "return_to_list") {
            semanticOptions.preferTypes = ["button", "link"];
        }
        const semanticResult = await (0, semantic_target_matcher_1.findSemanticTargetMatch)(page, target, semanticOptions);
        if (semanticResult.status === "exact" || semanticResult.status === "semantic") {
            const candidate = semanticResult.candidate;
            const tagName = await candidate.locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
            const type = await candidate.locator.evaluate((el) => el.type || "").catch(() => "");
            const isClickable = ["button", "a", "input"].includes(tagName) ||
                (tagName === "input" && ["submit", "button", "reset"].includes(type)) ||
                await candidate.locator.evaluate((el) => el.getAttribute("onclick") !== null || el.getAttribute("role") === "button").catch(() => false);
            if (isClickable) {
                return {
                    locator: candidate.locator,
                    strategy: `semantic:${candidate.type}:${semanticResult.reason}`,
                    scope: "page",
                    visible: candidate.visible,
                    enabled: candidate.enabled,
                    clickable: true
                };
            }
        }
        // Ambiguity error with diagnostics
        if (semanticResult.status === "ambiguous") {
            throw new Error(`semantic_target_ambiguous: target="${target}" ` +
                `bestCandidates=[${semanticResult.candidates?.slice(0, 2).map(c => `{ text:"${c.text}", score:${c.score.toFixed(2)}, type:"${c.type}" }`).join(", ")}] ` +
                `reason="${semanticResult.reason}"`);
        }
        // Not found error with diagnostics
        if (semanticResult.status === "not_found") {
            throw new Error(`semantic_target_not_found: target="${target}" actionIntent="${intentForSemantic}" ` +
                `bestCandidates=[${semanticResult.diagnostics.candidateScores.slice(0, 3).map(c => `{ text:"${c.text}", score:${c.score.toFixed(2)}, type:"${c.type}" }`).join(", ")}] ` +
                `reason="${semanticResult.reason}"`);
        }
    }
    return undefined;
}
async function captureDiagnosticsIfNeeded(page, diagnostics, evidenceDir, enabled) {
    if (!enabled)
        return diagnostics;
    const outputDir = evidenceDir ?? node_path_1.default.join(process.cwd(), ".artifacts", "promoted-runtime");
    node_fs_1.default.mkdirSync(outputDir, { recursive: true });
    const fileName = `step-${String(diagnostics.stepIndex).padStart(3, "0")}.png`;
    const screenshotPath = node_path_1.default.join(outputDir, fileName);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
    return { ...diagnostics, screenshotPath };
}
async function shouldUseSafeForceClick(page, locator, options, error) {
    if (options.actionIntent !== "open_module")
        return false;
    if (!/consulta de balance/i.test(options.target))
        return false;
    const message = error instanceof Error ? error.message : String(error);
    const isInterceptError = /intercepts pointer events/i.test(message) ||
        /another element would receive the click/i.test(message) ||
        /element is not receiving pointer events/i.test(message);
    if (!isInterceptError)
        return false;
    const overlayVisible = await page
        .locator('text=/cargando productos|por favor espere/i')
        .first()
        .isVisible()
        .catch(() => false);
    if (!overlayVisible)
        return false;
    const targetVisible = await locator.isVisible().catch(() => false);
    const targetEnabled = await locator.isEnabled().catch(() => false);
    return targetVisible && targetEnabled;
}
function doesVisibleFieldSignalMatch(signals, target) {
    if (typeof target !== "string" || target.trim() === "")
        return false;
    const normalizedTarget = (0, semantic_text_normalization_1.normalizeSemanticText)(target).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return signals.some((signal) => typeof signal === "string"
        && signal.trim() !== ""
        && (0, semantic_text_normalization_1.normalizeSemanticText)(signal).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(normalizedTarget));
}
async function captureVisibleFieldSignals(page) {
    return page.locator("input:visible, textarea:visible, select:visible").evaluateAll((elements) => {
        const signals = [];
        for (const element of elements) {
            const attributes = ["aria-label", "name", "placeholder", "id"];
            for (const attribute of attributes) {
                const value = element.getAttribute(attribute);
                if (value)
                    signals.push(value);
            }
            if (element.id) {
                const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
                if (label?.textContent)
                    signals.push(label.textContent);
            }
            const parentLabel = element.closest("label");
            if (parentLabel?.textContent)
                signals.push(parentLabel.textContent);
        }
        return signals;
    }).catch(() => []);
}
/**
 * Validate screen context before executing context-dependent actions
 * Prevents executing deep functional actions from wrong screen (Home/Login/Menu)
 */
async function validateScreenContextForAction(page, options) {
    const CONTEXT_DEPENDENT_ACTIONS = new Set([
        "select_product", "select_category", "click_primary_action",
        "submit_form", "confirm_action", "fill_form_field",
        "select_first_visible_item", "select_first_visible_product",
        "select_first_visible_card", "select_first_visible_row",
        "select_visible_item_by_ordinal", "open_module", "return_to_list"
    ]);
    if (!CONTEXT_DEPENDENT_ACTIONS.has(options.actionIntent)) {
        return;
    }
    if (typeof options.target !== "string" || options.target.trim() === "") {
        throw new Error(`invalid_context_action_target: target is required for '${options.actionIntent}' at step ${options.stepIndex}`);
    }
    // Capture current page state
    const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(page);
    const currentUrl = pageDiag.currentUrl;
    const visibleButtons = pageDiag.visibleButtons.filter((value) => typeof value === "string" && value.trim() !== "");
    const visibleHeadings = pageDiag.visibleHeadings.filter((value) => typeof value === "string" && value.trim() !== "");
    const normalizedTarget = options.target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const visibleFieldSignals = options.actionIntent === "fill_form_field"
        ? await captureVisibleFieldSignals(page)
        : [];
    // Check for clear signals of being on wrong screen
    const isOnHomeScreen = currentUrl === "/" || currentUrl === "" ||
        visibleHeadings.some(h => /home|inicio|welcome|bienvenid/i.test(h));
    const isOnLoginScreen = visibleButtons.some(b => /iniciar|login|sign in|ingresar/i.test(b)) &&
        !visibleButtons.some(b => /continuar|next|submit|confirmar/i.test(b));
    const isOnMenuScreen = visibleHeadings.some(h => /menu|operaciones|module/i.test(h)) &&
        visibleButtons.length > 0 &&
        !visibleButtons.some(b => /producto|item|card|select/i.test(b));
    // Check for AuthGate/Identification screen
    const isOnAuthGate = /client-identification|identification|auth|login/i.test(currentUrl) ||
        visibleHeadings.some(h => /identificaci|identification|auth|login/i.test(h));
    const isOnWrongScreen = isOnHomeScreen || isOnLoginScreen || isOnMenuScreen || isOnAuthGate;
    if (options.actionIntent === "return_to_list") {
        const hasBackControl = visibleButtons.some(b => /volver|atras|atrás|back/i.test(b)) ||
            visibleHeadings.some(h => /detalle|detail/i.test(h));
        if (!hasBackControl && options.lastSelectionStep) {
            throw new Error(`detail_reentry_required: Expected detail page before return_to_list. ` +
                `Target "${options.target}" not available on current screen. ` +
                `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
                `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
                `lastSelectionStep=step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}" `);
        }
    }
    if (isOnWrongScreen) {
        // Check if target exists on current page
        const genericTargetExists = visibleButtons.some(b => b.toLowerCase().includes(normalizedTarget)) || visibleHeadings.some(h => h.toLowerCase().includes(normalizedTarget));
        const targetExists = genericTargetExists || (options.actionIntent === "fill_form_field" && doesVisibleFieldSignalMatch(visibleFieldSignals, options.target));
        if (!targetExists) {
            // Special handling for open_module when on AuthGate
            if (options.actionIntent === "open_module" && isOnAuthGate) {
                throw new Error(`auth_required_before_open_module: Cannot execute '${options.actionIntent}' on target "${options.target}" ` +
                    `because authentication is required but not completed. ` +
                    `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
                    `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
                    `actionIntent="${options.actionIntent}" ` +
                    `screenSignals={isOnAuthGate:${isOnAuthGate}} ` +
                    `suggestedFix="Call AuthFlow.ensureAuthenticated() before openModule() in the spec"`);
            }
            throw new Error(`wrong_screen_before_contextual_action: Cannot execute '${options.actionIntent}' on target "${options.target}" ` +
                `because current screen does not match required context. ` +
                `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
                `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
                `actionIntent="${options.actionIntent}" ` +
                `screenSignals={isOnHomeScreen:${isOnHomeScreen}, isOnLoginScreen:${isOnLoginScreen}, isOnMenuScreen:${isOnMenuScreen}, isOnAuthGate:${isOnAuthGate}} ` +
                `suggestedFix="Ensure navigation/module/auth steps precede this action in the spec"`);
        }
    }
    // Special handling for click_primary_action when on list page but target not visible
    // This handles cases where we need to re-enter detail page before executing primary action
    if (options.actionIntent === "click_primary_action" && options.lastSelectionStep) {
        // Check if we're on a list page (has product cards/items but not detail-specific elements)
        const isOnListPage = visibleButtons.some(b => /producto|item|card|select|dep|cuenta|tarjeta|balance/i.test(b)) &&
            !visibleHeadings.some(h => /detalle|detail|informaci|information del producto/i.test(h));
        if (isOnListPage) {
            // Check if the primary action target exists on current page
            const primaryActionExists = visibleButtons.some(b => b.toLowerCase().includes(normalizedTarget));
            if (!primaryActionExists) {
                // Throw specific error that can be caught for re-entry attempt
                throw new Error(`detail_reentry_required: Expected to be on DetailPage but currently on list page. ` +
                    `Target "${options.target}" not visible. ` +
                    `currentUrl="${currentUrl}" visibleButtons=[${visibleButtons.join(", ")}] ` +
                    `visibleHeadings=[${visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
                    `actionIntent="${options.actionIntent}" expectedOwnerPage="${options.expectedOwnerPage || 'unknown'}" ` +
                    `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
                    `suggestedFix="Re-execute the product/item selection step before click_primary_action"`);
            }
        }
    }
}
/**
 * Detect if page has returned to home due to inactivity/session timeout
 */
async function detectHomeResetOrInactivity(page) {
    const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(page);
    const currentUrl = pageDiag.currentUrl;
    const visibleTexts = pageDiag.visibleTexts;
    const visibleButtons = pageDiag.visibleButtons;
    const visibleHeadings = pageDiag.visibleHeadings;
    // Check for inactivity messages
    const inactivityPatterns = [
        /volviendo al inicio/i,
        /volvió a la pantalla de inicio/i,
        /inactividad/i,
        /sess(?:ion)? (?:time.?out|expired)/i,
        /sess(?:ion)? reset/i,
        /por inactividad/i
    ];
    const hasInactivityMessage = visibleTexts.some(t => inactivityPatterns.some(p => p.test(t))) || visibleHeadings.some(h => inactivityPatterns.some(p => p.test(h)));
    // Check for home URL with only "Iniciar" button (fresh session state)
    const isRootLikeUrl = currentUrl === "/" || currentUrl === "" || /https?:\/\/[^/]+\/?$/.test(currentUrl);
    const isOnHomeWithIniciar = isRootLikeUrl &&
        visibleButtons.some(b => /iniciar|login|ingresar/i.test(b)) &&
        visibleButtons.length <= 3; // Home should have few buttons
    if (hasInactivityMessage) {
        return { detected: true, reason: "inactivity_message", visibleTexts, visibleButtons, currentUrl };
    }
    if (isOnHomeWithIniciar) {
        return { detected: true, reason: "home_url_with_iniciar", visibleTexts, visibleButtons, currentUrl };
    }
    return { detected: false };
}
/**
 * Check if an action intent is safe to replay
 * return_to_list is NOT safe to replay - it consumes context (detail page), doesn't produce it
 */
function isSafeActionToReplay(actionIntent) {
    const SAFE_ACTIONS = new Set([
        "start_session", "open_home", "open_module", "open_product_information",
        "select_category", "select_product", "select_visible_item_by_ordinal",
        "select_first_visible_item", "select_first_visible_product", "select_first_visible_card",
        "navigate"
        // NOTE: return_to_list is NOT safe - it requires being on detail page (consumes context)
    ]);
    const UNSAFE_ACTIONS = new Set([
        "submit_form", "confirm_action", "payment", "transfer", "send",
        "accept_terms", "delete", "fill_form_field", "click_primary_action",
        "return_to_list" // Explicitly unsafe - requires detail page context
    ]);
    if (UNSAFE_ACTIONS.has(actionIntent))
        return false;
    if (SAFE_ACTIONS.has(actionIntent))
        return true;
    // Default: be conservative, don't replay unknown actions
    return false;
}
const ORDINAL_PATTERNS = [
    { pattern: /(?:la|el|los|las)\s+primer[oa]?\b/i, ordinal: "first" },
    { pattern: /(?:la|el|los|las)\s+primera?\b/i, ordinal: "first" },
    { pattern: /(?:la|el|los|las)\s+segunda?\b/i, ordinal: "second" },
    { pattern: /(?:la|el|los|las)\s+tercera?\b/i, ordinal: "third" },
    { pattern: /(?:la|el|los|las)\s+(?:última|ultima)\b/i, ordinal: "last" },
    { pattern: /\bfirst\b/i, ordinal: "first" },
    { pattern: /\bsecond\b/i, ordinal: "second" },
    { pattern: /\bthird\b/i, ordinal: "third" },
    { pattern: /\blast\b/i, ordinal: "last" },
];
const ORDINAL_GENERIC_TERMS = [
    "producto", "productos", "item", "items", "elemento", "elementos", "fila", "filas",
    "card", "cards", "cuenta", "cuentas", "tarjeta", "tarjetas", "beneficiario", "beneficiarios",
    "registro", "registros", "solicitud", "solicitudes", "resultado", "resultados", "row", "rows",
    "list item", "listitem"
];
const ORDINAL_INSTRUCTIONAL_PATTERNS = [
    /selecciona/i,
    /elige\s+(el|la|un|una|el\s+tipo)/i,
    /elige/i,
    /escoge/i,
    /escoge/i,
    /select/i,
    /choose/i,
    /pick/i,
    /ver detalles/i,
    /detalles?/i,
    /ayuda/i,
    /help/i,
    /seleccione\s+una?\s+opci[oó]n/i,
    /choose\s+an?\s+option/i,
    /select\s+an?\s+option/i,
];
function normalizeOrdinalText(text) {
    return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}
function escapeRegex(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function extractOrdinalFromText(text) {
    const normalized = normalizeOrdinalText(text);
    for (const { pattern, ordinal } of ORDINAL_PATTERNS) {
        if (pattern.test(normalized))
            return ordinal;
    }
    return null;
}
function buildOrdinalDomainTerms(routeProfile) {
    const terms = new Set(ORDINAL_GENERIC_TERMS.map(normalizeOrdinalText));
    for (const term of routeProfile?.domainTerms ?? []) {
        const normalized = normalizeOrdinalText(term);
        if (normalized)
            terms.add(normalized);
        if (normalized && !normalized.endsWith("s"))
            terms.add(`${normalized}s`);
    }
    return [...terms];
}
function extractDomainTermFromText(target, routeProfile) {
    const normalized = normalizeOrdinalText(target);
    const terms = buildOrdinalDomainTerms(routeProfile);
    const matched = terms.find(term => term && normalized.includes(term));
    if (!matched)
        return undefined;
    return matched.replace(/s$/, "");
}
function isInstructionalText(text) {
    const normalized = normalizeOrdinalText(text);
    return ORDINAL_INSTRUCTIONAL_PATTERNS.some(pattern => pattern.test(normalized));
}
function isOrdinalCandidateText(text) {
    const normalized = normalizeOrdinalText(text);
    if (!normalized)
        return false;
    if (isInstructionalText(normalized))
        return false;
    if (/^(selecciona|elige|escoge|select|choose|pick)\b/i.test(normalized))
        return false;
    if (normalized.endsWith(":"))
        return false; // texts ending with colon are instructions, not items
    if (normalized.length > 80)
        return false;
    if ((normalized.match(/[.!?]/g) ?? []).length > 1)
        return false;
    if (normalized.length < 2)
        return false;
    return true;
}
function isProductLikeText(text, domainTerm) {
    const normalized = normalizeOrdinalText(text);
    if (!normalized)
        return false;
    if (domainTerm && normalized.includes(normalizeOrdinalText(domainTerm)))
        return true;
    return ORDINAL_GENERIC_TERMS.some(term => normalized.includes(normalizeOrdinalText(term)));
}
function isGlobalOrdinalControl(text, routeProfile) {
    const normalized = normalizeOrdinalText(text);
    const blocked = new Set([
        "volver", "atras", "atrás", "back", "regresar", "return",
        "finalizar sesion", "finalizar sesión", "cerrar sesion", "cerrar sesión",
        "logout", "sign out", "salir", "solicitar", "request",
        "cancelar", "cancel", "confirmar", "confirm", "aceptar", "accept",
        "continuar", "continue", "siguiente", "next", "menu principal", "main menu"
    ]);
    if (blocked.has(normalized))
        return true;
    for (const label of routeProfile?.blockedLabels ?? []) {
        if (normalized.includes(normalizeOrdinalText(label)))
            return true;
    }
    return false;
}
function isOrdinalSelectionActionIntent(actionIntent) {
    return actionIntent === "select_visible_item_by_ordinal";
}
async function resolveOrdinalSelectionOnPage(page, options) {
    if (!isOrdinalSelectionActionIntent(options.actionIntent))
        return null;
    const ordinal = extractOrdinalFromText(options.target);
    const domainTerm = extractDomainTermFromText(options.target, options.routeProfile);
    if (!ordinal)
        return null;
    const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(page).catch(() => null);
    const selectors = [
        'button:visible',
        '[role="button"]:visible',
        'a:visible',
        '[role="link"]:visible',
        'article:visible',
        '[role="listitem"]:visible',
        '[role="row"]:visible',
        '[class*="card"]:visible',
    ];
    const seen = new Set();
    const candidates = [];
    for (const selector of selectors) {
        const locatorGroup = page.locator(selector);
        const count = await locatorGroup.count().catch(() => 0);
        for (let index = 0; index < count; index += 1) {
            const locator = locatorGroup.nth(index);
            try {
                const visible = await locator.isVisible().catch(() => false);
                if (!visible)
                    continue;
                const enabled = await locator.isEnabled().catch(() => false);
                if (!enabled)
                    continue;
                const text = ((await locator.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
                if (!isOrdinalCandidateText(text))
                    continue;
                const tagName = await locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
                const role = await locator.getAttribute("role").catch(() => undefined) ?? undefined;
                const isHeading = /^h[1-6]$/.test(tagName) || role === "heading";
                const isCardLike = /article|li|div|section|row/i.test(tagName) || /card|item|row|product/i.test(text);
                const isClickable = ["button", "a", "input"].includes(tagName) || role === "button" || role === "link" || isCardLike || isHeading;
                if (!isClickable)
                    continue;
                const selectorKey = `${tagName}:${role ?? ""}:${text}`;
                if (seen.has(selectorKey))
                    continue;
                seen.add(selectorKey);
                let finalLocator = locator;
                if (isHeading) {
                    const container = locator.locator('xpath=ancestor::article[1] | ancestor::li[1] | ancestor::section[1] | ancestor::div[contains(@class,"card")][1] | ancestor::div[contains(@class,"item")][1]');
                    const containerCount = await container.count().catch(() => 0);
                    if (containerCount > 0) {
                        finalLocator = container.first();
                    }
                }
                candidates.push({
                    locator: finalLocator,
                    text,
                    selector,
                    type: isHeading ? "heading" : isCardLike ? "card" : tagName === "button" ? "button" : tagName === "a" ? "link" : "item",
                    role,
                    tagName,
                    visible,
                    enabled,
                    domainRelated: Boolean(domainTerm ? normalizeOrdinalText(text).includes(normalizeOrdinalText(domainTerm)) : isProductLikeText(text)),
                    productLike: isProductLikeText(text, domainTerm),
                });
            }
            catch {
                continue;
            }
        }
    }
    if (candidates.length === 0 && pageDiag?.visibleButtons?.length) {
        for (const text of pageDiag.visibleButtons) {
            if (!isOrdinalCandidateText(text))
                continue;
            const normalizedText = normalizeOrdinalText(text);
            const domainRelated = Boolean(domainTerm ? normalizedText.includes(normalizeOrdinalText(domainTerm)) : isProductLikeText(text));
            const productLike = isProductLikeText(text, domainTerm);
            if (!domainRelated && !productLike)
                continue;
            try {
                const locator = page.getByRole("button", { name: new RegExp(escapeRegex(text), "i") });
                candidates.push({
                    locator,
                    text,
                    selector: `visibleButton:${text}`,
                    type: "button",
                    role: "button",
                    tagName: "button",
                    visible: true,
                    enabled: true,
                    domainRelated,
                    productLike,
                });
            }
            catch {
                continue;
            }
        }
    }
    // Step 1: Prefer domain-related + product-like, then domain-related or product-like
    const safe = candidates.filter(c => c.visible && c.enabled && c.domainRelated && c.productLike);
    const ordered = safe.length > 0 ? safe : candidates.filter(c => c.visible && c.enabled && (c.domainRelated || c.productLike));
    // Step 2a: Exclude navigation controls like "Volver", "Salir"
    const navRejected = ordered.filter(c => isGlobalOrdinalControl(c.text, options.routeProfile));
    for (const nav of navRejected) {
        console.log(`[ordinal-selection-runtime] rejected navigation candidate="${nav.text}"`);
    }
    let nonNav = ordered.filter(c => !isGlobalOrdinalControl(c.text, options.routeProfile));
    // Step 2b: For ordinal item selection, separate generic categories from specific items.
    // A single-word label like "Tarjetas", "Cuentas", "Préstamos" is typically a section
    // heading/category, not a selectable item. Multi-word labels like "Préstamo Personal",
    // "Cuenta de Ahorro", "Tarjeta de Crédito" are specific items.
    const CATEGORY_NOUNS = new Set([
        "tarjetas", "cuentas", "prestamos", "préstamos", "depósitos", "depositos",
        "productos", "servicios", "categorías", "categorias", "solicitudes",
        "usuarios", "reportes", "documentos", "planes", "facturas", "ordenes", "órdenes",
        "sucursales", "beneficiarios", "registros", "resultados"
    ]);
    const categoryRejected = [];
    const productCandidates = [];
    for (const c of nonNav) {
        const text = c.text.trim().toLowerCase();
        const wordCount = text.split(/\s+/).length;
        const isSingleCategoryWord = wordCount === 1 && CATEGORY_NOUNS.has(text);
        if (isSingleCategoryWord) {
            categoryRejected.push(c);
            console.log(`[ordinal-selection-runtime] rejected category candidate="${c.text}" reason=generic_category_not_item`);
        }
        else {
            productCandidates.push(c);
        }
    }
    // Step 2c: If expectedTarget is specified (from detailTarget), rank candidates by match
    const expectedTarget = options.expectedTarget;
    if (expectedTarget && productCandidates.length > 0) {
        console.log(`[ordinal-selection] expectedTarget="${expectedTarget}"`);
        const normalizedExpected = normalizeOrdinalText(expectedTarget);
        // Score each candidate by match with expectedTarget
        const scored = productCandidates.map(c => {
            const normalizedText = normalizeOrdinalText(c.text);
            let score = 0;
            let reason = "no_match";
            let hasVariantConflict = false;
            // Exact match after normalization
            if (normalizedText === normalizedExpected) {
                score = 1.0;
                reason = "exact_match";
            }
            else if (normalizedText.includes(normalizedExpected) || normalizedExpected.includes(normalizedText)) {
                score = 0.9;
                reason = "expected_target_match";
            }
            else {
                // Token-based matching
                const expectedTokens = normalizedExpected.split(/\s+/).filter(t => t.length > 2);
                const candidateTokens = normalizedText.split(/\s+/).filter(t => t.length > 2);
                let matches = 0;
                for (const et of expectedTokens) {
                    if (candidateTokens.some(ct => ct.includes(et) || et.includes(ct)))
                        matches++;
                }
                const tokenScore = expectedTokens.length > 0 ? matches / expectedTokens.length : 0;
                if (tokenScore >= 0.6) {
                    score = 0.7 + 0.2 * tokenScore;
                    reason = "token_match";
                }
                // Detect variant conflict: candidate has variant token that expected doesn't
                const variantTokens = ["pesos", "dólares", "dolares", "euros", "personal", "comercial", "clásica", "clasica", "gold", "platinum", "infinite"];
                for (const vt of variantTokens) {
                    const inExpected = normalizedExpected.includes(vt);
                    const inCandidate = normalizedText.includes(vt);
                    if (inCandidate && !inExpected) {
                        hasVariantConflict = true;
                        score *= 0.3;
                        reason = "variant_conflict";
                        console.log(`[ordinal-selection] candidate text="${c.text}" match=false reason=variant_conflict expectedVariant="${normalizedExpected.match(/pesos|dólares|dolares|euros|personal|comercial|clásica|clasica|gold|platinum|infinite/)?.[0] ?? "?"}" actualVariant="${vt}"`);
                    }
                }
            }
            return { candidate: c, score, reason };
        });
        scored.sort((a, b) => b.score - a.score);
        const bestScore = scored[0].score;
        if (bestScore >= 0.7) {
            // Reorder productCandidates by score
            productCandidates.length = 0;
            for (const s of scored) {
                if (s.score === bestScore)
                    productCandidates.push(s.candidate);
            }
            console.log(`[ordinal-selection] selected best match score=${bestScore.toFixed(2)} reason="${scored[0].reason}"`);
        }
    }
    // If only one non-nav candidate remains, accept it (even if single-word, it's the only option)
    if (productCandidates.length === 0 && nonNav.length === 1) {
        console.log(`[ordinal-selection-runtime] accepted only non-nav candidate="${nonNav[0].text}" reason=single_non_nav_candidate`);
        productCandidates.push(nonNav[0]);
    }
    // Prefer product candidates; for product domain, never fall back to categories
    const isProductDomain = Boolean(domainTerm && normalizeOrdinalText(domainTerm) === "producto");
    let candidatesToUse;
    if (productCandidates.length > 0) {
        candidatesToUse = productCandidates;
    }
    else if (isProductDomain) {
        candidatesToUse = [];
    }
    else {
        candidatesToUse = nonNav;
    }
    const selected = candidatesToUse.length > 0 ? candidatesToUse[0] : undefined;
    if (selected) {
        console.log(`[ordinal-selection-runtime] ordinal=${ordinal} domainTerm=${domainTerm ?? "generic"} candidateCount=${candidates.length} selectedText="${selected.text}"`);
        return { ...selected, ordinal, domainTerm, candidateCount: candidates.length };
    }
    // Step 3: Empty candidates or none passed filters — fall back to pageDiag
    // Ensure pageDiag is available (retry if first capture failed)
    const effectiveDiag = pageDiag ?? await (0, promoted_spec_helpers_1.capturePageDiagnostics)(page).catch(() => null);
    const visibleButtons = effectiveDiag?.visibleButtons ?? [];
    const visibleHeadingsDiag = effectiveDiag?.visibleHeadings ?? [];
    const firstVisibleButton = visibleButtons.find(text => isOrdinalCandidateText(text) &&
        !isGlobalOrdinalControl(text, options.routeProfile) &&
        isProductLikeText(text, domainTerm));
    if (firstVisibleButton) {
        return {
            locator: page.getByRole("button", { name: new RegExp(escapeRegex(firstVisibleButton), "i") }).first(),
            text: firstVisibleButton,
            selector: `visibleButton:${firstVisibleButton}`,
            ordinal,
            domainTerm,
            candidateCount: Math.max(candidates.length, visibleButtons.length),
        };
    }
    const firstHeading = visibleHeadingsDiag.find(text => isOrdinalCandidateText(text) && !isInstructionalText(text));
    if (firstHeading) {
        const headingLocator = page.getByRole("heading", { name: new RegExp(escapeRegex(firstHeading), "i") }).first();
        const headingContainer = headingLocator.locator('xpath=ancestor::article[1] | ancestor::li[1] | ancestor::section[1] | ancestor::div[contains(@class,"card")][1] | ancestor::div[contains(@class,"item")][1]').first();
        return {
            locator: headingContainer,
            text: firstHeading,
            selector: `visibleHeading:${firstHeading}`,
            ordinal,
            domainTerm,
            candidateCount: Math.max(candidates.length, visibleHeadingsDiag.length),
        };
    }
    // Step 4: Single product-like candidate from CSS selectors (no pageDiag needed)
    const allProductLike = candidates.filter(c => c.visible && c.enabled && c.productLike);
    if (allProductLike.length === 1) {
        return { ...allProductLike[0], ordinal, domainTerm, candidateCount: candidates.length };
    }
    return null;
}
class PromotedSpecRuntime {
    page;
    config;
    lastDialogMessage;
    activeContainer;
    activeContainerDiscardReason;
    lastSelectionStep;
    evidenceRecorder;
    evidenceStepIndex = 0;
    evidenceInitState = "pending";
    evidenceInitReason;
    evidenceInitPromise;
    loginRequests = new Set();
    authBoundary = {
        loginRequestObserved: false,
        loginPageUrl: undefined,
        loginRequestStartedAt: undefined,
        loginResponseObserved: false,
        loginResponseAt: undefined,
        loginStatus: undefined,
        loginRequestFinished: false,
        loginRequestFinishedAt: undefined,
        loginRequestFailed: false,
        loginRequestFailureText: undefined,
        authSubmitObserved: false,
        functionalBusinessExecutionStarted: false,
        oracleEvaluationStarted: false,
    };
    constructor(page, config) {
        this.page = page;
        this.config = { ...loadPromotedRuntimeConfigFromEnv(), ...config };
        this.attachAuthBoundaryObserver();
        this.page.on("dialog", async (dialog) => {
            this.lastDialogMessage = dialog.message();
            this.activeContainerDiscardReason = "dialog_seen_mark_container_stale";
            const lower = dialog.message().toLowerCase();
            const sensitive = /(password|otp|token|transfer|payment|loan|prestamo|contract|contrato)/i.test(lower);
            if (sensitive) {
                await dialog.dismiss().catch(() => undefined);
            }
            else {
                await dialog.accept().catch(() => undefined);
            }
        });
        // Initialize evidence recorder if EVIDENCE_ENABLED
        this.evidenceInitPromise = this.initEvidence().catch((err) => {
            this.evidenceInitState = "failed";
            this.evidenceInitReason = err?.message ?? "unknown_error";
            console.log(`[evidence] init error: ${this.evidenceInitReason}`);
        });
    }
    attachAuthBoundaryObserver() {
        this.page.on("request", (request) => {
            if (request.method().toUpperCase() !== "POST" || !this.isLoginRequestUrl(request.url()))
                return;
            this.loginRequests.add(request);
            if (!this.authBoundary.loginRequestObserved) {
                this.authBoundary.loginRequestObserved = true;
                this.authBoundary.loginRequestStartedAt = Date.now();
                this.authBoundary.loginPageUrl = this.page.url();
            }
        });
        this.page.on("response", (response) => {
            const request = response.request();
            if (!this.loginRequests.has(request))
                return;
            this.authBoundary.loginResponseObserved = true;
            this.authBoundary.loginResponseAt ??= Date.now();
            this.authBoundary.loginStatus ??= response.status();
        });
        this.page.on("requestfinished", (request) => {
            if (!this.loginRequests.has(request))
                return;
            this.authBoundary.loginRequestFinished = true;
            this.authBoundary.loginRequestFinishedAt = Date.now();
        });
        this.page.on("requestfailed", (request) => {
            if (!this.loginRequests.has(request))
                return;
            this.authBoundary.loginRequestFailed = true;
            this.authBoundary.loginRequestFinished = true;
            this.authBoundary.loginRequestFinishedAt = Date.now();
            this.authBoundary.loginRequestFailureText = request.failure()?.errorText;
        });
    }
    isLoginRequestUrl(url) {
        try {
            const pathname = new URL(url).pathname.replace(/\/+$/, "").toLowerCase();
            return pathname === "/login" || pathname.endsWith("/login");
        }
        catch {
            return /\/login(?:$|[?#])/i.test(url);
        }
    }
    isAuthSubmitTarget(target) {
        return /continuar|iniciar sesión|iniciar sesion|login|sign in|submit|ingresar/i.test(target);
    }
    async markBoundaryProgress() {
        if (!this.authBoundary.authSubmitObserved)
            return;
        const currentUrl = this.page.url();
        const onLoginSurface = this.isLoginRequestUrl(currentUrl);
        if (!onLoginSurface) {
            this.authBoundary.functionalBusinessExecutionStarted = true;
        }
    }
    async emitAuthBoundaryAttempt() {
        const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page).catch(() => undefined);
        const currentUrl = this.page.url();
        const authSurfaceStillVisible = this.isLoginRequestUrl(currentUrl)
            || Boolean(pageDiag?.visibleButtons.some((text) => /continuar|iniciar sesión|iniciar sesion|iniciando sesión|iniciando sesion|login|ingresar/i.test(text)));
        const loadingIndicatorObserved = Boolean(pageDiag?.loadingDetected
            || pageDiag?.skeletonDetected
            || pageDiag?.visibleButtons.some((text) => /cargando|loading|iniciando sesión|iniciando sesion|procesando/i.test(text)));
        const postLoginSurfaceObserved = this.authBoundary.authSubmitObserved && !authSurfaceStillVisible;
        const businessSurfaceReached = postLoginSurfaceObserved && !loadingIndicatorObserved;
        const authRejected = this.authBoundary.loginStatus === 401
            || this.authBoundary.loginStatus === 403
            || Boolean(pageDiag?.visibleTexts.some((text) => /credencial|contraseña incorrecta|contrasena incorrecta|usuario inválido|usuario invalido|autenticación fallida|autenticacion fallida|invalid password|invalid credential/i.test(text)));
        const applicationError = !authRejected && Boolean(pageDiag?.visibleTexts.some((text) => /\b(?:error|exception|fall[oó]|failed)\b/i.test(text)));
        const requestPending = this.authBoundary.loginRequestObserved
            && !this.authBoundary.loginRequestFinished
            && !this.authBoundary.loginRequestFailed;
        const failureClassification = businessSurfaceReached
            ? "BUSINESS_SURFACE_REACHED"
            : authRejected
                ? "AUTH_REJECTED"
                : this.authBoundary.loginRequestObserved && (requestPending || loadingIndicatorObserved || authSurfaceStillVisible)
                    ? "POST_AUTH_NAVIGATION_FAILURE"
                    : "PROMOTED_RUNTIME_FAILURE";
        const attempt = Number(process.env.PROMOTED_RUNTIME_ATTEMPT ?? "1");
        const payload = {
            attempt: Number.isInteger(attempt) && attempt > 0 ? attempt : 1,
            browserStarted: true,
            contextStarted: true,
            pageStarted: true,
            loginRequestObserved: this.authBoundary.loginRequestObserved,
            loginRequestStartedAt: this.authBoundary.loginRequestStartedAt,
            loginResponseObserved: this.authBoundary.loginResponseObserved,
            loginResponseAt: this.authBoundary.loginResponseAt,
            loginStatus: this.authBoundary.loginStatus,
            loginRequestFinished: this.authBoundary.loginRequestFinished,
            loginRequestFinishedAt: this.authBoundary.loginRequestFinishedAt,
            loginRequestFailed: this.authBoundary.loginRequestFailed,
            loginRequestFailureText: this.authBoundary.loginRequestFailureText,
            requestPending,
            redirectObserved: Boolean(this.authBoundary.loginPageUrl && currentUrl !== this.authBoundary.loginPageUrl),
            urlChanged: Boolean(this.authBoundary.loginPageUrl && currentUrl !== this.authBoundary.loginPageUrl),
            loadingIndicatorObserved,
            authSurfaceStillVisible,
            postLoginSurfaceObserved,
            businessSurfaceReached,
            failureClassification,
            authRejected,
            applicationError,
            functionalBusinessExecutionStarted: this.authBoundary.functionalBusinessExecutionStarted,
            oracleEvaluationStarted: this.authBoundary.oracleEvaluationStarted,
        };
        console.log(`[promoted-runtime-attempt] ${JSON.stringify(payload)}`);
    }
    /** Initialize evidence recorder from env config */
    async initEvidence() {
        try {
            const cfg = (0, evidence_types_1.loadEvidenceConfig)();
            if (!cfg.enabled) {
                this.evidenceInitState = "disabled";
                this.evidenceInitReason = "config_disabled";
                console.log("[evidence] disabled reason=config_disabled");
                return;
            }
            this.evidenceRecorder = new evidence_recorder_1.EvidenceRecorder({
                appSlug: stringFromEnv("EVIDENCE_APP_SLUG", "APP_SLUG") ?? "default",
                sectionSlug: stringFromEnv("EVIDENCE_SECTION_SLUG", "SECTION_SLUG") ?? "default-section",
                sectionName: process.env.SECTION_NAME,
                scenarioId: stringFromEnv("SCENARIO_ID") ?? "unknown",
                scenarioTitle: stringFromEnv("SCENARIO_TITLE") ?? "unknown",
                runId: process.env.EVIDENCE_RUN_ID,
                outputRoot: cfg.outputRoot,
                analystName: cfg.analystName || process.env.EVIDENCE_ANALYST_NAME,
            }, cfg);
            await this.evidenceRecorder.start();
            this.evidenceInitState = "initialized";
            this.evidenceInitReason = undefined;
            console.log(`[evidence] initialized scenario=${process.env.SCENARIO_ID || "unknown"}`);
        }
        catch (err) {
            this.evidenceInitState = "failed";
            this.evidenceInitReason = err?.message ?? "unknown_error";
            console.log(`[evidence] init failed: ${this.evidenceInitReason}`);
        }
    }
    async ensureEvidenceInitialized() {
        if (!this.evidenceInitPromise)
            return;
        await this.evidenceInitPromise;
    }
    async ensureInitialEvidence() {
        await this.ensureEvidenceInitialized();
        if (!this.evidenceRecorder)
            return;
        if (!(await this.evidenceRecorder.captureInitialScreen(this.page, "promoted_reuse"))) {
            throw new Error("initial_readiness_failure");
        }
    }
    /** Capture evidence for a single step */
    async captureEvidenceStep(stepText, status, errorMessage, options) {
        await this.ensureEvidenceInitialized();
        if (!this.evidenceRecorder)
            return;
        this.evidenceStepIndex++;
        try {
            const target = options?.target ?? stepText.match(/"([^"]+)"/)?.[1];
            await this.evidenceRecorder.captureStep(this.page, this.evidenceStepIndex, stepText, {
                target,
                status,
                errorMessage,
                sourceStepIndex: options?.sourceStepIndex,
            });
        }
        catch (err) {
            console.log(`[evidence] step capture failed: ${err.message}`);
        }
    }
    /** Capture evidence for a click target step */
    async captureClickStep(target, status, errorMessage, sourceStepIndex) {
        if (!this.evidenceRecorder)
            return;
        const stepText = `Clic en "${target}".`;
        await this.captureEvidenceStep(stepText, status, errorMessage, { target, sourceStepIndex });
    }
    /** Call at the end of a spec to finalize evidence (saves evidence.json and generates evidencia.docx) */
    async finishEvidence() {
        await this.emitAuthBoundaryAttempt();
        await this.ensureEvidenceInitialized();
        if (!this.evidenceRecorder) {
            if (this.evidenceInitState === "failed") {
                console.log(`[evidence] unavailable reason=initialization_failed detail=${this.evidenceInitReason ?? "unknown"}`);
            }
            else if (this.evidenceInitState === "disabled") {
                console.log(`[evidence] disabled`);
            }
            return;
        }
        try {
            if (!this.evidenceRecorder.hasInitialScreenEvidence) {
                await this.evidenceRecorder.captureInitialScreen(this.page, "promoted_reuse");
            }
            const record = await this.evidenceRecorder.finish();
            const perScenarioDocxGenerated = Boolean(record.docxPath
                && node_fs_1.default.existsSync(record.docxPath));
            console.log(`[evidence] scenario=${record.scenarioId} status=${record.status} perScenarioDocxGenerated=${perScenarioDocxGenerated} steps=${record.steps.length} screenshots=${record.steps.filter((s) => s.screenshotPath).length}`);
        }
        catch (err) {
            console.log(`[evidence] finish failed: ${err.message}`);
        }
    }
    async waitForPromotedUiStable(stepIndex, target) {
        if (!this.config.enabled)
            return;
        const stability = await (0, page_stability_detector_1.waitForStablePageState)(this.page, {
            timeoutMs: this.config.stabilityTimeoutMs,
            pollMs: 500,
            stableForMs: 700
        });
        if (!stability.finalStable) {
            throw new Error(`UI not stable after step ${stepIndex} target="${target}"`);
        }
    }
    async handlePromotedDialogOrAlert() {
        return this.lastDialogMessage;
    }
    /**
     * Attempt safe replay of previous steps to restore context after home reset
     */
    async safeReplayContext(previousSteps, targetStepIndex) {
        const replayedSteps = [];
        const stepsToReplay = previousSteps.filter(s => s.stepIndex < targetStepIndex && isSafeActionToReplay(s.actionIntent) && !s.sensitive);
        if (stepsToReplay.length === 0) {
            return { success: false, replayedSteps, reason: "no_safe_steps_to_replay" };
        }
        console.log(`[runtime:replay] Attempting to replay ${stepsToReplay.length} safe step(s) to restore context`);
        for (const step of stepsToReplay) {
            try {
                console.log(`[runtime:replay] Replaying step ${step.stepIndex}: ${step.actionIntent} "${step.target}"`);
                if (step.replay && typeof step.replay === 'function') {
                    await step.replay();
                }
                else if (step.action && typeof step.action === 'function') {
                    await step.action();
                }
                else {
                    console.warn(`[runtime:replay] Step ${step.stepIndex} has no executable callback`);
                    return {
                        success: false,
                        replayedSteps,
                        stoppedAt: step.stepIndex,
                        reason: `step_${step.stepIndex}_missing_replay_callback`
                    };
                }
                replayedSteps.push(step.stepIndex);
                await this.waitForPromotedUiStable(step.stepIndex, step.target);
            }
            catch (error) {
                console.warn(`[runtime:replay] Failed to replay step ${step.stepIndex}: ${error instanceof Error ? error.message : String(error)}`);
                return {
                    success: false,
                    replayedSteps,
                    stoppedAt: step.stepIndex,
                    reason: `replay_failed_at_step_${step.stepIndex}`
                };
            }
        }
        console.log(`[runtime:replay] Successfully replayed ${replayedSteps.length} step(s)`);
        return { success: true, replayedSteps };
    }
    /**
     * Check if current page is already a list page (for return_to_list handling)
     */
    async checkIfAlreadyOnListPage(pageDiag) {
        const { currentUrl, visibleButtons, visibleHeadings, visibleTexts } = pageDiag;
        // Signals that indicate we're on a list page
        const listPageSignals = {
            // Multiple product cards/items visible
            hasMultipleItems: visibleButtons.length >= 2,
            // Heading indicates list/module
            hasListHeading: visibleHeadings.some(h => /consulta|listado|productos|productos|balance|transacciones|menu/i.test(h)),
            // No detail-specific elements
            noDetailSignals: !visibleHeadings.some(h => /detalle|detail|informaci|information del producto|finalizar sesi|log out|log out/i.test(h)) && !visibleButtons.some(b => /finalizar sesi|log out|log out|más detalles|ver detalles|informaci|details/i.test(b)),
            // Has product selection buttons/cards
            hasProductButtons: visibleButtons.some(b => /dep|cuenta|tarjeta|producto|item|card|balance|préstamo|prestamo/i.test(b))
        };
        const isOnListPage = listPageSignals.hasMultipleItems &&
            listPageSignals.hasListHeading &&
            listPageSignals.noDetailSignals &&
            listPageSignals.hasProductButtons;
        if (isOnListPage) {
            console.log(`[runtime:list_check] List page detected: hasMultipleItems=${listPageSignals.hasMultipleItems} hasListHeading=${listPageSignals.hasListHeading} noDetailSignals=${listPageSignals.noDetailSignals} hasProductButtons=${listPageSignals.hasProductButtons}`);
        }
        return isOnListPage;
    }
    async ensureContextForOrdinalSelection(options) {
        const replaySteps = options.previousStepReplays || options.previousSteps || [];
        const readyBeforeReplay = await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 1500, pollMs: 250, minCards: 1 });
        if (readyBeforeReplay.ready)
            return;
        const currentDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page).catch(() => undefined);
        const nonGlobalButtons = (currentDiag?.visibleButtons ?? []).filter((text) => isOrdinalCandidateText(text) &&
            !isGlobalOrdinalControl(text, options.routeProfile) &&
            !isInstructionalText(text));
        const nonGlobalHeadings = (currentDiag?.visibleHeadings ?? []).filter((text) => isOrdinalCandidateText(text) && !isInstructionalText(text));
        const hasVisibleOrdinalCandidate = nonGlobalButtons.length >= 2 || nonGlobalHeadings.length >= 2;
        if (hasVisibleOrdinalCandidate)
            return;
        if (replaySteps.length > 0) {
            console.log(`[runtime:ordinal_context] list not ready, replaying ${replaySteps.length} prior step(s) before ordinal target="${options.target}" stepIndex=${options.stepIndex}`);
            const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
            if (replayResult.success) {
                const readyAfterReplay = await (0, promoted_spec_helpers_1.waitForListReadiness)(this.page, { timeoutMs: 4000, pollMs: 250, minCards: 1 });
                if (readyAfterReplay.ready)
                    return;
            }
        }
        const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
        const expectedContext = options.routeProfile?.domainTerms?.length
            ? `list_context:${options.routeProfile.domainTerms.join("|")}`
            : "list_context";
        throw new Error(`missing_runtime_context_for_ordinal: target="${options.target}" actionIntent="select_visible_item_by_ordinal" ` +
            `expectedContext="${expectedContext}" currentUrl="${pageDiag.currentUrl}" ` +
            `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
            `replayStepsCount=${replaySteps.length} stepIndex=${options.stepIndex} ` +
            `suggestedFix="Reproduce the full navigation path before ordinal selection, including entry/module/category/list"`);
    }
    async clickPromotedTarget(options) {
        await this.markBoundaryProgress();
        if (this.isAuthSubmitTarget(options.target)) {
            this.authBoundary.authSubmitObserved = true;
        }
        await this.ensureInitialEvidence();
        const previousUrl = this.page.url();
        const expectedEffect = options.expectedEffect ?? "ui_change";
        let retryAttempted = false;
        const targetIdentity = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(options.stepIndex, options.target, {
            valueKey: options.valueKey,
            technicalTargetRefs: options.technicalTargetRefs,
        });
        const resolvedExpectedEffect = effectiveExpectedEffect(expectedEffect, targetIdentity);
        const beforeActionSnapshot = this.config.enabled
            ? await capturePromotedActionSurfaceSnapshot(this.page, options.target).catch(() => undefined)
            : undefined;
        const replaySteps = options.previousStepReplays || options.previousSteps;
        const isInitialHomeEntryAction = options.actionIntent === "start_session" ||
            options.actionIntent === "open_home" ||
            /^(iniciar|inicio|home|start)$/i.test(options.target.trim());
        // STEP 1: Detect home reset/inactivity BEFORE any target resolution
        const homeReset = await detectHomeResetOrInactivity(this.page);
        if (homeReset.detected && !isInitialHomeEntryAction) {
            console.log(`[runtime:session_reset] detected: reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" stepIndex=${options.stepIndex}`);
            if (replaySteps && replaySteps.length > 0) {
                console.log(`[runtime:session_reset] replaying steps count=${replaySteps.length}`);
                const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
                if (replayResult.success) {
                    console.log(`[runtime:session_reset] replay succeeded: replayedSteps=[${replayResult.replayedSteps.join(", ")}]`);
                }
                else {
                    console.log(`[runtime:session_reset] replay failed: ${replayResult.reason}`);
                    throw new Error(`session_reset_unrecoverable_replay_failed: Home reset detected but safe replay failed. ` +
                        `reason="${replayResult.reason}" currentUrl="${homeReset.currentUrl}" ` +
                        `previousStepsCount=${replaySteps.length} stepIndex=${options.stepIndex} ` +
                        `target="${options.target}" actionIntent="${options.actionIntent}" ` +
                        `suggestedFix="Regenerate spec or increase session timeout"`);
                }
            }
            else {
                throw new Error(`session_reset_unrecoverable_missing_replay_callback: Home reset detected but cannot recover context. ` +
                    `reason="${homeReset.reason}" currentUrl="${homeReset.currentUrl}" ` +
                    `previousStepsCount=${replaySteps?.length || 0} stepIndex=${options.stepIndex} ` +
                    `target="${options.target}" actionIntent="${options.actionIntent}" ` +
                    `suggestedFix="Regenerate spec with previousStepReplays callbacks or increase session timeout"`);
            }
        }
        // STEP 2: Special handling for return_to_list: check if already on list page
        if (options.actionIntent === "return_to_list") {
            const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
            const alreadyOnList = await this.checkIfAlreadyOnListPage(pageDiag);
            if (alreadyOnList) {
                console.log(`[runtime:return_to_list] Already on list page, marking as satisfied: currentUrl="${pageDiag.currentUrl}"`);
                return;
            }
        }
        if (isOrdinalSelectionActionIntent(options.actionIntent)) {
            await this.ensureContextForOrdinalSelection({
                target: options.target,
                stepIndex: options.stepIndex,
                previousStepReplays: options.previousStepReplays,
                previousSteps: options.previousSteps,
                routeProfile: options.routeProfile
            });
        }
        // STEP 3: Validate screen context before executing context-dependent actions
        try {
            await validateScreenContextForAction(this.page, {
                target: options.target,
                actionIntent: options.actionIntent,
                stepIndex: options.stepIndex,
                expectedOwnerPage: options.expectedOwnerPage,
                lastSelectionStep: options.lastSelectionStep
            });
        }
        catch (error) {
            if (error instanceof Error && error.message.includes("detail_reentry_required")) {
                // Detail re-entry required - attempt replay if callback available
                if (options.lastSelectionReplay) {
                    console.log(`[runtime:detail_reentry] Executing lastSelectionReplay callback for step=${options.lastSelectionStep?.stepIndex || 'unknown'} target="${options.lastSelectionStep?.selectedTarget || 'unknown'}"`);
                    try {
                        await options.lastSelectionReplay();
                        console.log(`[runtime:detail_reentry] Replay succeeded, retrying target resolution`);
                        // After successful replay, continue with normal flow (don't throw)
                    }
                    catch (replayError) {
                        console.log(`[runtime:detail_reentry] Replay failed: ${replayError instanceof Error ? replayError.message : String(replayError)}`);
                        throw new Error(`detail_reentry_replay_failed: Could not re-enter detail page to execute "${options.target}". ` +
                            `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
                            `replayError="${replayError instanceof Error ? replayError.message : String(replayError)}" ` +
                            `suggestedFix="Ensure the selection step callback is executable and navigates to detail page."`);
                    }
                }
                else {
                    // No replay callback available - this is a framework limitation
                    throw new Error(`detail_reentry_required: Expected to be on DetailPage but currently on list page. ` +
                        `Target "${options.target}" not visible. ` +
                        `currentUrl="${(await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page)).currentUrl}" ` +
                        `lastSelectionStep=${options.lastSelectionStep ? `step=${options.lastSelectionStep.stepIndex} target="${options.lastSelectionStep.selectedTarget}"` : "none"} ` +
                        `suggestedFix="This is a known framework limitation. The selection step needs an action callback for replay. ` +
                        `Please regenerate the spec or manually add the selection step before the primary action in the spec."`);
                }
            }
            else {
                throw error;
            }
        }
        // New diagnostics for native click tracking
        let clickPath = "failed";
        let nativeClickAttempted = false;
        let nativeClickSucceeded = false;
        let nativeClickError;
        let callbackAttempted = false;
        let callbackSucceeded = false;
        let callbackError;
        let effectDetected = false;
        let fallbackUsed = "none";
        let matchedLocatorStrategy = "unknown";
        // Post-selection detail state verification
        // If previous step was a selection and current step expects detail page, verify we navigated
        if (this.lastSelectionStep && options.actionIntent === "click_primary_action") {
            const selectionDiag = await this.verifyDetailStateAfterSelection(options.target);
            if (!selectionDiag.reachedDetail) {
                throw new Error(`selection_did_not_reach_expected_detail_state: After selecting "${this.lastSelectionStep.selectedTarget}", ` +
                    `expected to be on detail page but still on list/source page. ` +
                    `currentUrl="${selectionDiag.currentUrl}" visibleButtons=[${selectionDiag.visibleButtons.join(", ")}] ` +
                    `visibleHeadings=[${selectionDiag.visibleHeadings.join(", ")}] nextStepTarget="${options.target}" ` +
                    `nextStepIntent="${options.actionIntent}" expectedOwnerPage="DetailPage" ` +
                    `sourcePageSignature="ListPage" destinationPageExpectedSignals=["primary_action_button", "detail_heading"]`);
            }
            this.lastSelectionStep = undefined;
        }
        // Guard: Verify target is visible before executing primary action
        // This prevents calling POM methods on wrong page/state
        if (options.actionIntent === "click_primary_action" || options.actionIntent === "expect_primary_action_visible") {
            try {
                // First try exact role/link match
                const targetLocator = this.page.getByRole('button', { name: new RegExp(options.target, 'i') })
                    .or(this.page.getByRole('link', { name: new RegExp(options.target, 'i') }));
                let isVisible = await targetLocator.isVisible({ timeout: 5000 }).catch(() => false);
                // Semantic fallback if exact match fails
                if (!isVisible) {
                    const semanticResult = await (0, semantic_target_matcher_1.findSemanticTargetMatch)(this.page, options.target, {
                        timeoutMs: 3000,
                        actionIntent: "click_primary_action",
                        minScore: 0.75,
                        preferTypes: ["button", "link"],
                        excludeSensitive: false
                    });
                    if (semanticResult.status === "exact" || semanticResult.status === "semantic") {
                        isVisible = await semanticResult.candidate.locator.isVisible().catch(() => false);
                    }
                }
                if (!isVisible) {
                    // Capture page state for diagnostics
                    const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
                    throw new Error(`wrong_screen_before_primary_action: Target "${options.target}" not visible on current page. ` +
                        `currentUrl="${pageDiag.currentUrl}" visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
                        `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] stepIndex=${options.stepIndex} ` +
                        `actionIntent="${options.actionIntent}" expectedOwnerPage="DetailPage"`);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.includes("wrong_screen_before_primary_action")) {
                    throw error;
                }
                // Continue with normal flow if visibility check fails for other reasons
            }
        }
        // Step 1: Try native runtime click with resolved locator. A selection
        // callback can own both opening the control and choosing the option; in
        // that contract the semantic field label is not itself a clickable target.
        nativeClickAttempted = true;
        const containerSelector = this.activeContainer?.selector;
        let resolved;
        try {
            if (options.skipNativeTargetResolution) {
                nativeClickAttempted = false;
                nativeClickError = "selection_callback_owns_target_resolution";
            }
            else {
                const ordinalResolved = await resolveOrdinalSelectionOnPage(this.page, {
                    target: options.target,
                    actionIntent: options.actionIntent,
                    routeProfile: options.routeProfile,
                    expectedTarget: options.expectedTarget,
                });
                if (ordinalResolved) {
                    matchedLocatorStrategy = `ordinal_selection:${ordinalResolved.ordinal}:${ordinalResolved.domainTerm ?? "generic"}:${ordinalResolved.selector}`;
                    const previousUrlOrdinal = this.page.url();
                    try {
                        await withTimeout(ordinalResolved.locator.click({ timeout: this.config.actionTimeoutMs, noWaitAfter: true }), this.config.actionTimeoutMs, "ordinal click");
                    }
                    catch {
                        try {
                            await withTimeout(ordinalResolved.locator.click({ timeout: this.config.actionTimeoutMs, force: true, noWaitAfter: true }), this.config.actionTimeoutMs, "ordinal force click");
                        }
                        catch (ordinalForceError) {
                            try {
                                await withTimeout(ordinalResolved.locator.evaluate((el) => {
                                    el.click();
                                }), this.config.actionTimeoutMs, "ordinal dom click");
                                nativeClickError = undefined;
                            }
                            catch (ordinalDomError) {
                                nativeClickError = ordinalDomError instanceof Error ? ordinalDomError.message : String(ordinalDomError);
                            }
                        }
                    }
                    if (!nativeClickError) {
                        nativeClickSucceeded = true;
                        clickPath = "native_runtime";
                        fallbackUsed = "page";
                        await this.postActionStability(previousUrlOrdinal, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target);
                        if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
                            await this.refreshActiveContainer();
                        }
                        effectDetected = true;
                        console.log(`[ordinal-selection-runtime] ordinal=${ordinalResolved.ordinal} domainTerm=${ordinalResolved.domainTerm ?? "none"} ` +
                            `candidateCount=${ordinalResolved.candidateCount} selectedText="${ordinalResolved.text}" selectedLocator="${matchedLocatorStrategy}"`);
                    }
                }
                if (nativeClickSucceeded) {
                    // Ordinal selection handled without semantic matching.
                }
                else {
                    const hasStructuredCheckboxReference = Boolean(targetIdentity?.technicalTargetRefs.some((ref) => ref.startsWith("role:checkbox|")));
                    const parsedTargetRefs = targetIdentity ? (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(targetIdentity.technicalTargetRefs) : {};
                    const entityRowScope = rowScopeFromEntityScope(targetIdentity?.entityScope);
                    const structuredCheckboxResolution = hasStructuredCheckboxReference
                        ? await (0, target_resolver_1.resolveActionTarget)(this.page, await (0, page_scanner_1.scanCurrentPage)(this.page), options.target, {
                            actionType: "action_click",
                            recordingActionType: "check",
                            rowScope: entityRowScope ?? rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
                            rowRef: entityRowScope ? undefined : parsedTargetRefs.rowRef,
                            entityScope: targetIdentity?.entityScope,
                            rowRelation: targetIdentity?.rowRelation ?? undefined,
                        }).catch(() => undefined)
                        : undefined;
                    resolved = structuredCheckboxResolution?.status === "resolved" && structuredCheckboxResolution.locator
                        ? {
                            locator: structuredCheckboxResolution.locator,
                            strategy: structuredCheckboxResolution.locatorStrategy ?? "structured:grid-row-checkbox",
                            scope: "page",
                            visible: true,
                            enabled: true,
                            clickable: true,
                        }
                        : await resolvePromotedClickableLocator(this.page, options.target, {
                            containerLocator: containerSelector,
                            targetIdentity,
                            timeoutMs: this.config.actionTimeoutMs,
                            actionKind: options.actionIntent,
                            actionIntent: options.actionIntent
                        });
                    if (resolved && resolved.locator) {
                        matchedLocatorStrategy = resolved.strategy;
                        console.log(`[runtime:click-resolution] step=${options.stepIndex} target="${options.target}" strategy="${resolved.strategy}" scope=${resolved.scope}`);
                        // Dispatch the click separately from outcome observation. Waiting for Playwright's
                        // implicit navigation here can time out on SPA/in-place transitions even though the
                        // application received the click.
                        const clickResult = await clickPromotedLocatorWithBoundedReresolution(resolved, async () => resolvePromotedClickableLocator(this.page, options.target, {
                            containerLocator: containerSelector,
                            targetIdentity,
                            timeoutMs: this.config.actionTimeoutMs,
                            actionKind: options.actionIntent,
                            actionIntent: options.actionIntent,
                        }), this.config.actionTimeoutMs);
                        if (clickResult.reResolved)
                            matchedLocatorStrategy = `${resolved.strategy}:bounded_reresolution`;
                        resolved = { ...resolved, locator: clickResult.locator };
                        nativeClickSucceeded = true;
                        clickPath = "native_runtime";
                        fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
                        // Handle expected effects
                        await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target);
                        // Refresh active container if modal/form/dialog expected
                        if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
                            await this.refreshActiveContainer();
                        }
                        effectDetected = true;
                    }
                }
            }
        }
        catch (error) {
            if (isOrdinalSelectionActionIntent(options.actionIntent)) {
                nativeClickError = error instanceof Error ? error.message : String(error);
            }
            if (typeof resolved !== "undefined" && resolved?.locator) {
                const canSafeForceClick = await shouldUseSafeForceClick(this.page, resolved.locator, options, error);
                if (canSafeForceClick) {
                    try {
                        await withTimeout(resolved.locator.click({ timeout: this.config.actionTimeoutMs, force: true }), this.config.actionTimeoutMs, "native safe force click");
                        nativeClickSucceeded = true;
                        clickPath = "native_runtime";
                        fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
                        matchedLocatorStrategy = `${resolved.strategy}:safe_force_click`;
                        await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target);
                        if (expectedEffect === "modal_or_form_or_navigation" || expectedEffect === "ui_change") {
                            await this.refreshActiveContainer();
                        }
                        effectDetected = true;
                    }
                    catch (forceError) {
                        nativeClickError = forceError instanceof Error ? forceError.message : String(forceError);
                    }
                }
                else {
                    nativeClickError = error instanceof Error ? error.message : String(error);
                }
            }
            else {
                nativeClickError = error instanceof Error ? error.message : String(error);
            }
            // Continue to callback fallback
        }
        // Step 2: If native click didn't succeed, try callback POM fallback
        if (!nativeClickSucceeded) {
            callbackAttempted = true;
            try {
                await withTimeout(options.action(), this.config.actionTimeoutMs, "click callback");
                clickPath = "pom_callback";
                fallbackUsed = "callback";
                matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "callback" : matchedLocatorStrategy;
                // Handle expected effects
                await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target);
                if (expectedEffect !== "none")
                    await this.refreshActiveContainer();
                callbackSucceeded = true;
                effectDetected = true;
            }
            catch (error) {
                callbackError = error instanceof Error ? error.message : String(error);
                console.log(`[runtime:click-callback-failure] step=${options.stepIndex} target="${options.target}" error="${callbackError}"`);
                // Retry if enabled and not sensitive
                if (this.config.retryEnabled && !options.sensitive && !retryAttempted) {
                    retryAttempted = true;
                    try {
                        await withTimeout(options.action(), this.config.actionTimeoutMs, "click retry");
                        clickPath = "pom_callback";
                        await this.postActionStability(previousUrl, resolvedExpectedEffect, targetIdentity, beforeActionSnapshot, options.target);
                        if (expectedEffect !== "none")
                            await this.refreshActiveContainer();
                        callbackSucceeded = true;
                        effectDetected = true;
                    }
                    catch (retryError) {
                        callbackError = `Retry failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`;
                    }
                }
            }
        }
        // Step 3: Error handling with enhanced diagnostics
        if (!nativeClickSucceeded && !callbackSucceeded) {
            const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
            if (isOrdinalSelectionActionIntent(options.actionIntent)) {
                throw new Error(`ordinal_selection_no_safe_candidate: target="${options.target}" actionIntent="${options.actionIntent}" ` +
                    `currentUrl="${pageDiag.currentUrl}" visibleButtons=[${pageDiag.visibleButtons.join(", ")}] ` +
                    `visibleHeadings=[${pageDiag.visibleHeadings.join(", ")}] ` +
                    `reason="${nativeClickError || callbackError || "unknown"}"`);
            }
            const diagnostics = await captureDiagnosticsIfNeeded(this.page, {
                currentUrl: this.page.url(),
                actionIntent: options.actionIntent,
                target: options.target,
                stepIndex: options.stepIndex,
                timeoutMs: this.config.actionTimeoutMs,
                activeContainer: this.activeContainer?.descriptor,
                lastDialogMessage: this.lastDialogMessage,
                stability: pageDiag,
                retryAttempted,
                // New diagnostics
                clickPath,
                nativeClickAttempted,
                nativeClickSucceeded,
                nativeClickError,
                callbackAttempted,
                callbackSucceeded,
                callbackError,
                expectedEffect,
                effectDetected,
                fallbackUsed,
                matchedLocatorStrategy
            }, options.evidenceDir, this.config.captureDiagnostics);
            // Check for home reset/inactivity BEFORE throwing generic click error
            // This prevents semantic_target_not_found when the real issue is session timeout
            const homeResetFromDiagnostics = await detectHomeResetOrInactivity(this.page);
            if (homeResetFromDiagnostics.detected) {
                console.log(`[runtime:session_reset] detected from diagnostics before throw: reason="${homeResetFromDiagnostics.reason}" currentUrl="${homeResetFromDiagnostics.currentUrl}"`);
                if (replaySteps && replaySteps.length > 0) {
                    console.log(`[runtime:session_reset] attempting replay from diagnostics: steps=${replaySteps.length}`);
                    const replayResult = await this.safeReplayContext(replaySteps, options.stepIndex);
                    if (replayResult.success) {
                        console.log(`[runtime:session_reset] replay succeeded, retrying target="${options.target}"`);
                        // Retry the original action after successful replay
                        try {
                            if (options.actionIntent === "return_to_list" && options.lastSelectionReplay) {
                                await options.lastSelectionReplay();
                            }
                            await options.action();
                            await this.waitForPromotedUiStable(options.stepIndex, options.target);
                            return; // Success after replay
                        }
                        catch (retryError) {
                            // Retry failed, throw original error
                        }
                    }
                    else {
                        console.log(`[runtime:session_reset] replay failed: ${replayResult.reason}`);
                    }
                }
                // Throw session reset error instead of generic click error
                throw new Error(`session_reset_unrecoverable: Home reset detected but recovery failed. ` +
                    `reason="${homeResetFromDiagnostics.reason}" currentUrl="${homeResetFromDiagnostics.currentUrl}" ` +
                    `stepIndex=${options.stepIndex} target="${options.target}" actionIntent="${options.actionIntent}" ` +
                    `previousStepsCount=${replaySteps?.length || 0} ` +
                    `suggestedFix="Regenerate spec with previousSteps metadata or increase session timeout"`);
            }
            await this.captureClickStep(options.target, "failed", `clickPath=${clickPath} native=${nativeClickError || "?"} callback=${callbackError || "?"}`, options.stepIndex);
            throw new Error(`Promoted click failed at step ${options.stepIndex} target="${options.target}". ` +
                `clickPath=${clickPath} nativeClickAttempted=${nativeClickAttempted} nativeClickSucceeded=${nativeClickSucceeded} ` +
                `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
                `retryAttempted=${String(retryAttempted)} diagnostics=${JSON.stringify(diagnostics)}`);
        }
        // Capture evidence after successful click
        await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
    }
    async fillPromotedField(options) {
        await this.markBoundaryProgress();
        await this.ensureInitialEvidence();
        const resolvedField = resolvePromotedFieldTarget(options);
        const masked = maskIfSensitive(options.value, options.sensitive);
        const targetIdentity = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(options.stepIndex, resolvedField, {
            valueKey: options.valueKey,
            technicalTargetRefs: options.technicalTargetRefs,
        }) ?? {
            valueKey: options.valueKey,
            technicalTargetRefs: options.technicalTargetRefs ?? [],
            entityScope: options.entityScope,
            targetIdentity: options.targetIdentity,
            surfaceIdentity: options.surfaceIdentity,
            containerIdentity: options.containerIdentity,
            fieldIdentity: options.fieldIdentity,
        };
        if (targetIdentity.technicalTargetRefs.length > 0 || targetIdentity.valueKey) {
            console.log(`[runtime:field-resolution] step=${options.stepIndex} field="${resolvedField}" ` +
                `valueKey="${targetIdentity.valueKey ?? "none"}" ` +
                `technicalTargetRefs=${targetIdentity.technicalTargetRefs.join(",") || "none"} ` +
                `surface="${targetIdentity.surfaceIdentity ?? "none"}" ` +
                `container="${targetIdentity.containerIdentity ?? "none"}" ` +
                `fieldIdentity="${targetIdentity.fieldIdentity ?? "none"}"`);
        }
        const previousActiveContainer = this.activeContainer?.descriptor;
        const refresh = await this.refreshActiveContainerForField(resolvedField);
        const refreshedActiveContainer = this.activeContainer?.descriptor;
        const searchedContainers = refresh.candidates.length;
        // Validate screen context before executing context-dependent actions
        await validateScreenContextForAction(this.page, {
            target: resolvedField,
            actionIntent: options.actionIntent ?? "fill_form_field",
            stepIndex: options.stepIndex
        });
        // New diagnostics for native fill tracking
        let fillPath = "failed";
        let nativeFillAttempted = false;
        let nativeFillSucceeded = false;
        let nativeFillError;
        let callbackAttempted = false;
        let callbackSucceeded = false;
        let callbackError;
        let verificationAttempted = false;
        let verificationSucceeded = false;
        let verificationSkippedReason;
        let fallbackUsed = "none";
        let matchedLocatorStrategy = "unknown";
        // Step 1: Try native runtime fill with resolved locator
        if ((refresh.best && refresh.best.matchingFieldFound) || targetIdentity.technicalTargetRefs.length > 0) {
            nativeFillAttempted = true;
            const containerSelector = refresh.best?.selector;
            try {
                const parsedTargetRefs = (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(targetIdentity.technicalTargetRefs);
                const entityRowScope = rowScopeFromEntityScope(targetIdentity.entityScope);
                const structuralResolution = (entityRowScope || parsedTargetRefs.rowRef)
                    ? await (0, target_resolver_1.resolveActionTarget)(this.page, await (0, page_scanner_1.scanCurrentPage)(this.page), resolvedField, {
                        actionType: "action_fill",
                        recordingActionType: "fill",
                        rowScope: entityRowScope ?? rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
                        rowRef: entityRowScope ? undefined : parsedTargetRefs.rowRef,
                        entityScope: targetIdentity.entityScope,
                        associatedField: resolvedField,
                    }).catch(() => undefined)
                    : undefined;
                const resolved = structuralResolution?.status === "resolved" && structuralResolution.locator
                    ? {
                        locator: structuralResolution.locator,
                        strategy: structuralResolution.locatorStrategy ?? "structured:grid-cell-editor",
                        scope: "page",
                        visible: true,
                        enabled: true,
                        editable: true,
                    }
                    : await resolvePromotedFieldLocator(this.page, resolvedField, {
                        containerLocator: refresh.best ? containerSelector : undefined,
                        targetIdentity,
                        timeoutMs: this.config.actionTimeoutMs
                    });
                if (resolved && resolved.locator) {
                    matchedLocatorStrategy = resolved.strategy;
                    // Fill with options.value (the hydrated value)
                    await withTimeout(resolved.locator.fill(options.value), this.config.actionTimeoutMs, "native fill");
                    nativeFillSucceeded = true;
                    fillPath = "native_runtime";
                    fallbackUsed = resolved.scope === "container" ? "active_container" : "page";
                    // Verify fill when safe (non-sensitive)
                    if (!options.sensitive) {
                        verificationAttempted = true;
                        try {
                            const filledValue = await resolved.locator.inputValue({ timeout: 2000 });
                            if (filledValue === options.value) {
                                verificationSucceeded = true;
                            }
                            else {
                                verificationSkippedReason = "value_mismatch";
                            }
                        }
                        catch {
                            verificationSkippedReason = "verification_unavailable";
                        }
                    }
                    else {
                        verificationSkippedReason = "sensitive_value";
                    }
                }
            }
            catch (error) {
                nativeFillError = error instanceof Error ? error.message : String(error);
                // Continue to callback fallback
            }
        }
        // Step 2: If native fill didn't succeed, try callback POM fallback
        if (!nativeFillSucceeded) {
            callbackAttempted = true;
            if (options.ensureEditable) {
                try {
                    await withTimeout(options.ensureEditable(), this.config.actionTimeoutMs, "fill editable check");
                }
                catch (error) {
                    callbackError = `Editable check failed: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
            if (!callbackSucceeded && callbackError === undefined) {
                if (this.activeContainer && options.fillInActiveContainer) {
                    try {
                        await withTimeout(options.fillInActiveContainer(), this.config.actionTimeoutMs, "fill active container");
                        callbackSucceeded = true;
                        fillPath = "pom_callback";
                        fallbackUsed = previousActiveContainer === refreshedActiveContainer ? "active_container" : "refreshed_container";
                        matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "active_container" : matchedLocatorStrategy;
                    }
                    catch (error) {
                        callbackError = `Active container fill failed: ${error instanceof Error ? error.message : String(error)}`;
                    }
                }
            }
            if (!callbackSucceeded && callbackError === undefined) {
                if (options.fillInPage) {
                    try {
                        await withTimeout(options.fillInPage(), this.config.actionTimeoutMs, "fill page fallback");
                        callbackSucceeded = true;
                        fillPath = "pom_callback";
                        fallbackUsed = "page";
                        matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "page_fallback" : matchedLocatorStrategy;
                    }
                    catch (error) {
                        callbackError = `Page fill failed: ${error instanceof Error ? error.message : String(error)}`;
                    }
                }
            }
            if (!callbackSucceeded && callbackError === undefined && options.fill) {
                try {
                    await withTimeout(options.fill(), this.config.actionTimeoutMs, "fill action");
                    callbackSucceeded = true;
                    fillPath = "pom_callback";
                    fallbackUsed = "page";
                    matchedLocatorStrategy = matchedLocatorStrategy === "unknown" ? "fill_callback" : matchedLocatorStrategy;
                }
                catch (error) {
                    callbackError = `Fill callback failed: ${error instanceof Error ? error.message : String(error)}`;
                }
            }
            if (!callbackSucceeded && callbackError === undefined) {
                callbackError = "No fill callback available";
            }
        }
        // Commit dynamic editors before the next action.  Grid cells commonly keep
        // the last value in a focused editor until blur, which can leave a valid
        // action button disabled even though the DOM displays the hydrated value.
        // This is intentionally generic: it does not identify or hardcode a field.
        try {
            const focusedEditor = this.page.locator(":focus");
            if (await focusedEditor.count() === 1) {
                await focusedEditor.blur({ timeout: this.config.actionTimeoutMs });
            }
        }
        catch {
            // Blur is a best-effort commit signal; fill success remains authoritative.
        }
        // Step 3: Wait for UI stability
        try {
            await this.waitForPromotedUiStable(options.stepIndex, resolvedField);
        }
        catch (error) {
            // Don't fail the fill, but log it
            verificationSkippedReason = "stability_check_failed";
        }
        // Step 4: Error handling with enhanced diagnostics
        if (!nativeFillSucceeded && !callbackSucceeded) {
            const diagnostics = await captureDiagnosticsIfNeeded(this.page, {
                currentUrl: this.page.url(),
                actionIntent: "fill",
                target: resolvedField,
                stepIndex: options.stepIndex,
                timeoutMs: this.config.actionTimeoutMs,
                activeContainer: this.activeContainer?.descriptor,
                lastDialogMessage: this.lastDialogMessage,
                retryAttempted: false,
                previousActiveContainer: previousActiveContainer ?? "none",
                refreshedActiveContainer: refreshedActiveContainer ?? "none",
                matchingFieldFound: refresh.best?.matchingFieldFound ?? false,
                fallbackUsed,
                searchedContainers,
                discardedReason: this.activeContainerDiscardReason ?? "none",
                matchedLocatorStrategy,
                valueKey: targetIdentity.valueKey,
                technicalTargetRefs: targetIdentity.technicalTargetRefs,
                targetIdentity: targetIdentity.targetIdentity,
                surfaceIdentity: targetIdentity.surfaceIdentity,
                containerIdentity: targetIdentity.containerIdentity,
                fieldIdentity: targetIdentity.fieldIdentity,
                fieldCandidateCount: refresh.candidates.reduce((count, candidate) => count + candidate.editableCount, 0),
                // New diagnostics
                fillPath,
                nativeFillAttempted,
                nativeFillSucceeded,
                nativeFillError,
                callbackAttempted,
                callbackSucceeded,
                callbackError,
                verificationAttempted,
                verificationSucceeded,
                verificationSkippedReason
            }, options.evidenceDir, this.config.captureDiagnostics);
            throw new Error(`Promoted fill failed at step ${options.stepIndex} field="${resolvedField}" value="${masked}". ` +
                `fillPath=${fillPath} nativeFillAttempted=${nativeFillAttempted} nativeFillSucceeded=${nativeFillSucceeded} ` +
                `callbackAttempted=${callbackAttempted} callbackSucceeded=${callbackSucceeded} ` +
                `diagnostics=${JSON.stringify(diagnostics)}`);
        }
    }
    async selectPromotedItem(options) {
        // Track selection step for post-selection detail verification
        this.lastSelectionStep = {
            selectedTarget: options.target,
            stepIndex: options.stepIndex,
            timestamp: Date.now()
        };
        await this.markBoundaryProgress();
        await this.ensureInitialEvidence();
        const targetIdentity = (0, promoted_field_target_contract_1.resolvePromotedFieldIdentityFromPersistedContract)(options.stepIndex, options.target, {
            valueKey: options.valueKey,
            technicalTargetRefs: options.technicalTargetRefs,
        });
        const runtimeValue = resolvePromotedRuntimeValue(targetIdentity?.valueKey ?? options.valueKey);
        const targetRefs = targetIdentity?.technicalTargetRefs ?? [];
        const parsedTargetRefs = (0, promoted_field_target_contract_1.parseTechnicalTargetRefs)(targetRefs);
        if (targetIdentity
            && runtimeValue
            && (parsedTargetRefs.semanticRole === "selection" || targetIdentity.semanticType === "selection")) {
            const previousUrl = this.page.url();
            let option = await resolvePromotedSelectionOption(this.page, runtimeValue, this.config.actionTimeoutMs);
            let openerStrategy = "already-open";
            if (!option) {
                const opener = await resolvePromotedClickableLocator(this.page, options.target, {
                    targetIdentity,
                    timeoutMs: this.config.actionTimeoutMs,
                    actionKind: "button",
                    actionIntent: "select",
                });
                if (!opener?.locator) {
                    throw new Error(`structured_selection_control_unresolved: stepIndex=${options.stepIndex} `
                        + `target="${options.target}" valueKey="${targetIdentity.valueKey ?? "none"}"`);
                }
                openerStrategy = opener.strategy;
                await withTimeout(opener.locator.click({ timeout: this.config.actionTimeoutMs }), this.config.actionTimeoutMs, "structured selection opener");
                const waitCandidates = [
                    this.page.getByRole("option", { name: runtimeValue, exact: true }),
                    this.page.getByText(runtimeValue, { exact: true }),
                ];
                for (const waitCandidate of waitCandidates) {
                    await waitCandidate.waitFor({ state: "visible", timeout: this.config.actionTimeoutMs }).catch(() => undefined);
                }
                option = await resolvePromotedSelectionOption(this.page, runtimeValue, this.config.actionTimeoutMs);
            }
            if (!option) {
                // Reuse the canonical structured resolver for keyboard/typeahead
                // selections whose option surface is not present in the DOM. The
                // generated callback remains out of authority for this path.
                const selectionField = (0, promoted_field_target_contract_1.semanticNameFromRef)(parsedTargetRefs.headerRef)
                    ?? (0, promoted_field_target_contract_1.semanticNameFromRef)(parsedTargetRefs.cellRef)
                    ?? options.target;
                const structuredResolution = await (0, target_resolver_1.resolveActionTarget)(this.page, await (0, page_scanner_1.scanCurrentPage)(this.page), options.target, {
                    actionType: "action_select",
                    recordingActionType: "select",
                    selectionField,
                    selectionValue: runtimeValue,
                    rowScope: rowScopeFromPromotedRef(parsedTargetRefs.rowRef),
                    rowRef: parsedTargetRefs.rowRef,
                    entityScope: targetIdentity.entityScope,
                    associatedField: selectionField,
                }).catch(() => undefined);
                if (structuredResolution?.status === "resolved" && structuredResolution.selectionApplied) {
                    await this.postActionStability(previousUrl, "none");
                    console.log(`[runtime:selection-resolution] step=${options.stepIndex} target="${options.target}" `
                        + `valueKey="${targetIdentity.valueKey ?? "none"}" `
                        + `openerStrategy="${openerStrategy}" `
                        + `optionStrategy="${structuredResolution.locatorStrategy ?? "selection_keyboard_typeahead"}" `
                        + `callbackSuppressed=true`);
                    await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
                    return;
                }
                throw new Error(`structured_selection_option_unresolved: stepIndex=${options.stepIndex} `
                    + `target="${options.target}" valueKey="${targetIdentity.valueKey ?? "none"}"`);
            }
            await withTimeout(option.locator.click({ timeout: this.config.actionTimeoutMs }), this.config.actionTimeoutMs, "structured selection option");
            await this.postActionStability(previousUrl, "none");
            console.log(`[runtime:selection-resolution] step=${options.stepIndex} target="${options.target}" `
                + `valueKey="${targetIdentity.valueKey ?? "none"}" openerStrategy="${openerStrategy}" `
                + `optionStrategy="${option.strategy}" callbackSuppressed=true`);
            await this.captureClickStep(options.target, "passed", undefined, options.stepIndex);
            return;
        }
        await this.clickPromotedTarget({
            ...options,
            actionIntent: "select",
            expectedEffect: options.expectedEffect ?? "none",
            skipNativeTargetResolution: true,
        });
    }
    async expectPromotedVisible(options) {
        this.authBoundary.oracleEvaluationStarted = true;
        await this.ensureInitialEvidence();
        const stepText = options.description?.trim() || `Validar que se muestre "${options.target}".`;
        try {
            if (options.polarity !== "positive" && options.polarity !== "negative") {
                throw new Error("PROMOTED_ASSERTION_POLARITY_UNRESOLVED");
            }
            if (options.polarity === "negative" && !options.expectedUrl) {
                throw new Error("PROMOTED_ASSERTION_DESCRIPTOR_UNRESOLVED");
            }
            if (options.expectedUrl) {
                const stateMatches = evaluatePromotedAssertionState(this.page.url(), options);
                if (!stateMatches)
                    throw new Error("PROMOTED_ASSERTION_STATE_MISMATCH");
            }
            else {
                await withTimeout(options.assertion(), this.config.actionTimeoutMs, "assert visible");
            }
            await this.captureEvidenceStep(stepText, "passed", undefined, {
                sourceStepIndex: options.stepIndex,
                target: options.target
            });
        }
        catch (error) {
            await this.captureEvidenceStep(stepText, "failed", error instanceof Error ? error.message : String(error), {
                sourceStepIndex: options.stepIndex,
                target: options.target
            });
            const diagnostics = await captureDiagnosticsIfNeeded(this.page, {
                currentUrl: this.page.url(),
                actionIntent: "assertVisible",
                target: options.target,
                stepIndex: options.stepIndex,
                timeoutMs: this.config.actionTimeoutMs,
                activeContainer: this.activeContainer?.descriptor,
                lastDialogMessage: this.lastDialogMessage,
                retryAttempted: false
            }, options.evidenceDir, this.config.captureDiagnostics);
            throw new Error(`Promoted assertion failed at step ${options.stepIndex} target="${options.target}". diagnostics=${JSON.stringify(diagnostics)} cause=${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async verifyDetailStateAfterSelection(nextTarget) {
        // Wait for potential navigation after selection
        await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => { });
        await this.page.waitForTimeout(1000);
        const pageDiag = await (0, promoted_spec_helpers_1.capturePageDiagnostics)(this.page);
        // Check if we're still on a list/subcategory page
        const listPageIndicators = [
            /selecciona/i, /elige/i, /select/i, /choose/i,
            /listado/i, /lista/i, /list/i,
            /subcategoria/i, /subcategory/i
        ];
        const isStillOnListPage = pageDiag.visibleHeadings.some(h => listPageIndicators.some(r => r.test(h)));
        // Check if primary action button is visible (detail page indicator)
        const primaryActionVisible = pageDiag.visibleButtons.some(b => b.toLowerCase().includes(nextTarget.toLowerCase()));
        // Check for detail page indicators
        const detailIndicators = [
            /detalle/i, /detail/i, /resumen/i, /summary/i,
            /información/i, /information/i, /datos/i
        ];
        const hasDetailHeading = pageDiag.visibleHeadings.some(h => detailIndicators.some(r => r.test(h)));
        // Consider it reached detail if:
        // 1. Primary action is visible, OR
        // 2. Has detail heading AND not on list page
        const reachedDetail = primaryActionVisible || (hasDetailHeading && !isStillOnListPage);
        return {
            reachedDetail,
            currentUrl: pageDiag.currentUrl,
            visibleButtons: pageDiag.visibleButtons,
            visibleHeadings: pageDiag.visibleHeadings
        };
    }
    async postActionStability(previousUrl, expectedEffect, targetIdentity, beforeSnapshot, target) {
        if (!this.config.enabled)
            return;
        if (expectedEffect === "none")
            return;
        const before = beforeSnapshot ?? await capturePromotedActionSurfaceSnapshot(this.page, target ?? "").catch(() => undefined);
        const startedAt = Date.now();
        let lastOutcome;
        while (Date.now() - startedAt < this.config.stabilityTimeoutMs) {
            const current = await capturePromotedActionSurfaceSnapshot(this.page, target ?? "").catch(() => undefined);
            if (current) {
                const routeChanged = current.url !== previousUrl;
                const domTransitionObserved = Boolean(before && before.signature !== current.signature);
                const targetDisappeared = Boolean(before?.targetVisible && !current.targetVisible);
                const newBusinessSurfaceObserved = routeChanged
                    || Boolean(before && (before.surfaceCount !== current.surfaceCount || before.signature !== current.signature));
                const inPlaceOutcomeObserved = !routeChanged && domTransitionObserved;
                lastOutcome = {
                    ...current,
                    navigationObserved: routeChanged,
                    routeChanged,
                    domTransitionObserved,
                    newBusinessSurfaceObserved,
                    inPlaceOutcomeObserved,
                    targetDisappeared,
                };
                const outcomeSatisfied = expectedEffect === "navigation"
                    ? routeChanged
                    : expectedEffect === "modal_or_form_or_navigation"
                        ? routeChanged || domTransitionObserved
                        : domTransitionObserved;
                if (outcomeSatisfied) {
                    console.log(`[runtime:post-action] target="${target ?? "unknown"}" expectedEffect=${expectedEffect} ` +
                        `navigationObserved=${routeChanged} routeChanged=${routeChanged} domTransitionObserved=${domTransitionObserved} ` +
                        `newBusinessSurfaceObserved=${newBusinessSurfaceObserved} inPlaceOutcomeObserved=${inPlaceOutcomeObserved}`);
                    await this.waitForPromotedUiStable(-1, target ?? "post_action");
                    if (expectedEffect === "modal_or_form_or_navigation")
                        await this.refreshActiveContainer();
                    return;
                }
            }
            await this.page.waitForTimeout(100);
        }
        const reason = targetIdentity?.expectedRouteTransition
            ? "expected_route_transition_not_observed"
            : targetIdentity?.expectedInPlaceTransition
                ? "expected_in_place_transition_not_observed"
                : "no_observable_post_action_outcome";
        throw new Error(`Post-click stability check failed. expectedEffect=${expectedEffect} reason=${reason} ` +
            `target="${target ?? "unknown"}" previousUrl="${previousUrl}" currentUrl="${lastOutcome?.url ?? this.page.url()}"`);
    }
    async getDebugState() {
        return {
            activeContainer: this.activeContainer?.descriptor,
            lastDialogMessage: this.lastDialogMessage,
            discardReason: this.activeContainerDiscardReason
        };
    }
    async refreshActiveContainer() {
        const { best } = await findBestActiveContainerForField(this.page);
        if (!best) {
            this.activeContainer = undefined;
            return undefined;
        }
        this.activeContainer = { selector: best.selector, descriptor: best.descriptor };
        this.activeContainerDiscardReason = undefined;
        return best.descriptor;
    }
    async refreshActiveContainerForField(fieldName) {
        const existing = this.activeContainer;
        const scan = await findBestActiveContainerForField(this.page, fieldName);
        const containsExisting = existing
            ? scan.candidates.find((c) => c.descriptor === existing.descriptor && c.visible && c.editableCount > 0 && c.matchingFieldFound)
            : undefined;
        if (containsExisting) {
            this.activeContainerDiscardReason = undefined;
            return scan;
        }
        if (existing) {
            this.activeContainerDiscardReason = "stale_or_not_matching_field";
        }
        if (scan.best) {
            this.activeContainer = { selector: scan.best.selector, descriptor: scan.best.descriptor };
        }
        else {
            this.activeContainer = undefined;
        }
        return scan;
    }
}
exports.PromotedSpecRuntime = PromotedSpecRuntime;
exports.PROMOTED_SPEC_RUNTIME_PUBLIC_METHODS = [
    "clickPromotedTarget",
    "fillPromotedField",
    "selectPromotedItem",
    "expectPromotedVisible",
    "waitForPromotedUiStable",
    "handlePromotedDialogOrAlert",
    "safeReplayContext",
    "checkIfAlreadyOnListPage",
    "getDebugState",
    "finishEvidence"
];
function createPromotedSpecRuntime(page, config) {
    return new PromotedSpecRuntime(page, config);
}
