/**
 * SPIKE (phase 1 of the remote-recording plan) -- not wired into the engine.
 *
 * A headless Chromium on the server, streamed to a plain web page (canvas) through CDP
 * `Page.startScreencast`, with the viewer's mouse/keyboard forwarded back through CDP `Input.*`.
 * Proves the approach and measures input-to-frame latency before any engine work.
 *
 *   npx tsx scripts/spikes/live-browser-spike.ts --url https://172.27.4.50/ --port 4070
 *   then open http://<server>:4070 from any PC.
 */
import http from "node:http";
import { chromium, type CDPSession } from "playwright";
import { WebSocketServer, type WebSocket } from "ws";

const args = process.argv.slice(2);
const argOf = (name: string, fallback: string) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const TARGET_URL = argOf("url", "https://172.27.4.50/");
const PORT = Number(argOf("port", "4070"));
const VIEWPORT = { width: Number(argOf("width", "1280")), height: Number(argOf("height", "800")) };
const JPEG_QUALITY = Number(argOf("quality", "60"));
/** Frames are dropped (not queued) while the socket is this far behind: stale frames only add lag. */
const MAX_BUFFERED_BYTES = 512 * 1024;

type ClientMessage =
  | { t: "mouse"; type: "mousePressed" | "mouseReleased" | "mouseMoved"; x: number; y: number; button?: "left" | "right" | "middle" | "none"; clickCount?: number; seq?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "keyDown" | "keyUp"; key: string; code: string; text?: string; keyCode?: number; seq?: number }
  | { t: "ping"; ts: number };

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded" }).catch((err) => console.log(`[spike] goto failed: ${err.message}`));
  const cdp: CDPSession = await context.newCDPSession(page);

  const clients = new Set<WebSocket>();
  let lastInputSeq = 0;
  let framesSent = 0;
  let framesDropped = 0;

  cdp.on("Page.screencastFrame", async (frame: { data: string; sessionId: number; metadata: { deviceWidth: number; deviceHeight: number } }) => {
    // Ack first: Chromium only produces the next frame after the previous one is acknowledged.
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    const header = JSON.stringify({ t: "frame", w: frame.metadata.deviceWidth, h: frame.metadata.deviceHeight, inputSeq: lastInputSeq, url: page.url() });
    const image = Buffer.from(frame.data, "base64");
    for (const client of clients) {
      if (client.readyState !== client.OPEN) continue;
      if (client.bufferedAmount > MAX_BUFFERED_BYTES) { framesDropped += 1; continue; }
      client.send(header);
      client.send(image, { binary: true });
      framesSent += 1;
    }
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: JPEG_QUALITY, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });

  const server = http.createServer((req, res) => {
    if (req.url === "/stats") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ framesSent, framesDropped, url: page.url(), viewport: VIEWPORT }));
      return;
    }
    if (req.url?.startsWith("/debug/box?")) {
      // Spike-only helper so an automated check can aim at a real element.
      const text = new URL(req.url, "http://x").searchParams.get("text") ?? "";
      page.getByText(text, { exact: true }).first().boundingBox()
        .then((box) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(box)); })
        .catch(() => { res.statusCode = 404; res.end("null"); });
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(VIEWER_HTML);
  });

  const wss = new WebSocketServer({ server, path: "/live" });
  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.send(JSON.stringify({ t: "hello", viewport: VIEWPORT }));
    socket.on("close", () => clients.delete(socket));
    socket.on("message", async (raw) => {
      let message: ClientMessage;
      try { message = JSON.parse(String(raw)); } catch { return; }
      try {
        if (message.t === "ping") {
          socket.send(JSON.stringify({ t: "pong", ts: message.ts }));
        } else if (message.t === "mouse") {
          if (message.seq) lastInputSeq = message.seq;
          await cdp.send("Input.dispatchMouseEvent", {
            type: message.type, x: message.x, y: message.y,
            button: message.button ?? (message.type === "mouseMoved" ? "none" : "left"),
            clickCount: message.clickCount ?? (message.type === "mouseMoved" ? 0 : 1),
          });
        } else if (message.t === "wheel") {
          await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: message.x, y: message.y, deltaX: message.dx, deltaY: message.dy });
        } else if (message.t === "key") {
          if (message.seq) lastInputSeq = message.seq;
          await cdp.send("Input.dispatchKeyEvent", {
            type: message.type === "keyDown" && message.text ? "keyDown" : message.type === "keyDown" ? "rawKeyDown" : "keyUp",
            key: message.key, code: message.code, text: message.type === "keyDown" ? message.text : undefined,
            windowsVirtualKeyCode: message.keyCode, nativeVirtualKeyCode: message.keyCode,
          });
        }
      } catch (err) {
        console.log(`[spike] input failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  });

  server.listen(PORT, () => console.log(`[spike] live view on http://localhost:${PORT}  target=${TARGET_URL}  viewport=${VIEWPORT.width}x${VIEWPORT.height}`));
  const shutdown = async () => { await browser.close().catch(() => undefined); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const VIEWER_HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vista en vivo</title>
<style>
  body { margin: 0; background: #111; color: #ddd; font: 12px system-ui, sans-serif; display: flex; flex-direction: column; height: 100vh; }
  #bar { padding: 6px 10px; display: flex; gap: 16px; }
  #wrap { flex: 1; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  canvas { background: #000; max-width: 100%; max-height: 100%; outline: none; cursor: default; }
</style></head>
<body>
<div id="bar"><span id="url">conectando…</span><span id="rtt"></span><span id="lat"></span></div>
<div id="wrap"><canvas id="screen" tabindex="0"></canvas></div>
<script>
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/live');
ws.binaryType = 'arraybuffer';
let pendingHeader = null, seq = 0, sentAt = new Map(), lastMove = 0;
window.__spike = { latencies: [], frames: 0 };
ws.onmessage = async (event) => {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.t === 'hello') { canvas.width = msg.viewport.width; canvas.height = msg.viewport.height; }
    if (msg.t === 'pong') document.getElementById('rtt').textContent = 'red: ' + Math.round(performance.now() - msg.ts) + ' ms';
    if (msg.t === 'frame') pendingHeader = msg;
    return;
  }
  const header = pendingHeader; pendingHeader = null;
  const bitmap = await createImageBitmap(new Blob([event.data], { type: 'image/jpeg' }));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  window.__spike.frames += 1;
  if (header) {
    document.getElementById('url').textContent = header.url;
    if (sentAt.has(header.inputSeq)) {
      const ms = Math.round(performance.now() - sentAt.get(header.inputSeq));
      sentAt.delete(header.inputSeq);
      window.__spike.latencies.push(ms);
      document.getElementById('lat').textContent = 'clic → pantalla: ' + ms + ' ms';
    }
  }
};
setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ t: 'ping', ts: performance.now() })), 2000);
function toPage(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvas.width / rect.width, y: (event.clientY - rect.top) * canvas.height / rect.height };
}
function send(message) { if (ws.readyState === 1) ws.send(JSON.stringify(message)); }
canvas.addEventListener('mousedown', (e) => { canvas.focus(); const p = toPage(e); seq += 1; sentAt.set(seq, performance.now()); send({ t: 'mouse', type: 'mousePressed', ...p, button: 'left', clickCount: e.detail || 1, seq }); e.preventDefault(); });
canvas.addEventListener('mouseup', (e) => { const p = toPage(e); send({ t: 'mouse', type: 'mouseReleased', ...p, button: 'left', clickCount: e.detail || 1 }); });
canvas.addEventListener('mousemove', (e) => { const now = performance.now(); if (now - lastMove < 33) return; lastMove = now; send({ t: 'mouse', type: 'mouseMoved', ...toPage(e) }); });
canvas.addEventListener('wheel', (e) => { send({ t: 'wheel', ...toPage(e), dx: e.deltaX, dy: e.deltaY }); e.preventDefault(); }, { passive: false });
canvas.addEventListener('keydown', (e) => { seq += 1; sentAt.set(seq, performance.now()); send({ t: 'key', type: 'keyDown', key: e.key, code: e.code, keyCode: e.keyCode, text: e.key.length === 1 ? e.key : (e.key === 'Enter' ? '\\r' : undefined), seq }); e.preventDefault(); });
canvas.addEventListener('keyup', (e) => { send({ t: 'key', type: 'keyUp', key: e.key, code: e.code, keyCode: e.keyCode }); e.preventDefault(); });
</script></body></html>`;

main().catch((err) => {
  console.error(`[spike] fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
