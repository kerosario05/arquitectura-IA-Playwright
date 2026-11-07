import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { LocalAgent } from "../../local-agent/local-agent";
import type { AndroidStatus } from "../../local-agent/android-probe";
import { attachLocalAgentEndpoint } from "./agent-endpoint";
import { LocalAgentRegistry } from "./agent-registry";
import { ChromiumPackage } from "./chromium-package";
import { openAgentTunnel } from "./agent-tunnel";

/**
 * Túnel completo en memoria: servidor HTTP con el endpoint real, un LocalAgent
 * real conectado a él y un "adb" falso (servidor TCP de eco) en el lado del PC.
 */

const ANDROID: AndroidStatus = { sdkFound: true, adbVersion: "35.0.2", emulatorFound: true, avds: [], devices: [], checkedAt: new Date().toISOString() };

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

/** Servicio TCP del PC: responde "eco:" y luego devuelve lo recibido tal cual. */
function echoService(): net.Server {
  return net.createServer((socket) => {
    socket.write("eco:");
    socket.on("data", (chunk) => socket.write(chunk));
    socket.on("error", () => socket.destroy());
  });
}

async function setup(t: test.TestContext, targets: { adbPort: number; start?: () => Promise<void> }) {
  const registry = new LocalAgentRegistry(new ChromiumPackage("C:\\no-usado", () => undefined), () => undefined);
  const server = http.createServer();
  attachLocalAgentEndpoint(server, registry);
  const port = await listen(server);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-tunel-"));
  const agent = new LocalAgent({
    config: { serverUrl: `http://127.0.0.1:${port}`, agentId: "agente-tunel-0001", rootDir: home, browsersDir: path.join(home, "b"), logsDir: path.join(home, "l") },
    version: "0.2.0",
    log: () => undefined,
    android: { probe: async () => ANDROID, start: async () => ({ serial: "x", avd: "x" }), stop: async () => undefined },
    localTargets: { adb: { port: targets.adbPort, start: targets.start } },
  });
  agent.start();
  await agent.connected;
  // El hello es asíncrono (sondea Android): esperar a que el registro lo tenga.
  for (let i = 0; i < 100 && !registry.get("agente-tunel-0001"); i += 1) await new Promise((r) => setTimeout(r, 20));
  t.after(async () => {
    await agent.stop();
    await new Promise<void>((r) => server.close(() => r()));
    server.closeAllConnections?.();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { registry };
}

function exchange(port: number, payload: Buffer, expectBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const socket = net.connect({ host: "127.0.0.1", port }, () => socket.write(payload));
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= expectBytes) {
        socket.end();
        resolve(Buffer.concat(chunks));
      }
    });
    socket.on("error", reject);
    socket.on("close", () => (total < expectBytes ? reject(new Error(`cerrado tras ${total} bytes`)) : undefined));
  });
}

test("túnel adb: varias conexiones a la vez llegan al servicio del PC con los bytes intactos", async (t) => {
  const service = echoService();
  const adbPort = await listen(service);
  t.after(() => service.close());
  const { registry } = await setup(t, { adbPort });

  const tunnel = await openAgentTunnel("agente-tunel-0001", "adb", registry, () => undefined);
  t.after(() => tunnel.close());

  const big = Buffer.alloc(3 * 1024 * 1024, 7);
  const [a, b, c] = await Promise.all([
    exchange(tunnel.port, Buffer.from("host:version"), 4 + 12),
    exchange(tunnel.port, Buffer.from("host:devices"), 4 + 12),
    // Una captura de pantalla pesa varios MB: llega completa y en orden.
    exchange(tunnel.port, big, 4 + big.length),
  ]);
  assert.equal(a.toString(), "eco:host:version");
  assert.equal(b.toString(), "eco:host:devices");
  assert.equal(c.length, 4 + big.length);
  assert.ok(c.subarray(4).equals(big));

  // Al cerrar el motor sus conexiones, el agente suelta las suyas.
  for (let i = 0; i < 100 && registry.openStreamCount("agente-tunel-0001") > 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(registry.openStreamCount("agente-tunel-0001"), 0);
});

test("túnel adb: si el servicio del PC cierra, se cierra la conexión del motor", async (t) => {
  const service = net.createServer((socket) => socket.end("adios"));
  const adbPort = await listen(service);
  t.after(() => service.close());
  const { registry } = await setup(t, { adbPort });
  const tunnel = await openAgentTunnel("agente-tunel-0001", "adb", registry, () => undefined);
  t.after(() => tunnel.close());

  const received = await new Promise<string>((resolve, reject) => {
    let text = "";
    const socket = net.connect({ host: "127.0.0.1", port: tunnel.port });
    socket.on("data", (chunk) => (text += chunk));
    socket.on("close", () => resolve(text));
    socket.on("error", reject);
  });
  assert.equal(received, "adios");
});

test("túnel adb: con el servidor de adb apagado lo arranca y reintenta; si no hay nada, corta la conexión", async (t) => {
  // Puerto libre: nadie escucha hasta que `start` levanta el servicio.
  const probe = net.createServer();
  const adbPort = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  const service = echoService();
  let starts = 0;
  const { registry } = await setup(t, {
    adbPort,
    start: async () => {
      starts += 1;
      await new Promise<void>((r) => service.listen(adbPort, "127.0.0.1", () => r()));
    },
  });
  t.after(() => service.close());
  const tunnel = await openAgentTunnel("agente-tunel-0001", "adb", registry, () => undefined);
  t.after(() => tunnel.close());
  assert.equal((await exchange(tunnel.port, Buffer.from("x"), 5)).toString(), "eco:x");
  assert.equal(starts, 1);

  // Appium no está escuchando y no tiene arranque: el motor ve la conexión cerrada.
  const appium = await openAgentTunnel("agente-tunel-0001", "appium", registry, () => undefined);
  t.after(() => appium.close());
  const closed = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: appium.port });
    socket.on("error", () => undefined);
    socket.on("close", () => resolve(true));
  });
  assert.ok(closed);
});

test("openStream: sin agente, sin Android o con token equivocado no hay canal", async () => {
  const registry = new LocalAgentRegistry(new ChromiumPackage("C:\\no-usado", () => undefined), () => undefined);
  await assert.rejects(registry.openStream("nadie-0001", "adb"), /no está conectado/);

  const sent: Array<{ t: string; streamId?: string; dataToken?: string }> = [];
  const handlers = registry.attachControl({ send: (d) => sent.push(JSON.parse(d)), close: () => undefined }, { agentId: "agente-0001", ip: "10.0.0.5" });
  handlers.onMessage(JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.1.0", agentId: "agente-0001", machine: "PC", windowsUser: "u", chromium: [] }));
  await assert.rejects(registry.openStream("agente-0001", "adb"), /Android Studio/);

  const opening = registry.openStream("agente-0001", "appium", 5000);
  const order = sent.find((m) => m.t === "open_stream")!;
  assert.equal(registry.acceptStreamChannel({ streamId: order.streamId!, token: "mal", agentId: "agente-0001" }), undefined);
  assert.equal(registry.acceptStreamChannel({ streamId: order.streamId!, token: order.dataToken!, agentId: "agente-9999" }), undefined);
  handlers.onMessage(JSON.stringify({ t: "stream_error", streamId: order.streamId, message: "ECONNREFUSED 127.0.0.1:4723" }));
  await assert.rejects(opening, /no pudo conectar: ECONNREFUSED/);
  assert.equal(registry.acceptStreamChannel({ streamId: order.streamId!, token: order.dataToken!, agentId: "agente-0001" }), undefined, "ya no está pendiente");
});
