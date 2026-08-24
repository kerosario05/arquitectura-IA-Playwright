import { test, expect } from "@playwright/test";
import { buildRunStreamPayload } from "../src/server/routes/runs";

test("SSE done incluye summary final y currentCase", () => {
  const payload = buildRunStreamPayload({
    status: "failed",
    exitCode: 1,
    currentCase: "Visualización de opciones principales tras iniciar el kiosco",
    currentCaseId: "PREVIEW-007",
    currentCaseTitle: "Visualización de opciones principales tras iniciar el kiosco",
    errorMessage: "Promotion not applicable because discovery status is discovered_partial.",
    summary: {
      completed: 7,
      passed: 5,
      failed: 2,
      scenarioCount: 7,
      totalStories: 7,
    },
  }, true);

  expect(payload.status).toBe("failed");
  expect(payload.currentCase).toBe("Visualización de opciones principales tras iniciar el kiosco");
  expect(payload.currentCaseId).toBe("PREVIEW-007");
  expect(payload.currentCaseTitle).toBe("Visualización de opciones principales tras iniciar el kiosco");
  expect(payload.errorMessage).toContain("discovered_partial");
  expect((payload.summary as any).completed).toBe(7);
  expect((payload.summary as any).passed).toBe(5);
  expect((payload.summary as any).failed).toBe(2);
});

test("SSE mantiene fallback al id técnico cuando no hay título", () => {
  const payload = buildRunStreamPayload({
    status: "running",
    currentCase: "PREVIEW-008",
    currentCaseId: "PREVIEW-008",
    currentCaseTitle: null,
  });

  expect(payload.currentCase).toBe("PREVIEW-008");
  expect(payload.currentCaseId).toBe("PREVIEW-008");
  expect(payload.currentCaseTitle).toBeNull();
});
