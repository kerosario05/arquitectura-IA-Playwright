import assert from "node:assert/strict";
import test from "node:test";
import { parseProductConditionTarget, resolveProductConditionAgainstSnapshot } from "./product-condition-parser";

test("exact product identity is independent of candidate order across vocabularies", () => {
  for (const [target, unrelated] of [["Cuentas Propias", "Cuenta de consulta"], ["Account settings", "Account overview"]]) {
    const entries = [
      { id: "other", text: unrelated, tagName: "a", visible: true },
      { id: "intended", text: target, tagName: "a", visible: true },
    ];
    for (const elements of [entries, [...entries].reverse()]) {
      const result = resolveProductConditionAgainstSnapshot({ elements }, parseProductConditionTarget(target)!, target);
      assert.equal(result.status, "resolved");
      assert.equal(result.matches[result.selectedIndex]?.elementId, "intended");
    }
  }
});

test("generic product and duplicate exact labels do not manufacture selection authority", () => {
  for (const [target, labels] of [["Cuenta", ["Cuenta A", "Cuenta B"]], ["Cuenta A", ["Cuenta A", "Cuenta A"]]] as const) {
    const result = resolveProductConditionAgainstSnapshot({ elements: labels.map((text, index) => ({
      id: `candidate-${index}`, text, tagName: "a", visible: true,
    })) }, parseProductConditionTarget(target)!, target);
    assert.equal(result.status, "multiple");
    assert.equal(result.selectedIndex, -1);
  }
});

test("unique conditional products retain type/status filtering and hidden products stay excluded", () => {
  const result = resolveProductConditionAgainstSnapshot({ elements: [
    { id: "hidden", text: "Cuenta activa", tagName: "a", visible: false },
    { id: "blocked", text: "Cuenta bloqueada", tagName: "a", visible: true },
    { id: "active", text: "Cuenta activa de prueba", tagName: "a", visible: true },
  ] }, parseProductConditionTarget("Cuenta activa")!, "Cuenta activa");
  assert.equal(result.status, "resolved");
  assert.equal(result.matches[result.selectedIndex]?.elementId, "active");
});
