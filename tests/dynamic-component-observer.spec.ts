import { test, expect } from "@playwright/test";
import { captureDynamicComponentSnapshot, observeDynamicComponentActivation, technicalTargetsForSnapshot } from "../src/recording/web/dynamic-component-observer";
import { buildCanonicalInteractions } from "../src/recording/canonical-recording-contract";
import { buildSemanticRecordingModel } from "../src/recording/semantic-recording";
import { buildWebLocators, CAPTURE_SCRIPT } from "../src/recording/web/web-session-recorder";
import { dynamicComponentLabHtml } from "./fixtures/dynamic-component-lab";

test.describe("Dynamic Component Observer laboratory", () => {
  test("discovers the real editable child, option inventory and dependent enablement", async ({ page }) => {
    await page.setContent(dynamicComponentLabHtml({ portal: false, labels: { left: "Measure A", right: "Measure B" } }));
    const cell = page.locator('[data-cell="row-a-left"]');
    const display = cell.locator("[data-display]");

    const activation = await observeDynamicComponentActivation(page, display);
    expect(activation.before.state).toBe("DISPLAY");
    expect(activation.after.state).toBe("EDITOR_MATERIALIZED");
    expect(activation.after.editableControl?.disabled).toBe(true);
    expect(activation.after.structuralContext.cellRef).toBe("row-a-left");

    const selector = cell.locator('[role="combobox"]');
    const selectorObservation = await observeDynamicComponentActivation(page, selector);
    expect(selectorObservation.after.state).toBe("SELECTOR_OPEN");
    expect(selectorObservation.after.surface?.portalized).toBe(false);
    expect(selectorObservation.after.surface?.options.map((option) => option.text)).toEqual([
      "Option One",
      "Option Two",
      "Option Three",
    ]);

    const options = page.locator('[role="option"]');
    await options.nth(0).focus();
    expect(await cell.locator('[role="combobox"]').getAttribute("data-selected")).toBeNull();
    await options.nth(1).click();
    expect(await cell.locator('[role="combobox"]').getAttribute("data-selected")).toBe("Option Two");

    const input = cell.locator('input[data-child-role="amount_or_text"]');
    expect(await input.isEnabled()).toBe(true);
    await input.fill("1500");
    const editingSnapshot = await captureDynamicComponentSnapshot(cell);
    const amountTarget = technicalTargetsForSnapshot(editingSnapshot, true)
      .find((candidate) => candidate.semanticRole === "amount_or_text");
    expect(editingSnapshot.state).toBe("VALUE_EDITING");
    expect(amountTarget).toBeDefined();
    expect(amountTarget?.validatedByInteraction).toBe(true);
    expect(amountTarget?.locatorCandidates.some((candidate) => candidate.strategy === "structural")).toBe(true);
    expect(amountTarget?.locatorCandidates.some((candidate) => /nth|first|coordinate/i.test(candidate.value))).toBe(false);

    const logicalValue = await input.inputValue();
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    const displayValue = await cell.locator("[data-display]").getAttribute("data-display-value");
    expect(logicalValue).toBe("1500");
    expect(displayValue).toBe("Option Two 1500");
    expect((await captureDynamicComponentSnapshot(cell)).state).toBe("DISPLAY");

    const rawEvent = {
      seq: 0,
      t: 1,
      kind: "fill" as const,
      screenKey: "grid-screen",
      value: logicalValue,
      target: {
        label: "",
        role: "input",
        compoundRole: "amount_or_text" as const,
        associatedField: "Measure A",
        entityScope: "entity_1",
        gridRef: amountTarget?.structuralContext?.gridRef,
        rowRef: amountTarget?.structuralContext?.rowRef,
        rowIdentity: amountTarget?.structuralContext?.rowRef,
        cellRef: amountTarget?.structuralContext?.cellRef,
        headerRef: amountTarget?.structuralContext?.headerRef,
        locators: amountTarget?.locatorCandidates ?? [],
        technicalTargetCandidates: amountTarget ? [amountTarget] : [],
        rawTypedValue: logicalValue,
        inputValue: logicalValue,
        committedValue: logicalValue,
        displayValue: displayValue ?? undefined,
      },
    };
    const [canonicalAmount] = buildCanonicalInteractions([rawEvent]);
    expect(canonicalAmount.valueKey).toBe("entity_1.measure_a_valor");
    expect(canonicalAmount.technicalTargetRefs.some((ref) => ref.startsWith("structural:"))).toBe(true);
    expect(canonicalAmount.validatedByInteraction).toBe(true);
    const semanticModel = buildSemanticRecordingModel({
      recordingId: "dynamic-component-lab",
      projectSlug: "fixture",
      appSlug: "fixture",
      platform: "web",
      baseUrl: "http://fixture.invalid",
      startedAt: new Date(0).toISOString(),
      status: "stopped",
      events: [rawEvent],
      screens: [{ screenKey: "grid-screen", title: "Grid", fingerprint: "grid", firstSeenAt: 0, controls: [], texts: [] }],
    });
    expect(semanticModel.technicalObservations.some((observation) => observation.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction))).toBe(true);
  });

  test("follows a portalized dynamic surface and treats popup ids as session evidence", async ({ page }) => {
    await page.setContent(dynamicComponentLabHtml({ portal: true, ariaControls: true, options: ["Alpha", "Beta"] }));
    const cell = page.locator('[data-cell="row-a-left"]');
    await observeDynamicComponentActivation(page, cell.locator("[data-display]"));
    const first = await observeDynamicComponentActivation(page, cell.locator('[role="combobox"]'));
    expect(first.documentEscalationUsed).toBe(true);
    expect(first.portalDetected).toBe(true);
    expect(first.ariaControlsFollowed).toBe(true);
    expect(first.after.surface?.options.map((option) => option.text)).toEqual(["Alpha", "Beta"]);
    const firstSurfaceId = first.after.surface?.surfaceRef;
    await page.locator('[role="option"]').first().click();

    const secondCell = page.locator('[data-cell="row-a-right"]');
    await secondCell.locator("[data-display]").click();
    await expect(secondCell.locator('[role="combobox"]')).toHaveCount(1);
    const second = await observeDynamicComponentActivation(page, secondCell.locator('[role="combobox"]'));
    expect(second.portalDetected).toBe(true);
    expect(second.after.surface?.surfaceRef).not.toBe(firstSurfaceId);
    expect(second.technicalTargets.every((target) => !target.locatorCandidates.some((candidate) => candidate.value.includes(firstSurfaceId || "__missing__")))).toBe(true);
  });

  test("keeps compound child identities distinct across siblings and rows", async ({ page }) => {
    await page.setContent(dynamicComponentLabHtml({ portal: false, labels: { left: "A different label", right: "Another label" } }));
    const left = page.locator('[data-cell="row-a-left"]');
    const right = page.locator('[data-cell="row-a-right"]');
    const otherRow = page.locator('[data-cell="row-b-left"]');
    await observeDynamicComponentActivation(page, left.locator("[data-display]"));
    const leftSnapshot = await captureDynamicComponentSnapshot(left);
    await observeDynamicComponentActivation(page, right.locator("[data-display]"));
    const rightSnapshot = await captureDynamicComponentSnapshot(right);
    await observeDynamicComponentActivation(page, otherRow.locator("[data-display]"));
    const otherRowSnapshot = await captureDynamicComponentSnapshot(otherRow);

    const leftTarget = technicalTargetsForSnapshot(leftSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
    const rightTarget = technicalTargetsForSnapshot(rightSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
    const otherRowTarget = technicalTargetsForSnapshot(otherRowSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
    expect(leftTarget?.structuralContext?.cellRef).not.toBe(rightTarget?.structuralContext?.cellRef);
    expect(leftTarget?.structuralContext?.rowRef).not.toBe(otherRowTarget?.structuralContext?.rowRef);
    expect(leftTarget?.locatorCandidates.some((candidate) => candidate.strategy === "structural")).toBe(true);
    expect([leftTarget, rightTarget, otherRowTarget].every((target) => target?.locatorCandidates.every((candidate) => !/nth|first|coordinate/i.test(candidate.value)))).toBe(true);
  });

  test("supports an initially enabled child without aria-controls or business labels", async ({ page }) => {
    await page.setContent(dynamicComponentLabHtml({
      ariaControls: false,
      initiallyEnabled: true,
      labels: { left: "Metric X", right: "Metric Y" },
      options: ["Choice North", "Choice South"],
    }));
    const cell = page.locator('[data-cell="row-b-right"]');
    await observeDynamicComponentActivation(page, cell.locator("[data-display]"));
    const input = cell.locator('input[data-child-role="amount_or_text"]');
    expect(await input.isEnabled()).toBe(true);
    const observation = await observeDynamicComponentActivation(page, cell.locator('[role="combobox"]'));
    expect(observation.ariaControlsFollowed).toBe(false);
    expect(observation.after.surface?.options.map((option) => option.text)).toEqual(["Choice North", "Choice South"]);
  });

  test("records the actual child through the production web capture script", async ({ page }) => {
    const captured: Array<Record<string, any>> = [];
    await page.exposeBinding("__qaRecord", async (_source, payload) => {
      captured.push(payload as Record<string, any>);
    });
    await page.setContent(dynamicComponentLabHtml({ portal: true, options: ["Choice A", "Choice B"] }));
    await page.evaluate(CAPTURE_SCRIPT);
    const cell = page.locator('[data-cell="row-a-left"]');
    await cell.locator("[data-display]").click();
    await cell.locator('[role="combobox"]').click();
    await page.locator('[role="option"]').nth(1).click();
    const input = cell.locator('input[data-child-role="amount_or_text"]');
    await input.fill("1500");
    await input.evaluate((element) => (element as HTMLInputElement).blur());
    await page.waitForTimeout(220);

    const fill = captured.filter((event) => event.kind === "input" && event.compoundRole === "amount_or_text").at(-1);
    expect(fill).toBeDefined();
    expect(fill?.deepestEditableTargetRef).toBeTruthy();
    expect(fill?.technicalTargetCandidates?.some((candidate: any) => candidate.validatedByInteraction)).toBe(true);
    const locators = buildWebLocators(fill as never);
    expect(locators.some((candidate) => candidate.strategy === "structural")).toBe(true);
    expect(fill?.rawTypedValue ?? fill?.inputValue).toBe("1500");

    const event = { ...fill, seq: 0, t: 1, kind: "fill", screenKey: "grid-screen", value: "1500", target: { ...fill, locators } } as any;
    const [canonical] = buildCanonicalInteractions([event]);
    expect(canonical.technicalTargetRefs.some((ref) => ref.startsWith("structural:"))).toBe(true);
    expect(canonical.validatedByInteraction).toBe(true);
    const semantic = buildSemanticRecordingModel({
      recordingId: "dynamic-component-production-capture",
      projectSlug: "fixture",
      appSlug: "fixture",
      platform: "web",
      baseUrl: "http://fixture.invalid",
      startedAt: new Date(0).toISOString(),
      status: "stopped",
      events: [event],
      screens: [{ screenKey: "grid-screen", title: "Grid", fingerprint: "grid", firstSeenAt: 0, controls: [], texts: [] }],
    });
    expect(semantic.technicalObservations.some((observation) => observation.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction))).toBe(true);
  });
});
