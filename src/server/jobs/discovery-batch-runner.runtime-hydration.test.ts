import assert from "node:assert/strict";
import test from "node:test";
import { hydrateConfirmedRuntimeEntriesByCase, resolveSectionSlugFromSpecPath } from "./discovery-batch-runner";

test("hydrates confirmed inputs by project and TestRail case while preserving explicit overrides", async () => {
  const hydrated = await hydrateConfirmedRuntimeEntriesByCase({
    appSlug: "project-a",
    caseIds: [100, 200],
    runtimeEntriesByCase: {
      "100": [{ key: "amount", value: "20", source: "explicit_runtime_input", sensitive: false }],
    },
  } as any, {
    resolveProject: async (slug: string) => ({ id: `id-${slug}` } as any),
    loadValues: async (projectId: string, caseId: number) => {
      assert.equal(projectId, "id-project-a");
      return caseId === 100
        ? [
            { key: "amount", value: "10", source: "confirmed_case_runtime", verified: true },
            { key: "token", value: "654321", source: "confirmed_case_runtime", verified: true },
          ] as any
        : [{ key: "username", value: "user-200", source: "confirmed_case_runtime", verified: true }] as any;
    },
    isJiraSemanticCase: async () => true,
  });

  const byCase = hydrated.runtimeEntriesByCase!;
  assert.equal(byCase["100"].find((entry) => entry.key === "amount")?.value, "20");
  assert.equal(byCase["100"].find((entry) => entry.key === "token")?.provenance, "confirmed_case_runtime");
  assert.equal(byCase["200"].find((entry) => entry.key === "username")?.value, "user-200");
});

test("does not cross project or case scope and tolerates an unavailable value store", async () => {
  const missingProject = await hydrateConfirmedRuntimeEntriesByCase({ appSlug: "unknown", caseIds: [100] } as any, {
    resolveProject: async () => null,
    loadValues: async () => { throw new Error("must not load without project"); },
    isJiraSemanticCase: async () => true,
  });
  assert.equal(missingProject.runtimeEntriesByCase, undefined);

  const unavailableStore = await hydrateConfirmedRuntimeEntriesByCase({ appSlug: "project-a", caseIds: [100] } as any, {
    resolveProject: async () => ({ id: "project-a-id" } as any),
    loadValues: async (_projectId: string, caseId: number) => {
      assert.equal(caseId, 100);
      throw new Error("optional store unavailable");
    },
    isJiraSemanticCase: async () => true,
  });
  assert.deepEqual(unavailableStore.runtimeEntriesByCase, {});

  const recordingCase = await hydrateConfirmedRuntimeEntriesByCase({ appSlug: "project-a", caseIds: [100] } as any, {
    resolveProject: async () => ({ id: "project-a-id" } as any),
    isJiraSemanticCase: async () => false,
    loadValues: async () => { throw new Error("must not load recording data"); },
  });
  assert.deepEqual(recordingCase.runtimeEntriesByCase, {});
});

test("resolves the spec section from its own multiproject path", () => {
  assert.equal(resolveSectionSlugFromSpecPath(
    "C:/work/automations/apps/app-one/sections/section-a/cases/case-1/case.spec.ts", "app-one",
  ), "section-a");
  assert.equal(resolveSectionSlugFromSpecPath(
    "C:/work/automations/apps/app-two/sections/section-b/cases/case-2/spec.ts", "app-one",
  ), undefined);
});
