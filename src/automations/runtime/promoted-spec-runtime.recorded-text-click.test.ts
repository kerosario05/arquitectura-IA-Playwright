import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { compileDeterministicSpec } from "../spec-compiler/deterministic-spec-compiler";
import type { SpecExecutionContract } from "../spec-execution-contract";
import { chromium } from "@playwright/test";
import { createPromotedSpecRuntime, resolvePromotedClickableLocator, clickPromotedLocatorWithBoundedReresolution } from "./promoted-spec-runtime";

test("recorded text opener uses exact unique identity across unrelated dropdown vocabularies", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  for (const value of ["Choose", "Pick account"]) {
   await page.setContent(`<div onclick="this.dataset.open='yes'">${value}</div><div>${value} type</div>`);
   const compiled = compileDeterministicSpec({
    version: "1", scenarioId: "fixture", title: "Fixture", unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
    steps: [{ contractStepIndex: 0, scenarioStepIndex: 9, originalText: "Open recorded control",
     operation: "click", required: true, executionStatus: "executed", evidenceRefs: [],
     target: { strategy: "text", value }, technicalTargetRef: `text:${value}`,
     resolutionState: "runtime_resolution_required" }],
   } as SpecExecutionContract, { targetSpecPath: path.resolve(".artifacts/tmp/dropdown-fixture.spec.ts") });
   assert.deepEqual(compiled.unsupportedCapabilities, []);
   assert.ok(compiled.source.includes(`parseSerializedTechnicalTargetString('text:${value}')!, true)`));
   assert.ok(compiled.source.includes(`technicalTargetRefs: ['text:${value}']`));
   const binding = compiled.bindings.find(entry => entry.scenarioStepIndex === 9)!;
   const resolved = await resolvePromotedClickableLocator(page, binding.targetRef!, {
    targetIdentity: { technicalTargetRefs: [`text:${value}`] }, timeoutMs: 200,
   });
   assert.ok(resolved, "recorded exact target must survive a second partial text match");
   assert.equal(await resolved.locator.count(), 1);
   await resolved.locator.click();
   assert.equal(await page.getByText(value, { exact: true }).getAttribute("data-open"), "yes");
   assert.equal(await page.getByText(`${value} type`, { exact: true }).getAttribute("data-open"), null);
  }
  for (const html of [
   '<button>Choose</button><button>Choose</button>',
   '<button>Choose type</button>',
   '<button hidden>Choose</button><button>Choose type</button>',
   '<button disabled>Choose</button>',
  ]) {
   await page.setContent(html);
   const resolved = await resolvePromotedClickableLocator(page, "text:Choose", {
    targetIdentity: { technicalTargetRefs: ["text:Choose"] }, timeoutMs: 100,
   });
   assert.equal(resolved, undefined, "absent, duplicate, hidden and disabled exact identities fail closed");
  }
  await page.setContent('<section id="active"><div>Choose</div></section><div>Choose</div>');
  const scoped = await resolvePromotedClickableLocator(page, "text:Choose", {
   containerLocator: "#active", targetIdentity: { technicalTargetRefs: ["text:Choose"] }, timeoutMs: 100,
  });
  assert.equal(scoped?.scope, "container");
  assert.equal(await scoped?.locator.count(), 1);
  await page.setContent('<button id="stable">Accounts</button><button>Accounts type</button>');
  const stable = await resolvePromotedClickableLocator(page, "text:Accounts", {
   targetIdentity: { technicalTargetRefs: ["id:stable", "text:Accounts"] }, timeoutMs: 100,
  });
  assert.equal(stable?.strategy, "recorded:id", "stronger recorded IDs retain priority");
 } finally { await browser.close(); }
});


