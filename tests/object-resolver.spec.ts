import { expect, test } from "@playwright/test";
import { findRegistryObjectsByText, normalizeRegistryText, resolveRegistryObject } from "../src/registry/object-resolver";
import type { ObjectRegistry } from "../src/types/object-registry.types";

const registry: ObjectRegistry = {
  version: "1.0",
  appName: "generic",
  objects: [
    {
      key: "cedulaInput",
      name: "Cédula input",
      description: "Campo de cédula del cliente",
      type: "input",
      locator: { strategy: "label", value: "Cédula" },
      aliases: ["documento", "identificacion"],
      tags: ["cliente"]
    }
  ]
};

test("resolves by exact key", () => {
  const result = resolveRegistryObject(registry, "cedulaInput");
  expect(result?.key).toBe("cedulaInput");
});

test("resolves by alias", () => {
  const result = resolveRegistryObject(registry, "documento");
  expect(result?.key).toBe("cedulaInput");
});

test("find by text in name", () => {
  const results = findRegistryObjectsByText(registry, "input");
  expect(results).toHaveLength(1);
});

test("normalizes accents", () => {
  expect(normalizeRegistryText("Cédula")).toBe("cedula");
  const result = resolveRegistryObject(registry, "identificación");
  expect(result?.key).toBe("cedulaInput");
});
