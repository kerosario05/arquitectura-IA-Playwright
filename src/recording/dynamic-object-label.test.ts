import assert from "node:assert/strict";
import test from "node:test";
import { isDynamicObjectDisplayLabel } from "./canonical-recording-contract";

const card = (label: string) => ({ label, tag: "div", locators: [], playwrightRecorderEvidence: { kind: "text", normalizedName: label, targetTag: "div", runtimeResolutionRequired: true } }) as any;

test("a product card whose text includes a price is not an object identity", () => {
  assert.equal(isDynamicObjectDisplayLabel(card("PRESTAMO CONSUMO MAPFRERD$222.72")), false);
});

test("a person-shaped card is still dynamic", () => {
  assert.equal(isDynamicObjectDisplayLabel(card("Juan Perez Gomez")), true);
});
