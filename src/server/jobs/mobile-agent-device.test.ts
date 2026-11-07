import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildApk } from "../../utils/apk-manifest.fixture";
import type { AdbExec, AdbTarget, ensureApkInstalled } from "../../mobile/apk-installer";
import type { AgentDevice } from "../local-agent/agent-device";
import { jobStore } from "./job-store";
import {
  __resetAgentDeviceAdbForTesting,
  __resetOpenAgentDeviceForTesting,
  __resetProjectApkPathForTesting,
  __setAgentDeviceAdbForTesting,
  __setOpenAgentDeviceForTesting,
  __setProjectApkPathForTesting,
  ensureMobileInfra,
  type RunOneScenarioOptions,
} from "./mobile-test-runner";
import { startMobileLaunchExecutionJobWithDeps } from "./mobile-launch-execution-runner";

/**
 * Lanzar pruebas sobre el dispositivo del PC del usuario: el runner abre ese dispositivo,
 * instala el APK por el túnel adb y crea la sesión en el Appium del PC por package, sin tocar
 * el emulador ni el Appium del servidor.
 */

const launcher = {
  name: "intent-filter",
  children: [
    { name: "action", attrs: [["name", "android.intent.action.MAIN"]] as Array<[string, string]> },
    { name: "category", attrs: [["name", "android.intent.category.LAUNCHER"]] as Array<[string, string]> },
  ],
};

async function writeApk(dir: string): Promise<string> {
  const apk = path.join(dir, "app.apk");
  fs.writeFileSync(apk, await buildApk({
    name: "manifest",
    attrs: [["versionCode", 42], ["package", "com.banco.app"]],
    children: [{ name: "application", children: [{ name: "activity", attrs: [["name", ".ui.MainActivity"]], children: [launcher] }] }],
  }));
  return apk;
}

function fakeDevice(): AgentDevice & { closed: number } {
  const device = {
    agentId: "agente-0001",
    serial: "emulator-5554",
    adb: { adbPath: "adb", serial: "emulator-5554", host: "127.0.0.1", port: 61001 },
    appium: { host: "127.0.0.1", port: 61002 },
    closed: 0,
    close: async () => {
      device.closed += 1;
    },
  };
  return device;
}

