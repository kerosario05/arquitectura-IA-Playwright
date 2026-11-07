import assert from "node:assert/strict";
import test from "node:test";
import { maximizeBrowserWindow } from "./agent-browser";

test("maximiza la ventana Chromium mediante CDP", async () => {
  const commands: Array<{ method: string; params: unknown }> = [];
  const fakeSession = {
    async send(method: string, params: unknown) {
      commands.push({ method, params });
      if (method === 'Target.getTargetInfo') return {targetInfo:{targetId:'page'}};
      if (method === 'Browser.getWindowBounds') return {bounds:{windowState:'maximized'}};
      return method === "Browser.getWindowForTarget" ? { windowId: 17 } : undefined;
    },
    async detach() {},
  };
  const result = await maximizeBrowserWindow({context:()=>({newCDPSession:async()=>fakeSession}),bringToFront:async()=>{}} as any);

  assert.equal(result, true);
  assert.deepEqual(commands, [
    {method:'Target.getTargetInfo',params:undefined},
    { method: "Browser.getWindowForTarget", params: {targetId:'page'} },
    { method: "Browser.setWindowBounds", params: { windowId: 17, bounds: { windowState: "normal" } } },
    { method: "Browser.setWindowBounds", params: { windowId: 17, bounds: { windowState: "maximized" } } },
    {method:'Browser.getWindowBounds',params:{windowId:17}},
  ]);
});

test("si CDP no expone gestión de ventanas, la grabación continúa", async () => {
  const result = await maximizeBrowserWindow({
    context:()=>({newCDPSession: async () => { throw new Error("unsupported"); }}),
  } as any);
  assert.equal(result, false);
});
