import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { ChromiumPackage, resolveChromiumSource } from "./chromium-package";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeRevisionDir(): string {
  const dir = path.join(tmp("qalab-pkg-src-"), "chromium-1223");
  fs.mkdirSync(path.join(dir, "chrome-win64"), { recursive: true });
  fs.writeFileSync(path.join(dir, "chrome-win64", "chrome.exe"), "MZ-falso");
  fs.writeFileSync(path.join(dir, "chrome-win64", "resources.pak"), "x".repeat(10_000));
  fs.writeFileSync(path.join(dir, "INSTALLATION_COMPLETE"), "");
  return dir;
}

test("lee la revisión de la ruta de chrome.exe de Playwright", () => {
  assert.deepEqual(resolveChromiumSource("C:\\qa\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe"), {
    revision: "1223",
    revisionDir: "C:\\qa\\ms-playwright\\chromium-1223",
  });
  assert.equal(resolveChromiumSource("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"), undefined);
});

test("arma el zip una sola vez (aunque lo pidan a la vez), con sha256, y luego lo reutiliza", async () => {
  const revisionDir = fakeRevisionDir();
  const downloads = tmp("qalab-pkg-out-");
  const pkg = new ChromiumPackage(downloads, () => ({ revision: "1223", revisionDir }));
  assert.equal(pkg.readyInfo(), undefined);

  const [a, b] = await Promise.all([pkg.ensure(() => undefined), pkg.ensure(() => undefined)]);
  assert.deepEqual(a, b);
  assert.equal(a.url, "/descargas/chromium-1223.zip");
  const zip = fs.readFileSync(path.join(downloads, "chromium-1223.zip"));
  assert.equal(a.sha256, createHash("sha256").update(zip).digest("hex"));
  assert.equal(a.sizeBytes, zip.length);
  assert.equal(zip.subarray(0, 2).toString(), "PK", "es un zip, no un tar");
  assert.deepEqual(fs.readdirSync(downloads).sort(), ["chromium-1223.zip", "chromium-1223.zip.sha256"]);

  // Otra instancia (reinicio del motor) reutiliza zip y sha sin rearmar.
  const mtime = fs.statSync(path.join(downloads, "chromium-1223.zip")).mtimeMs;
  const again = await new ChromiumPackage(downloads, () => ({ revision: "1223", revisionDir })).ensure(() => undefined);
  assert.equal(again.sha256, a.sha256);
  assert.equal(fs.statSync(path.join(downloads, "chromium-1223.zip")).mtimeMs, mtime);
});

test("sin chrome.exe en el servidor falla con un mensaje claro", async () => {
  const revisionDir = path.join(tmp("qalab-pkg-src-"), "chromium-1223");
  fs.mkdirSync(revisionDir);
  const pkg = new ChromiumPackage(tmp("qalab-pkg-out-"), () => ({ revision: "1223", revisionDir }));
  await assert.rejects(pkg.ensure(() => undefined), /falta instalar Chromium 1223 en el servidor/);
  const none = new ChromiumPackage(tmp("qalab-pkg-out-"), () => undefined);
  await assert.rejects(none.ensure(() => undefined), /no encuentra el Chromium/);
});