test("Lanzar pruebas en el PC del usuario: instala por el túnel y abre la app por package en su Appium", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-agent-run-"));
  const apkPath = await writeApk(dir);
  const device = fakeDevice();
  const opened: Array<{ agentId: string; serial: string; appium?: boolean }> = [];
  const installs: Array<{ target: AdbTarget; packageName: string }> = [];
  const shells: string[][] = [];
  __setOpenAgentDeviceForTesting(async (opts) => {
    opened.push({ agentId: opts.agentId, serial: opts.serial, appium: opts.appium });
    return device;
  });
  __setAgentDeviceAdbForTesting(
    (async (_adb: string, args: string[]) => {
      shells.push(args);
      return { exitCode: 0, stdout: "adb_ok\n", stderr: "" };
    }) as AdbExec,
    (async (target: AdbTarget, apk: { packageName: string }) => {
      installs.push({ target, packageName: apk.packageName });
      return { action: "installed" as const };
    }) as typeof ensureApkInstalled,
  );
  t.after(() => {
    __resetOpenAgentDeviceForTesting();
    __resetAgentDeviceAdbForTesting();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const job = jobStore.create("mobile-launch-execution", {
    launchId: "launch-agent-device",
    testRunId: 5101,
    apkPath,
    appSlug: "app-mobile",
    localAgentId: "agente-0001",
    deviceSerial: "emulator-5554",
    publishedCases: [{ caseId: 95001, scenarioId: "MOBILE-AA-95-001" }],
    scenarios: [{ scenarioId: "MOBILE-AA-95-001", title: "En el PC", steps: [{ action: "launchApp", description: "Abrir app" }] }],
  });

  let observed: RunOneScenarioOptions | undefined;
  await startMobileLaunchExecutionJobWithDeps(job.id, {
    ensureMobileInfraFn: ensureMobileInfra,
    runOneScenarioFn: async (opts) => {
      observed = opts;
      return { passed: 1, failed: 0, artifactsDir: "", results: [] };
    },
    syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
    consolidateEvidenceFn: async () => undefined,
  });

  assert.deepEqual(opened, [{ agentId: "agente-0001", serial: "emulator-5554", appium: true }]);
  assert.deepEqual(shells[0], ["-H", "127.0.0.1", "-P", "61001", "-s", "emulator-5554", "shell", "echo", "adb_ok"]);
  assert.deepEqual(installs, [{ target: device.adb, packageName: "com.banco.app" }]);
  assert.ok(observed, jobStore.get(job.id)?.logs.join("\n"));
  assert.deepEqual(observed.appiumServer, device.appium);
  assert.equal(observed.deviceId, "emulator-5554");
  assert.equal(observed.apkPath, undefined, "la ruta del APK del servidor no significa nada en el PC");
  assert.equal(observed.appPackage, "com.banco.app");
  assert.equal(observed.appActivity, "com.banco.app.ui.MainActivity");
  assert.equal(device.closed, 1, "los túneles se cierran al terminar");
});

test("Lanzar pruebas en el PC del usuario: si el dispositivo no se puede abrir es un bloqueo de infraestructura", async (t) => {
  __setOpenAgentDeviceForTesting(async () => {
    throw new Error("emulator-5554 no está conectado en tu equipo.");
  });
  t.after(() => __resetOpenAgentDeviceForTesting());

  const job = jobStore.create("mobile-launch-execution", {
    launchId: "launch-agent-device-missing",
    testRunId: 5102,
    appPackage: "com.banco.app",
    appSlug: "app-mobile",
    localAgentId: "agente-0001",
    deviceSerial: "emulator-5554",
    publishedCases: [{ caseId: 95002, scenarioId: "MOBILE-AA-95-002" }],
    scenarios: [{ scenarioId: "MOBILE-AA-95-002", title: "Sin dispositivo", steps: [{ action: "launchApp", description: "Abrir app" }] }],
  });
  let ran = false;
  await startMobileLaunchExecutionJobWithDeps(job.id, {
    ensureMobileInfraFn: ensureMobileInfra,
    runOneScenarioFn: async () => {
      ran = true;
      return { passed: 1, failed: 0, artifactsDir: "", results: [] };
    },
    syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
    consolidateEvidenceFn: async () => undefined,
  });

  const updated = jobStore.get(job.id);
  assert.equal(ran, false);
  assert.equal(updated?.status, "failed");
  assert.equal(updated?.summary?.reasonCode, "mobile_agent_device_unavailable");
  assert.match(String(updated?.errorMessage), /no está conectado en tu equipo/);
});

test("Lanzar pruebas en el PC del usuario: sin APK en la petición instala el APK guardado del proyecto", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-agent-projapk-"));
  const apkPath = await writeApk(dir);
  const device = fakeDevice();
  const installs: Array<{ apkPath: string; packageName: string }> = [];
  const lookedUp: string[] = [];
  __setOpenAgentDeviceForTesting(async () => device);
  __setProjectApkPathForTesting(async (slug) => {
    lookedUp.push(slug);
    return apkPath;
  });
  __setAgentDeviceAdbForTesting(
    (async () => ({ exitCode: 0, stdout: "adb_ok\n", stderr: "" })) as AdbExec,
    (async (_target: AdbTarget, apk: { apkPath: string; packageName: string }) => {
      installs.push({ apkPath: apk.apkPath, packageName: apk.packageName });
      return { action: "installed" as const };
    }) as typeof ensureApkInstalled,
  );
  t.after(() => {
    __resetOpenAgentDeviceForTesting();
    __resetAgentDeviceAdbForTesting();
    __resetProjectApkPathForTesting();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const job = jobStore.create("mobile-launch-execution", {
    launchId: "launch-agent-project-apk",
    testRunId: 5103,
    appPackage: "com.banco.app",
    appSlug: "app-mobile",
    localAgentId: "agente-0001",
    deviceSerial: "emulator-5554",
    publishedCases: [{ caseId: 95003, scenarioId: "MOBILE-AA-95-003" }],
    scenarios: [{ scenarioId: "MOBILE-AA-95-003", title: "Solo package", steps: [{ action: "launchApp", description: "Abrir app" }] }],
  });
  let observed: RunOneScenarioOptions | undefined;
  await startMobileLaunchExecutionJobWithDeps(job.id, {
    ensureMobileInfraFn: ensureMobileInfra,
    runOneScenarioFn: async (opts) => {
      observed = opts;
      return { passed: 1, failed: 0, artifactsDir: "", results: [] };
    },
    syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
    consolidateEvidenceFn: async () => undefined,
  });

  assert.deepEqual(lookedUp, ["app-mobile"]);
  assert.deepEqual(installs, [{ apkPath, packageName: "com.banco.app" }]);
  assert.ok(observed, jobStore.get(job.id)?.logs.join("\n"));
  assert.equal(observed.appPackage, "com.banco.app");
  assert.equal(observed.apkPath, undefined);
});
