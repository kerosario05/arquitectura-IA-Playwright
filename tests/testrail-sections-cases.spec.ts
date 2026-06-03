import { test, expect } from "@playwright/test";
import { resolveSectionCases } from "../src/server/routes/testrail";

test("resolveSectionCases returns cases for a valid section", async () => {
  const tr = {
    getSection: async () => ({ id: 4903, name: "Sección A", project_id: 56, suite_id: 1731 }),
    getCases: async () => [{ id: 1, title: "Caso 1" }, { id: 2, title: "Caso 2" }],
  };

  const result = await resolveSectionCases(tr as any, { sectionId: 4903, projectId: 56, suiteId: 1731 });

  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({
    ok: true,
    sectionId: 4903,
    projectId: 56,
    suiteId: 1731,
  });
  expect((result.body as any).cases).toHaveLength(2);
});

test("resolveSectionCases returns empty cases for a valid section without cases", async () => {
  const tr = {
    getSection: async () => ({ id: 4903, name: "Sección A", project_id: 56, suite_id: 1731 }),
    getCases: async () => [],
  };

  const result = await resolveSectionCases(tr as any, { sectionId: 4903, projectId: 56, suiteId: 1731 });

  expect(result.status).toBe(200);
  expect((result.body as any).cases).toEqual([]);
});

test("resolveSectionCases returns 404 when the section does not exist", async () => {
  const tr = {
    getSection: async () => null,
    getCases: async () => [],
  };

  const result = await resolveSectionCases(tr as any, { sectionId: 9999, projectId: 56, suiteId: 1731 });

  expect(result.status).toBe(404);
  expect(result.body).toMatchObject({
    ok: false,
    error: "section_not_found",
    sectionId: 9999,
  });
});
