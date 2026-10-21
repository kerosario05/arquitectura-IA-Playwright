import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveRecordedStructuralOwner } from "./target-resolver";
import type { RecordedTechnicalTarget } from "../recording/session-trace.types";

const certificate = (id: string): RecordedTechnicalTarget => ({
 targetType: "structural", validatedByInteraction: true, certifiedFrom: "recording",
 locatorCandidates: [{ strategy: "css", value: `[id="${id}"]`, confidence: 1 }],
 structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id },
  stableDescendants: [], semanticShape: ["span"], deterministicStructuralIdentity: true,
  targetFingerprint: "captured-owner", structuralIdentityMatchCount: 1, captureTargetMatchCount: 1, captureScopeUnique: true,
  scopeIdentity: { strategy: "id", value: "screen" } },
} as unknown as RecordedTechnicalTarget);

test("certified owner waits for its own asynchronous mount inside the recorded scope", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  for (const id of ["request-action", "inventory-action"]) {
   await page.setContent('<section id="screen"><button>Other</button></section>');
   await page.evaluate(id => { setTimeout(() => {
    const button = document.createElement("button"); button.id = id;
    button.innerHTML = "<span>Open</span>";
    button.onclick = () => { button.dataset.executed = "yes"; };
    document.getElementById("screen")!.appendChild(button);
   }, 120); }, id);
   const result = await resolveRecordedStructuralOwner(page, certificate(id));
   assert.ok(result, "a mounted scope does not prove its certified child is ready yet");
   assert.equal(await result.locator.count(), 1);
   await result.locator.click();
   assert.equal(await page.locator(`[id="${id}"]`).getAttribute("data-executed"), "yes");
  }
  await page.setContent('<section id="screen"><button id="duplicate"><span>Open</span></button><button id="duplicate"><span>Open</span></button></section>');
  assert.equal(await resolveRecordedStructuralOwner(page, certificate("duplicate")), undefined);
  await page.setContent('<section id="screen"><button id="disabled" disabled><span>Open</span></button></section>');
  assert.equal(await resolveRecordedStructuralOwner(page, certificate("disabled")), undefined);
  await page.setContent('<section id="screen"><button id="wrong-shape">Open</button></section>');
  const weak = certificate("wrong-shape");
  weak.structuralContext!.deterministicStructuralIdentity = false;
  assert.equal(await resolveRecordedStructuralOwner(page, weak), undefined);
 } finally { await browser.close(); }
});


test("structural readiness accepts a configured deadline beyond five seconds and respects a shorter budget", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  page.setDefaultTimeout(100);
  await page.setContent('<section id="screen"><button>Other</button></section>');
  await page.evaluate(() => { setTimeout(() => {
   document.getElementById("screen")!.insertAdjacentHTML("beforeend", '<button id="slow"><span>Open</span></button>');
  }, 5100); });
  assert.ok(await resolveRecordedStructuralOwner(page, certificate("slow"), undefined, 7000));
  await page.setContent('<section id="screen"><button>Other</button></section>');
  const started = Date.now();
  assert.equal(await resolveRecordedStructuralOwner(page, certificate("missing"), undefined, 80), undefined);
  assert.ok(Date.now() - started < 1500, "a short configured budget must not fall back to a fixed five-second wait");
 } finally { await browser.close(); }
});
