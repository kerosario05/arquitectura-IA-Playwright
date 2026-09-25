import assert from "node:assert/strict";
import test from "node:test";
import { resolveRecordedField } from "./semantic-recording";
import type { RecordedTarget } from "./session-trace.types";

/**
 * FIRST_LOSS: `resolveRecordedField`'s candidate list checked `target.associatedField`
 * ("explicit_associated_label") BEFORE the owner's own `label`. CaptureEngine V2's generic
 * `computeAssociatedField` (browser-instrumentation.ts) can legitimately populate `associatedField`
 * on ANY actionable owner sitting near a short sibling label, including one that already has its
 * own real accessible name -- it never checks whether the owner already has a usable name of its
 * own before recording the structural relation. With associatedField checked first, a real
 * "Iniciar sesión" button near a "Usuario" field label, or a real aria-label="Depurar" button near
 * "Salir"/"Cancelar" text, had its own real name overridden by that unrelated nearby text.
 * Fixed by moving `explicit_associated_label` to LAST in the candidate list: the owner's own real
 * name (and every other real context signal) is now always preferred; associatedField is
 * consulted only when nothing else -- including the owner's own label -- resolved to a usable
 * name.
 */

function target(overrides: Partial<RecordedTarget> & { label?: string }): RecordedTarget {
  return { locators: [], ...overrides } as RecordedTarget;
}

test("1/9. named button (Iniciar sesión) with a nearby unrelated field label: own accessibleName wins (Usuario/Login regression)", () => {
  const resolution = resolveRecordedField(target({ label: "Iniciar sesión", role: "button", associatedField: "Usuario" }));
  assert.equal(resolution.semanticField, "Iniciar sesión");
  assert.equal(resolution.reason, "stable_business_label");
});

test("2/10. aria-labelled button (Depurar) inside a noisy ancestor: own accessibleName wins (Depurar regression)", () => {
  const resolution = resolveRecordedField(target({ label: "Depurar", role: "button", associatedField: "SalirCancelar" }));
  assert.equal(resolution.semanticField, "Depurar");
  assert.equal(resolution.reason, "stable_business_label");
});

test("3. an option's own text is a SELECTED VALUE, not a field name -- associatedField (the actual field it belongs to) still wins for role=option, unchanged from before this fix (regression: semantic-recording.selection-admission.test.ts)", () => {
  const resolution = resolveRecordedField(target({ label: "DOP", role: "option", associatedField: "Moneda" }));
  assert.equal(resolution.semanticField, "Moneda");
});

test("4. combobox's own accessibleName wins over any associatedField", () => {
  const resolution = resolveRecordedField(target({ label: "Moneda", role: "combobox", associatedField: "Tipo de cambio" }));
  assert.equal(resolution.semanticField, "Moneda");
});

test("5. unnamed input (no usable own label) falls back to associatedField", () => {
  const resolution = resolveRecordedField(target({ label: "control", role: "input", associatedField: "Número de identificación" }));
  assert.equal(resolution.semanticField, "Número de identificación");
  assert.equal(resolution.reason, "explicit_associated_label");
});

test("6. unnamed icon button (no usable own label) falls back to associatedField", () => {
  const resolution = resolveRecordedField(target({ label: undefined, role: "button", associatedField: "Número de identificación" }));
  assert.equal(resolution.semanticField, "Número de identificación");
  assert.equal(resolution.reason, "explicit_associated_label");
});

test("11. Aceptar/Cancelar/Continuar keep their own identity even with an unrelated associatedField nearby", () => {
  for (const label of ["Aceptar", "Cancelar", "Continuar"]) {
    const resolution = resolveRecordedField(target({ label, role: "button", associatedField: "Some Unrelated Field" }));
    assert.equal(resolution.semanticField, label, `expected "${label}" to win over the associatedField`);
  }
});

test("12. no app/project-specific hardcode: the reordering is generic candidate-priority logic, verified with an arbitrary unrelated pair", () => {
  const resolution = resolveRecordedField(target({ label: "Cualquier Etiqueta Real", role: "button", associatedField: "Cualquier Campo Cercano" }));
  assert.equal(resolution.semanticField, "Cualquier Etiqueta Real");
});

test("associatedField never wins when the label is merely a format mask but IS the real content (regression: format-mask handling untouched)", () => {
  const resolution = resolveRecordedField(target({ label: "000-000-0000", headerContext: "Teléfono del colaborador", associatedField: "Some Other Field", role: "input" }));
  assert.equal(resolution.semanticField, "Teléfono del colaborador", "headerContext still outranks both a format-masked label and associatedField, unaffected by this reorder");
});

test("associatedField still wins over headerContext/containerContext when the owner has NO usable name at all (fallback ordering among non-label signals is unchanged)", () => {
  const resolution = resolveRecordedField(target({ label: "control", associatedField: "Número de identificación", role: "input" }));
  assert.equal(resolution.semanticField, "Número de identificación");
});
