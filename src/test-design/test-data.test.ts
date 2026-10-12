import assert from "node:assert/strict";
import test from "node:test";
import {
  carryOverDataValues,
  describeTestData,
  isSensitiveName,
  keyFromLabel,
  missingDataCount,
  placeholderKeys,
  reconcileDataFields,
  renderWithData,
} from "./test-data";
import { mergeRegenerated, parseGeneratedScenarios } from "./test-design-generator";
import { toCaseInput } from "./test-design-publisher";
import { normalizeScenario } from "./test-design.validation";

const field = (key: string, value = "", sensitive = false) => ({
  key,
  label: key === "usuario" ? "Usuario" : key === "contrasena" ? "Contraseña" : key,
  description: "",
  value,
  sensitive,
});

test("keys and sensitivity come from labels", () => {
  assert.equal(keyFromLabel("Número de cédula"), "numero_de_cedula");
  assert.ok(isSensitiveName("contrasena Contraseña"));
  assert.ok(isSensitiveName("codigo_otp"));
  assert.ok(isSensitiveName("PIN de la tarjeta"));
  assert.ok(!isSensitiveName("usuario"));
  assert.ok(!isSensitiveName("spinner"), "PIN only as a word");
});

test("placeholders are found in order, case-insensitively", () => {
  assert.deepEqual(placeholderKeys(["Ingresar {{usuario}} y {{ Contrasena }}", "otra vez {{usuario}}"]), ["usuario", "contrasena"]);
});

test("every placeholder gets a field; declared fields are kept", () => {
  const fields = reconcileDataFields([field("monto")], ["Ingresar {{usuario}} y {{clave_otp}}"]);
  assert.deepEqual(fields.map((f) => [f.key, f.label, f.sensitive]), [
    ["monto", "monto", false],
    ["usuario", "Usuario", false],
    ["clave_otp", "Clave otp", true],
  ]);
});

test("rendering fills values but never reveals sensitive or empty ones", () => {
  const data = [field("usuario", "ana.qa"), field("contrasena", "S3creta!", true), field("cedula")];
  const text = "Ingresar {{usuario}}, {{contrasena}} y {{cedula}}; {{desconocido}}";
  assert.equal(renderWithData(text, data), "Ingresar ana.qa, <Contraseña> y <cedula>; <Desconocido>");
  assert.equal(renderWithData(text, data, { revealSensitive: true }), "Ingresar ana.qa, S3creta! y <cedula>; <Desconocido>");
  assert.deepEqual(describeTestData(data), [
    "- Usuario: ana.qa",
    "- Contraseña: (dato sensible, se entrega por canal seguro)",
    "- cedula: (por definir)",
  ]);
  assert.equal(missingDataCount({ data }), 1);
});

test("validation normalizes data and creates fields for placeholders the user typed", () => {
  const s = normalizeScenario(
    {
      title: "Login",
      steps: [{ action: "Escribir {{usuario}} y {{contrasena}}", expected: "Entra" }],
      data: [{ label: "Usuario", value: " ana " }, { key: "usuario", label: "Repetido" }],
    },
    0,
  );
  assert.deepEqual(s.data, [
    { key: "usuario", label: "Usuario", description: "", value: "ana", sensitive: false },
    { key: "contrasena", label: "Contrasena", description: "", value: "", sensitive: true },
  ]);
});

test("the generator keeps the AI's data fields but never its values", () => {
  const [s] = parseGeneratedScenarios({
    scenarios: [
      {
        title: "Login",
        steps: [{ action: "Ingresar {{usuario}} y {{password}}", expected: "Entra" }],
        data: [
          { key: "usuario", label: "Usuario", description: "Cliente activo", value: "inventado" },
          { key: "password", label: "Contraseña", sensitive: true },
        ],
      },
    ],
  });
  assert.deepEqual(s.data.map((f) => [f.key, f.value, f.sensitive, f.description]), [
    ["usuario", "", false, "Cliente activo"],
    ["password", "", true, ""],
  ]);
});

test("regeneration carries typed values over to new scenarios with the same key", () => {
  const existing = [
    normalizeScenario({ title: "Viejo", steps: ["{{usuario}}"], data: [{ key: "usuario", value: "ana" }] }, 0, { origin: "ai" }),
  ];
  const fresh = [normalizeScenario({ title: "Nuevo", steps: ["{{usuario}} y {{monto}}"] }, 0, { origin: "ai" })];
  const merged = mergeRegenerated(existing, fresh);
  assert.deepEqual(merged.map((s) => s.title), ["Nuevo"], "untouched AI scenario is replaced");
  assert.deepEqual(merged[0].data.map((f) => [f.key, f.value]), [["usuario", "ana"], ["monto", ""]]);
  assert.deepEqual(carryOverDataValues([], fresh), fresh);
});

test("the TestRail case gets values in its steps and a data section in its preconditions", () => {
  const s = normalizeScenario(
    {
      title: "Login",
      preconditions: "Cliente {{usuario}} activo",
      steps: [{ action: "Ingresar {{usuario}} y {{contrasena}}", expected: "Bienvenida a {{usuario}}" }],
      expectedResult: "Sesión de {{usuario}}",
      data: [
        { key: "usuario", label: "Usuario", value: "ana.qa" },
        { key: "contrasena", label: "Contraseña", value: "S3creta!", sensitive: true },
      ],
    },
    0,
  );
  const input = toCaseInput(s, "PAY-1", { requiredCustomFields: {}, caseOracle: "QA" });
  assert.deepEqual(input.stepsSeparated, [{ content: "Ingresar ana.qa y <Contraseña>", expected: "Bienvenida a ana.qa" }]);
  assert.equal(input.customExpected, "Sesión de ana.qa");
  assert.equal(
    input.preconditions,
    "Cliente ana.qa activo\n\nDatos de prueba:\n- Usuario: ana.qa\n- Contraseña: (dato sensible, se entrega por canal seguro)",
  );
  assert.ok(!JSON.stringify(input).includes("S3creta!"), "a sensitive value never reaches TestRail");
});