test("complete promoted click honors recorded text before associated-field inference and never invokes a partial callback", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<div><div onclick="this.dataset.open=String(Number(this.dataset.open || 0)+1)">Choose</div><input id="session-input" role="combobox" readonly style="pointer-events:none"></div><div>Choose type</div>');
  await page.evaluate("globalThis.__name = (value) => value");
  const runtime = createPromotedSpecRuntime(page, { enabled: false, actionTimeoutMs: 500 });
  await page.route("**/*", route => route.abort());
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).recordActionEvidence = async () => undefined;
  let callbackInvoked = false;
  await runtime.clickPromotedTarget({
   stepIndex: 9, target: "text:Choose", technicalTargetRefs: ["text:Choose"],
   associatedField: "Choose", actionIntent: "click", expectedEffect: "none",
   playwrightRecorderEvidence: { kind: "text", normalizedName: "Choose", targetTag: "div",
    scopeIdentity: { strategy: "css", value: 'div:has(input[id="session-input"])' },
    captureMatchCount: 1, runtimeResolutionRequired: true },
   action: async () => { callbackInvoked = true; await page.getByText("Choose").click({ timeout: 100 }); },
  });
  assert.equal(callbackInvoked, false);

  assert.equal(await page.getByText("Choose", { exact: true }).getAttribute("data-open"), "1");
  await page.setContent('<button>Choose</button><button>Choose</button>');
  await assert.rejects(runtime.clickPromotedTarget({
   stepIndex: 9, target: "text:Choose", technicalTargetRefs: ["text:Choose"],
   associatedField: "Choose", actionIntent: "click", expectedEffect: "none",
   action: async () => { callbackInvoked = true; },
  }), /promoted_recorded_text_click_failed/);
  assert.equal(callbackInvoked, false, "ambiguous exact identity must not escape into a callback");

 } finally { await browser.close(); }
});


test("bounded re-resolution retains exact recorded text after a detached opener", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<button onclick="this.dataset.clicked=String(Number(this.dataset.clicked || 0)+1)">Choose</button><button>Choose type</button>');
  let retries = 0;
  const result = await clickPromotedLocatorWithBoundedReresolution({ locator: {
   click: async () => { throw new Error("element is detached from DOM"); },
  } }, async () => {
   retries++;
   return resolvePromotedClickableLocator(page, "text:Choose", {
    targetIdentity: { technicalTargetRefs: ["text:Choose"] }, timeoutMs: 200,
   });
  }, 300);
  assert.equal(retries, 1);
  assert.equal(result.reResolved, true);
  assert.equal(await page.getByText("Choose", { exact: true }).getAttribute("data-clicked"), "1");
  assert.equal(await page.getByText("Choose type", { exact: true }).getAttribute("data-clicked"), null);
 } finally { await browser.close(); }
});

test("recorded text repeated on the page resolves only inside the recorder scope and still fails closed when ambiguous there", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<form id="scoped"><div onclick="this.dataset.open=\'yes\'">Pick</div></form><div>Pick</div>');
  await page.evaluate("globalThis.__name = (value) => value");
  const runtime = createPromotedSpecRuntime(page, { enabled: false, actionTimeoutMs: 500 });
  await page.route("**/*", route => route.abort());
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).recordActionEvidence = async () => undefined;
  let callbackInvoked = false;
  const options = {
   stepIndex: 3, target: "text:Pick", technicalTargetRefs: ["text:Pick"], actionIntent: "click", expectedEffect: "none",
   playwrightRecorderEvidence: { kind: "text", normalizedName: "Pick", targetTag: "div",
    scopeIdentity: { strategy: "id", value: "scoped" }, captureMatchCount: 1, runtimeResolutionRequired: true },
   action: async () => { callbackInvoked = true; },
  } as any;
  await runtime.clickPromotedTarget(options);
  assert.equal(await page.locator("#scoped div").getAttribute("data-open"), "yes");
  await page.setContent('<form id="scoped"><div>Pick</div><div>Pick</div></form>');
  await assert.rejects(runtime.clickPromotedTarget(options), /promoted_recorded_text_click_failed/);
  assert.equal(callbackInvoked, false);
 } finally { await browser.close(); }
});
