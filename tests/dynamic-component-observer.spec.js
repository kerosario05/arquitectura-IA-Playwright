"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const dynamic_component_observer_1 = require("../src/recording/web/dynamic-component-observer");
const canonical_recording_contract_1 = require("../src/recording/canonical-recording-contract");
const semantic_recording_1 = require("../src/recording/semantic-recording");
const web_session_recorder_1 = require("../src/recording/web/web-session-recorder");
const dynamic_component_lab_1 = require("./fixtures/dynamic-component-lab");
test_1.test.describe("Dynamic Component Observer laboratory", () => {
    (0, test_1.test)("discovers the real editable child, option inventory and dependent enablement", async ({ page }) => {
        await page.setContent((0, dynamic_component_lab_1.dynamicComponentLabHtml)({ portal: false, labels: { left: "Measure A", right: "Measure B" } }));
        const cell = page.locator('[data-cell="row-a-left"]');
        const display = cell.locator("[data-display]");
        const activation = await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, display);
        (0, test_1.expect)(activation.before.state).toBe("DISPLAY");
        (0, test_1.expect)(activation.after.state).toBe("EDITOR_MATERIALIZED");
        (0, test_1.expect)(activation.after.editableControl?.disabled).toBe(true);
        (0, test_1.expect)(activation.after.structuralContext.cellRef).toBe("row-a-left");
        const selector = cell.locator('[role="combobox"]');
        const selectorObservation = await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, selector);
        (0, test_1.expect)(selectorObservation.after.state).toBe("SELECTOR_OPEN");
        (0, test_1.expect)(selectorObservation.after.surface?.portalized).toBe(false);
        (0, test_1.expect)(selectorObservation.after.surface?.options.map((option) => option.text)).toEqual([
            "Option One",
            "Option Two",
            "Option Three",
        ]);
        const options = page.locator('[role="option"]');
        await options.nth(0).focus();
        (0, test_1.expect)(await cell.locator('[role="combobox"]').getAttribute("data-selected")).toBeNull();
        await options.nth(1).click();
        (0, test_1.expect)(await cell.locator('[role="combobox"]').getAttribute("data-selected")).toBe("Option Two");
        const input = cell.locator('input[data-child-role="amount_or_text"]');
        (0, test_1.expect)(await input.isEnabled()).toBe(true);
        await input.fill("1500");
        const editingSnapshot = await (0, dynamic_component_observer_1.captureDynamicComponentSnapshot)(cell);
        const amountTarget = (0, dynamic_component_observer_1.technicalTargetsForSnapshot)(editingSnapshot, true)
            .find((candidate) => candidate.semanticRole === "amount_or_text");
        (0, test_1.expect)(editingSnapshot.state).toBe("VALUE_EDITING");
        (0, test_1.expect)(amountTarget).toBeDefined();
        (0, test_1.expect)(amountTarget?.validatedByInteraction).toBe(true);
        (0, test_1.expect)(amountTarget?.locatorCandidates.some((candidate) => candidate.strategy === "structural")).toBe(true);
        (0, test_1.expect)(amountTarget?.locatorCandidates.some((candidate) => /nth|first|coordinate/i.test(candidate.value))).toBe(false);
        const logicalValue = await input.inputValue();
        await input.evaluate((element) => element.blur());
        const displayValue = await cell.locator("[data-display]").getAttribute("data-display-value");
        (0, test_1.expect)(logicalValue).toBe("1500");
        (0, test_1.expect)(displayValue).toBe("Option Two 1500");
        (0, test_1.expect)((await (0, dynamic_component_observer_1.captureDynamicComponentSnapshot)(cell)).state).toBe("DISPLAY");
        const rawEvent = {
            seq: 0,
            t: 1,
            kind: "fill",
            screenKey: "grid-screen",
            value: logicalValue,
            target: {
                label: "",
                role: "input",
                compoundRole: "amount_or_text",
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
        const [canonicalAmount] = (0, canonical_recording_contract_1.buildCanonicalInteractions)([rawEvent]);
        (0, test_1.expect)(canonicalAmount.valueKey).toBe("entity_1.measure_a_valor");
        (0, test_1.expect)(canonicalAmount.technicalTargetRefs.some((ref) => ref.startsWith("structural:"))).toBe(true);
        (0, test_1.expect)(canonicalAmount.validatedByInteraction).toBe(true);
        const semanticModel = (0, semantic_recording_1.buildSemanticRecordingModel)({
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
        (0, test_1.expect)(semanticModel.technicalObservations.some((observation) => observation.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction))).toBe(true);
    });
    (0, test_1.test)("follows a portalized dynamic surface and treats popup ids as session evidence", async ({ page }) => {
        await page.setContent((0, dynamic_component_lab_1.dynamicComponentLabHtml)({ portal: true, ariaControls: true, options: ["Alpha", "Beta"] }));
        const cell = page.locator('[data-cell="row-a-left"]');
        await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, cell.locator("[data-display]"));
        const first = await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, cell.locator('[role="combobox"]'));
        (0, test_1.expect)(first.documentEscalationUsed).toBe(true);
        (0, test_1.expect)(first.portalDetected).toBe(true);
        (0, test_1.expect)(first.ariaControlsFollowed).toBe(true);
        (0, test_1.expect)(first.after.surface?.options.map((option) => option.text)).toEqual(["Alpha", "Beta"]);
        const firstSurfaceId = first.after.surface?.surfaceRef;
        await page.locator('[role="option"]').first().click();
        const secondCell = page.locator('[data-cell="row-a-right"]');
        await secondCell.locator("[data-display]").click();
        await (0, test_1.expect)(secondCell.locator('[role="combobox"]')).toHaveCount(1);
        const second = await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, secondCell.locator('[role="combobox"]'));
        (0, test_1.expect)(second.portalDetected).toBe(true);
        (0, test_1.expect)(second.after.surface?.surfaceRef).not.toBe(firstSurfaceId);
        (0, test_1.expect)(second.technicalTargets.every((target) => !target.locatorCandidates.some((candidate) => candidate.value.includes(firstSurfaceId || "__missing__")))).toBe(true);
    });
    (0, test_1.test)("keeps compound child identities distinct across siblings and rows", async ({ page }) => {
        await page.setContent((0, dynamic_component_lab_1.dynamicComponentLabHtml)({ portal: false, labels: { left: "A different label", right: "Another label" } }));
        const left = page.locator('[data-cell="row-a-left"]');
        const right = page.locator('[data-cell="row-a-right"]');
        const otherRow = page.locator('[data-cell="row-b-left"]');
        await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, left.locator("[data-display]"));
        const leftSnapshot = await (0, dynamic_component_observer_1.captureDynamicComponentSnapshot)(left);
        await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, right.locator("[data-display]"));
        const rightSnapshot = await (0, dynamic_component_observer_1.captureDynamicComponentSnapshot)(right);
        await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, otherRow.locator("[data-display]"));
        const otherRowSnapshot = await (0, dynamic_component_observer_1.captureDynamicComponentSnapshot)(otherRow);
        const leftTarget = (0, dynamic_component_observer_1.technicalTargetsForSnapshot)(leftSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
        const rightTarget = (0, dynamic_component_observer_1.technicalTargetsForSnapshot)(rightSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
        const otherRowTarget = (0, dynamic_component_observer_1.technicalTargetsForSnapshot)(otherRowSnapshot).find((candidate) => candidate.semanticRole === "amount_or_text");
        (0, test_1.expect)(leftTarget?.structuralContext?.cellRef).not.toBe(rightTarget?.structuralContext?.cellRef);
        (0, test_1.expect)(leftTarget?.structuralContext?.rowRef).not.toBe(otherRowTarget?.structuralContext?.rowRef);
        (0, test_1.expect)(leftTarget?.locatorCandidates.some((candidate) => candidate.strategy === "structural")).toBe(true);
        (0, test_1.expect)([leftTarget, rightTarget, otherRowTarget].every((target) => target?.locatorCandidates.every((candidate) => !/nth|first|coordinate/i.test(candidate.value)))).toBe(true);
    });
    (0, test_1.test)("supports an initially enabled child without aria-controls or business labels", async ({ page }) => {
        await page.setContent((0, dynamic_component_lab_1.dynamicComponentLabHtml)({
            ariaControls: false,
            initiallyEnabled: true,
            labels: { left: "Metric X", right: "Metric Y" },
            options: ["Choice North", "Choice South"],
        }));
        const cell = page.locator('[data-cell="row-b-right"]');
        await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, cell.locator("[data-display]"));
        const input = cell.locator('input[data-child-role="amount_or_text"]');
        (0, test_1.expect)(await input.isEnabled()).toBe(true);
        const observation = await (0, dynamic_component_observer_1.observeDynamicComponentActivation)(page, cell.locator('[role="combobox"]'));
        (0, test_1.expect)(observation.ariaControlsFollowed).toBe(false);
        (0, test_1.expect)(observation.after.surface?.options.map((option) => option.text)).toEqual(["Choice North", "Choice South"]);
    });
    (0, test_1.test)("records the actual child through the production web capture script", async ({ page }) => {
        const captured = [];
        await page.exposeBinding("__qaRecord", async (_source, payload) => {
            captured.push(payload);
        });
        await page.setContent((0, dynamic_component_lab_1.dynamicComponentLabHtml)({ portal: true, options: ["Choice A", "Choice B"] }));
        await page.evaluate(web_session_recorder_1.CAPTURE_SCRIPT);
        const cell = page.locator('[data-cell="row-a-left"]');
        await cell.locator("[data-display]").click();
        await cell.locator('[role="combobox"]').click();
        await page.locator('[role="option"]').nth(1).click();
        const input = cell.locator('input[data-child-role="amount_or_text"]');
        await input.fill("1500");
        await input.evaluate((element) => element.blur());
        await page.waitForTimeout(220);
        const fill = captured.filter((event) => event.kind === "input" && event.compoundRole === "amount_or_text").at(-1);
        (0, test_1.expect)(fill).toBeDefined();
        (0, test_1.expect)(fill?.deepestEditableTargetRef).toBeTruthy();
        (0, test_1.expect)(fill?.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction)).toBe(true);
        const locators = (0, web_session_recorder_1.buildWebLocators)(fill);
        (0, test_1.expect)(locators.some((candidate) => candidate.strategy === "structural")).toBe(true);
        (0, test_1.expect)(fill?.rawTypedValue ?? fill?.inputValue).toBe("1500");
        const event = { ...fill, seq: 0, t: 1, kind: "fill", screenKey: "grid-screen", value: "1500", target: { ...fill, locators } };
        const [canonical] = (0, canonical_recording_contract_1.buildCanonicalInteractions)([event]);
        (0, test_1.expect)(canonical.technicalTargetRefs.some((ref) => ref.startsWith("structural:"))).toBe(true);
        (0, test_1.expect)(canonical.validatedByInteraction).toBe(true);
        const semantic = (0, semantic_recording_1.buildSemanticRecordingModel)({
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
        (0, test_1.expect)(semantic.technicalObservations.some((observation) => observation.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction))).toBe(true);
    });
});
