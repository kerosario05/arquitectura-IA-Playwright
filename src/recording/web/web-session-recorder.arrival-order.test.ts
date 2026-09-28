import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import type { CaptureAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent } from "../session-trace.types";

/**
 * FIRST_LOSS (recording b56d2e4e, kiosko): the capture queue lagged the user by 1-2 s while
 * navigations were recorded immediately, and every queued event was stamped with its PROCESSING
 * time and URL. The navigations of "Tarjetas" and "Tarjeta de Crédito" landed before those clicks,
 * so derivation credited "Explora nuestros productos" with a jump straight to
 * /product-subcategory?...credit and replay stopped at step 1 (RECORDED_POSTCONDITION_NOT_REACHED).
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2PointerObservation(record: ShadowActionRecord): void;
  recordMainFrameNavigation(url: string): void;
  v2IngestionQueue: Promise<void>;
  page: unknown;
};

/** Page stand-in: the post-click observation wait takes real time, so the queue falls behind. */
function fakePage(state: { url: string }, clickObservationMs: number) {
  return {
    url: () => state.url,
    isClosed: () => false,
    waitForTimeout: (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.min(ms, clickObservationMs))),
    evaluate: async () => "probe",
    screenshot: async () => { throw new Error("no screenshots in this test"); },
  };
}

let seq = 0;
function pointer(label: string, interactionId: string): ShadowActionRecord {
  seq += 1;
  const action = {
    actionType: "observation",
    observationType: "pointer",
    interactionId,
    identity: { label, tagName: "button", role: "button" },
    owner: { tag: "button", role: "button", accessibleName: label, technicalRefs: [`testid:${label}`] },
  } as unknown as CaptureAction;
  return { seq, action };
}
function click(label: string, interactionId: string): ShadowActionRecord {
  seq += 1;
  const action = {
    actionType: "click",
    interactionId,
    identity: { label, tagName: "button", role: "button" },
    owner: { tag: "button", role: "button", accessibleName: label, technicalRefs: [`testid:${label}`] },
  } as unknown as CaptureAction;
  return { seq, action };
}

test("navigations stay after the clicks that caused them, even when captures are processed late", async () => {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://kiosko.test/",
    framesDir: path.join(os.tmpdir(), "arrival-order-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  const state = { url: "http://kiosko.test/" };
  recorder.page = fakePage(state, 150);

  // The user acts every ~30 ms while each click capture takes ~450 ms to process (post-click
  // observation), so the queue falls well behind -- the recording b56d2e4e shape.
  const userPause = () => new Promise((resolve) => setTimeout(resolve, 30));
  recorder.onV2PointerObservation(pointer("Explora nuestros productos", "pointer-1"));
  await userPause();
  recorder.onV2TechnicalAction(click("Explora nuestros productos", "pointer-1"));
  await userPause();
  state.url = "http://kiosko.test/product-catalog";
  recorder.recordMainFrameNavigation(state.url);
  await userPause();

  recorder.onV2PointerObservation(pointer("Tarjetas", "pointer-2"));
  await userPause();
  recorder.onV2TechnicalAction(click("Tarjetas", "pointer-2"));
  await userPause();
  state.url = "http://kiosko.test/product-subcategory?category=cards";
  recorder.recordMainFrameNavigation(state.url);

  await recorder.v2IngestionQueue;

  const sequence = events.map((event) => `${event.kind}:${event.target?.label ?? event.url?.replace("http://kiosko.test", "")}`);
  assert.deepEqual(sequence.filter((entry) => !entry.startsWith("screen_change")), [
    "note:Explora nuestros productos",
    "tap:Explora nuestros productos",
    "navigate:/product-catalog",
    "note:Tarjetas",
    "tap:Tarjetas",
    "navigate:/product-subcategory?category=cards",
  ]);

  // Arrival time and URL, not processing time: monotonic, and each pointer carries the page it
  // was pressed on.
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t, `t must not go back at ${sequence[i]}`);
  const tarjetasPointer = events.find((event) => event.kind === "note" && event.target?.label === "Tarjetas");
  assert.equal(tarjetasPointer?.url, "http://kiosko.test/product-catalog");

  // Derivation now binds each navigation to its own click.
  const interactions = buildCanonicalInteractions(events).filter((interaction) => interaction.action === "click");
  const explora = interactions.find((interaction) => /Explora/.test(interaction.semanticField ?? interaction.controlIdentity ?? ""));
  const tarjetas = interactions.find((interaction) => /Tarjetas/.test(interaction.semanticField ?? interaction.controlIdentity ?? ""));
  assert.equal(explora?.routeBefore, "http://kiosko.test/");
  assert.equal(explora?.routeAfter, "http://kiosko.test/product-catalog");
  assert.equal(tarjetas?.routeBefore, "http://kiosko.test/product-catalog");
  assert.equal(tarjetas?.routeAfter, "http://kiosko.test/product-subcategory?category=cards");
});
