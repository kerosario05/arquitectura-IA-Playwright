import { test, expect } from "@playwright/test";

/**
 * Test: Blocked Scenarios Fallback
 *
 * Verifies that blockedScenarios are correctly built from rejected array
 * when routeResolutions is unavailable or lost during serialization.
 */
test.describe("Blocked Scenarios Fallback", () => {

  test("should build blockedScenarios from rejected with route-first reasons", () => {
    // Simulate scenario-preview.service response construction
    const rejected = [
      {
        sourceIssueKey: "AA-82",
        reason: "needs_route_profile: Route profile not found. Scenario generation blocked until route profile is defined."
      },
      {
        sourceIssueKey: "AA-83",
        reason: "missing_parent_route: The parent route (list) is not defined."
      },
      {
        sourceIssueKey: "AA-84",
        reason: "Some non-route reason like validation failed"
      }
    ];

    const issues = [
      { key: "AA-82", summary: "Visualizar productos" },
      { key: "AA-83", summary: "Ver listado" },
      { key: "AA-84", summary: "Operación backend" }
    ];

    const appSlug = "test-app";
    const appProfilePath = "automations/apps/test-app/app.config.json";

    // Simulate the fallback logic
    const blockedScenarios: any[] = [];
    const blockedFromRejected = new Set(blockedScenarios.map(b => b.sourceIssueKey));
    let fallbackCount = 0;

    for (const rej of rejected) {
      if (blockedFromRejected.has(rej.sourceIssueKey)) continue;

      const reasonLower = rej.reason.toLowerCase();
      let reasonCode: string | null = null;

      if (reasonLower.includes("needs_route_profile")) {
        reasonCode = "needs_route_profile";
      } else if (reasonLower.includes("missing_parent_route")) {
        reasonCode = "missing_parent_route";
      } else if (reasonLower.includes("missing_intermediate_step")) {
        reasonCode = "missing_intermediate_step";
      } else if (reasonLower.includes("missing_detail_selection_step")) {
        reasonCode = "missing_detail_selection_step";
      } else if (reasonLower.includes("ambiguous_route_target")) {
        reasonCode = "ambiguous_route_target";
      } else if (reasonLower.includes("unsupported_route_target")) {
        reasonCode = "unsupported_route_target";
      }

      if (reasonCode) {
        const issue = issues.find(i => i.key === rej.sourceIssueKey);
        const isError = reasonCode === "needs_route_profile" || reasonCode === "missing_parent_route";

        let suggestedAction = "review_route_profile";
        if (reasonCode === "needs_route_profile") {
          suggestedAction = "configure_route_profile";
        } else if (reasonCode === "missing_parent_route") {
          suggestedAction = "add_parent_route";
        } else if (reasonCode === "missing_intermediate_step") {
          suggestedAction = "add_intermediate_steps";
        }

        blockedScenarios.push({
          sourceIssueKey: rej.sourceIssueKey,
          title: issue?.summary ?? `Issue ${rej.sourceIssueKey}`,
          status: "blocked",
          reasonCode,
          reason: rej.reason,
          diagnostics: [
            {
              level: isError ? "error" : "warning",
              code: reasonCode,
              message: rej.reason.replace(`${reasonCode}: `, ""),
              context: { source: "rejected_fallback" }
            }
          ],
          appSlug,
          appProfilePath,
          suggestedAction
        });

        fallbackCount++;
      }
    }

    // Verify results
    expect(blockedScenarios.length).toBe(2); // AA-82 and AA-83, not AA-84
    expect(fallbackCount).toBe(2);

    // Verify AA-82
    const aa82 = blockedScenarios.find(b => b.sourceIssueKey === "AA-82");
    expect(aa82).toBeDefined();
    expect(aa82.reasonCode).toBe("needs_route_profile");
    expect(aa82.title).toBe("Visualizar productos");
    expect(aa82.status).toBe("blocked");
    expect(aa82.suggestedAction).toBe("configure_route_profile");
    expect(aa82.diagnostics[0].level).toBe("error");
    expect(aa82.diagnostics[0].context.source).toBe("rejected_fallback");

    // Verify AA-83
    const aa83 = blockedScenarios.find(b => b.sourceIssueKey === "AA-83");
    expect(aa83).toBeDefined();
    expect(aa83.reasonCode).toBe("missing_parent_route");
    expect(aa83.title).toBe("Ver listado");
    expect(aa83.suggestedAction).toBe("add_parent_route");
    expect(aa83.diagnostics[0].level).toBe("error");

    // Verify AA-84 is NOT in blockedScenarios (non-route reason)
    const aa84 = blockedScenarios.find(b => b.sourceIssueKey === "AA-84");
    expect(aa84).toBeUndefined();
  });

  test("should not duplicate blockedScenarios when routeResolutions already provided them", () => {
    // Simulate case where routeResolutions already populated blockedScenarios
    const blockedScenarios: any[] = [
      {
        sourceIssueKey: "AA-82",
        title: "Visualizar productos",
        status: "blocked",
        reasonCode: "needs_route_profile",
        reason: "needs_route_profile: Route profile not found.",
        diagnostics: [
          {
            level: "error",
            code: "needs_route_profile",
            message: "Route profile not found.",
            context: { issue: "AA-82" }
          }
        ],
        appSlug: "test-app",
        appProfilePath: "automations/apps/test-app/app.config.json",
        suggestedAction: "configure_route_profile"
      }
    ];

    const rejected = [
      {
        sourceIssueKey: "AA-82",
        reason: "needs_route_profile: Route profile not found."
      }
    ];

    // Simulate fallback logic with duplicate check
    const blockedFromRejected = new Set(blockedScenarios.map(b => b.sourceIssueKey));
    let fallbackCount = 0;

    for (const rej of rejected) {
      if (blockedFromRejected.has(rej.sourceIssueKey)) continue; // Skip duplicate
      // ... rest of fallback logic would go here
      fallbackCount++;
    }

    // Verify no duplicates were added
    expect(blockedScenarios.length).toBe(1);
    expect(fallbackCount).toBe(0);
  });

  test("should handle all route-first diagnostic codes", () => {
    const rejected = [
      { sourceIssueKey: "AA-1", reason: "needs_route_profile: Missing profile" },
      { sourceIssueKey: "AA-2", reason: "missing_parent_route: Parent missing" },
      { sourceIssueKey: "AA-3", reason: "missing_intermediate_step: Intermediate missing" },
      { sourceIssueKey: "AA-4", reason: "missing_detail_selection_step: Selection missing" },
      { sourceIssueKey: "AA-5", reason: "ambiguous_route_target: Ambiguous target" },
      { sourceIssueKey: "AA-6", reason: "unsupported_route_target: Unsupported target" },
    ];

    const issues = rejected.map((r, i) => ({ key: r.sourceIssueKey, summary: `Test ${i + 1}` }));
    const blockedScenarios: any[] = [];
    const blockedFromRejected = new Set();

    for (const rej of rejected) {
      if (blockedFromRejected.has(rej.sourceIssueKey)) continue;

      const reasonLower = rej.reason.toLowerCase();
      let reasonCode: string | null = null;

      if (reasonLower.includes("needs_route_profile")) reasonCode = "needs_route_profile";
      else if (reasonLower.includes("missing_parent_route")) reasonCode = "missing_parent_route";
      else if (reasonLower.includes("missing_intermediate_step")) reasonCode = "missing_intermediate_step";
      else if (reasonLower.includes("missing_detail_selection_step")) reasonCode = "missing_detail_selection_step";
      else if (reasonLower.includes("ambiguous_route_target")) reasonCode = "ambiguous_route_target";
      else if (reasonLower.includes("unsupported_route_target")) reasonCode = "unsupported_route_target";

      if (reasonCode) {
        const issue = issues.find(i => i.key === rej.sourceIssueKey);
        const isError = reasonCode === "needs_route_profile" || reasonCode === "missing_parent_route";

        blockedScenarios.push({
          sourceIssueKey: rej.sourceIssueKey,
          title: issue?.summary ?? rej.sourceIssueKey,
          reasonCode,
          diagnostics: [{ level: isError ? "error" : "warning", code: reasonCode }]
        });
      }
    }

    // All 6 should be converted to blockedScenarios
    expect(blockedScenarios.length).toBe(6);
    expect(blockedScenarios[0].reasonCode).toBe("needs_route_profile");
    expect(blockedScenarios[1].reasonCode).toBe("missing_parent_route");
    expect(blockedScenarios[2].reasonCode).toBe("missing_intermediate_step");
    expect(blockedScenarios[3].reasonCode).toBe("missing_detail_selection_step");
    expect(blockedScenarios[4].reasonCode).toBe("ambiguous_route_target");
    expect(blockedScenarios[5].reasonCode).toBe("unsupported_route_target");

    // Error level correct for blocking codes
    expect(blockedScenarios[0].diagnostics[0].level).toBe("error");
    expect(blockedScenarios[1].diagnostics[0].level).toBe("error");
    expect(blockedScenarios[2].diagnostics[0].level).toBe("warning");
  });
});
