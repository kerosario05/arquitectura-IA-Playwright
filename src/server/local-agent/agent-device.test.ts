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
import type { AdbExec } from "../../mobile/apk-installer";
import { attachLocalAgentEndpoint } from "./agent-endpoint";
import { LocalAgentRegistry } from "./agent-registry";
import { ChromiumPackage } from "./chromium-package";
import { openAgentDevice, pairUserDevice } from "./agent-device";

/**
 * Dispositivo del PC del usuario de punta a punta en memoria: endpoint real, LocalAgent real,
 * un Appium falso (HTTP) en el lado del PC y un adb simulado que solo comprueba que se le
 * habla por el túnel.
 */

const AGENT = "agente-dispositivo-0001";
const ANDROID: AndroidStatus = { sdkFound: true, adbVersion: "35.0.2", emulatorFound: true, avds: [], devices: [], checkedAt: new Date().toISOString() };

function listen(server: net.Server | http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  const port = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

async function setup(t: test.TestContext, appiumPort: number) {
  const registry = new LocalAgentRegistry(new ChromiumPackage("C:\\no-usado", () => undefined), () => undefined);
  const server = http.createServer();
  attachLocalAgentEndpoint(server, registry);
  const port = await listen(server);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-disp-"));
  const agent = new LocalAgent({
    config: { serverUrl: `http://127.0.0.1:${port}`, agentId: AGENT, rootDir: home, browsersDir: path.join(home, "b"), logsDir: path.join(home, "l") },
    version: "0.2.0",
    log: () => undefined,
    android: { probe: async () => ANDROID, start: async () => ({ serial: "x", avd: "x" }), stop: async () => undefined },
    localTargets: { adb: { port: await freePort() }, appium: { port: appiumPort } },
  });
  agent.start();
  await agent.connected;
  for (let i = 0; i < 100 && !registry.get(AGENT); i += 1) await new Promise((r) => setTimeout(r, 20));
  t.after(async () => {
    await agent.stop();
    await new Promise<void>((r) => server.close(() => r()));
    server.closeAllConnections?.();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return { registry };
}

/** adb simulado: `devices -l` con lo que se le pase; recuerda los argumentos. */
function fakeAdb(devices: string): AdbExec & { calls: string[][] } {
  const calls: string[][] = [];
  const exec = (async (_adb: string, args: string[]) => {
    calls.push(args);
    return { exitCode: 0, stdout: `List of devices attached\n${devices}\n`, stderr: "" };
  }) as unknown as AdbExec & { calls: string[][] };
  exec.calls = calls;
  return exec;
}

function appiumService(ready: boolean): http.Server {
  return http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/status" ? { value: { ready, build: { version: "2.11.0" } } } : {}));
  });
}

test("dispositivo del usuario: adb por el túnel con su serial y Appium del PC alcanzable", async (t) => {
  const appium = appiumService(true);
  const appiumPort = await listen(appium);
  t.after(() => appium.close());
  const { registry } = await setup(t, appiumPort);

  const exec = fakeAdb("emulator-5554          device product:sdk model:Pixel_6_Pro");
  const device = await openAgentDevice({ agentId: AGENT, serial: "emulator-5554", appium: true, registry, adbPath: "adb", exec });
  t.after(() => device.close());

  assert.equal(device.adb.host, "127.0.0.1");
  assert.ok(device.adb.port && device.adb.port !== 5037);
  assert.deepEqual(exec.calls[0], ["-H", "127.0.0.1", "-P", String(device.adb.port), "devices", "-l"]);
  assert.ok(device.appium);
  const status = (await (await fetch(`http://${device.appium!.host}:${device.appium!.port}/status`)).json()) as { value: { ready: boolean } };
  assert.equal(status.value.ready, true, "el motor habla con el Appium del PC por el túnel");

  await device.close();
  for (let i = 0; i < 100 && registry.openStreamCount(AGENT) > 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(registry.openStreamCount(AGENT), 0);
});

test("dispositivo del usuario: ausente, sin autorizar o sin Appium da un error que el usuario puede seguir", async (t) => {
  const appiumPort = await freePort();
  const { registry } = await setup(t, appiumPort);

  await assert.rejects(
    openAgentDevice({ agentId: AGENT, serial: "emulator-5556", registry, adbPath: "adb", exec: fakeAdb("emulator-5554\tdevice") }),
    (err: Error & { code?: string }) => err.code === "LOCAL_AGENT_DEVICE_NOT_FOUND" && /emulator-5556 no está conectado/.test(err.message),
  );
  await assert.rejects(
    openAgentDevice({ agentId: AGENT, serial: "R58M123", registry, adbPath: "adb", exec: fakeAdb("R58M123\tunauthorized") }),
    (err: Error & { code?: string }) => err.code === "LOCAL_AGENT_DEVICE_UNAUTHORIZED",
  );
  // Grabar no necesita Appium: sin él igual abre.
  const recording = await openAgentDevice({ agentId: AGENT, serial: "R58M123", registry, adbPath: "adb", exec: fakeAdb("R58M123\tdevice") });
  assert.equal(recording.appium, undefined);
  await recording.close();
  // Ejecutar sí: nada escucha en el puerto de Appium del PC.
  await assert.rejects(
    openAgentDevice({ agentId: AGENT, serial: "R58M123", appium: true, registry, adbPath: "adb", exec: fakeAdb("R58M123\tdevice") }),
    (err: Error & { code?: string }) => err.code === "LOCAL_AGENT_APPIUM_UNAVAILABLE" && /Appium no responde/.test(err.message),
  );
  for (let i = 0; i < 100 && registry.openStreamCount(AGENT) > 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(registry.openStreamCount(AGENT), 0, "los túneles de los intentos fallidos se cierran");
});

test("pairUserDevice: el agente sale del emparejamiento por IP, nunca del cliente", () => {
  const registry = new LocalAgentRegistry(new ChromiumPackage("C:\\no-usado", () => undefined), () => undefined);
  const user = { userId: "u1", username: "kevin" };
  assert.throws(() => pairUserDevice(user, "10.0.0.5", "emulator-5554", registry), /No hay un agente/);

  const handlers = registry.attachControl({ send: () => undefined, close: () => undefined }, { agentId: "agente-0001", ip: "10.0.0.5" });
  handlers.onMessage(JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.1.0", agentId: "agente-0001", machine: "PC", windowsUser: "kevin", chromium: [] }));
  assert.throws(() => pairUserDevice(user, "10.0.0.5", "emulator-5554", registry), /Android Studio/);

  handlers.onMessage(JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.2.0", agentId: "agente-0001", machine: "PC", windowsUser: "kevin", chromium: [], android: ANDROID }));
  assert.deepEqual(pairUserDevice(user, "10.0.0.5", " emulator-5554 ", registry), { localAgentId: "agente-0001", deviceSerial: "emulator-5554" });
  assert.throws(() => pairUserDevice(user, "10.0.0.9", "emulator-5554", registry), /No hay un agente/);
  assert.throws(() => pairUserDevice(user, "10.0.0.5", "x; rm -rf /", registry), /serial del dispositivo no es válido/);
});
