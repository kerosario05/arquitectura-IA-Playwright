import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { AppiumPackage, appiumClosure, resolveAppiumSource } from "./appium-package";
import { writeFakeAppiumTree } from "./appium-package.fixture";

const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

function tempDir(t: test.TestContext, prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("appiumClosure: Appium, el driver y sus dependencias resueltas como Node, sin lo de otros sistemas", (t) => {
  const root = tempDir(t, "qalab-appium-tree-");
  writeFakeAppiumTree(root);
  assert.deepEqual(appiumClosure(root), [
    "node_modules/appium",
    "node_modules/appium-adb",
    "node_modules/appium-uiautomator2-driver",
    "node_modules/lodash",
  ]);

  fs.rmSync(path.join(root, "node_modules", "lodash"), { recursive: true });
  assert.throws(() => appiumClosure(root), /Falta lodash \(dependencia de appium\)/);
});

test("resolveAppiumSource: la versión junta la de Appium y la del driver; sin ellos no hay paquete", (t) => {
  const root = tempDir(t, "qalab-appium-src-");
  assert.equal(resolveAppiumSource(root), undefined);
  writeFakeAppiumTree(root);
  assert.deepEqual(resolveAppiumSource(root), {
    version: "3.5.0-uia2-8.4.0",
    rootDir: root,
    dependencies: { appium: "3.5.0", "appium-uiautomator2-driver": "8.4.0" },
  });
});

test("AppiumPackage: arma el zip una vez, con package.json propio y sin mapas ni TypeScript", async (t) => {
  const root = tempDir(t, "qalab-appium-pkg-");
  const downloads = tempDir(t, "qalab-appium-dl-");
  writeFakeAppiumTree(root);
  const pkg = new AppiumPackage(downloads, () => resolveAppiumSource(root));
  const logs: string[] = [];

  const [a, b] = await Promise.all([pkg.ensure((l) => logs.push(l)), pkg.ensure((l) => logs.push(l))]);
  assert.deepEqual(a, b);
  assert.equal(logs.filter((l) => l.includes("armando")).length, 1, "dos pedidos a la vez arman un solo zip");
  assert.equal(a.url, "/descargas/appium-3.5.0-uia2-8.4.0.zip");
  const zip = pkg.zipPath(a.version);
  assert.equal(a.sha256, createHash("sha256").update(fs.readFileSync(zip)).digest("hex"));

  const entries = execFileSync(TAR, ["-tf", zip], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean).map((e) => e.replace(/\/$/, ""));
  for (const expected of [
    "package.json",
    "node_modules/appium/index.js",
    "node_modules/appium/README.md",
    "node_modules/appium-adb/node_modules/semver/package.json",
    "node_modules/appium-uiautomator2-driver/build/index.js",
  ]) assert.ok(entries.includes(expected), `${expected} en el zip`);
  assert.ok(!entries.some((e) => /\.map$|\.ts$/.test(e)), "sin .map ni .ts");
  assert.ok(!entries.some((e) => e.includes("sharp-linux") || e.includes("playwright")));

  const extracted = tempDir(t, "qalab-appium-x-");
  execFileSync(TAR, ["-xf", zip, "-C", extracted]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(extracted, "package.json"), "utf8")).dependencies, {
    appium: "3.5.0",
    "appium-uiautomator2-driver": "8.4.0",
  });

  assert.deepEqual(await pkg.ensure((l) => logs.push(l)), a);
  assert.equal(logs.filter((l) => l.includes("armando")).length, 1, "ya armado: no se vuelve a armar");
  assert.ok(!fs.readdirSync(downloads).some((f) => f.includes(".stage") || f.includes(".tmp")), "sin restos temporales");
});
