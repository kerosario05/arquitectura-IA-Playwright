import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { adbArgs, ensureApkInstalled, parseInstalledVersion, parsePmPath, type AdbExec, type AdbResult } from "./apk-installer";
import { resolveAdbPath } from "./android-sdk";

const TUNNEL = { adbPath: "adb", serial: "emulator-5554", host: "127.0.0.1", port: 61234 };
const APK = { apkPath: "C:\\apks\\app.apk", packageName: "com.banco.app", versionCode: "42" };

const NOT_FOUND = "Unable to find package: com.banco.app\n";
const LOCAL_SHA = "a".repeat(64);
const BASE = "/data/app/~~x==/com.banco.app-y==/base.apk";

/** adb falso. `path` ausente = sin APK en el dispositivo; `sha` ausente = el dispositivo no tiene sha256sum. */
function fakeAdb(responses: { dumpsys: string; path?: boolean; sha?: string; install?: AdbResult; dumpsysFailures?: number }): AdbExec & { calls: string[][] } {
  const calls: string[][] = [];
  let failures = responses.dumpsysFailures ?? 0;
  const exec = (async (_adb: string, args: string[]) => {
    calls.push(args);
    if (args.includes("dumpsys")) {
      if (failures-- > 0) return { exitCode: 1, stdout: "", stderr: "" };
      return { exitCode: 0, stdout: responses.dumpsys, stderr: "" };
    }
    if (args.includes("path")) return responses.path ? { exitCode: 0, stdout: `package:${BASE}\r\npackage:/data/app/x/split_config.en.apk\r\n`, stderr: "" } : { exitCode: 1, stdout: "", stderr: "" };
    if (args.includes("sha256sum")) return responses.sha ? { exitCode: 0, stdout: `${responses.sha}  ${BASE}\n`, stderr: "" } : { exitCode: 127, stdout: "", stderr: "sha256sum: not found" };
    if (args.includes("install")) return responses.install ?? { exitCode: 0, stdout: "Performing Streamed Install\nSuccess\n", stderr: "" };
    throw new Error(`inesperado: ${args.join(" ")}`);
  }) as unknown as AdbExec & { calls: string[][] };
  exec.calls = calls;
  return exec;
}

const installed = (code: string) => `Packages:\n  Package [com.banco.app] (1a2b):\n    userId=10190\n    versionCode=${code} minSdk=24 targetSdk=35\n    versionName=2.3.1\n`;

test("por el túnel: adb -H/-P con el serial del dispositivo del usuario", () => {
  assert.deepEqual(adbArgs(TUNNEL, ["shell", "echo"]), ["-H", "127.0.0.1", "-P", "61234", "-s", "emulator-5554", "shell", "echo"]);
  assert.deepEqual(adbArgs({ adbPath: "adb", serial: "R58M" }, ["devices"]), ["-s", "R58M", "devices"]);
});

test("versión instalada: la del paquete pedido, no la de otro", () => {
  assert.equal(parseInstalledVersion(installed("42"), "com.banco.app"), "42");
  assert.equal(parseInstalledVersion("Package [com.otro] (x):\n versionCode=9 ", "com.banco.app"), undefined);
  assert.equal(parseInstalledVersion("", "com.banco.app"), undefined);
});

test("mismo APK (mismo SHA-256): no reinstala ni borra datos", async () => {
  const same = fakeAdb({ dumpsys: installed("42"), path: true, sha: LOCAL_SHA });
  assert.deepEqual(await ensureApkInstalled(TUNNEL, APK, { exec: same, sha256: LOCAL_SHA }), { action: "already_installed", previousVersionCode: "42" });
  assert.ok(!same.calls.some((c) => c.includes("install")));
  assert.deepEqual(parsePmPath(`package:/data/app/x/split_config.en.apk\npackage:${BASE}`), BASE);
});

