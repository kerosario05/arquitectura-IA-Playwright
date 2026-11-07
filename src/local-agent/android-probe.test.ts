import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  parseAdbDevices,
  parseAdbVersion,
  parseAvdList,
  parseAvdName,
  probeAndroid,
  resolveSdk,
  startEmulator,
  stopEmulator,
  type AndroidSdkPaths,
  type CommandRunner,
} from "./android-probe";

const SDK: AndroidSdkPaths = { sdkPath: "C:\\Sdk", adbPath: "adb", emulatorPath: "emulator" };

/** Runner falso: responde según "archivo args". */
function fakeRunner(responses: Record<string, string | Error | (() => string)>): CommandRunner & { calls: string[] } {
  const calls: string[] = [];
  const run = (async (file: string, args: string[]) => {
    const key = [file, ...args].join(" ");
    calls.push(key);
    const answer = responses[key];
    if (answer === undefined) throw new Error(`comando inesperado: ${key}`);
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer() : answer;
  }) as CommandRunner & { calls: string[] };
  run.calls = calls;
  return run;
}

test("parsea adb devices -l: emuladores, teléfonos USB y estados no usables", () => {
  const out = [
    "List of devices attached",
    "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1",
    "R58M123ABC             unauthorized usb:1-1 transport_id:2",
    "192.168.1.20:5555      device product:a52 model:SM_A525M device:a52q transport_id:3",
    "",
  ].join("\r\n");
  assert.deepEqual(parseAdbDevices(out), [
    { serial: "emulator-5554", state: "device", kind: "emulator", model: "sdk_gphone64_x86_64" },
    { serial: "R58M123ABC", state: "unauthorized", kind: "physical" },
    { serial: "192.168.1.20:5555", state: "device", kind: "physical", model: "SM_A525M" },
  ]);
});

test("parsea la versión de adb, la lista de AVD y el nombre del AVD", () => {
  assert.equal(parseAdbVersion("Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\nInstalled as C:\\adb.exe"), "35.0.2");
  assert.equal(parseAdbVersion("Android Debug Bridge version 1.0.39"), "1.0.39");
  assert.deepEqual(parseAvdList("INFO    | Storing crashdata in: C:\\x\nPixel_6_API_34\r\nMedium_Phone\n"), ["Pixel_6_API_34", "Medium_Phone"]);
  assert.equal(parseAvdName("Pixel_6_API_34\r\nOK\r\n"), "Pixel_6_API_34");
});

test("resolveSdk exige adb; el emulador es opcional", () => {
  const files = new Set([path.join("C:\\B", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb")]);
  const sdk = resolveSdk(["C:\\A", "C:\\B"], (p) => files.has(p));
  assert.equal(sdk?.sdkPath, "C:\\B");
  assert.equal(sdk?.emulatorPath, undefined);
  assert.equal(resolveSdk(["C:\\A"], () => false), undefined);
});

test("probeAndroid sin SDK lo dice sin lanzar comandos", async () => {
  const run = fakeRunner({});
  const status = await probeAndroid({ run, sdk: undefined });
  assert.equal(status.sdkFound, false);
  assert.match(status.error ?? "", /Android Studio/);
  assert.equal(run.calls.length, 0);
});

test("probeAndroid junta versión, dispositivos, AVD y el nombre del AVD encendido", async () => {
  const run = fakeRunner({
    "adb version": "Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458",
    "adb devices -l": "List of devices attached\nemulator-5554 device model:sdk_gphone64\n",
    "emulator -list-avds": "Pixel_6_API_34\nTablet\n",
    // Vía principal; `emu avd name` (respaldo) lo cubren las pruebas de startEmulator.
    "adb -s emulator-5554 shell getprop ro.boot.qemu.avd_name": "Pixel_6_API_34\r\n",
  });
  const status = await probeAndroid({ run, sdk: SDK, now: () => new Date("2026-10-30T10:00:00Z") });
  assert.deepEqual(status, {
    sdkFound: true,
    sdkPath: "C:\\Sdk",
    adbVersion: "35.0.2",
    emulatorFound: true,
    avds: ["Pixel_6_API_34", "Tablet"],
    devices: [{ serial: "emulator-5554", state: "device", kind: "emulator", model: "sdk_gphone64", avd: "Pixel_6_API_34" }],
    checkedAt: "2026-10-30T10:00:00.000Z",
  });
});

test("probeAndroid informa el fallo de adb sin perder el resto", async () => {
  const run = fakeRunner({
    "adb version": "Version 35.0.2-1",
    "adb devices -l": new Error("adb server didn't ACK"),
    "emulator -list-avds": "Pixel_6\n",
  });
  const status = await probeAndroid({ run, sdk: SDK });
  assert.equal(status.sdkFound, true);
  assert.deepEqual(status.avds, ["Pixel_6"]);
  assert.deepEqual(status.devices, []);
  assert.match(status.error ?? "", /adb devices falló: adb server didn't ACK/);
});

test("startEmulator lanza el AVD y espera boot_completed", async () => {
  let launched = 0;
  let bootChecks = 0;
  const run = fakeRunner({
    "emulator -list-avds": "Pixel_6\n",
    "adb version": "Version 35.0.2-1",
    "adb devices -l": () => (launched ? "emulator-5556 device model:x\n" : ""),
    "adb -s emulator-5556 emu avd name": "Pixel_6\nOK\n",
    "adb -s emulator-5556 shell getprop sys.boot_completed": () => (++bootChecks >= 2 ? "1\n" : "\n"),
  });
  const phases: string[] = [];
  const ready = await startEmulator("Pixel_6", { sdk: SDK, run, pollMs: 1, launch: () => (launched += 1), onProgress: (p) => phases.push(p) });
  assert.deepEqual(ready, { serial: "emulator-5556", avd: "Pixel_6" });
  assert.equal(launched, 1);
  assert.deepEqual(phases, ["launched", "booting"]);
});

test("startEmulator reutiliza el emulador ya encendido y rechaza un AVD inexistente", async () => {
  const run = fakeRunner({
    "emulator -list-avds": "Pixel_6\n",
    "adb version": "Version 35.0.2-1",
    "adb devices -l": "emulator-5554 device\n",
    "adb -s emulator-5554 emu avd name": "Pixel_6\nOK\n",
    "adb -s emulator-5554 shell getprop sys.boot_completed": "1\n",
  });
  let launched = 0;
  assert.deepEqual(await startEmulator("Pixel_6", { sdk: SDK, run, pollMs: 1, launch: () => (launched += 1) }), { serial: "emulator-5554", avd: "Pixel_6" });
  assert.equal(launched, 0);
  await assert.rejects(startEmulator("Otro", { sdk: SDK, run, launch: () => undefined }), /no existe en este equipo/);
});

test("stopEmulator: si la consola rechaza emu kill, apaga desde Android", async () => {
  const run = fakeRunner({
    "adb -s emulator-5554 emu kill": new Error("could not connect to TCP port 5554"),
    "adb -s emulator-5554 shell reboot -p": "",
  });
  await stopEmulator("emulator-5554", { sdk: SDK, run });
  assert.deepEqual(run.calls, ["adb -s emulator-5554 emu kill", "adb -s emulator-5554 shell reboot -p"]);
  await assert.rejects(stopEmulator("R58M123", { sdk: SDK, run }), /no es un emulador/);
});
