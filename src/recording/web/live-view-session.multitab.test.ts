import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { editingCommandFor, LiveViewSession, type LiveCdp, type LivePage, type LiveViewerSocket } from "./live-view-session";

class TestSocket extends EventEmitter implements LiveViewerSocket {
  readyState = 1;
  bufferedAmount = 0;
  readonly sent: string[] = [];

  send(data: string | Buffer): void {
    if (typeof data === "string") this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
  }
}

test("clipboard shortcuts from the viewer carry the editing command CDP needs", () => {
  assert.equal(editingCommandFor({ type: "keyDown", key: "c", modifiers: 2 }), "copy");
  assert.equal(editingCommandFor({ type: "keyDown", key: "V", modifiers: 4 }), "paste");
  assert.equal(editingCommandFor({ type: "keyUp", key: "c", modifiers: 2 }), undefined);
  assert.equal(editingCommandFor({ type: "keyDown", key: "c", modifiers: 0 }), undefined);
  assert.equal(editingCommandFor({ type: "keyDown", key: "z", modifiers: 2 }), undefined);
});

test("a lost frame acknowledgement does not freeze the stream forever", async (t) => {
  const handlers: Record<string, (frame: any) => void> = {};
  const cdp: LiveCdp = { send: async () => ({}), on: (event: string, handler: any) => { handlers[event] = handler; } } as LiveCdp;
  const page: LivePage = { url: () => "https://portal.example", goBack: async () => undefined, reload: async () => undefined };
  const socket = new TestSocket();
  const session = new LiveViewSession({ page, viewport: { width: 800, height: 600 }, cdp: async () => cdp });
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);

  await session.attachViewer(socket, { canControl: true, frameAcknowledgements: true });
  const frame = { data: Buffer.from("x").toString("base64"), sessionId: 1 };
  const framesSent = () => socket.sent.filter((message) => message.includes('"t":"frame"')).length;
  handlers["Page.screencastFrame"](frame);
  handlers["Page.screencastFrame"](frame);
  assert.equal(framesSent(), 1, "second frame waits for the acknowledgement");
  now += 2_500;
  handlers["Page.screencastFrame"](frame);
  assert.equal(framesSent(), 2, "an acknowledgement that never arrives must not block later frames");
  await session.close();
});

test("manual tab changes are recorded, while opening a new tab is represented by its navigation", async () => {
  const portal: LivePage = { url: () => "https://portal.example", goBack: async () => undefined, reload: async () => undefined };
  const approvals: LivePage = { url: () => "https://approvals.example", goBack: async () => undefined, reload: async () => undefined };
  const cdp: LiveCdp = { send: async () => ({}), on: () => undefined };
  const selectedTabs: string[] = [];
  const broughtToFront: string[] = [];
  portal.bringToFront = async () => { broughtToFront.push("tab-1"); };
  const socket = new TestSocket();
  const session = new LiveViewSession({
    page: portal,
    viewport: { width: 800, height: 600 },
    cdp: async () => cdp,
    getTabs: async () => [
      { pageKey: "tab-1", url: portal.url(), title: "Portal" },
      { pageKey: "tab-2", url: approvals.url(), title: "Aprobaciones" },
    ],
    resolveTab: async (pageKey) => pageKey === "tab-1"
      ? { page: portal, createCdp: async () => cdp }
      : pageKey === "tab-2" ? { page: approvals, createCdp: async () => cdp } : undefined,
    navigateUrl: async (_url, newTab) => newTab ? "tab-2" : "tab-1",
    onTabSelected: async (pageKey) => { selectedTabs.push(pageKey); },
  });

  await session.attachViewer(socket, { canControl: true });
  socket.emit("message", JSON.stringify({ t: "navigate", url: "https://approvals.example", newTab: true }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(selectedTabs, [], "the new-tab navigation itself is the step; selecting it must not create a duplicate switch");

  socket.emit("message", JSON.stringify({ t: "select_tab", pageKey: "tab-1" }));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(selectedTabs, ["tab-1"], "a manual return to the original tab must emit a switch step");
  assert.deepEqual(broughtToFront, ["tab-1"], "the selected tab must be foregrounded or it stops producing frames");
  assert.ok(socket.sent.some((message) => message.includes('"t":"selected_tab"') && message.includes('"pageKey":"tab-1"')));

  await session.close();
});
