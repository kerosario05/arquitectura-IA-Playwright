import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { ChromiumInstaller, findChromeExe } from "./chromium-installer";

const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Zip con la forma de ms-playwright\chromium-<rev>: chrome-win64\chrome.exe + otros. */
function makeChromiumZip(withChrome = true): { zip: Buffer; sha256: string } {
  const src = tmp("qalab-inst-src-");
  fs.mkdirSync(path.join(src, "chrome-win64"));
  if (withChrome) fs.writeFileSync(path.join(src, "chrome-win64", "chrome.exe"), "MZ-falso");
  fs.writeFileSync(path.join(src, "chrome-win64", "resources.pak"), randomBytes(200_000));
  const zipPath = path.join(tmp("qalab-inst-zip-"), "chromium.zip");
  execFileSync(TAR, ["--format", "zip", "-c", "-f", zipPath, "-C", src, "chrome-win64"]);
  const zip = fs.readFileSync(zipPath);
  return { zip, sha256: createHash("sha256").update(zip).digest("hex") };
}

async function serve(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test("instala, informa avance y deja el marcador; la segunda vez no descarga", async () => {
  const { zip, sha256 } = makeChromiumZip();
  let downloads = 0;
  const site = await serve((_req, res) => {
    downloads += 1;
    res.writeHead(200, { "content-length": zip.length, "content-type": "application/zip" });
    res.end(zip);
  });
  try {
    const dir = tmp("qalab-inst-dest-");
    const installer = new ChromiumInstaller(dir, site.url);
    assert.equal(installer.status("1223").installed, false);

    const phases = new Set<string>();
    let lastPercent = -1;
    const status = await installer.install({ revision: "1223", url: "/descargas/chromium-1223.zip", sha256 }, (p) => {
      phases.add(p.phase);
      if (p.percent !== undefined) {
        assert.ok(p.percent >= lastPercent, "el porcentaje no retrocede");
        lastPercent = p.percent;
      }
    });

    assert.equal(status.installed, true);
    assert.equal(status.executablePath, path.join(dir, "chromium-1223", "chrome-win64", "chrome.exe"));
    assert.deepEqual([...phases].sort(), ["download", "extract"]);
    assert.equal(lastPercent, 100);
    assert.deepEqual(fs.readdirSync(dir), ["chromium-1223"], "sin restos .tmp ni .zip.part");
    assert.deepEqual(installer.installedRevisions().map((s) => s.revision), ["1223"]);

    await installer.install({ revision: "1223", url: "/descargas/chromium-1223.zip" });
    assert.equal(downloads, 1);
  } finally {
    site.close();
  }
});

test("dos peticiones simultáneas comparten una sola descarga", async () => {
  const { zip } = makeChromiumZip();
  let downloads = 0;
  const site = await serve((_req, res) => {
    downloads += 1;
    res.writeHead(200, { "content-length": zip.length });
    res.end(zip);
  });
  try {
    const installer = new ChromiumInstaller(tmp("qalab-inst-dest-"), site.url);
    const [a, b] = await Promise.all([
      installer.install({ revision: "1223", url: "/z" }),
      installer.install({ revision: "1223", url: "/z" }),
    ]);
    assert.equal(a.installed && b.installed, true);
    assert.equal(downloads, 1);
  } finally {
    site.close();
  }
});

test("sha256 distinto: falla y no deja una instalación a medias", async () => {
  const { zip } = makeChromiumZip();
  const site = await serve((_req, res) => res.end(zip));
  try {
    const dir = tmp("qalab-inst-dest-");
    const installer = new ChromiumInstaller(dir, site.url);
    await assert.rejects(installer.install({ revision: "1223", url: "/z", sha256: "0".repeat(64) }), /sha256/);
    assert.equal(installer.status("1223").installed, false);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    site.close();
  }
});

test("descarga cortada a mitad: falla y el siguiente intento instala", async () => {
  const { zip } = makeChromiumZip();
  let first = true;
  const site = await serve((_req, res) => {
    res.writeHead(200, { "content-length": zip.length });
    if (first) {
      first = false;
      res.write(zip.subarray(0, 1000));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(zip);
  });
  try {
    const dir = tmp("qalab-inst-dest-");
    const installer = new ChromiumInstaller(dir, site.url);
    await assert.rejects(installer.install({ revision: "1223", url: "/z" }));
    assert.equal(installer.status("1223").installed, false);
    assert.equal((await installer.install({ revision: "1223", url: "/z" })).installed, true);
  } finally {
    site.close();
  }
});

test("un zip sin chrome.exe se rechaza", async () => {
  const { zip } = makeChromiumZip(false);
  const site = await serve((_req, res) => res.end(zip));
  try {
    const dir = tmp("qalab-inst-dest-");
    const installer = new ChromiumInstaller(dir, site.url);
    await assert.rejects(installer.install({ revision: "1223", url: "/z" }), /chrome\.exe/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    site.close();
  }
});

test("HTTP de error del servidor se informa", async () => {
  const site = await serve((_req, res) => { res.statusCode = 404; res.end(); });
  try {
    const installer = new ChromiumInstaller(tmp("qalab-inst-dest-"), site.url);
    await assert.rejects(installer.install({ revision: "1223", url: "/z" }), /HTTP 404/);
  } finally {
    site.close();
  }
});

test("una carpeta sin marcador (instalación interrumpida) no cuenta como instalada", () => {
  const dir = tmp("qalab-inst-dest-");
  fs.mkdirSync(path.join(dir, "chromium-1223", "chrome-win64"), { recursive: true });
  fs.writeFileSync(path.join(dir, "chromium-1223", "chrome-win64", "chrome.exe"), "x");
  const installer = new ChromiumInstaller(dir, "http://127.0.0.1:1");
  assert.equal(installer.status("1223").installed, false);
  assert.ok(findChromeExe(path.join(dir, "chromium-1223")));
});

test("pruneExcept borra otras revisiones y restos, nunca la indicada", () => {
  const dir = tmp("qalab-inst-dest-");
  for (const name of ["chromium-1217", "chromium-1223", "chromium-1230.tmp", "otra-cosa"]) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, "chromium-1230.zip.part"), "x");
  const removed = new ChromiumInstaller(dir, "http://127.0.0.1:1").pruneExcept("1223");
  assert.deepEqual(removed.sort(), ["chromium-1217", "chromium-1230.tmp", "chromium-1230.zip.part"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["chromium-1223", "otra-cosa"]);
});

test("revisión con caracteres no numéricos se rechaza (evita rutas fuera de la carpeta)", () => {
  const installer = new ChromiumInstaller(tmp("qalab-inst-dest-"), "http://127.0.0.1:1");
  assert.throws(() => installer.dirFor("..\\..\\Windows"), /inválida/);
});
