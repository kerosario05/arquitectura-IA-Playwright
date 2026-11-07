import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { AppiumPackage, resolveAppiumSource } from "../server/local-agent/appium-package";
import { writeFakeAppiumTree } from "../server/local-agent/appium-package.fixture";
import { AppiumInstaller, AppiumServer } from "./appium-runtime";

function tempDir(t: test.TestContext, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", () => r()));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

/** Un servidor de QA Lab mínimo que sirve /descargas desde `dir`. */
async function serveDownloads(t: test.TestContext, dir: string): Promise<string> {
  const server = http.createServer((req, res) => {
    const file = path.join(dir, path.basename(String(req.url)));
    if (!fs.existsSync(file)) return void res.writeHead(404).end();
    res.setHeader("Content-Length", fs.statSync(file).size);
    fs.createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  t.after(() => server.close());
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test("AppiumInstaller: descarga el zip del servidor, comprueba su sha256 y deja la versión instalada", async (t) => {
  const tree = tempDir(t, "qalab-arun-tree-");
  const downloads = tempDir(t, "qalab-arun-dl-");
  const home = tempDir(t, "qalab-arun-home-");
  writeFakeAppiumTree(tree);
  const info = await new AppiumPackage(downloads, () => resolveAppiumSource(tree)).ensure(() => undefined);
  const serverUrl = await serveDownloads(t, downloads);
  const installer = new AppiumInstaller(path.join(home, "appium"), serverUrl);

  await assert.rejects(installer.install({ ...info, sha256: "0".repeat(64) }), /no coincide con su sha256/);
  assert.deepEqual(installer.installedVersions(), [], "una descarga corrupta no deja nada instalado");

  const phases: string[] = [];
  const dir = await installer.install(info, (p) => phases.push(p.phase));
  assert.equal(dir, installer.dirFor(info.version));
  assert.ok(phases.includes("download") && phases.at(-1) === "extract");
  assert.deepEqual(installer.installedVersions(), ["3.5.0-uia2-8.4.0"]);
  assert.ok(installer.mainScript(info.version)?.endsWith(path.join("node_modules", "appium", "index.js")));
  assert.ok(!fs.readdirSync(path.join(home, "appium")).some((f) => f.includes(".tmp") || f.includes(".part")));

  // Ya instalada: no vuelve a descargar.
  await installer.install({ ...info, url: "/descargas/no-existe.zip" });
  assert.throws(() => installer.dirFor("../fuera"), /versión de Appium inválida/);
});

test("AppiumServer: arranca una sola vez con APPIUM_HOME y el SDK, espera a /status y se detiene", async (t) => {
  const tree = tempDir(t, "qalab-arun-srv-");
  writeFakeAppiumTree(tree);
  const port = await freePort();
  const logs: string[] = [];
  const server = new AppiumServer({
    home: tree,
    mainScript: path.join(tree, "node_modules", "appium", "index.js"),
    port,
    sdkPath: "C:\\Android\\Sdk",
    logFile: path.join(tree, "logs", "appium.log"),
    log: (l) => logs.push(l),
  });

  await Promise.all([server.start(), server.start()]);
  assert.equal(server.running, true);
  assert.equal(logs.filter((l) => l.includes("arrancando Appium")).length, 1, "dos conexiones a la vez arrancan un solo Appium");
  const status = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as { value: { ready: boolean }; home: string };
  assert.equal(status.value.ready, true);
  assert.equal(status.home, tree);
  assert.match(fs.readFileSync(path.join(tree, "logs", "appium.log"), "utf8"), /fake appium listening/);

  await server.stop();
  assert.equal(server.running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/status`), "ya no escucha");
});

test("AppiumServer: si Appium termina al arrancar, el error trae su salida", async (t) => {
  const dir = tempDir(t, "qalab-arun-crash-");
  const crash = path.join(dir, "crash.js");
  fs.writeFileSync(crash, `console.error("Could not find a driver for automationName 'UiAutomator2'"); process.exit(3);`);
  const server = new AppiumServer({ home: dir, mainScript: crash, port: await freePort(), logFile: path.join(dir, "appium.log") });
  await assert.rejects(server.start(), /terminó al arrancar \(código 3\).*UiAutomator2/s);
  assert.equal(server.running, false);
});
