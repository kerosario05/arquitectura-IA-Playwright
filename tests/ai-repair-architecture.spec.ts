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
  expect(content).toContain("controlar el navegador");
  expect(content).toContain("modificar repo");
  expect(content).toContain("inventar selectores");
  expect(content).toContain("target_not_found");
});
