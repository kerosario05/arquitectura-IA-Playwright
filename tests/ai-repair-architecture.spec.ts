import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("existe la documentacion de arquitectura IA", () => {
  const path = join(process.cwd(), "docs", "ai-repair-architecture.md");
  expect(existsSync(path)).toBe(true);
});

test("la documentacion define limites clave", () => {
  const path = join(process.cwd(), "docs", "ai-repair-architecture.md");
  const content = readFileSync(path, "utf8");
  expect(content).toContain("La IA no reemplaza el motor MCP");
  expect(content).toContain("La IA NO debe:");
  expect(content.toLowerCase()).toContain("controlar el navegador");
  expect(content).toContain("IA no modifica repo");
  expect(content).toContain("IA no inventa selectores");
  expect(content).toContain("target_not_found");
  expect(content).toContain("route_recovery");
  expect(content).toContain("assertion_resolution");
  expect(content).toContain("selection_resolution");
});
