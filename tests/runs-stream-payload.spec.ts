import { test, expect } from "@playwright/test";
import { buildRunStreamPayload } from "../src/server/routes/runs";

test("SSE done incluye summary final y currentCase", () => {
  const payload = buildRunStreamPayload({
    status: "failed",
    exitCode: 1,
    currentCase: "PREVIEW-007",
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
  expect(payload.currentCase).toBe("PREVIEW-007");
  expect(payload.errorMessage).toContain("discovered_partial");
  expect((payload.summary as any).completed).toBe(7);
  expect((payload.summary as any).passed).toBe(5);
  expect((payload.summary as any).failed).toBe(2);
});
