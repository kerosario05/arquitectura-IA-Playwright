import assert from "node:assert/strict";
import test from "node:test";
import { LiveViewSession, parseClientMessage, type LiveCdp, type LiveViewerSocket } from "./live-view-session";
import { resolveRecordingPresentation, resolveRecordingViewport, DEFAULT_RECORDING_VIEWPORT } from "./recording-presentation";

class FakeCdp implements LiveCdp {
  sent: Array<{ method: string; params?: Record<string, unknown> }> = [];
  private handlers = new Map<string, (payload: any) => void>();
  async send(method: string, params?: Record<string, unknown>) { this.sent.push({ method, params }); return {}; }
  on(event: string, handler: (payload: any) => void) { this.handlers.set(event, handler); }
  emitFrame(data = Buffer.from("jpeg-bytes").toString("base64"), sessionId = 1) {
    this.handlers.get("Page.screencastFrame")?.({ data, sessionId, metadata: { deviceWidth: 1280, deviceHeight: 1024 } });
  }
  methods() { return this.sent.map((entry) => entry.method); }
}

class FakeSocket implements LiveViewerSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: Array<string | Buffer> = [];
  closedWith?: number;
  private listeners: Record<string, Array<(data?: unknown) => void>> = {};
  send(data: string | Buffer) { this.sent.push(data); }
  close(code?: number) { this.closedWith = code; this.readyState = 3; this.listeners.close?.forEach((fn) => fn()); }
  on(event: string, handler: (data?: unknown) => void) { (this.listeners[event] ??= []).push(handler); }
  receive(message: unknown) { this.listeners.message?.forEach((fn) => fn(JSON.stringify(message))); }
  json() { return this.sent.filter((item): item is string => typeof item === "string").map((item) => JSON.parse(item)); }
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function newSession(cdp = new FakeCdp()) {
  const page = { url: () => "https://172.27.4.50/", back: 0, reloads: 0, async goBack() { this.back += 1; }, async reload() { this.reloads += 1; } };
  const session = new LiveViewSession({ cdp: async () => cdp, page, viewport: { width: 1280, height: 1024 } });
  return { session, cdp, page };
}

test("the screencast runs only while someone is watching", async () => {
  const { session, cdp } = newSession();
  const viewer = new FakeSocket();
  await session.attachViewer(viewer, { canControl: true });
  assert.equal(cdp.methods().filter((m) => m === "Page.startScreencast").length, 1);
  assert.deepEqual(viewer.json()[0], { t: "hello", viewport: { width: 1280, height: 1024 }, canControl: true, url: "https://172.27.4.50/" });
  viewer.close();
  await flush();
  assert.ok(cdp.methods().includes("Page.stopScreencast"));
});

test("each frame is acknowledged and fanned out as header + binary image", async () => {
  const { session, cdp } = newSession();
  const a = new FakeSocket();
  const b = new FakeSocket();
  await session.attachViewer(a, { canControl: true });
  await session.attachViewer(b, { canControl: false });
  cdp.emitFrame();
  await flush();
  assert.ok(cdp.methods().includes("Page.screencastFrameAck"));
  for (const viewer of [a, b]) {
    const header = viewer.json().find((m) => m.t === "frame");
    assert.equal(header.url, "https://172.27.4.50/");
    assert.ok(viewer.sent.some((item) => Buffer.isBuffer(item) && item.toString() === "jpeg-bytes"));
  }
});

test("a viewer that falls behind gets frames dropped, never queued", async () => {
  const { session, cdp } = newSession();
  const slow = new FakeSocket();
  await session.attachViewer(slow, { canControl: true });
  slow.bufferedAmount = 10 * 1024 * 1024;
  cdp.emitFrame();
  await flush();
  assert.equal(slow.sent.filter((item) => Buffer.isBuffer(item)).length, 0);
  assert.equal(session.framesDropped, 1);
});

test("a controlling viewer's click, key, text and navigation reach the page through CDP", async () => {
  const { session, cdp, page } = newSession();
  const viewer = new FakeSocket();
  await session.attachViewer(viewer, { canControl: true });
  viewer.receive({ t: "mouse", type: "mousePressed", x: 640, y: 5000, button: "left", clickCount: 1, seq: 7 });
  viewer.receive({ t: "key", type: "keyDown", key: "4", code: "Digit4", text: "4", keyCode: 52 });
  viewer.receive({ t: "text", text: "402-2999373-4" });
  viewer.receive({ t: "nav", action: "back" });
  await flush();
  const mouse = cdp.sent.find((entry) => entry.method === "Input.dispatchMouseEvent");
  assert.equal(mouse?.params?.y, 1024, "coordinates are clamped to the viewport");
  assert.equal(mouse?.params?.type, "mousePressed");
  const key = cdp.sent.find((entry) => entry.method === "Input.dispatchKeyEvent");
  assert.equal(key?.params?.type, "keyDown");
  assert.equal(key?.params?.text, "4");
  assert.equal(cdp.sent.find((entry) => entry.method === "Input.insertText")?.params?.text, "402-2999373-4");
  assert.equal(page.back, 1);
});

test("a view-only viewer can watch but its input never reaches the page", async () => {
  const { session, cdp } = newSession();
  const watcher = new FakeSocket();
  await session.attachViewer(watcher, { canControl: false });
  watcher.receive({ t: "mouse", type: "mousePressed", x: 10, y: 10 });
  await flush();
  assert.equal(cdp.sent.filter((entry) => entry.method.startsWith("Input.")).length, 0);
  assert.equal(watcher.json().at(-1).code, "view_only");
});

test("closing the session ends every viewer and refuses new ones", async () => {
  const { session } = newSession();
  const viewer = new FakeSocket();
  await session.attachViewer(viewer, { canControl: true });
  await session.close();
  assert.equal(viewer.closedWith, 4410);
  const late = new FakeSocket();
  await session.attachViewer(late, { canControl: true });
  assert.equal(late.closedWith, 4410);
});

test("malformed or oversized messages are ignored", () => {
  assert.equal(parseClientMessage("not json"), undefined);
  assert.equal(parseClientMessage(JSON.stringify({ t: "mouse", type: "evil", x: 1, y: 1 })), undefined);
  assert.equal(parseClientMessage(JSON.stringify({ t: "mouse", type: "mousePressed", x: "1", y: 1 })), undefined);
  assert.equal(parseClientMessage(JSON.stringify({ t: "text", text: "x".repeat(3000) })), undefined);
  assert.equal(parseClientMessage(JSON.stringify({ t: "nav", action: "goto" })), undefined);
  assert.deepEqual(parseClientMessage(JSON.stringify({ t: "mouse", type: "mousePressed", x: 1, y: 2, clickCount: 9 })), { t: "mouse", type: "mousePressed", x: 1, y: 2, clickCount: 3 });
});

test("presentation defaults to headed; viewport parses WxH and falls back on bad input", () => {
  assert.equal(resolveRecordingPresentation({}), "headed");
  assert.equal(resolveRecordingPresentation({ RECORDING_PRESENTATION: "Remote" }), "remote");
  assert.deepEqual(resolveRecordingViewport({ RECORDING_VIEWPORT: "1080x1920" }), { width: 1080, height: 1920 });
  assert.deepEqual(resolveRecordingViewport({ RECORDING_VIEWPORT: "99999x1" }), DEFAULT_RECORDING_VIEWPORT);
  assert.deepEqual(resolveRecordingViewport({}), DEFAULT_RECORDING_VIEWPORT);
});
