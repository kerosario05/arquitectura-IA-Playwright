/**
 * Automated check for the live-browser spike, without a second browser (memory is tight): a Node
 * WebSocket client plays the viewer -- receives frames, clicks real elements by coordinates -- and
 * measures input-to-frame latency plus whether the server-side page actually navigated.
 *
 *   npx tsx scripts/spikes/live-browser-spike.check.ts [--port 4070]
 */
import { spawn } from "node:child_process";
import { WebSocket } from "ws";

const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 4070);
const base = `http://localhost:${port}`;
const VIEWPORT_HEIGHT = 800;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/stats`)).ok) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error("spike server did not start");
}

async function stats(): Promise<{ framesSent: number; framesDropped: number; url: string }> {
  return (await fetch(`${base}/stats`)).json() as Promise<{ framesSent: number; framesDropped: number; url: string }>;
}

async function main() {
  const server = spawn(process.execPath, ["--import", "tsx", "scripts/spikes/live-browser-spike.ts", "--port", String(port)], { stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (d) => process.stdout.write(`  ${d}`));
  server.stderr.on("data", (d) => process.stdout.write(`  ${d}`));
  try {
    await waitForServer();
    const ws = new WebSocket(`ws://localhost:${port}/live`);
    let frames = 0;
    let bytes = 0;
    let pendingHeader: { inputSeq: number; url: string } | null = null;
    const sentAt = new Map<number, number>();
    const latencies: number[] = [];
    const rtts: number[] = [];
    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        const message = JSON.parse(String(data));
        if (message.t === "frame") pendingHeader = message;
        if (message.t === "pong") rtts.push(Math.round(performance.now() - message.ts));
        return;
      }
      frames += 1;
      bytes += (data as Buffer).length;
      const header = pendingHeader;
      pendingHeader = null;
      if (header && sentAt.has(header.inputSeq)) {
        latencies.push(Math.round(performance.now() - sentAt.get(header.inputSeq)!));
        sentAt.delete(header.inputSeq);
      }
    });
    await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
    for (let i = 0; i < 5; i++) { ws.send(JSON.stringify({ t: "ping", ts: performance.now() })); await sleep(200); }

    let seq = 0;
    const clickText = async (text: string, expectUrlPart: string) => {
      let box: { x: number; y: number; width: number; height: number } | null = null;
      for (let i = 0; i < 40 && !box; i++) {
        box = await (await fetch(`${base}/debug/box?text=${encodeURIComponent(text)}`)).json().catch(() => null);
        if (!box) await sleep(500);
      }
      if (!box) throw new Error(`"${text}" not visible on the server page`);
      // Like a person would: scroll with the wheel until the target is inside the viewport.
      for (let i = 0; i < 10 && box && (box.y < 0 || box.y + box.height > VIEWPORT_HEIGHT); i++) {
        ws.send(JSON.stringify({ t: "wheel", x: 640, y: 400, dx: 0, dy: box.y + box.height / 2 - VIEWPORT_HEIGHT / 2 }));
        await sleep(600);
        box = await (await fetch(`${base}/debug/box?text=${encodeURIComponent(text)}`)).json().catch(() => null);
      }
      if (!box) throw new Error(`"${text}" disappeared while scrolling`);
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      seq += 1;
      sentAt.set(seq, performance.now());
      ws.send(JSON.stringify({ t: "mouse", type: "mouseMoved", x, y }));
      ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x, y, button: "left", clickCount: 1, seq }));
      ws.send(JSON.stringify({ t: "mouse", type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
      for (let i = 0; i < 40; i++) {
        if ((await stats()).url.includes(expectUrlPart)) return;
        await sleep(250);
      }
      throw new Error(`click on "${text}" did not reach ${expectUrlPart} (url=${(await stats()).url})`);
    };

    await clickText("Explora nuestros productos", "/product-catalog");
    console.log("  ok: 'Explora nuestros productos' -> /product-catalog");
    await sleep(1500);
    await clickText("Tarjetas", "category=cards");
    console.log("  ok: 'Tarjetas' -> category=cards");
    await sleep(1500);

    const final = await stats();
    const avg = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : NaN);
    console.log(`RESULT frames=${frames} avgFrameKB=${Math.round(bytes / Math.max(frames, 1) / 1024)} dropped=${final.framesDropped} wsRttMs=${avg(rtts)} clickToFrameMs=[${latencies.join(", ")}] finalUrl=${final.url}`);
    ws.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => { console.error(`CHECK_FAILED ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
