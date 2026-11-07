import assert from "node:assert/strict";
import test from "node:test";
import { isTargetTextVisibleInSnapshot } from "./target-text-visibility";

const normalize = (value: string) => value.trim().toLowerCase();

test("an input named only by its placeholder or accessible name is visible by that name", () => {
  assert.equal(isTargetTextVisibleInSnapshot([{ tag: "input", text: "", accessibleName: "Buscar" }], "Buscar", normalize), true);
  assert.equal(isTargetTextVisibleInSnapshot([{ tag: "input", text: "", placeholder: "Buscar" }], "buscar", normalize), true);
  assert.equal(isTargetTextVisibleInSnapshot([{ tag: "input", text: "", ariaLabel: "Buscar solicitud" }], "Buscar", normalize), true);
});

test("the previous matches still match and unrelated or empty targets never do", () => {
  assert.equal(isTargetTextVisibleInSnapshot([{ text: "Siguiente" }], "Siguiente", normalize), true);
  assert.equal(isTargetTextVisibleInSnapshot([{ label: "Usuario" }], "Usuario", normalize), true);
  assert.equal(isTargetTextVisibleInSnapshot([{ text: "Cerrar", accessibleName: "Cerrar" }], "Buscar", normalize), false);
  assert.equal(isTargetTextVisibleInSnapshot([{ text: "Cerrar" }], "", normalize), false);
  assert.equal(isTargetTextVisibleInSnapshot(undefined, "Buscar", normalize), false);
});
