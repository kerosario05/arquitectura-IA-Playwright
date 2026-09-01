import { test, expect } from "@playwright/test";
import { buildStructuralFingerprint, buildTechnicalScreenKey } from "../src/explorer/page-scanner";

const element = (overrides: any = {}) => ({
  id: "runtime-id",
  type: "button",
  role: "button",
  tagName: "button",
  visible: true,
  candidateLocators: [],
  dataHints: [],
  ...overrides,
});

test("structural fingerprint ignores content and URL fragments", () => {
  const a = [element({ text: "Alpha", label: "One" }), element({ type: "input", tagName: "input", inputType: "text" })];
  const b = [element({ text: "Completely different", label: "Two" }), element({ type: "input", tagName: "input", inputType: "text" })];
  expect(buildStructuralFingerprint(a)).toBe(buildStructuralFingerprint(b));
  expect(buildStructuralFingerprint(a)).not.toBe(buildStructuralFingerprint([element({}), element({ type: "input", tagName: "input", inputType: "password" })]));
});

test("technical screen key is route-and-structure technical evidence", () => {
  const fingerprint = buildStructuralFingerprint([element()]);
  expect(buildTechnicalScreenKey("https://example.test/screen?id=1#x", fingerprint))
    .toBe(buildTechnicalScreenKey("https://example.test/screen?id=999#y", fingerprint));
  expect(buildTechnicalScreenKey("https://example.test/route-one", fingerprint))
    .not.toBe(buildTechnicalScreenKey("https://example.test/route-two", fingerprint));
  expect(buildTechnicalScreenKey("https://example.test/screen", fingerprint))
    .not.toBe(buildTechnicalScreenKey("https://example.test/screen", `${fingerprint}-changed`));
});
