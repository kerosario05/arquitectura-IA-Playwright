import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { manifestInfo, parseAxml, readApkManifest } from "./apk-manifest";
import { buildAxml, type Node } from "./apk-manifest.fixture";

const launcherFilter: Node = {
  name: "intent-filter",
  children: [
    { name: "action", attrs: [["name", "android.intent.action.MAIN"]] },
    { name: "category", attrs: [["name", "android.intent.category.LAUNCHER"]] },
  ],
};

const manifest: Node = {
  name: "manifest",
  attrs: [["versionCode", 42], ["versionName", "2.3.1"], ["package", "com.banco.app"]],
  children: [
    { name: "uses-sdk", attrs: [["minSdkVersion", 24], ["targetSdkVersion", 35]] },
    {
      name: "application",
      children: [
        { name: "activity", attrs: [["name", ".SplashOff"], ["enabled", false]], children: [launcherFilter] },
        { name: "activity", attrs: [["name", "com.banco.app.Detalle"]] },
        { name: "activity", attrs: [["name", ".ui.MainActivity"]], children: [launcherFilter] },
      ],
    },
  ],
};

const expected = { packageName: "com.banco.app", mainActivity: "com.banco.app.ui.MainActivity", versionName: "2.3.1", versionCode: "42", minSdk: "24", targetSdk: "35" };

test("manifiesto binario UTF-16: paquete, versión, SDK y la actividad MAIN/LAUNCHER habilitada", () => {
  assert.deepEqual(manifestInfo(parseAxml(buildAxml(manifest))), expected);
});

test("pool UTF-8 y nombres de atributo ofuscados (se resuelven por id de recurso)", () => {
  assert.deepEqual(manifestInfo(parseAxml(buildAxml(manifest, { utf8: true, obfuscated: true }))), expected);
});

test("sin actividad de inicio (p. ej. un APK de pruebas) mainActivity queda vacío; un alias sí cuenta", () => {
  const noLauncher: Node = { name: "manifest", attrs: [["package", "io.app.test"]], children: [{ name: "application", children: [{ name: "activity", attrs: [["name", "X"]] }] }] };
  assert.deepEqual(manifestInfo(parseAxml(buildAxml(noLauncher))), { packageName: "io.app.test", mainActivity: "" });

  const alias: Node = { name: "manifest", attrs: [["package", "io.app"]], children: [{ name: "application", children: [{ name: "activity-alias", attrs: [["name", "Launcher"]], children: [launcherFilter] }] }] };
  assert.equal(manifestInfo(parseAxml(buildAxml(alias))).mainActivity, "io.app.Launcher");
});

test("readApkManifest abre el zip; un archivo que no es APK da un error claro", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apk-manifest-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const zip = new JSZip();
  zip.file("AndroidManifest.xml", buildAxml(manifest));
  zip.file("classes.dex", "dex");
  const apk = path.join(dir, "app.apk");
  fs.writeFileSync(apk, await zip.generateAsync({ type: "nodebuffer" }));
  assert.deepEqual(await readApkManifest(apk), expected);

  const bogus = path.join(dir, "no.apk");
  fs.writeFileSync(bogus, "hola");
  await assert.rejects(readApkManifest(bogus), (err: Error & { code?: string }) => err.code === "apk_not_zip");
  const empty = new JSZip();
  empty.file("otra.txt", "x");
  fs.writeFileSync(bogus, await empty.generateAsync({ type: "nodebuffer" }));
  await assert.rejects(readApkManifest(bogus), (err: Error & { code?: string }) => err.code === "manifest_missing");
});
