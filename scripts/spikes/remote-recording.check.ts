/**
 * End-to-end check of a "remote" recording: real WebSessionRecorder (headless, fixed viewport)
 * against the kiosk app, streamed through the real live-view endpoint, driven by a WebSocket
 * client acting as the person in the panel. Verifies Capture V2 records the streamed clicks.
 *
 *   npx tsx scripts/spikes/remote-recording.check.ts
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { WebSessionRecorder } from "../../src/recording/web/web-session-recorder";
import { LiveViewSession } from "../../src/recording/web/live-view-session";
import { attachLiveViewEndpoint } from "../../src/server/live-view-endpoint";
import type { RecordedEvent } from "../../src/recording/session-trace.types";

const BASE_URL = process.argv[2] ?? "https://172.27.4.50/";
const VIEWPORT = { width: 1280, height: 1024 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: BASE_URL,
    framesDir: fs.mkdtempSync(path.join(os.tmpdir(), "remote-rec-")),
    captureAuthority: "v2",
    presentation: "remote",
    viewport: VIEWPORT,
    ignoreHTTPSErrors: true,
    onEvent: (event) => events.push(event),
    onLog: () => undefined,
  });
  await recorder.start();
  const target = recorder.liveViewTarget()!;
  const session = new LiveViewSession({ cdp: target.createCdp, page: target.page, viewport: VIEWPORT });
  const server = http.createServer();
  attachLiveViewEndpoint(server, () => ({ session, projectSlug: "kiosko" }), () => ({ authEnabled: false, resolveToken: async () => { throw new Error("unused"); } }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/recordings/rec/live`);
  let frames = 0;
  let hello: any;
  ws.on("message", (data, isBinary) => {
    if (isBinary) { frames += 1; return; }
    const message = JSON.parse(String(data));
    if (message.t === "hello") hello = message;
  });
  await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  ws.send(JSON.stringify({ t: "auth" }));

  const click = async (text: string, urlPart: string) => {
    const locator = target.page.getByText(text, { exact: true }).first();
    await locator.waitFor({ timeout: 20_000 });
    for (let i = 0; i < 8; i++) {
      const box = (await locator.boundingBox())!;
      if (box.y >= 0 && box.y + box.height <= VIEWPORT.height) {
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        ws.send(JSON.stringify({ t: "mouse", type: "mouseMoved", x, y }));
        ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x, y, button: "left", clickCount: 1 }));
        ws.send(JSON.stringify({ t: "mouse", type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
        for (let j = 0; j < 40 && !target.page.url().includes(urlPart); j++) await sleep(250);
        if (!target.page.url().includes(urlPart)) throw new Error(`click on "${text}" did not reach ${urlPart}`);
        return;
      }
      ws.send(JSON.stringify({ t: "wheel", x: 640, y: 500, dx: 0, dy: box.y + box.height / 2 - VIEWPORT.height / 2 }));
      await sleep(600);
    }
    throw new Error(`"${text}" never scrolled into view`);
  };

  await click("Explora nuestros productos", "/product-catalog");
  await sleep(1500);
  await click("Tarjetas", "category=cards");
  await sleep(1500);

  ws.close();
  await session.close();
  const { events: finalEvents, drain } = await recorder.stop();
  server.close();

  const taps = finalEvents.filter((event) => event.kind === "tap").map((event) => event.target?.label);
  const timeline = finalEvents
    .filter((event) => ["tap", "navigate"].includes(event.kind))
    .map((event) => (event.kind === "tap" ? `tap:${event.target?.label}` : `nav:${(event.url ?? "").replace(BASE_URL.replace(/\/$/, ""), "")}`));
  console.log(`RESULT hello=${JSON.stringify(hello?.viewport)} frames=${frames} drained=${drain.drained} taps=${JSON.stringify(taps)}`);
  console.log(`TIMELINE ${timeline.join(" -> ")}`);
  const ok = taps.includes("Explora nuestros productos") && taps.includes("Tarjetas");
  console.log(ok ? "CHECK_PASSED" : "CHECK_FAILED streamed clicks were not captured");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(`CHECK_FAILED ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
