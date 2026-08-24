import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { config } from "../src/config/env";
import {
  __resetAppiumServerStateForTesting,
  __resetHttpStatusCheckerForTesting,
  __resetSpawnForTesting,
  __setHttpStatusCheckerForTesting,
  __setPortProbeForTesting,
  __setPlatformForTesting,
  __setReadinessPollIntervalForTesting,
  __setSpawnForTesting,
  getStatus,
  resolveAppiumSpawnPlan,
  resolveAppiumStartTimeoutMs,
  startAppiumServer,
  waitForReady,
} from "../src/mobile/appium-server-manager";

type SpawnInvocation = {
  command: string;
  args: string[];
};

function createFakeChild(pid: number | undefined): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  (child as unknown as { stdout: EventEmitter }).stdout = stdout;
  (child as unknown as { stderr: EventEmitter }).stderr = stderr;
  (child as unknown as { pid?: number }).pid = pid;
  (child as unknown as { exitCode?: number | null }).exitCode = null;
  (child as unknown as { killed?: boolean }).killed = false;
  (child as unknown as { kill: (signal?: NodeJS.Signals | number) => boolean }).kill = () => true;
  return child;
}

test.describe("mobile appium launcher", () => {
  const originalAndroid = config.integrations.android;
  const originalAppiumBin = config.integrations.android?.appiumBin;

  test.beforeEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
    __resetSpawnForTesting();
    __setPlatformForTesting(undefined);
    __setReadinessPollIntervalForTesting(1);
    __setPortProbeForTesting(undefined);
    delete process.env.APPIUM_START_TIMEOUT_MS;
  });

  test.afterEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
    __resetSpawnForTesting();
    __setPlatformForTesting(undefined);
    __setPortProbeForTesting(undefined);
    delete process.env.APPIUM_START_TIMEOUT_MS;
    if (originalAndroid) {
      originalAndroid.appiumBin = originalAppiumBin ?? "appium";
    }
  });

  test("Windows + appium.cmd uses ComSpec launcher", () => {
    const plan = resolveAppiumSpawnPlan("appium.cmd", ["--port", "4723"], {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(plan.commandKind).toBe("cmd");
    expect(plan.effectiveLauncher).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.spawnCommand).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(plan.spawnArgs.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.spawnArgs[3]).toContain("appium.cmd");
    expect(plan.spawnArgs[3]).toContain("--port");
  });

  test("Windows + .bat uses ComSpec launcher", () => {
    const plan = resolveAppiumSpawnPlan("C:\\tools\\appium-start.bat", ["--port", "4723"], {
      platform: "win32",
      comSpec: "cmd.exe",
    });
    expect(plan.commandKind).toBe("bat");
    expect(plan.spawnCommand).toBe("cmd.exe");
    expect(plan.spawnArgs.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(plan.spawnArgs[3]).toContain("appium-start.bat");
  });

  test("Windows + native executable keeps native launch", () => {
    const plan = resolveAppiumSpawnPlan("C:\\tools\\appium.exe", ["--port", "4723"], {
      platform: "win32",
      comSpec: "cmd.exe",
    });
    expect(plan.commandKind).toBe("native");
    expect(plan.spawnCommand).toBe("C:\\tools\\appium.exe");
    expect(plan.spawnArgs).toEqual(["--port", "4723"]);
  });

  test("Linux/macOS + native binary keeps direct launch", () => {
    const plan = resolveAppiumSpawnPlan("appium", ["--port", "4723"], {
      platform: "linux",
    });
    expect(plan.commandKind).toBe("native");
    expect(plan.spawnCommand).toBe("appium");
    expect(plan.spawnArgs).toEqual(["--port", "4723"]);
  });

  test("APPIUM_BIN inexistente clasifica appium_binary_not_found", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "missing-appium-binary";
    __setPlatformForTesting("linux");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0 }));
    __setSpawnForTesting(() => {
      const child = createFakeChild(undefined);
      process.nextTick(() => {
        const err = Object.assign(new Error("spawn missing-appium-binary ENOENT"), { code: "ENOENT" });
        (child as unknown as EventEmitter).emit("error", err);
      });
      return child;
    });
    await expect(startAppiumServer(4723)).rejects.toThrow(/appium_binary_not_found/i);
  });

  test("proceso Appium ya listo se reutiliza sin spawn", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    let spawnCalls = 0;
    __setHttpStatusCheckerForTesting(async () => ({ ok: true, status: 200 }));
    __setSpawnForTesting(() => {
      spawnCalls++;
      return createFakeChild(123);
    });
    const result = await startAppiumServer(4723);
    expect(result.reused).toBe(true);
    expect(result.external).toBe(true);
    expect(spawnCalls).toBe(0);
  });

  test("inicio concurrente o repetido evita procesos duplicados", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    let spawnCalls = 0;
    const invocations: SpawnInvocation[] = [];
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0 }));
    __setSpawnForTesting((command, args) => {
      spawnCalls++;
      invocations.push({ command, args });
      const child = createFakeChild(9911);
      process.nextTick(() => (child as unknown as EventEmitter).emit("spawn"));
      return child;
    });

    await Promise.all([startAppiumServer(4723), startAppiumServer(4723)]);
    expect(spawnCalls).toBe(1);
    expect(invocations[0]?.command).toBe("appium");
    expect(invocations[0]?.args).toEqual(["--port", "4723"]);
  });

  test("error spawn EINVAL se clasifica como appium_spawn_invalid_argument", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium.cmd";
    __setPlatformForTesting("win32");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0 }));
    __setSpawnForTesting(() => {
      const child = createFakeChild(undefined);
      process.nextTick(() => {
        const err = Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
        (child as unknown as EventEmitter).emit("error", err);
      });
      return child;
    });
    await expect(startAppiumServer(4723)).rejects.toThrow(/appium_spawn_invalid_argument/i);
  });

  test("spawn error desconocido se clasifica como appium_spawn_failed", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0 }));
    __setSpawnForTesting(() => {
      const child = createFakeChild(undefined);
      process.nextTick(() => {
        const err = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
        (child as unknown as EventEmitter).emit("error", err);
      });
      return child;
    });
    await expect(startAppiumServer(4723)).rejects.toThrow(/appium_spawn_failed/i);
  });

  test("timeout esperando /status se clasifica como appium_readiness_timeout", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    let probeCount = 0;
    __setHttpStatusCheckerForTesting(async () => {
      probeCount++;
      return { ok: false, status: 0, error: "ECONNREFUSED" };
    });
    __setPortProbeForTesting(async () => false);
    __setSpawnForTesting(() => {
      const child = createFakeChild(7788);
      process.nextTick(() => (child as unknown as EventEmitter).emit("spawn"));
      return child;
    });

    await startAppiumServer(4723);
    await expect(waitForReady(5000)).rejects.toThrow(/appium_readiness_timeout/i);
    expect(probeCount).toBeGreaterThan(1);
  });

  test("proceso que llega a ready antes del timeout configurado", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    let attempts = 0;
    __setHttpStatusCheckerForTesting(async () => {
      attempts++;
      if (attempts < 35) return { ok: false, status: 0, error: "ECONNREFUSED" };
      return { ok: true, status: 200 };
    });
    __setSpawnForTesting(() => {
      const child = createFakeChild(8899);
      process.nextTick(() => (child as unknown as EventEmitter).emit("spawn"));
      return child;
    });
    await startAppiumServer(4723);
    await expect(waitForReady(80000)).resolves.toBeUndefined();
    expect(attempts).toBeGreaterThan(30);
  });

  test("si proceso termina antes de readiness devuelve appium_process_exited sin esperar timeout completo", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
    __setSpawnForTesting(() => {
      const child = createFakeChild(9901);
      process.nextTick(() => {
        (child as unknown as EventEmitter).emit("spawn");
        (child as unknown as EventEmitter).emit("exit", 1, null);
      });
      return child;
    });
    await startAppiumServer(4723);
    const startedAt = Date.now();
    await expect(waitForReady(60000)).rejects.toThrow(/appium_process_exited/i);
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(2000);
  });

  test("timeout reporta processAlive y portListening cuando sigue vivo sin responder", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0, error: "ETIMEDOUT" }));
    __setPortProbeForTesting(async () => false);
    __setSpawnForTesting(() => {
      const child = createFakeChild(9910);
      process.nextTick(() => (child as unknown as EventEmitter).emit("spawn"));
      return child;
    });
    await startAppiumServer(4723);
    let timeoutMessage = "";
    try {
      await waitForReady(5000);
    } catch (err) {
      timeoutMessage = err instanceof Error ? err.message : String(err);
    }
    expect(timeoutMessage).toContain("processAlive=true");
    expect(timeoutMessage).toContain("portListening=false");
  });

  test("fallo limpia estado y permite nuevo intento", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    let spawnCalls = 0;
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
    __setPortProbeForTesting(async () => false);
    __setSpawnForTesting(() => {
      spawnCalls++;
      const child = createFakeChild(10010 + spawnCalls);
      process.nextTick(() => (child as unknown as EventEmitter).emit("spawn"));
      return child;
    });
    await startAppiumServer(4723);
    await expect(waitForReady(5000)).rejects.toThrow(/appium_readiness_timeout/i);
    expect(getStatus().running).toBe(false);

    __setHttpStatusCheckerForTesting(async () => ({ ok: true, status: 200 }));
    const retry = await startAppiumServer(4723);
    expect(retry.reused).toBe(true);
  });

  test("stdout/stderr se sanitizan y limitan en errores", async () => {
    expect(originalAndroid).toBeDefined();
    if (!originalAndroid) return;
    originalAndroid.appiumBin = "appium";
    __setPlatformForTesting("linux");
    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
    const logs: string[] = [];
    __setSpawnForTesting(() => {
      const child = createFakeChild(9933);
      process.nextTick(() => {
        (child as unknown as { stdout: EventEmitter }).stdout.emit("data", Buffer.from("token=12345 readying"));
        (child as unknown as { stderr: EventEmitter }).stderr.emit("data", Buffer.from("password=secret-value failed"));
        (child as unknown as EventEmitter).emit("spawn");
        (child as unknown as EventEmitter).emit("exit", 1, null);
      });
      return child;
    });
    await startAppiumServer(4723, (line) => logs.push(line));
    await expect(waitForReady(5000, (line) => logs.push(line))).rejects.toThrow(/appium_process_exited/i);
    expect(logs.some((line) => line.includes("event=process_output"))).toBe(true);
    const fullLog = logs.join("\n");
    expect(fullLog).not.toContain("secret-value");
    expect(fullLog).not.toContain("12345");
  });

  test("APPIUM_START_TIMEOUT_MS usa default y limites seguros", () => {
    expect(resolveAppiumStartTimeoutMs(undefined)).toBe(60000);
    process.env.APPIUM_START_TIMEOUT_MS = "500";
    expect(resolveAppiumStartTimeoutMs(process.env.APPIUM_START_TIMEOUT_MS)).toBe(5000);
    process.env.APPIUM_START_TIMEOUT_MS = "999999";
    expect(resolveAppiumStartTimeoutMs(process.env.APPIUM_START_TIMEOUT_MS)).toBe(300000);
  });
});
