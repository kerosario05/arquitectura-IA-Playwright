/**
 * Full-stack check of remote recording through the REAL routes: login -> project -> start
 * recording (engine in RECORDING_PRESENTATION=remote) -> live view WebSocket THROUGH THE BFF ->
 * streamed clicks -> stop -> persisted trace.
 *
 *   npx tsx scripts/spikes/remote-recording.fullstack.check.ts <bffBaseUrl> <username> <passwordFile>
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { WebSocket } from "ws";

const [bff = "http://127.0.0.1:3201", username = "verificador", passwordFile = ""] = process.argv.slice(2);
const APP_URL = "https://172.27.4.50/";
const VIEWPORT = { width: 1280, height: 1024 };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(path: string, init: RequestInit & { token?: string } = {}) {
  const res = await fetch(`${bff}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body: body as any };
}

async function main() {
  const newPassword = "Kiosko-Prueba#2026-Ok";
  let token: string;
  if (passwordFile && fs.existsSync(passwordFile)) {
    const initialPassword = fs.readFileSync(passwordFile, "utf8").trim();
    fs.rmSync(passwordFile, { force: true });
    const first = await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password: initialPassword }) });
    const changed = await api("/api/auth/change-password", { method: "POST", token: first.body.token, body: JSON.stringify({ currentPassword: initialPassword, newPassword }) });
    token = changed.body.token;
  } else {
    token = (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password: newPassword }) })).body.token;
  }
  console.log(`login ok=${Boolean(token)}`);

  const caps = await api("/api/recordings/capabilities", { token });
  console.log(`capabilities enabled=${caps.body.recording?.enabled} presentation=${caps.body.presentation} viewport=${JSON.stringify(caps.body.viewport)}`);

  const project = await api("/api/projects/web", { method: "POST", token, body: JSON.stringify({ name: "Live test", slug: "live-test", baseUrl: APP_URL, loginMode: 2, ignoreHTTPSErrors: true, enabled: true }) });
  console.log(`project status=${project.status}`);

  const started = await api("/api/recordings/start", { method: "POST", token, body: JSON.stringify({ projectSlug: "live-test", recordingGoal: "vista en vivo" }) });
  const recordingId: string = started.body.recordingId;
  console.log(`recording start status=${started.status} id=${recordingId}`);
  if (!recordingId) throw new Error(JSON.stringify(started.body).slice(0, 300));

  // Layout probe only: a second page at the same viewport tells where the buttons are.
  const probeBrowser = await chromium.launch({ headless: true });
  const probe = await probeBrowser.newPage({ viewport: VIEWPORT, ignoreHTTPSErrors: true });

  const ws = new WebSocket(`${bff.replace(/^http/, "ws")}/api/recordings/${recordingId}/live`);
  let frames = 0;
  let hello: any;
  let currentUrl = "";
  ws.on("message", (data, isBinary) => {
    if (isBinary) { frames += 1; return; }
    const message = JSON.parse(String(data));
    if (message.t === "hello") hello = message;
    if (message.t === "frame") currentUrl = message.url;
    if (message.t === "error") console.log(`live error ${message.code}`);
  });
  await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
  ws.send(JSON.stringify({ t: "auth", token }));
  for (let i = 0; i < 40 && !hello; i++) await sleep(250);
  console.log(`live hello canControl=${hello?.canControl} viewport=${JSON.stringify(hello?.viewport)}`);

  const clickText = async (url: string, text: string, expectUrl: string) => {
    await probe.goto(url, { waitUntil: "domcontentloaded" });
    const locator = probe.getByText(text, { exact: true }).first();
    await locator.waitFor({ timeout: 20_000 });
    let box = (await locator.boundingBox())!;
    if (box.y + box.height > VIEWPORT.height) {
      const dy = box.y + box.height / 2 - VIEWPORT.height / 2;
      await probe.mouse.wheel(0, dy);
      ws.send(JSON.stringify({ t: "wheel", x: 640, y: 500, dx: 0, dy }));
      await sleep(800);
      box = (await locator.boundingBox())!;
    }
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    ws.send(JSON.stringify({ t: "mouse", type: "mouseMoved", x, y }));
    ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x, y, button: "left", clickCount: 1 }));
    ws.send(JSON.stringify({ t: "mouse", type: "mouseReleased", x, y, button: "left", clickCount: 1 }));
    for (let i = 0; i < 40 && !currentUrl.includes(expectUrl); i++) await sleep(250);
    console.log(`click "${text}" -> ${currentUrl.includes(expectUrl) ? "ok" : "NO"} (${currentUrl})`);
  };

  await clickText(APP_URL, "Explora nuestros productos", "/product-catalog");
  await sleep(1200);
  await clickText(`${APP_URL}product-catalog`, "Tarjetas", "category=cards");
  await sleep(1200);
  await probeBrowser.close();

  const t0 = Date.now();
  const stopped = await api(`/api/recordings/${recordingId}/stop`, { method: "POST", token, body: JSON.stringify({ projectSlug: "live-test" }) });
  console.log(`stop status=${stopped.status} in ${Date.now() - t0} ms, frames received=${frames}`);
  ws.close();

  const trace = await api(`/api/recordings/${recordingId}/trace?projectSlug=live-test`, { token });
  const events: any[] = trace.body.trace?.events ?? [];
  const taps = events.filter((e) => e.kind === "tap").map((e) => e.target?.label);
  console.log(`trace taps=${JSON.stringify(taps)}`);
  const ok = taps.includes("Explora nuestros productos") && taps.includes("Tarjetas") && hello?.canControl === true;
  console.log(ok ? "CHECK_PASSED" : "CHECK_FAILED");
  process.exit(ok ? 0 : 1);
}

main().catch((err) => { console.error(`CHECK_FAILED ${err instanceof Error ? err.message : String(err)}`); process.exit(1); });
