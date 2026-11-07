import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget, resolveRecordedStructuralOwner, retrySelectionResolutionAfterNetworkIdle } from "./target-resolver";
import type { RecordedTechnicalTarget } from "../recording/session-trace.types";

const certificate = (id: string): RecordedTechnicalTarget => ({
 targetType: "structural", validatedByInteraction: true, certifiedFrom: "recording",
 locatorCandidates: [{ strategy: "css", value: `[id="${id}"]`, confidence: 1 }],
 structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id },
  stableDescendants: [], semanticShape: ["span"], deterministicStructuralIdentity: true,
  targetFingerprint: "captured-owner", structuralIdentityMatchCount: 1, captureTargetMatchCount: 1, captureScopeUnique: true,
  scopeIdentity: { strategy: "id", value: "screen" } },
} as unknown as RecordedTechnicalTarget);

const hrefCertificate = (href: string): RecordedTechnicalTarget => ({
 targetType: "structural", validatedByInteraction: true, certifiedFrom: "recording",
 locatorCandidates: [{ strategy: "css", value: `a[href="${href}"]`, confidence: 1 }],
 structuralContext: { owner: { tag: "a" }, stableDirectAttributes: { href },
  stableDescendants: [], semanticShape: ["span"], deterministicStructuralIdentity: true,
  targetFingerprint: "captured-link", structuralIdentityMatchCount: 1, captureTargetMatchCount: 1, captureScopeUnique: true,
  scopeIdentity: { strategy: "id", value: "screen" }, landmarkAncestor: { tag: "main" } },
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

test("certified href owner waits for its asynchronous mount even when unrelated anchors already exist", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<main id="screen"><a href="/other">Other</a></main>');
  await page.evaluate(() => { setTimeout(() => {
   document.getElementById("screen")!.insertAdjacentHTML("beforeend", '<a href="/requests/create/multiproduct"><span>Solicitud multiproducto</span></a>');
  }, 120); });

  const result = await resolveRecordedStructuralOwner(
   page,
   hrefCertificate("/requests/create/multiproduct"),
   undefined,
   1500,
  );

  assert.ok(result, "an unrelated anchor must not hide a certified link that is still mounting");
  assert.equal(await result.locator.count(), 1);
  assert.equal(await result.locator.getAttribute("href"), "/requests/create/multiproduct");
 } finally { await browser.close(); }
});

test("certified href owner recovers from a stale but unique recorded scope only when the same global target is unique", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<main><section id="screen"><a href="/other"><span>Other</span></a></section><a href="/requests/create/multiproduct"><span>Solicitud multiproducto</span></a></main><nav><a href="/requests/create/multiproduct"><span>Solicitud multiproducto</span></a></nav>');
  const recordedTarget = hrefCertificate("/requests/create/multiproduct");
  // The capture-time id still exists, but now points at another menu branch. The target's
  // capture-unique href and landmark remain its authority; the stale scope must not hide it.
  recordedTarget.structuralContext!.scopeIdentity = { strategy: "id", value: "screen" };

  const result = await resolveRecordedStructuralOwner(page, recordedTarget, undefined, 250);

  assert.ok(result, "the capture-time landmark must disambiguate a duplicated link after the scope id becomes stale");
  assert.equal(await result.locator.count(), 1);
  assert.equal(await result.locator.getAttribute("href"), "/requests/create/multiproduct");
  assert.equal(await result.locator.evaluate((element) => Boolean(element.closest("main"))), true);

  await page.setContent('<main><section id="screen"><a href="/other"><span>Other</span></a></section><nav><a href="/requests/create/multiproduct"><span>Solicitud multiproducto</span></a></nav><aside><a href="/requests/create/multiproduct"><span>Duplicate</span></a></aside></main>');
  assert.equal(
   await resolveRecordedStructuralOwner(page, recordedTarget, undefined, 250),
   undefined,
   "duplicates inside the recorded landmark must remain uncertified even when the recorded scope is stale",
  );
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

test("recorded option candidates share a short scope-readiness budget before field recovery", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent('<main><button id="owner" aria-expanded="false">Oficial</button></main>');
  const recordedTarget = certificate("missing-option");
  recordedTarget.locatorCandidates = [{ strategy: "css", value: '[id="missing-option"]', confidence: 1 }];
  recordedTarget.structuralContext!.scopeIdentity = { strategy: "id", value: "not-mounted-popup" };
  recordedTarget.structuralContext!.targetFingerprint = JSON.stringify({ topologySignature: "captured-option-topology" });
  const started = Date.now();
  const result = await resolveActionTarget(page, {
   url: page.url(),
   elements: [],
  } as any, "Oficial", {
   actionType: "action_select",
   recordingActionType: "click",
   selectionField: "Oficial",
   associatedField: "Oficial",
   selectionValue: "A recorded option",
   recordedTechnicalTargetRefs: ['css:[id="missing-option"]'],
   recordedTechnicalTargets: [recordedTarget],
  });
  assert.ok(Date.now() - started < 2000, "a closed recorded popup must not consume a default 30-second wait per structural candidate");
  assert.notEqual(result.status, "resolved", "an absent recorded option must still fail closed");
 } finally { await browser.close(); }
});

test("value-backed selection retries its field owner after the current request burst settles", async () => {
 const browser = await chromium.launch({ headless: true });
 try {
  const page = await browser.newPage();
  await page.setContent("<main></main>");
  await page.evaluate(() => { setTimeout(() => {
   document.querySelector("main")!.innerHTML = '<label for="kind">Tipo</label><select id="kind"><option>Oficial</option></select>';
  }, 80); });
  let attempts = 0;
  const result = await retrySelectionResolutionAfterNetworkIdle(page, async () => {
   attempts += 1;
   const field = page.getByLabel("Tipo");
   return await field.count().catch(() => 0) === 1 ? "ready" : undefined;
  }, 1000);
  assert.equal(result, "ready");
  assert.equal(attempts, 2, "a missing first owner is retried once after network idle");

  attempts = 0;
  const alreadyReady = await retrySelectionResolutionAfterNetworkIdle(page, async () => {
   attempts += 1;
   return "ready";
  }, 1000);
  assert.equal(alreadyReady, "ready");
  assert.equal(attempts, 1, "a resolved field does not incur a readiness wait");
 } finally { await browser.close(); }
});