test("otra compilación con el mismo versionCode se instala encima (conserva datos con -r)", async () => {
  const other = fakeAdb({ dumpsys: installed("42"), path: true, sha: "b".repeat(64) });
  assert.deepEqual(await ensureApkInstalled(TUNNEL, APK, { exec: other, sha256: LOCAL_SHA }), { action: "updated", previousVersionCode: "42" });
  assert.deepEqual(other.calls.at(-1), ["-H", "127.0.0.1", "-P", "61234", "-s", "emulator-5554", "install", "-r", "-t", "-d", APK.apkPath]);
});

test("app archivada (dumpsys la conoce pero no hay APK) o ausente: se instala", async () => {
  const archived = fakeAdb({ dumpsys: installed("42"), path: false });
  assert.deepEqual(await ensureApkInstalled(TUNNEL, APK, { exec: archived, sha256: LOCAL_SHA }), { action: "installed" });
  const missing = fakeAdb({ dumpsys: NOT_FOUND, path: false });
  assert.deepEqual(await ensureApkInstalled(TUNNEL, APK, { exec: missing, sha256: LOCAL_SHA }), { action: "installed" });
});

test("sin sha256sum en el dispositivo se compara la versión; recién arrancado reintenta la consulta", async () => {
  const sameVersion = fakeAdb({ dumpsys: installed("42"), path: true, dumpsysFailures: 2 });
  assert.equal((await ensureApkInstalled(TUNNEL, APK, { exec: sameVersion, sha256: LOCAL_SHA })).action, "already_installed");
  assert.equal(sameVersion.calls.filter((c) => c.includes("dumpsys")).length, 3);
  const olderVersion = fakeAdb({ dumpsys: installed("41"), path: true });
  assert.equal((await ensureApkInstalled(TUNNEL, APK, { exec: olderVersion, sha256: LOCAL_SHA })).action, "updated");
});

test("fallos de instalación con un mensaje que el usuario puede seguir", async () => {
  const signature = fakeAdb({ dumpsys: installed("41"), path: true, sha: "b".repeat(64), install: { exitCode: 1, stdout: "Performing Streamed Install\n", stderr: "adb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.banco.app signatures do not match]" } });
  await assert.rejects(ensureApkInstalled(TUNNEL, APK, { exec: signature, sha256: LOCAL_SHA }), (err: Error & { code?: string }) => err.code === "INSTALL_FAILED_UPDATE_INCOMPATIBLE" && /otra firma/.test(err.message));

  const abi = fakeAdb({ dumpsys: NOT_FOUND, install: { exitCode: 1, stdout: "", stderr: "Failure [INSTALL_FAILED_NO_MATCHING_ABIS: Failed to extract native libraries, res=-113]" } });
  await assert.rejects(ensureApkInstalled(TUNNEL, APK, { exec: abi, sha256: LOCAL_SHA }), /arquitectura/);

  const silent = fakeAdb({ dumpsys: NOT_FOUND, install: { exitCode: 0, stdout: "", stderr: "" } });
  await assert.rejects(ensureApkInstalled(TUNNEL, APK, { exec: silent, sha256: LOCAL_SHA }), (err: Error & { code?: string }) => err.code === "install_failed");
});

test("resolveAdbPath: basta platform-tools (sin emulador) o ANDROID_ADB_PATH", () => {
  const sdk = path.resolve("C:\\Sdk");
  const adb = path.join(sdk, "platform-tools", "adb.exe");
  const files = new Set([sdk, adb]);
  const opts = { platform: "win32" as const, configuredSdkHome: "", existsSync: (p: string) => files.has(p) };
  assert.equal(resolveAdbPath({ ...opts, env: { ANDROID_HOME: sdk } }), adb);

  const explicit = path.resolve("D:\\tools\\adb.exe");
  files.add(explicit);
  assert.equal(resolveAdbPath({ ...opts, env: { ANDROID_ADB_PATH: `"${explicit}"`, ANDROID_HOME: sdk } }), explicit);
  assert.throws(() => resolveAdbPath({ ...opts, env: {} }), /platform-tools/);
});
