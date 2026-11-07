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
import { AppiumPackage, resolveAppiumSource } from "./appium-package";
import { writeFakeAppiumTree } from "./appium-package.fixture";
import { ChromiumPackage } from "./chromium-package";
import { openAgentDevice } from "./agent-device";

/**
 * Appium en el PC sin que el usuario haga nada: el servidor reparte el zip, el agente
 * lo instala al conectar (tiene Android Studio) y lo arranca la primera vez que el motor
 * abre el túnel de Appium. Endpoint, registro y agente reales; el "Appium" es el del
 * fixture, que responde /status con su APPIUM_HOME.
 */

const AGENT = "agente-appium-0001";
const ANDROID: AndroidStatus = { sdkFound: true, sdkPath: "C:\\Android\\Sdk", adbVersion: "35.0.2", emulatorFound: true, avds: [], devices: [], checkedAt: new Date().toISOString() };

/** Se borran al final, ya detenido el agente: Windows no deja borrar la carpeta de un Appium vivo. */
function tempDirs(prefixes: string[]): string[] {
  return prefixes.map((prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function removeAll(dirs: string[]): void {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

/** Paquete de Appium armable a partir del fixture. */
function fakeAppiumPackage(): { pkg: AppiumPackage; downloads: string; dirs: string[] } {
  const dirs = tempDirs(["qalab-aa-tree-", "qalab-aa-dl-"]);
  const [tree, downloads] = dirs;
  writeFakeAppiumTree(tree);
  return { pkg: new AppiumPackage(downloads, () => resolveAppiumSource(tree)), downloads, dirs };
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

const fakeAdb = (async () => ({ exitCode: 0, stdout: "List of devices attached\nemulator-5554\tdevice\n", stderr: "" })) as unknown as AdbExec;

async function setup(t: test.TestContext, options: { android?: AndroidStatus } = {}) {
  const { pkg, downloads, dirs } = fakeAppiumPackage();
  const [home] = tempDirs(["qalab-aa-home-"]);
  const logs: string[] = [];
  const registry = new LocalAgentRegistry(new ChromiumPackage(downloads, () => undefined), (l) => logs.push(l), pkg);
  const downloadsServed: string[] = [];
  const server = http.createServer((req, res) => {
    const file = path.join(downloads, path.basename(String(req.url)));
    downloadsServed.push(String(req.url));
    if (!String(req.url).startsWith("/descargas/") || !fs.existsSync(file)) return void res.writeHead(404).end();
    res.setHeader("Content-Length", fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  });
  attachLocalAgentEndpoint(server, registry);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  const appiumPort = await freePort();
  const agent = new LocalAgent({
    config: { serverUrl: `http://127.0.0.1:${port}`, agentId: AGENT, rootDir: home, browsersDir: path.join(home, "b"), logsDir: path.join(home, "logs") },
    version: "0.3.0",
    log: (l) => logs.push(l),
    android: { probe: async () => options.android ?? ANDROID, start: async () => ({ serial: "x", avd: "x" }), stop: async () => undefined },
    localTargets: { adb: { port: await freePort() } },
    appiumPort,
  });
  agent.start();
  await agent.connected;
  for (let i = 0; i < 100 && !registry.get(AGENT); i += 1) await new Promise((r) => setTimeout(r, 20));
  t.after(async () => {
    await agent.stop();
    await new Promise<void>((r) => server.close(() => r()));
    server.closeAllConnections?.();
    removeAll([...dirs, home]);
  });
  return { registry, home, appiumPort, logs, downloadsServed };
}

test("Appium del PC: el agente lo instala al conectar y lo arranca con el primer túnel", async (t) => {
  const { registry, home, appiumPort, logs, downloadsServed } = await setup(t);

  const device = await openAgentDevice({ agentId: AGENT, serial: "emulator-5554", appium: true, registry, adbPath: "adb", exec: fakeAdb, log: (l) => logs.push(l) });
  t.after(() => device.close());

  assert.ok(downloadsServed.includes("/descargas/appium-3.5.0-uia2-8.4.0.zip"), "el agente bajó el zip del propio servidor");
  assert.equal(registry.appiumInstallState(AGENT)?.state, "done");
  assert.ok(registry.hasAppium(registry.get(AGENT)!));
  const status = (await (await fetch(`http://${device.appium!.host}:${device.appium!.port}/status`)).json()) as { value: { ready: boolean }; home: string };
  assert.equal(status.value.ready, true);
  assert.equal(status.home, path.join(home, "appium", "appium-3.5.0-uia2-8.4.0"), "el motor habla con el Appium que instaló el agente");
  assert.ok(logs.some((l) => l.includes(`arrancando Appium en 127.0.0.1:${appiumPort}`)));
  assert.match(fs.readFileSync(path.join(home, "logs", "appium.log"), "utf8"), /fake appium listening/);

  // Una segunda ejecución reutiliza el Appium ya abierto.
  const again = await openAgentDevice({ agentId: AGENT, serial: "emulator-5554", appium: true, registry, adbPath: "adb", exec: fakeAdb });
  await again.close();
  assert.equal(logs.filter((l) => l.includes("arrancando Appium")).length, 1);
});

test("Appium del PC: sin Android Studio no se instala solo, pero ensureAppium lo pide al ejecutar", async (t) => {
  const { registry, downloadsServed } = await setup(t, { android: { ...ANDROID, sdkFound: false, adbVersion: undefined } });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(registry.appiumInstallState(AGENT), undefined, "sin Android Studio no se descarga nada");
  assert.ok(!downloadsServed.some((u) => u.includes("appium")));

  await registry.ensureAppium(AGENT);
  assert.equal(registry.appiumInstallState(AGENT)?.state, "done");
  await registry.ensureAppium(AGENT); // ya instalado: inmediato
});

test("Appium del PC: un agente anterior a 0.3.0 no se espera (vale el Appium que abrió el usuario)", async () => {
  const registry = new LocalAgentRegistry(new ChromiumPackage("C:\\no-usado", () => undefined), () => undefined, new AppiumPackage("C:\\no-usado", () => ({ version: "3.5.0-uia2-8.4.0", rootDir: "C:\\no-usado", dependencies: {} })));
  const sent: string[] = [];
  const handlers = registry.attachControl({ send: (d) => sent.push(d), close: () => undefined }, { agentId: "viejo", ip: "10.0.0.5" });
  handlers.onMessage(JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.2.0", agentId: "viejo", machine: "PC", windowsUser: "u", chromium: [], android: ANDROID }));
  await registry.ensureAppium("viejo");
  assert.ok(!sent.some((m) => m.includes("install_appium")), "no se le pide algo que no entiende");
  assert.throws(() => registry.requestAppiumInstall("viejo"), /anterior a 0\.3\.0/);
});

test("Appium del PC: si la instalación falla, ensureAppium lo dice y no se reintenta en cada hello", async (t) => {
  const { pkg, downloads, dirs } = fakeAppiumPackage();
  t.after(() => removeAll(dirs));
  const registry = new LocalAgentRegistry(new ChromiumPackage(downloads, () => undefined), () => undefined, pkg);
  const sent: string[] = [];
  const handlers = registry.attachControl({ send: (d) => sent.push(d), close: () => undefined }, { agentId: "nuevo", ip: "10.0.0.6" });
  const hello = JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.3.0", agentId: "nuevo", machine: "PC", windowsUser: "u", chromium: [], android: ANDROID, appium: { installed: [] } });
  handlers.onMessage(hello);
  const pending = registry.ensureAppium("nuevo");
  for (let i = 0; i < 100 && !sent.some((m) => m.includes("install_appium")); i += 1) await new Promise((r) => setTimeout(r, 10));
  const request = JSON.parse(sent.find((m) => m.includes("install_appium"))!) as { requestId: string };
  handlers.onMessage(JSON.stringify({ t: "appium_install_error", requestId: request.requestId, version: "3.5.0-uia2-8.4.0", message: "disco lleno" }));
  await assert.rejects(pending, (err: Error & { code?: string }) => err.code === "LOCAL_AGENT_APPIUM_INSTALL_FAILED" && /disco lleno/.test(err.message));

  const before = sent.filter((m) => m.includes("install_appium")).length;
  handlers.onMessage(hello);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(sent.filter((m) => m.includes("install_appium")).length, before, "el hello siguiente no vuelve a descargar");
});
