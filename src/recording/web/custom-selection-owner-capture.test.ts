import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { CaptureEngineV2ShadowBridge, type ShadowActionRecord, type ShadowFunctionalActionRecord } from "../capture-engine-v2.shadow-bridge";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import type { RecordedEvent } from "../session-trace.types";
import { WebSessionRecorder } from "./web-session-recorder";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2FunctionalAction(record: ShadowFunctionalActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

test("custom ARIA dropdown stores option value with its uniquely labelled trigger", async (context) => {
  const browser = await chromium.launch({ headless: true });
  context.after(() => browser.close());
  const page = await browser.newPage();
  context.after(() => page.close());

  const bridge = new CaptureEngineV2ShadowBridge();
  await page.exposeBinding("__qaRecordV2", (_source, message) => bridge.handleMessage(message));
  await page.setContent(`
    <main>
      <section data-field="currency">
        <span>Moneda</span>
        <button id="currency-trigger" role="button" aria-haspopup="listbox" aria-controls="currency-options">DOP</button>
      </section>
      <ul id="currency-options" role="listbox">
        <li id="usd-option" role="option">USD</li>
      </ul>
    </main>
  `);
  await page.evaluate(buildCaptureScriptV2Content("custom-dropdown-fixture"));
  await page.getByRole("button", { name: "DOP" }).click();
  await page.getByRole("option", { name: "USD" }).click();

  assert.equal(bridge.functionalActions.length, 1);
  const projectedOwner = bridge.functionalActions[0].action.owner;
  assert.equal(projectedOwner?.selectionTriggerEvidence, "aria_popup");
  assert.equal(projectedOwner?.associatedField, "Moneda");

  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://custom-dropdown.fixture",
    framesDir: path.join(os.tmpdir(), "qa-custom-dropdown-selection-test"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  for (const action of bridge.technicalActions) recorder.onV2TechnicalAction(action);
  for (const action of bridge.functionalActions) recorder.onV2FunctionalAction(action);
  await recorder.v2IngestionQueue;

  const selection = events.find((event) => event.target?.compoundRole === "selection");
  assert.equal(selection?.target?.associatedField, "Moneda");
  assert.equal(selection?.target?.afterValue, "USD");
  assert.equal(selection?.target?.dynamicLifecycle?.triggerTechnicalTarget, projectedOwner?.technicalRefs?.[0]);
  assert.deepEqual(selection?.target?.sourceTechnicalEventSeqs, [events[0].seq, events[1].seq]);

  const canonical = buildCanonicalInteractions(events).find((interaction) => interaction.action === "select");
  assert.equal(canonical?.semanticField, "Moneda");
  assert.equal(canonical?.recordedValue, "USD");
  assert.equal(canonical?.selectorControlId, "selector:id:currency-trigger", JSON.stringify(canonical));
});
