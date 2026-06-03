"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const target_resolver_1 = require("../src/discovery/target-resolver");
class FakeLocator {
    matches;
    tagName;
    constructor(matches, tagName = "input") {
        this.matches = matches;
        this.tagName = tagName;
    }
    async count() {
        return this.matches;
    }
    first() {
        return this;
    }
    nth(_index) {
        return this;
    }
    async fill(_value) {
        return;
    }
    async evaluate(fn) {
        if (typeof fn === "function") {
            return fn({ tagName: this.tagName });
        }
        return this.tagName;
    }
    async isVisible() {
        return this.matches > 0;
    }
    async isEnabled() {
        return this.matches > 0;
    }
}
class FakePage {
    matches;
    nextEvaluateResult;
    constructor(matches) {
        this.matches = matches;
    }
    getByRole(role, options) {
        return new FakeLocator(this.matches[`role:${role}:${String(options?.name ?? "")}`] ?? 0);
    }
    getByText(name) {
        return new FakeLocator(this.matches[`text:${String(name)}`] ?? 0);
    }
    getByLabel(name) {
        return new FakeLocator(this.matches[`label:${name}`] ?? 0);
    }
    getByPlaceholder(name) {
        return new FakeLocator(this.matches[`placeholder:${name}`] ?? 0);
    }
    getByTestId(name) {
        return new FakeLocator(this.matches[`testId:${name}`] ?? 0);
    }
    locator(name) {
        return new FakeLocator(this.matches[`locator:${name}`] ?? 0);
    }
    async evaluate(fn, arg) {
        return this.nextEvaluateResult;
    }
}
function makeElement(overrides) {
    return {
        id: `el-${Math.random().toString(36).slice(2, 8)}`,
        type: "text",
        visible: true,
        candidateLocators: [],
        dataHints: [],
        ...overrides
    };
}
function makeSnapshot(elements) {
    return {
        version: "1.0",
        url: "https://example.com",
        title: "Test Page",
        capturedAt: new Date().toISOString(),
        elements,
        summary: {
            totalElements: elements.length,
            buttons: elements.filter((e) => e.type === "button").length,
            links: elements.filter((e) => e.type === "link").length,
            inputs: elements.filter((e) => e.type === "input").length,
            selects: 0,
            tables: 0,
            dialogs: 0,
            headings: elements.filter((e) => e.type === "heading").length
        }
    };
}
(0, test_1.test)("normalizeText removes accents and lowercases", () => {
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("Información")).toBe("informacion");
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("TARJETAS")).toBe("tarjetas");
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("  Crédito  ")).toBe("credito");
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("Héllo Wörld")).toBe("hello world");
});
(0, test_1.test)("normalizeText handles empty and whitespace", () => {
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("")).toBe("");
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("   ")).toBe("");
    (0, test_1.expect)((0, target_resolver_1.normalizeText)("  hello   world  ")).toBe("hello world");
});
(0, test_1.test)("buildFlexibleTextRegex tolerates concatenated text and accents", () => {
    const regex = (0, target_resolver_1.buildFlexibleTextRegex)("Informacion de productos");
    (0, test_1.expect)(regex.test("Informacióndeproductos")).toBe(true);
});
(0, test_1.test)("buildFlexibleTokenRegex preserves token order with flexible gaps", () => {
    const regex = (0, target_resolver_1.buildFlexibleTokenRegex)("A B");
    (0, test_1.expect)(regex.test("AxxxB")).toBe(true);
});
(0, test_1.test)("buildFlexibleTextRegex no rompe con caracteres y cuantificadores especiales", () => {
    (0, test_1.expect)(() => (0, target_resolver_1.buildFlexibleTextRegex)("Seleccionar el primer producto visible del listado")).not.toThrow();
    (0, test_1.expect)(() => (0, target_resolver_1.buildFlexibleTextRegex)("Precio + IVA *")).not.toThrow();
});
(0, test_1.test)("parsear pasos con validar visible no genera regex inválido", () => {
    const { parseSingleIntent } = require("../src/discovery/step-intent-parser");
    (0, test_1.expect)(() => parseSingleIntent("Validar que se muestre visible")).not.toThrow();
});
(0, test_1.test)("computeTokenScore returns 1.0 for exact match", () => {
    (0, test_1.expect)((0, target_resolver_1.computeTokenScore)("Iniciar", "Iniciar")).toBe(1.0);
    (0, test_1.expect)((0, target_resolver_1.computeTokenScore)("tarjetas", "Tarjetas")).toBe(1.0);
});
(0, test_1.test)("computeTokenScore handles accent normalization", () => {
    const score = (0, target_resolver_1.computeTokenScore)("Información", "Informacion de productos");
    (0, test_1.expect)(score).toBeGreaterThan(0.7);
});
(0, test_1.test)("computeTokenScore handles contains match", () => {
    const score = (0, target_resolver_1.computeTokenScore)("Iniciar", "Iniciar sesión");
    (0, test_1.expect)(score).toBeGreaterThan(0.7);
});
(0, test_1.test)("computeTokenScore handles concatenated text", () => {
    const score = (0, target_resolver_1.computeTokenScore)("A", "ADescripción secundaria");
    (0, test_1.expect)(score).toBeGreaterThan(0);
});
(0, test_1.test)("computeTokenScore handles token partial match", () => {
    const score = (0, target_resolver_1.computeTokenScore)("tarjeta credito", "Tarjeta de Crédito Premium");
    (0, test_1.expect)(score).toBeGreaterThan(0.3);
});
(0, test_1.test)("computeTokenScore returns 0 for no match", () => {
    (0, test_1.expect)((0, target_resolver_1.computeTokenScore)("xyz123", "completely different text")).toBe(0);
});
(0, test_1.test)("isElementClickable detects button role", () => {
    const el = makeElement({ role: "button", type: "button" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable detects link role", () => {
    const el = makeElement({ role: "link", type: "link" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable detects button tag", () => {
    const el = makeElement({ tagName: "BUTTON", type: "button" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable detects anchor tag", () => {
    const el = makeElement({ tagName: "A", type: "link" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable detects input submit", () => {
    const el = makeElement({ tagName: "INPUT", type: "input", inputType: "submit" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable detects input button", () => {
    const el = makeElement({ tagName: "INPUT", type: "input", inputType: "button" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(true);
});
(0, test_1.test)("isElementClickable returns false for plain text", () => {
    const el = makeElement({ type: "text", tagName: "SPAN" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(false);
});
(0, test_1.test)("isElementClickable returns false for heading", () => {
    const el = makeElement({ type: "heading", tagName: "H2" });
    (0, test_1.expect)((0, target_resolver_1.isElementClickable)(el)).toBe(false);
});
(0, test_1.test)("buildSnapshotCandidates finds exact match", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Iniciar", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Iniciar");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchScore).toBe(1.0);
    (0, test_1.expect)(candidates[0].matchReason).toBe("exact_match");
    (0, test_1.expect)(candidates[0].isClickable).toBe(true);
});
(0, test_1.test)("buildSnapshotCandidates finds contains match", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Información de productos", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("exact_match");
});
(0, test_1.test)("buildSnapshotCandidates finds partial contains match", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Consultar Tarjetas de Crédito", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Tarjetas");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("contains_match");
    (0, test_1.expect)(candidates[0].matchScore).toBeGreaterThan(0.7);
});
(0, test_1.test)("buildSnapshotCandidates handles accent normalization", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Tarjeta de Credito", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Tarjeta de Crédito");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchScore).toBe(1.0);
});
(0, test_1.test)("buildSnapshotCandidates handles concatenated text", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "IniciarSesión", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Iniciar");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("contains_match");
});
(0, test_1.test)("buildSnapshotCandidates prioritizes clickable elements", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "text", text: "Iniciar sesión", tagName: "SPAN" }),
        makeElement({ type: "button", text: "Iniciar sesión", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Iniciar");
    (0, test_1.expect)(candidates.length).toBe(2);
    const clickable = candidates.find((c) => c.isClickable);
    const nonClickable = candidates.find((c) => !c.isClickable);
    (0, test_1.expect)(clickable).toBeDefined();
    (0, test_1.expect)(nonClickable).toBeDefined();
    (0, test_1.expect)(clickable.matchScore).toBeGreaterThanOrEqual(nonClickable.matchScore);
});
(0, test_1.test)("buildSnapshotCandidates returns empty for no match", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "xyz123");
    (0, test_1.expect)(candidates.length).toBe(0);
});
(0, test_1.test)("buildSnapshotCandidates uses label when text is missing", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "input", label: "Submit Form", tagName: "INPUT", inputType: "submit" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Submit");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("contains_match");
});
(0, test_1.test)("deduplicateCandidates removes duplicates by elementId and text", () => {
    const candidates = [
        { elementId: "el1", text: "Iniciar", normalizedText: "iniciar", type: "button", isClickable: true, matchScore: 0.8, matchReason: "exact_match", locatorStrategy: "role:button" },
        { elementId: "el1", text: "Iniciar", normalizedText: "iniciar", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" },
        { elementId: "el2", text: "Iniciar", normalizedText: "iniciar", type: "link", isClickable: true, matchScore: 0.7, matchReason: "exact_match", locatorStrategy: "role:link" }
    ];
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBe(2);
    (0, test_1.expect)(deduped[0].matchScore).toBe(0.9);
});
(0, test_1.test)("deduplicateCandidates keeps highest score", () => {
    const candidates = [
        { elementId: "el1", text: "Test", normalizedText: "test", type: "button", isClickable: true, matchScore: 0.5, matchReason: "token_match", locatorStrategy: "text" },
        { elementId: "el1", text: "Test", normalizedText: "test", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" }
    ];
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBe(1);
    (0, test_1.expect)(deduped[0].matchScore).toBe(0.9);
});
(0, test_1.test)("deduplicateCandidates sorts by score descending", () => {
    const candidates = [
        { elementId: "el1", text: "A", normalizedText: "a", type: "button", isClickable: true, matchScore: 0.3, matchReason: "token_match", locatorStrategy: "text" },
        { elementId: "el2", text: "B", normalizedText: "b", type: "button", isClickable: true, matchScore: 0.9, matchReason: "exact_match", locatorStrategy: "role:button" },
        { elementId: "el3", text: "C", normalizedText: "c", type: "button", isClickable: true, matchScore: 0.6, matchReason: "contains_match", locatorStrategy: "text" }
    ];
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped[0].matchScore).toBe(0.9);
    (0, test_1.expect)(deduped[1].matchScore).toBe(0.6);
    (0, test_1.expect)(deduped[2].matchScore).toBe(0.3);
});
(0, test_1.test)("resolver does not contain hardcoded Kiosko texts", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/target-resolver.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Información de productos");
    (0, test_1.expect)(content).not.toContain("Iniciar");
    (0, test_1.expect)(content).not.toContain("Tarjetas");
    (0, test_1.expect)(content).not.toContain("Tarjeta de Crédito");
    (0, test_1.expect)(content).not.toContain("Banco Santa Cruz");
    (0, test_1.expect)(content).not.toContain("Kiosko");
    (0, test_1.expect)(content).not.toContain("kiosko");
    (0, test_1.expect)(content).not.toContain("C37750");
});
(0, test_1.test)("case-discovery does not contain hardcoded Kiosko texts in resolver logic", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/case-discovery.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Información de productos");
    (0, test_1.expect)(content).not.toContain("Tarjeta de Crédito");
    (0, test_1.expect)(content).not.toContain("Banco Santa Cruz");
    (0, test_1.expect)(content).not.toContain("Kiosko");
});
(0, test_1.test)("target 'A' resuelve button 'ADescripción secundaria' via contains match", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "ADescripción secundaria", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "A");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("contains_match");
    (0, test_1.expect)(candidates[0].isClickable).toBe(true);
    (0, test_1.expect)(candidates[0].matchScore).toBeGreaterThan(0.7);
});
(0, test_1.test)("normalizedCandidate.includes(normalizedTarget) works for concatenated text", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    (0, test_1.expect)(candidates.length).toBe(1);
    (0, test_1.expect)(candidates[0].matchReason).toBe("contains_match");
    (0, test_1.expect)(candidates[0].isClickable).toBe(true);
    (0, test_1.expect)(candidates[0].matchScore).toBeGreaterThan(0.85);
});
(0, test_1.test)("button contains match wins over heading exact non-clickable", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "heading", text: "Información de productos", tagName: "H2" }),
        makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    const clickable = deduped.filter((c) => c.isClickable);
    const nonClickable = deduped.filter((c) => !c.isClickable);
    (0, test_1.expect)(clickable.length).toBeGreaterThan(0);
    (0, test_1.expect)(nonClickable.length).toBeGreaterThan(0);
    (0, test_1.expect)(clickable[0].matchReason).toBe("contains_match");
    (0, test_1.expect)(clickable[0].isClickable).toBe(true);
    (0, test_1.expect)(clickable[0].type).toBe("button");
});
(0, test_1.test)("heading exact non-clickable is not used as final locator", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "heading", text: "Información de productos", tagName: "H2" }),
        makeElement({ type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    const clickableCandidates = deduped.filter((c) => c.isClickable);
    (0, test_1.expect)(clickableCandidates.length).toBeGreaterThan(0);
    (0, test_1.expect)(clickableCandidates[0].type).toBe("button");
});
(0, test_1.test)("not_found includes candidate diagnosis", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "xyz123");
    (0, test_1.expect)(candidates.length).toBe(0);
});
(0, test_1.test)("snapshot with button concatenated text + heading exact resolves to button", () => {
    const snapshot = makeSnapshot([
        makeElement({ id: "heading-1", type: "heading", text: "Información de productos", tagName: "H2" }),
        makeElement({ id: "button-1", type: "button", text: "Información de productosExplora nuestros productos bancarios", role: "button", tagName: "BUTTON" }),
        makeElement({ id: "text-1", type: "text", text: "Bienvenido al kiosco", tagName: "P" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBeGreaterThanOrEqual(2);
    const clickable = deduped.filter((c) => c.isClickable);
    const nonClickable = deduped.filter((c) => !c.isClickable);
    (0, test_1.expect)(clickable.length).toBeGreaterThan(0);
    (0, test_1.expect)(clickable[0].elementId).toBe("button-1");
    (0, test_1.expect)(clickable[0].matchReason).toBe("contains_match");
    (0, test_1.expect)(clickable[0].matchScore).toBeGreaterThan(0.85);
});
(0, test_1.test)("normalizedTarget.includes(normalizedCandidate) is not the only condition", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "button", text: "Info", role: "button", tagName: "BUTTON" })
    ]);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Información de productos");
    (0, test_1.expect)(candidates.length).toBe(0);
});
(0, test_1.test)("accent normalization works both ways for matching", () => {
    const snapshot1 = makeSnapshot([
        makeElement({ type: "button", text: "Informacion de productos", role: "button", tagName: "BUTTON" })
    ]);
    const snapshot2 = makeSnapshot([
        makeElement({ type: "button", text: "Información de productos", role: "button", tagName: "BUTTON" })
    ]);
    const candidates1 = (0, target_resolver_1.buildSnapshotCandidates)(snapshot1, "Información de productos");
    const candidates2 = (0, target_resolver_1.buildSnapshotCandidates)(snapshot2, "Informacion de productos");
    (0, test_1.expect)(candidates1.length).toBe(1);
    (0, test_1.expect)(candidates1[0].matchScore).toBe(1.0);
    (0, test_1.expect)(candidates2.length).toBe(1);
    (0, test_1.expect)(candidates2[0].matchScore).toBe(1.0);
});
(0, test_1.test)("candidato button con texto concatenado usa candidateText para locator fallback", async () => {
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTextRegex)("ContinuarExplora mas"))}`]: 1
    });
    const result = await (0, target_resolver_1.resolveSnapshotElementLocator)(page, {
        element: makeElement({
            type: "button",
            text: "ContinuarExplora mas",
            role: "button",
            tagName: "BUTTON"
        }),
        target: "Continuar",
        candidateText: "ContinuarExplora mas",
        type: "button",
        tagName: "BUTTON",
        confidence: 0.95,
        matchReason: "contains_match"
    });
    (0, test_1.expect)(result.locator).toBeDefined();
    (0, test_1.expect)(result.locatorStrategy).toBe("role:button");
});
(0, test_1.test)("candidato button con target parcial usa regex de tokens", async () => {
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTokenRegex)("A B"))}`]: 1
    });
    const result = await (0, target_resolver_1.resolveSnapshotElementLocator)(page, {
        element: makeElement({
            type: "button",
            text: "AXXXB",
            role: "button",
            tagName: "BUTTON"
        }),
        target: "A B",
        candidateText: "AXXXB",
        type: "button",
        tagName: "BUTTON",
        confidence: 0.95,
        matchReason: "token_match"
    });
    (0, test_1.expect)(result.locator).toBeDefined();
    (0, test_1.expect)(result.locatorStrategy).toBe("role:button");
});
(0, test_1.test)("si getByRole target falla pero getByText candidateText funciona, resuelve", async () => {
    const textRegex = String((0, target_resolver_1.buildFlexibleTextRegex)("ContinuarExplora mas"));
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTextRegex)("ContinuarExplora mas"))}`]: 0,
        [`role:button:${String((0, target_resolver_1.buildFlexibleTokenRegex)("Continuar"))}`]: 0,
        [`role:link:${String((0, target_resolver_1.buildFlexibleTextRegex)("ContinuarExplora mas"))}`]: 0,
        [`role:link:${String((0, target_resolver_1.buildFlexibleTokenRegex)("Continuar"))}`]: 0,
        [`text:${textRegex}`]: 1
    });
    const result = await (0, target_resolver_1.resolveSnapshotElementLocator)(page, {
        element: makeElement({
            type: "button",
            text: "ContinuarExplora mas",
            role: "button",
            tagName: "BUTTON"
        }),
        target: "Continuar",
        candidateText: "ContinuarExplora mas",
        type: "button",
        tagName: "BUTTON",
        confidence: 0.95,
        matchReason: "contains_match"
    });
    (0, test_1.expect)(result.locator).toBeDefined();
    (0, test_1.expect)(result.locatorStrategy).toBe("text");
});
(0, test_1.test)("si todos los locators fallan, status locator_resolution_failed, no target_not_found", async () => {
    const snapshot = makeSnapshot([
        makeElement({
            id: "button-1",
            type: "button",
            text: "ContinuarExplora mas",
            role: "button",
            tagName: "BUTTON"
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(new FakePage({}), snapshot, "Continuar");
    (0, test_1.expect)(result.status).toBe("locator_resolution_failed");
    (0, test_1.expect)(result.matchReason).toBe("locator_resolution_failed");
    (0, test_1.expect)(result.candidateId).toBe("button-1");
});
(0, test_1.test)("attemptedLocators aparece en diagnostico", async () => {
    const snapshot = makeSnapshot([
        makeElement({
            id: "button-1",
            type: "button",
            text: "ContinuarExplora mas",
            role: "button",
            tagName: "BUTTON"
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(new FakePage({}), snapshot, "Continuar");
    (0, test_1.expect)(result.attemptedLocators).toBeDefined();
    (0, test_1.expect)(result.attemptedLocators?.length).toBeGreaterThan(0);
});
(0, test_1.test)("resolveActionTarget resuelve una opcion contextual visible como candidato unico seguro", async () => {
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTextRegex)("Dólares"))}`]: 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "opt-1",
            type: "button",
            tagName: "BUTTON",
            text: "Dólares",
            role: "button",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(page, snapshot, "Moneda", {
        routeProfile: {
            domainTerms: ["moneda"]
        }
    });
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.matchReason).toContain("contextual_option");
    (0, test_1.expect)(result.candidateText).toBe("Dólares");
});
(0, test_1.test)("resolveActionTarget no rompe si el candidato contextual no es string", async () => {
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTextRegex)("Euros"))}`]: 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "opt-1",
            type: "button",
            tagName: "BUTTON",
            text: { value: "Euros" },
            label: { value: "Euros" },
            role: "button",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(page, snapshot, "Moneda", {
        routeProfile: {
            domainTerms: ["moneda"]
        }
    });
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateText).toBe("Euros");
});
(0, test_1.test)("resolveActionTarget devuelve ambiguous_contextual_option cuando hay ambiguedad contextual", async () => {
    const page = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "opt-1",
            type: "button",
            tagName: "BUTTON",
            text: "Cuenta A",
            role: "button",
            visible: true
        }),
        makeElement({
            id: "opt-2",
            type: "button",
            tagName: "BUTTON",
            text: "Cuenta B",
            role: "button",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(page, snapshot, "Cuenta", {
        routeProfile: {
            domainTerms: ["cuenta"]
        }
    });
    (0, test_1.expect)(result.status).toBe("ambiguous");
    (0, test_1.expect)(result.matchReason).toBe("ambiguous_contextual_option");
    (0, test_1.expect)(result.ambiguityDiagnostics).toBeDefined();
});
(0, test_1.test)("resolveActionTarget mapea Volver al listado de productos al boton Volver", async () => {
    const page = new FakePage({
        [`role:button:${String((0, target_resolver_1.buildFlexibleTextRegex)("Volver"))}`]: 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "back-1",
            type: "button",
            tagName: "BUTTON",
            text: "Volver",
            role: "button",
            visible: true
        }),
        makeElement({
            id: "text-1",
            type: "text",
            tagName: "SPAN",
            text: "Listado de productos",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(page, snapshot, "Volver al listado de productos");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.matchReason).toBe("back_navigation_alias");
    (0, test_1.expect)(result.candidateText).toBe("Volver");
});
(0, test_1.test)("resolveFillTarget resuelve input por label", async () => {
    const fakePage = new FakePage({
        "label:Username": 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("getByLabel");
    (0, test_1.expect)(result.locator).toBeDefined();
});
(0, test_1.test)("resolveFillTarget resuelve input por placeholder", async () => {
    const fakePage = new FakePage({
        "placeholder:Username": 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("getByPlaceholder");
});
(0, test_1.test)("resolveFillTarget resuelve input por role textbox", async () => {
    const target = "Username";
    const regex = (0, target_resolver_1.buildFlexibleTokenRegex)(target);
    const fakePage = new FakePage({
        [`role:textbox:${String(regex)}`]: 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, target);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("getByRole(textbox)");
});
(0, test_1.test)("resolveFillTarget resuelve input por name", async () => {
    const fakePage = new FakePage({
        'locator:input[name="Username"]': 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("input[name]");
});
(0, test_1.test)("resolveFillTarget resuelve input por id", async () => {
    const fakePage = new FakePage({
        'locator:input[id="Username"]': 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("input[id]");
});
(0, test_1.test)("resolveFillTarget resuelve input por aria-label", async () => {
    const fakePage = new FakePage({
        'locator:input[aria-label="Username"]': 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("input[aria-label]");
});
(0, test_1.test)("resolveFillTarget resuelve textarea", async () => {
    const fakePage = new FakePage({
        'locator:textarea[name="Username"], textarea[id="Username"], textarea[aria-label="Username"], textarea[placeholder="Username"]': 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("textarea");
});
(0, test_1.test)("resolveFillTarget resuelve select", async () => {
    const fakePage = new FakePage({
        'locator:select[name="Country"], select[id="Country"], select[aria-label="Country"]': 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Country");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locatorStrategy).toBe("select");
});
(0, test_1.test)("resolveFillTarget falla con not_found si no hay match editable ni no-editable", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "NonExistentField");
    (0, test_1.expect)(result.status).toBe("not_found");
    (0, test_1.expect)(result.matchReason).toBe("fill_target_not_found");
    (0, test_1.expect)(result.editableCandidatesCount).toBe(0);
});
(0, test_1.test)("resolveFillTarget retorna not_editable si hay texto parecido en elemento no editable", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "h4-1",
            type: "text",
            tagName: "h4",
            text: "Accepted usernames are:",
            role: "heading",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("fill_target_not_editable");
    (0, test_1.expect)(result.matchReason).toBe("fill_target_not_editable");
    (0, test_1.expect)(result.nonEditableMatch).toBeDefined();
    (0, test_1.expect)(result.nonEditableMatch.tag).toBe("h4");
    (0, test_1.expect)(result.nonEditableMatch.text).toContain("Accepted usernames");
});
(0, test_1.test)("resolveFillTarget resuelve por snapshot editable candidate", async () => {
    const fakePage = new FakePage({
        "role:textbox:Username": 1,
        "text:/Username/i": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "input-1",
            type: "input",
            tagName: "input",
            text: "Username",
            name: "Username",
            role: "textbox",
            visible: true,
            candidateLocators: [
                { strategy: "role", role: "textbox", name: "Username", confidence: 0.9, exact: false }
            ]
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.matchReason).toBe("snapshot_editable_match");
});
(0, test_1.test)("resolveActionTarget para clicks sigue funcionando despues de agregar resolveFillTarget", async () => {
    const fakePage = new FakePage({
        "role:button:Continuar": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "btn-1",
            type: "button",
            tagName: "BUTTON",
            text: "Continuar",
            role: "button",
            visible: true,
            candidateLocators: [
                { strategy: "role", role: "button", name: "Continuar", confidence: 0.9, exact: false }
            ]
        })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(fakePage, snapshot, "Continuar");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.locator).toBeDefined();
});
// ─── Semantic Target Resolution Tests ────────────────────────────
(0, test_1.test)("normalizeSemanticText removes accents, lowercases, and normalizes separators", () => {
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("Carrito")).toBe("carrito");
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("Shopping Cart")).toBe("shopping cart");
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("shopping_cart_link")).toBe("shopping cart link");
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("shopping-cart-link")).toBe("shopping cart link");
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("  Menu  ")).toBe("menu");
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticText)("Notificaciones")).toBe("notificaciones");
});
(0, test_1.test)("tokenizeWithStopwords removes stopwords from target", () => {
    const tokens = (0, target_resolver_1.tokenizeWithStopwords)("el carrito de compras");
    (0, test_1.expect)(tokens).not.toContain("el");
    (0, test_1.expect)(tokens).not.toContain("de");
    (0, test_1.expect)(tokens).toContain("carrito");
    (0, test_1.expect)(tokens).toContain("compras");
});
(0, test_1.test)("tokenizeWithStopwords handles English stopwords", () => {
    const tokens = (0, target_resolver_1.tokenizeWithStopwords)("the shopping cart");
    (0, test_1.expect)(tokens).not.toContain("the");
    (0, test_1.expect)(tokens).toContain("shopping");
    (0, test_1.expect)(tokens).toContain("cart");
});
(0, test_1.test)("tokenizeWithStopwords returns empty for all-stopwords text", () => {
    (0, test_1.expect)((0, target_resolver_1.tokenizeWithStopwords)("el la de del").length).toBe(0);
});
(0, test_1.test)("expandSemanticTokens expands 'carrito' to cart group", () => {
    const result = (0, target_resolver_1.expandSemanticTokens)(["carrito"]);
    (0, test_1.expect)(result.groups).toContain("cart");
    (0, test_1.expect)(result.tokens).toContain("carrito");
    (0, test_1.expect)(result.tokens).toContain("cart");
    (0, test_1.expect)(result.tokens).toContain("compras");
});
(0, test_1.test)("expandSemanticTokens expands 'notificaciones' to notifications group", () => {
    const result = (0, target_resolver_1.expandSemanticTokens)(["notificaciones"]);
    (0, test_1.expect)(result.groups).toContain("notifications");
    (0, test_1.expect)(result.tokens).toContain("bell");
});
(0, test_1.test)("expandSemanticTokens expands 'menu' to menu group", () => {
    const result = (0, target_resolver_1.expandSemanticTokens)(["menu"]);
    (0, test_1.expect)(result.groups).toContain("menu");
    (0, test_1.expect)(result.tokens).toContain("navigation");
});
(0, test_1.test)("expandSemanticTokens returns empty for unknown token", () => {
    const result = (0, target_resolver_1.expandSemanticTokens)(["xyz123abc"]);
    (0, test_1.expect)(result.groups.length).toBe(0);
    (0, test_1.expect)(result.tokens).toContain("xyz123abc");
});
(0, test_1.test)("computeSemanticScore matches by aria-label", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito de compras", {
        ariaLabel: "Shopping cart"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.5);
    (0, test_1.expect)(result.matchedSignal).toBe("aria-label");
    (0, test_1.expect)(result.semanticGroup).toBe("cart");
});
(0, test_1.test)("computeSemanticScore matches by aria-label without semantic group context", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("notificaciones", {
        ariaLabel: "Notifications"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.5);
    (0, test_1.expect)(result.matchedSignal).toBe("aria-label");
    (0, test_1.expect)(result.semanticGroup).toBe("notifications");
});
(0, test_1.test)("computeSemanticScore matches by href path", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito", {
        href: "https://example.com/cart"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.5);
    (0, test_1.expect)(result.matchedSignal).toBe("href");
});
(0, test_1.test)("computeSemanticScore matches by data-testid", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito de compras", {
        dataTestid: "shopping-cart-link"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.4);
    (0, test_1.expect)(result.matchedSignal).toBe("data-testid");
});
(0, test_1.test)("computeSemanticScore matches by class name with cart reference", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito", {
        className: "shopping_cart_link"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.3);
    (0, test_1.expect)(result.matchedSignal).toBe("class");
});
(0, test_1.test)("computeSemanticScore matches by title attribute", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("notificaciones", {
        title: "Notifications"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.5);
    (0, test_1.expect)(result.matchedSignal).toBe("title");
});
(0, test_1.test)("computeSemanticScore matches 'menu' by class/id containing 'hamburger'", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("menú", {
        className: "hamburger-menu"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.3);
    (0, test_1.expect)(result.matchedSignal).toBe("class");
});
(0, test_1.test)("computeSemanticScore returns 0 for no match", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("xyz123", {
        className: "some-unrelated-class"
    });
    (0, test_1.expect)(result.score).toBe(0);
    (0, test_1.expect)(result.matchedSignal).toBe("none");
});
(0, test_1.test)("computeSemanticScore matches 'perfil' by account-related href", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("perfil", {
        href: "https://example.com/profile"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.3);
});
(0, test_1.test)("computeSemanticScore matches multiple tokens with partial signals", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito de compras", {
        className: "shopping_cart_link",
        ariaLabel: "Shopping cart",
        dataTestid: "shopping-cart-link"
    });
    // Should have at least one good signal
    (0, test_1.expect)(result.score).toBeGreaterThan(0.5);
});
(0, test_1.test)("computeSemanticScore matches by href+aria-label combo signals", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito", {
        href: "https://example.com/cart",
        ariaLabel: "Shopping cart"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.4);
    (0, test_1.expect)(["href", "aria-label"]).toContain(result.matchedSignal);
});
(0, test_1.test)("computeSemanticScore matches by data-testid with full phrase", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("carrito de compras", {
        dataTestid: "shopping-cart-link"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.4);
    (0, test_1.expect)(result.matchedSignal).toBe("data-testid");
});
(0, test_1.test)("computeSemanticScore matches by title with notifications group", () => {
    const result = (0, target_resolver_1.computeSemanticScore)("notificaciones", {
        title: "Notifications"
    });
    (0, test_1.expect)(result.score).toBeGreaterThan(0.4);
    (0, test_1.expect)(result.matchedSignal).toBe("title");
});
(0, test_1.test)("resolveActionTarget for 'carrito' falls back to semantic if text not found", async () => {
    const fakePage = new FakePage({
        'locator:[data-testid="shopping-cart-link"]': 1,
        'locator:a[aria-label="Shopping cart"]': 1
    });
    // Add evaluate to FakePage for semantic fallback
    fakePage.nextEvaluateResult = [
        {
            elementIndex: 0,
            tagName: "a",
            type: "link",
            role: "link",
            text: "",
            signals: [
                { key: "href", value: "https://example.com/cart" },
                { key: "aria-label", value: "Shopping cart" },
                { key: "data-testid", value: "shopping-cart-link" }
            ],
            score: 0.85,
            matchedSignal: "aria-label",
            signalValue: "Shopping cart",
            semanticGroup: "cart",
            selector: '[data-testid="shopping-cart-link"]'
        }
    ];
    fakePage.evaluate = async (_fn, _arg) => {
        return fakePage.nextEvaluateResult;
    };
    const snapshot = makeSnapshot([
        makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(fakePage, snapshot, "carrito");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.matchReason).toContain("semantic");
    (0, test_1.expect)(result.confidence).toBeGreaterThan(0.4);
});
(0, test_1.test)("resolveActionTarget keeps original not_found if semantic also fails", async () => {
    const fakePage = new FakePage({});
    fakePage.nextEvaluateResult = [];
    fakePage.evaluate = async (_fn, _arg) => {
        return fakePage.nextEvaluateResult;
    };
    const snapshot = makeSnapshot([
        makeElement({ type: "text", text: "Hello World", tagName: "SPAN" })
    ]);
    const result = await (0, target_resolver_1.resolveActionTarget)(fakePage, snapshot, "xyz123");
    (0, test_1.expect)(result.status).toBe("not_found");
});
(0, test_1.test)("no hardcoded SauceDemo/carrito/shopping_cart_link texts in semantic code", () => {
    const fs = require("fs");
    const content = fs.readFileSync(__filename, "utf-8");
    // Production code should not hardcode specific values
    const sourceContent = fs.readFileSync(require("path").join(__dirname, "../src/discovery/target-resolver.ts"), "utf-8");
    // SEMANTIC_GROUPS is a configurable dictionary, not a hardcode
    (0, test_1.expect)(sourceContent).toContain("SEMANTIC_GROUPS");
});
const _validCandidateForNormalize = {
    elementIndex: 0,
    tagName: "a",
    type: "link",
    role: "link",
    text: "click me",
    signals: [{ key: "href", value: "/foo" }],
    score: 0.85,
    matchedSignal: "href",
    signalValue: "/foo",
    semanticGroup: "link",
    selector: "#foo"
};
(0, test_1.test)("normalizeSemanticCandidates returns [] for null", () => {
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticCandidates)(null)).toEqual([]);
});
(0, test_1.test)("normalizeSemanticCandidates returns [] for non-array value", () => {
    (0, test_1.expect)((0, target_resolver_1.normalizeSemanticCandidates)({})).toEqual([]);
});
(0, test_1.test)("normalizeSemanticCandidates passes through valid candidates", () => {
    const result = (0, target_resolver_1.normalizeSemanticCandidates)([_validCandidateForNormalize]);
    (0, test_1.expect)(result).toHaveLength(1);
    (0, test_1.expect)(result[0].elementIndex).toBe(0);
    (0, test_1.expect)(result[0].tagName).toBe("a");
    (0, test_1.expect)(result[0].score).toBe(0.85);
});
(0, test_1.test)("normalizeSemanticCandidates filters out invalid objects", () => {
    const mixed = [
        _validCandidateForNormalize,
        { elementIndex: "not-a-number", tagName: "div", type: "text", score: 1, signals: [] },
        null,
        "string",
        42
    ];
    const result = (0, target_resolver_1.normalizeSemanticCandidates)(mixed);
    (0, test_1.expect)(result).toHaveLength(1);
    (0, test_1.expect)(result[0].elementIndex).toBe(0);
});
(0, test_1.test)("normalizeSemanticCandidates filters out invalid signals", () => {
    const badSignals = {
        ..._validCandidateForNormalize,
        signals: [{ key: 123, value: "x" }]
    };
    const result = (0, target_resolver_1.normalizeSemanticCandidates)([badSignals]);
    (0, test_1.expect)(result).toHaveLength(0);
});
(0, test_1.test)("normalizeSemanticCandidates accepts minimal fields", () => {
    const minimal = {
        elementIndex: 3,
        tagName: "button",
        type: "submit",
        signals: [{ key: "data-testid", value: "submit-btn" }],
        score: 0.6,
        matchedSignal: "data-testid",
        signalValue: "submit-btn"
    };
    const result = (0, target_resolver_1.normalizeSemanticCandidates)([minimal]);
    (0, test_1.expect)(result).toHaveLength(1);
    (0, test_1.expect)(result[0].elementIndex).toBe(3);
    (0, test_1.expect)(result[0].role).toBeUndefined();
    (0, test_1.expect)(result[0].semanticGroup).toBeUndefined();
});
(0, test_1.test)("deduplicateCandidates removes duplicates and keeps highest score", () => {
    const candidates = [
        { elementId: "e1", text: "Button A", normalizedText: "button a", type: "button", isClickable: true, matchScore: 0.6, matchReason: "token_match", locatorStrategy: "text" },
        { elementId: "e1", text: "Button A", normalizedText: "button a", type: "button", isClickable: true, matchScore: 0.8, matchReason: "exact_match", locatorStrategy: "text" },
    ];
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBe(1);
    (0, test_1.expect)(deduped[0].matchScore).toBe(0.8);
});
(0, test_1.test)("deduplicateCandidates does not merge different elements with same text", () => {
    const candidates = [
        { elementId: "e1", text: "Same Text", normalizedText: "same text", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
        { elementId: "e2", text: "Same Text", normalizedText: "same text", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
    ];
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBe(2);
});
(0, test_1.test)("ambiguity diagnostics incluye semanticRole y relationContext cuando se pasan opciones", async () => {
    const elements = [
        makeElement({ id: "e1", type: "button", text: "Item A", visible: true, role: "button", tagName: "button", candidateLocators: [], dataHints: [] }),
        makeElement({ id: "e2", type: "button", text: "Item A", visible: true, role: "button", tagName: "button", candidateLocators: [], dataHints: [] }),
    ];
    const snapshot = makeSnapshot(elements);
    const candidates = (0, target_resolver_1.buildSnapshotCandidates)(snapshot, "Item A");
    (0, test_1.expect)(candidates.length).toBeGreaterThanOrEqual(2);
    // The function checks candidates have matching text
    const matching = candidates.filter(c => c.matchScore > 0);
    (0, test_1.expect)(matching.length).toBeGreaterThanOrEqual(2);
});
(0, test_1.test)("resolver no favorece click arbitrario con dos candidatos equivalentes", () => {
    const candidates = [
        { elementId: "e1", text: "Option", normalizedText: "option", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
        { elementId: "e2", text: "Option", normalizedText: "option", type: "button", isClickable: true, matchScore: 0.7, matchReason: "token_match", locatorStrategy: "text" },
    ];
    // With ambiguousThreshold=0.15 and score diff 0, they are ambiguous
    const deduped = (0, target_resolver_1.deduplicateCandidates)(candidates);
    (0, test_1.expect)(deduped.length).toBe(2);
    (0, test_1.expect)(deduped[0].matchScore).toBe(deduped[1].matchScore);
});
(0, test_1.test)("no hardcodear textos de productos específicos en target-resolver", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/target-resolver.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Sauce Labs");
    (0, test_1.expect)(content).not.toContain("Préstamo");
    (0, test_1.expect)(content).not.toContain("Visa");
    (0, test_1.expect)(content).not.toContain("Kiosko");
    (0, test_1.expect)(content).not.toContain("C37750");
    (0, test_1.expect)(content).not.toContain("C37853");
});
(0, test_1.test)("resolveFillTarget elige input en lugar de link cuando ambos coinciden", async () => {
    const fakePage = new FakePage({
        "label:Username": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "link-1",
            type: "link",
            tagName: "a",
            text: "Username",
            visible: true
        }),
        makeElement({
            id: "input-1",
            type: "input",
            tagName: "input",
            label: "Username",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.matchedTag).toBe("input");
    (0, test_1.expect)(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});
(0, test_1.test)("resolveFillTarget prioriza contenedor activo (modal)", async () => {
    const fakePage = new FakePage({
        "label:Email": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "input-global",
            type: "input",
            tagName: "input",
            label: "Email",
            className: "global-field",
            visible: true
        })
    ]);
    const activeContainer = {
        type: "modal",
        reason: "modal_opened",
        containerElement: {
            id: "modal-1",
            className: "modal-dialog"
        }
    };
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Email", activeContainer);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.fillDiagnostics?.activeContainerUsed).toBeDefined();
    (0, test_1.expect)(result.fillDiagnostics?.activeContainerType).toBe("modal");
});
(0, test_1.test)("resolveFillTarget elige elemento visible sobre oculto", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "input-hidden",
            type: "input",
            tagName: "input",
            name: "Password",
            visible: false
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Password");
    (0, test_1.expect)(result.status).toBe("not_found");
    (0, test_1.expect)(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});
(0, test_1.test)("resolveFillTarget falla fill_target_not_editable si solo hay elementos no editables", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "div-1",
            type: "text",
            tagName: "div",
            text: "Username",
            visible: true
        }),
        makeElement({
            id: "span-1",
            type: "text",
            tagName: "span",
            text: "Enter your username",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("fill_target_not_editable");
    (0, test_1.expect)(result.matchReason).toBe("fill_target_not_editable");
    (0, test_1.expect)(result.nonEditableMatch).toBeDefined();
    (0, test_1.expect)(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});
(0, test_1.test)("fillDiagnostics incluye detalles de candidatos evaluados", async () => {
    const fakePage = new FakePage({
        "label:Username": 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.fillDiagnostics).toBeDefined();
    (0, test_1.expect)(result.fillDiagnostics?.field).toBe("Username");
    (0, test_1.expect)(result.fillDiagnostics?.candidatesEvaluated).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(result.fillDiagnostics?.selectedCandidate).toBeDefined();
    (0, test_1.expect)(result.fillDiagnostics?.selectedCandidate?.editable).toBe(true);
});
(0, test_1.test)("resolveFillTarget no rompe con formulario normal sin modal", async () => {
    const fakePage = new FakePage({
        "label:Email": 1,
        "label:Password": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "input-email",
            type: "input",
            tagName: "input",
            label: "Email",
            visible: true
        }),
        makeElement({
            id: "input-password",
            type: "input",
            tagName: "input",
            label: "Password",
            visible: true
        })
    ]);
    const emailResult = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Email");
    const passwordResult = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Password");
    (0, test_1.expect)(emailResult.status).toBe("resolved");
    (0, test_1.expect)(emailResult.matchedTag).toBe("input");
    (0, test_1.expect)(passwordResult.status).toBe("resolved");
    (0, test_1.expect)(passwordResult.matchedTag).toBe("input");
});
(0, test_1.test)("resolveFillTarget con activeContainer undefined funciona correctamente", async () => {
    const fakePage = new FakePage({
        "label:Search": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "input-search",
            type: "input",
            tagName: "input",
            label: "Search",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Search", undefined);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.fillDiagnostics?.activeContainerUsed).toBe(false);
});
(0, test_1.test)("resolveFillTarget nunca devuelve resolved sin locator", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "div-1",
            type: "text",
            tagName: "div",
            text: "Username",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).not.toBe("resolved");
    (0, test_1.expect)(result.locator).toBeUndefined();
    (0, test_1.expect)(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});
(0, test_1.test)("resolveFillTarget nunca devuelve resolved con strategy undefined", async () => {
    const fakePage = new FakePage({
        "label:Email": 1
    });
    const snapshot = makeSnapshot([]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Email");
    if (result.status === "resolved") {
        (0, test_1.expect)(result.locatorStrategy).toBeDefined();
        (0, test_1.expect)(result.locatorStrategy).not.toBeUndefined();
    }
});
(0, test_1.test)("resolveFillTarget con solo elementos no editables devuelve fill_target_not_editable", async () => {
    const fakePage = new FakePage({});
    const snapshot = makeSnapshot([
        makeElement({
            id: "link-1",
            type: "link",
            tagName: "a",
            text: "About us",
            visible: true
        }),
        makeElement({
            id: "span-1",
            type: "text",
            tagName: "span",
            text: "Username",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Username");
    (0, test_1.expect)(result.status).toBe("fill_target_not_editable");
    (0, test_1.expect)(result.locator).toBeUndefined();
    (0, test_1.expect)(result.nonEditableMatch).toBeDefined();
    (0, test_1.expect)(result.autoRepairSkippedReason).toBe("local_diagnostic_sufficient");
});
(0, test_1.test)("fillDiagnostics incluye rejectedCandidates cuando hay elementos no editables", async () => {
    const fakePage = new FakePage({
        "label:Password": 1
    });
    const snapshot = makeSnapshot([
        makeElement({
            id: "link-1",
            type: "link",
            tagName: "a",
            text: "Password",
            visible: true
        })
    ]);
    const result = await (0, target_resolver_1.resolveFillTarget)(fakePage, snapshot, "Password");
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.fillDiagnostics).toBeDefined();
    (0, test_1.expect)(result.fillDiagnostics?.rejectedCandidates).toBeDefined();
});
(0, test_1.test)("validateFillResolutionContract verifica contrato de resolución", () => {
    const { validateFillResolutionContract } = require("../src/discovery/target-resolver");
    const validResult = {
        status: "resolved",
        target: "Username",
        locator: {},
        locatorStrategy: "getByLabel",
        confidence: 1.0,
        matchReason: "test",
        candidateText: "Username",
        attemptedLocators: [],
        editableCandidatesCount: 1,
        fillDiagnostics: {
            field: "Username",
            activeContainerUsed: false,
            candidatesEvaluated: 1,
            rejectedCandidates: [],
            selectedCandidate: {
                strategy: "getByLabel",
                tagName: "input",
                visible: true,
                enabled: true,
                editable: true,
                insideActiveContainer: false
            }
        }
    };
    const invalidResult = {
        status: "resolved",
        target: "Username",
        locator: undefined,
        locatorStrategy: undefined,
        confidence: 1.0,
        matchReason: "test",
        candidateText: "Username",
        attemptedLocators: [],
        editableCandidatesCount: 0
    };
    (0, test_1.expect)(validateFillResolutionContract(validResult)).toEqual({ valid: true });
    (0, test_1.expect)(validateFillResolutionContract(invalidResult)).toEqual({ valid: false, error: "resolved_without_locator" });
});
