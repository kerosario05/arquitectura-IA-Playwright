import { test, expect } from "@playwright/test";
import { resolveDataForField } from "../src/data/data-resolver";
import type { DataContext } from "../src/data/data-context";
import type { TestDataAliasesMap } from "../src/types/env.types";

function createContext(entries: DataContext["entries"]): DataContext {
  const sensitive = entries.filter((entry) => entry.sensitive).length;
  return {
    entries,
    counts: {
      total: entries.length,
      sensitive,
      nonSensitive: entries.length - sensitive
    }
  };
}

test("resolves cedula from test data by label", () => {
  const context = createContext([
    { key: "cedula", value: "00112345678", source: "test_data", sensitive: true }
  ]);

  const result = resolveDataForField({ label: "Cédula" }, context, {}, "fail");
  expect(result.status).toBe("resolved");
  if (result.status === "resolved") {
    expect(result.key).toBe("cedula");
  }
});

test("resolves alias codigo to numero2", () => {
  const context = createContext([
    { key: "numero2", value: "123456", source: "test_data", sensitive: false }
  ]);
  const aliases: TestDataAliasesMap = {
    numero2: ["codigo", "código", "otp", "pin", "token"]
  };

  const result = resolveDataForField({ label: "Código de 6 dígitos" }, context, aliases, "fail");
  expect(result.status).toBe("resolved");
  if (result.status === "resolved") {
    expect(result.key).toBe("numero2");
  }
});

test("resolves APP_USERNAME by semantic hint", () => {
  const context = createContext([
    { key: "APP_USERNAME", value: "usuario_demo", source: "app_username", sensitive: false }
  ]);

  const result = resolveDataForField({ label: "Usuario" }, context, {}, "fail");
  expect(result.status).toBe("resolved");
  if (result.status === "resolved") {
    expect(["APP_USERNAME", "username"]).toContain(result.key);
  }
});

test("resolves APP_PASSWORD by placeholder and marks sensitive", () => {
  const context = createContext([
    { key: "APP_PASSWORD", value: "secret", source: "app_password", sensitive: true }
  ]);

  const result = resolveDataForField({ placeholder: "Contraseña" }, context, {}, "fail");
  expect(result.status).toBe("resolved");
  if (result.status === "resolved") {
    expect(result.sensitive).toBe(true);
  }
});

test("returns missing_input for loan number with fail behavior", () => {
  const context = createContext([]);

  const result = resolveDataForField({ label: "Número de préstamo" }, context, {}, "fail");
  expect(result.status).toBe("missing_input");
  if (result.status === "missing_input") {
    expect(result.suggestedVariableNames).toEqual(expect.arrayContaining(["numeroPrestamo", "loanNumber"]));
  }
});

test("returns skipped for missing phone with skip behavior", () => {
  const context = createContext([]);

  const result = resolveDataForField({ label: "Teléfono" }, context, {}, "skip");
  expect(result.status).toBe("skipped");
});

test("does not auto-pick when generic number has multiple candidates", () => {
  const context = createContext([
    { key: "referenciaA", value: "111", source: "test_data", sensitive: false },
    { key: "referenciaB", value: "222", source: "test_data", sensitive: false }
  ]);

  const result = resolveDataForField({ label: "Número" }, context, {}, "fail");
  expect(result.status).toBe("missing_input");
});
