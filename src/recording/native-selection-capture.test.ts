import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { CAPTURE_NATIVE_SELECTION_SOURCE, type NativeSelectionCapture } from "./native-selection-capture";
import { buildCaptureScriptV2Content } from "./web/capture-engine-v2.browser-instrumentation";
import { normalizeEvents } from "./trace-normalizer";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";
import { resolveActionTarget } from "../discovery/target-resolver";

// Isolated DOM fixtures only. No project login, job, or external application.
test("native selection preserves distinct owners and keys through capture and projection", async () => {
  new Function(buildCaptureScriptV2Content());
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("http://selection-fixture.test/**", route => route.fulfill({ body: "<html></html>", contentType: "text/html" }));
    await page.goto("http://selection-fixture.test/");
    await page.setContent(`<form>
      <section><h3>Primary item</h3><div><select id="primary" hidden><option value="">Choose</option><option value="key-a">Item / 20.00</option></select><span id="pick-a">Item / 20.00</span></div></section>
      <section><h3>Secondary item</h3><div><select id="secondary" hidden><option value="">Choose</option><option value="key-b">Item / 20.00</option></select><span id="pick-b">Item / 20.00</span></div></section>
      <button id="submit">Continue</button>
    </form>`);
    const messages: any[] = [];
    await page.exposeBinding("__qaRecordV2", (_source, message) => { messages.push(message); });
    await page.evaluate(buildCaptureScriptV2Content());
    await page.locator("#pick-a").click();
    await page.evaluate(async () => { await (window as any).__qaRecorderV2Flush(); });
    const click = messages.find(message => message.type === "click");
    assert.equal(click?.composedPath?.[0]?.playwrightRecorderEvidence?.nativeSelection?.clickedOption?.value, "key-a", "real injected click carries the native key");
    const capture = async (id: string) => page.evaluate(({ source, id }) => {
      const read = new Function(`return ${source}`)();
      return read(document.getElementById(id));
    }, { source: CAPTURE_NATIVE_SELECTION_SOURCE, id }) as Promise<NativeSelectionCapture | undefined>;
    const primary = await capture("pick-a");
    const secondary = await capture("pick-b");
    assert.equal(primary?.controlIdentity.value, "primary");
    assert.equal(secondary?.controlIdentity.value, "secondary");
    assert.equal(primary?.fieldLabel, "Primary item");
    assert.equal(secondary?.fieldLabel, "Secondary item");
    assert.equal(primary?.clickedOption?.value, "key-a");
    assert.equal(secondary?.clickedOption?.value, "key-b");
    assert.equal(await capture("submit"), undefined);
    const events: RecordedEvent[] = [primary!, secondary!].map((nativeSelection, index) => ({
      seq: index + 1, t: (index + 1) * 1000, kind: "tap", screenKey: "fixture",
      interactionId: `pointer-${index}`,
      target: {
        tag: "span", label: "Item / 20.00", locators: [],
        playwrightRecorderEvidence: { kind: "text", normalizedName: "Item / 20.00", runtimeResolutionRequired: true, nativeSelection },
      },
    }));
    const normalized = normalizeEvents(events);
    const canonical = buildCanonicalInteractions(normalized).filter(action => action.action === "select");
    assert.equal(canonical.length, 2, "neither owner selection may disappear");
    assert.deepEqual(canonical.map(action => action.semanticField), ["Primary item", "Secondary item"]);
    assert.notEqual(canonical[0].valueKey, canonical[1].valueKey);
    assert.equal(canonical[0].playwrightRecorderEvidence?.nativeSelection?.clickedOption?.value, "key-a");
    // Exact internal key translates the old display label to the current native option.
    await page.setContent(`<div><select id="primary" aria-label="Primary item"><option value="">Choose</option><option value="key-x">Other</option><option value="key-a">Updated item / 99.00</option></select></div>`);
    const evidence = { kind: "text" as const, normalizedName: "Item / 20.00", scopeIdentity: primary!.scopeIdentity, runtimeResolutionRequired: true, nativeSelection: primary! };
    const result = await resolveActionTarget(page, { elements: [] } as any, "Primary item", {
      actionType: "action_select", recordingActionType: "select", selectionField: "Primary item",
      associatedField: "Primary item", selectionValue: "Item / 20.00", playwrightRecorderEvidence: evidence,
    });
    assert.equal(result.selectionApplied, true);
    assert.equal(await page.locator("#primary").inputValue(), "key-a");
    await page.locator('option[value="key-a"]').evaluate(element => element.remove());
    const missing = await resolveActionTarget(page, { elements: [] } as any, "Primary item", {
      actionType: "action_select", recordingActionType: "select", selectionField: "Primary item",
      associatedField: "Primary item", selectionValue: "Item / 20.00", playwrightRecorderEvidence: evidence,
    });
    assert.notEqual(missing.status, "resolved", "missing recorded key cannot pick another option");
    await page.setContent(`<div><select id="primary" hidden><option value="">Choose</option><option value="key-a">Updated item / 99.00</option></select><span id="current-choice">Updated item / 99.00</span></div>
      <div><select id="secondary" hidden><option value="">Choose</option><option value="key-b">Updated item / 99.00</option></select><span>Updated item / 99.00</span></div>`);
    await page.locator("#current-choice").evaluate(element => {
      element.addEventListener("click", () => { (document.getElementById("primary") as HTMLSelectElement).value = "key-a"; });
    });
    const custom = await resolveActionTarget(page, { elements: [] } as any, "Primary item", {
      actionType: "action_select", recordingActionType: "select", selectionField: "Primary item",
      associatedField: "Primary item", selectionValue: "Item / 20.00", playwrightRecorderEvidence: evidence,
    });
    assert.equal(custom.selectionApplied, true, "visible custom option stays inside its captured owner");
    assert.equal(await page.locator("#primary").inputValue(), "key-a");
    assert.equal(await page.locator("#secondary").inputValue(), "");
    // Ambiguous field ownership and duplicate display names are never guessed.
    await page.setContent(`<div><select id="a"><option value="1">Same</option><option value="2">Same</option></select><span id="ambiguous">Same</span></div>`);
    assert.equal((await capture("ambiguous"))?.clickedOption, undefined);
    await page.setContent(`<div><select id="a"><option value="1">Same</option></select><select id="b"><option value="2">Same</option></select><span id="ambiguous">Same</span></div>`);
    assert.equal(await capture("ambiguous"), undefined);
    await page.setContent(`<div><select id="a"><option value="1">Same</option></select><span id="ambiguous">Same</span></div><select id="a"></select>`);
    assert.equal(await capture("ambiguous"), undefined);
  } finally {
    await browser.close();
  }
});
