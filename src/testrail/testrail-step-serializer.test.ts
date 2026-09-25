import assert from "node:assert/strict";
import test from "node:test";
import { serializeTestRailSteps } from "./testrail-step-serializer";
import { normalizeTestRailCase } from "./testrail-normalizer";

test("serializeTestRailSteps matches the working TestRail rich-text format and preserves canonical cardinality", () => {
    const steps = [
      { content: "Abrir la aplicación", expected: "La pantalla inicial carga" },
      { content: "Ingresar \"130598983\" en \"RNC\"" },
      { content: "Presionar Validar", expected: "La empresa queda validada" },
    ];

    const serialized = serializeTestRailSteps(steps);

    assert.equal(serialized,
      '<ol>\n<li>Abrir la aplicación<br />Esperado: La pantalla inicial carga</li>\n<li>Ingresar &quot;130598983&quot; en &quot;RNC&quot;</li>\n<li>Presionar Validar<br />Esperado: La empresa queda validada</li>\n</ol>\n',
    );
    assert.match(serialized, /<ol>/);
    assert.match(serialized, /<li>/);
    assert.equal(steps.length, 3);
});

test("shared serializer round-trips canonical step count and expected association", () => {
  const serialized = serializeTestRailSteps([
    { content: "Abrir", expected: "Disponible" },
    { content: "Guardar", expected: "Confirmar" },
    { content: "Cerrar" },
  ]);
  const normalized = normalizeTestRailCase({ id: 991, title: "Round trip", custom_steps: serialized });

  assert.equal(normalized.steps.length, 3);
  assert.deepEqual(normalized.steps.map((step) => ({ action: step.action, expected: step.expected })), [
    { action: "Abrir", expected: "Disponible" },
    { action: "Guardar", expected: "Confirmar" },
    { action: "Cerrar", expected: undefined },
  ]);
});

test("presentation ordinal is emitted exactly once by the ol/li serializer", () => {
  const serialized = serializeTestRailSteps([
    { content: "1. Abrir" },
    { content: "2) Seleccionar" },
    { content: "3. Guardar", expected: "3. Confirmado" },
  ]);
  assert.equal(serialized, "<ol>\n<li>Abrir</li>\n<li>Seleccionar</li>\n<li>Guardar<br />Esperado: 3. Confirmado</li>\n</ol>\n");
  assert.equal((serialized.match(/<li>/g) ?? []).length, 3);
  assert.equal((serialized.match(/\b\d+[.)]\s/g) ?? []).length, 1);
});
