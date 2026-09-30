import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { WebSocket } from "ws";
import type { Principal } from "../auth/principal";
import type { PermissionKey } from "../auth/permissions";
import { LiveViewSession, type LiveCdp } from "../recording/web/live-view-session";
import { attachLiveViewEndpoint, decideLiveViewAccess, type LiveViewAuthDeps } from "./live-view-endpoint";

function principal(overrides: { userId?: string; permissions?: PermissionKey[]; scope?: "full" | "password_change_only"; projects?: string[] } = {}): Principal {
  return {
    kind: "user",
    userId: overrides.userId ?? "user-1",
    username: "qa",
    sessionId: "s-1",
    scope: overrides.scope ?? "full",
    permissions: new Set(overrides.permissions ?? ["recordings.view", "recordings.create"]),
    allProjects: false,
    projectIds: new Set(),
    projectSlugs: new Set(overrides.projects ?? ["kiosko"]),
    writableProjectIds: new Set(),
  } as unknown as Principal;
}

const deps = (who: Principal | Error, extra: Partial<LiveViewAuthDeps> = {}): LiveViewAuthDeps => ({
  authEnabled: true,
  resolveToken: async () => { if (who instanceof Error) throw who; return who; },
  ...extra,
});
const access = { startedBy: "user-1", projectSlug: "kiosko" };

test("the user who started the recording may control it", async () => {
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(principal())), { ok: true, canControl: true });
});

test("another user with access may only watch; an admin may control", async () => {
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(principal({ userId: "user-2" }))), { ok: true, canControl: false });
  const admin = principal({ userId: "admin", permissions: ["recordings.view", "recordings.create", "admin.users"] });
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(admin)), { ok: true, canControl: true });
});

test("no token, bad token, pending password change, no permission or no project access are refused", async () => {
  assert.deepEqual(await decideLiveViewAccess({}, access, deps(principal())), { ok: false, code: "missing_token" });
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(new Error("expired"))), { ok: false, code: "invalid_token" });
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(principal({ scope: "password_change_only" }))), { ok: false, code: "password_change_required" });
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(principal({ permissions: [] }))), { ok: false, code: "forbidden" });
  assert.deepEqual(await decideLiveViewAccess({ token: "t" }, access, deps(principal({ projects: ["otro"] }))), { ok: false, code: "forbidden" });
});

test("with auth disabled and no API key the stream is open, as the HTTP API is", async () => {
  assert.deepEqual(await decideLiveViewAccess({}, access, deps(principal(), { authEnabled: false })), { ok: true, canControl: true });
});

// --- real WebSocket upgrade ------------------------------------------------------------------

class StubCdp implements LiveCdp {
  sent: string[] = [];
  async send(method: string) { this.sent.push(method); return {}; }
  on() {}
}

async function withServer(fn: (url: string, cdp: StubCdp) => Promise<void>): Promise<void> {
  const cdp = new StubCdp();
  const session = new LiveViewSession({ cdp: async () => cdp, page: { url: () => "https://172.27.4.50/", goBack: async () => undefined, reload: async () => undefined }, viewport: { width: 1280, height: 1024 } });
  const server = http.createServer();
  attachLiveViewEndpoint(
    server,
    (id) => (id === "rec-1" ? { session, startedBy: "user-1", projectSlug: "kiosko" } : undefined),
    () => deps(principal()),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`ws://127.0.0.1:${port}`, cdp);
  } finally {
    await session.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => ws.once("message", (data) => resolve(JSON.parse(String(data)))));
}

test("upgrade: authenticated viewer receives hello and its click reaches CDP", async () => {
  await withServer(async (url, cdp) => {
    const ws = new WebSocket(`${url}/api/recordings/rec-1/live`);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
    const hello = nextMessage(ws);
    ws.send(JSON.stringify({ t: "auth", token: "valid" }));
    assert.deepEqual(await hello, { t: "hello", viewport: { width: 1280, height: 1024 }, canControl: true, url: "https://172.27.4.50/" });
    ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x: 10, y: 20 }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(cdp.sent.includes("Page.startScreencast"));
    assert.ok(cdp.sent.includes("Input.dispatchMouseEvent"));
    ws.close();
  });
});

test("upgrade: a first message that is not auth closes the socket and streams nothing", async () => {
  await withServer(async (url, cdp) => {
    const ws = new WebSocket(`${url}/api/recordings/rec-1/live`);
    await new Promise<void>((resolve) => { ws.once("open", () => resolve()); });
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    ws.send(JSON.stringify({ t: "mouse", type: "mousePressed", x: 1, y: 1 }));
    assert.equal(await closed, 4403);
    assert.equal(cdp.sent.length, 0);
  });
});

test("upgrade: a recording without a live stream is rejected before any socket opens", async () => {
  await withServer(async (url) => {
    const ws = new WebSocket(`${url}/api/recordings/unknown/live`);
    const error = await new Promise<Error>((resolve) => ws.once("error", resolve));
    assert.match(error.message, /404/);
  });
});
