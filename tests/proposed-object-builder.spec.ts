import { test, expect } from "@playwright/test";
import { buildProposedObject, buildProposedObjects } from "../src/discovery/proposed-object-builder";
import type { SnapshotElement } from "../src/types/page-snapshot.types";

function makeElement(base: Partial<SnapshotElement> & { id: string; type: SnapshotElement["type"]; visible: boolean }): SnapshotElement {
  return {
    id: base.id,
    type: base.type,
    text: base.text,
    label: base.label,
    placeholder: base.placeholder,
    name: base.name,
    role: base.role,
    tagName: base.tagName,
    inputType: base.inputType,
    required: base.required,
    disabled: base.disabled,
    visible: base.visible,
    nearbyText: base.nearbyText,
    candidateLocators: base.candidateLocators || [],
    dataHints: base.dataHints || []
  };
}

test("buildProposedObject creates button object with high confidence", () => {
  const element = makeElement({
    id: "el-1",
    type: "button",
    text: "Consultar",
    tagName: "button",
    candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.type).toBe("button");
  expect(result.key).toBe("button_consultar");
  expect(result.name).toBe("Consultar");
  expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  expect(result.locator.strategy).toBe("text");
});

test("buildProposedObject creates input object from placeholder", () => {
  const element = makeElement({
    id: "el-2",
    type: "input",
    placeholder: "Ingrese su cédula",
    tagName: "input",
    inputType: "text",
    candidateLocators: [{ strategy: "placeholder", value: "Ingrese su cédula", confidence: 0.8 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.type).toBe("input");
  expect(result.key).toContain("input");
  expect(result.confidence).toBeGreaterThanOrEqual(0.8);
});

test("buildProposedObject creates table object", () => {
  const element = makeElement({
    id: "el-3",
    type: "table",
    tagName: "table",
    candidateLocators: [{ strategy: "css", value: "table", confidence: 0.55 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.type).toBe("table");
  expect(result.key).toBe("table_table");
});

test("buildProposedObject handles disabled element", () => {
  const element = makeElement({
    id: "el-4",
    type: "button",
    text: "Submit",
    tagName: "button",
    disabled: true,
    candidateLocators: [{ strategy: "text", value: "Submit", confidence: 0.75 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.reason).toContain("disabled");
});

test("buildProposedObject handles required element", () => {
  const element = makeElement({
    id: "el-5",
    type: "input",
    placeholder: "Email",
    tagName: "input",
    required: true,
    candidateLocators: [{ strategy: "placeholder", value: "Email", confidence: 0.8 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.reason).toContain("Required");
});

test("buildProposedObjects filters to actionable types only", () => {
  const elements: SnapshotElement[] = [
    makeElement({ id: "el-1", type: "button", text: "Click", tagName: "button", visible: true }),
    makeElement({ id: "el-2", type: "text", text: "Some paragraph", tagName: "p", visible: true }),
    makeElement({ id: "el-3", type: "input", placeholder: "Name", tagName: "input", visible: true })
  ];

  const results = buildProposedObjects(elements);

  expect(results).toHaveLength(2);
  expect(results[0].type).toBe("button");
  expect(results[1].type).toBe("input");
});

test("buildProposedObjects deduplicates keys", () => {
  const elements: SnapshotElement[] = [
    makeElement({ id: "el-1", type: "button", text: "Submit", tagName: "button", visible: true }),
    makeElement({ id: "el-2", type: "button", text: "Submit", tagName: "button", visible: true })
  ];

  const results = buildProposedObjects(elements);

  expect(results).toHaveLength(2);
  expect(results[0].key).toBe("button_submit");
  expect(results[1].key).toBe("button_submit_1");
});

test("buildProposedObjects handles empty elements array", () => {
  const results = buildProposedObjects([]);

  expect(results).toHaveLength(0);
});

test("buildProposedObject sanitizes key with special characters", () => {
  const element = makeElement({
    id: "el-1",
    type: "button",
    text: "Consultar Saldo (Cuenta de Ahorros)",
    tagName: "button",
    candidateLocators: [{ strategy: "text", value: "Consultar Saldo", confidence: 0.75 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.key).not.toContain("(");
  expect(result.key).not.toContain(")");
  expect(result.key).not.toContain("á");
});

test("buildProposedObject uses label when text is missing", () => {
  const element = makeElement({
    id: "el-1",
    type: "input",
    label: "Número de cuenta",
    tagName: "input",
    candidateLocators: [{ strategy: "label", value: "Número de cuenta", confidence: 0.85 }],
    visible: true
  });

  const result = buildProposedObject(element);

  expect(result.name).toBe("Número de cuenta");
  expect(result.key).toContain("input");
});
