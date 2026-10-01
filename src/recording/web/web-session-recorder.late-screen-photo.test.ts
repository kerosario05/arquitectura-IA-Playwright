import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import type { CaptureAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent } from "../session-trace.types";

/**
 * Recording e52ee42c: the capture queue lagged the user, and each click's "resulting screen" was
 * photographed when the queue reached it -- for "Explora nuestros productos" that was the Visa
 * Gold detail page, three clicks later. A click processed after the user already acted again no
 * longer records a screen_change: the page on screen is not its result.
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2PointerObservation(record: ShadowActionRecord): void;
  recordMainFrameNavigation(url: string): void;
  absorbScreen(changedSince?: string): Promise<{ changed: boolean; screenKey: string }>;
  v2IngestionQueue: Promise<void>;
  page: unknown;
};

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
function record(actionType: "observation" | "click", label: string, interactionId: string): ShadowActionRecord {
  seq += 1;
  const action = {
    actionType,
    ...(actionType === "observation" ? { observationType: "pointer" } : {}),
    interactionId,
    identity: { label, tagName: "button", role: "button" },
    owner: { tag: "button", role: "button", accessibleName: label, technicalRefs: [`testid:${label}`] },
  } as unknown as CaptureAction;
  return { seq, action };
}

function recorderOn(state: { url: string }, clickObservationMs: number) {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://kiosko.test/",
    framesDir: path.join(os.tmpdir(), "late-screen-photo-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  }) as unknown as RecorderInternals;
  recorder.page = fakePage(state, clickObservationMs);
  // The "screen" is whatever page is showing when the photo is taken.
  let last = "http://kiosko.test/";
  recorder.absorbScreen = async () => {
    const changed = state.url !== last;
    last = state.url;
    return { changed, screenKey: state.url.replace("http://kiosko.test", "") };
  };
  return { recorder, events };
}

function screenChangeCreditedTo(events: RecordedEvent[], label: string): RecordedEvent | undefined {
  const index = events.findIndex((event) => event.kind === "tap" && event.target?.label === label);
  const next = events.slice(index + 1).find((event) => event.kind === "screen_change" || event.kind === "tap");
  return next?.kind === "screen_change" ? next : undefined;
}

test("a click processed after the user moved on records no screen_change for it", async () => {
  const state = { url: "http://kiosko.test/" };
  const { recorder, events } = recorderOn(state, 150);
  const pause = () => new Promise((resolve) => setTimeout(resolve, 30));
  recorder.onV2PointerObservation(record("observation", "Explora nuestros productos", "p-1"));
  recorder.onV2TechnicalAction(record("click", "Explora nuestros productos", "p-1"));
  await pause();
  state.url = "http://kiosko.test/product-catalog";
  recorder.recordMainFrameNavigation(state.url);
  await pause();
  recorder.onV2PointerObservation(record("observation", "Tarjeta Visa Gold", "p-2"));
  recorder.onV2TechnicalAction(record("click", "Tarjeta Visa Gold", "p-2"));
  await pause();
  state.url = "http://kiosko.test/product-extended?product=visa-gold";
  recorder.recordMainFrameNavigation(state.url);
  await recorder.v2IngestionQueue;

  // Before the fix, "Explora" was credited with the detail page it never opened.
  assert.equal(screenChangeCreditedTo(events, "Explora nuestros productos"), undefined, JSON.stringify(events.map((event) => `${event.kind}:${event.target?.label ?? event.toScreenKey ?? event.url ?? ""}`)));
});

test("a click processed on time still records its screen_change", async () => {
  const state = { url: "http://kiosko.test/" };
  const { recorder, events } = recorderOn(state, 5);
  recorder.onV2PointerObservation(record("observation", "Explora nuestros productos", "p-1"));
  state.url = "http://kiosko.test/product-catalog";
  recorder.onV2TechnicalAction(record("click", "Explora nuestros productos", "p-1"));
  await recorder.v2IngestionQueue;
  assert.equal(screenChangeCreditedTo(events, "Explora nuestros productos")?.toScreenKey, "/product-catalog");
});
