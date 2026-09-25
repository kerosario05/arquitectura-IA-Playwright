"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const page_scanner_1 = require("../src/explorer/page-scanner");
const element = (overrides = {}) => ({
    id: "runtime-id",
    type: "button",
    role: "button",
    tagName: "button",
    visible: true,
    candidateLocators: [],
    dataHints: [],
    ...overrides,
});
(0, test_1.test)("structural fingerprint ignores content and URL fragments", () => {
    const a = [element({ text: "Alpha", label: "One" }), element({ type: "input", tagName: "input", inputType: "text" })];
    const b = [element({ text: "Completely different", label: "Two" }), element({ type: "input", tagName: "input", inputType: "text" })];
    (0, test_1.expect)((0, page_scanner_1.buildStructuralFingerprint)(a)).toBe((0, page_scanner_1.buildStructuralFingerprint)(b));
    (0, test_1.expect)((0, page_scanner_1.buildStructuralFingerprint)(a)).not.toBe((0, page_scanner_1.buildStructuralFingerprint)([element({}), element({ type: "input", tagName: "input", inputType: "password" })]));
});
(0, test_1.test)("technical screen key is route-and-structure technical evidence", () => {
    const fingerprint = (0, page_scanner_1.buildStructuralFingerprint)([element()]);
    (0, test_1.expect)((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/screen?id=1#x", fingerprint))
        .toBe((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/screen?id=999#y", fingerprint));
    (0, test_1.expect)((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/route-one", fingerprint))
        .not.toBe((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/route-two", fingerprint));
    (0, test_1.expect)((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/screen", fingerprint))
        .not.toBe((0, page_scanner_1.buildTechnicalScreenKey)("https://example.test/screen", `${fingerprint}-changed`));
});
