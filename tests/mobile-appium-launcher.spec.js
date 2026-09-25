"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_events_1 = require("node:events");
const test_1 = require("@playwright/test");
const env_1 = require("../src/config/env");
const appium_server_manager_1 = require("../src/mobile/appium-server-manager");
function createFakeChild(pid) {
    const child = new node_events_1.EventEmitter();
    const stdout = new node_events_1.EventEmitter();
    const stderr = new node_events_1.EventEmitter();
    child.stdout = stdout;
    child.stderr = stderr;
    child.pid = pid;
    child.exitCode = null;
    child.killed = false;
    child.kill = () => true;
    return child;
}
test_1.test.describe("mobile appium launcher", () => {
    const originalAndroid = env_1.config.integrations.android;
    const originalAppiumBin = env_1.config.integrations.android?.appiumBin;
    test_1.test.beforeEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
        (0, appium_server_manager_1.__resetSpawnForTesting)();
        (0, appium_server_manager_1.__setPlatformForTesting)(undefined);
        (0, appium_server_manager_1.__setReadinessPollIntervalForTesting)(1);
        (0, appium_server_manager_1.__setPortProbeForTesting)(undefined);
        delete process.env.APPIUM_START_TIMEOUT_MS;
    });
    test_1.test.afterEach(() => {
        (0, appium_server_manager_1.__resetAppiumServerStateForTesting)();
        (0, appium_server_manager_1.__resetHttpStatusCheckerForTesting)();
        (0, appium_server_manager_1.__resetSpawnForTesting)();
        (0, appium_server_manager_1.__setPlatformForTesting)(undefined);
        (0, appium_server_manager_1.__setPortProbeForTesting)(undefined);
        delete process.env.APPIUM_START_TIMEOUT_MS;
        if (originalAndroid) {
            originalAndroid.appiumBin = originalAppiumBin ?? "appium";
        }
    });
    (0, test_1.test)("Windows + appium.cmd uses ComSpec launcher", () => {
        const plan = (0, appium_server_manager_1.resolveAppiumSpawnPlan)("appium.cmd", ["--port", "4723"], {
            platform: "win32",
            comSpec: "C:\\Windows\\System32\\cmd.exe",
        });
        (0, test_1.expect)(plan.commandKind).toBe("cmd");
        (0, test_1.expect)(plan.effectiveLauncher).toBe("C:\\Windows\\System32\\cmd.exe");
        (0, test_1.expect)(plan.spawnCommand).toBe("C:\\Windows\\System32\\cmd.exe");
        (0, test_1.expect)(plan.spawnArgs.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
        (0, test_1.expect)(plan.spawnArgs[3]).toContain("appium.cmd");
        (0, test_1.expect)(plan.spawnArgs[3]).toContain("--port");
    });
    (0, test_1.test)("Windows + .bat uses ComSpec launcher", () => {
        const plan = (0, appium_server_manager_1.resolveAppiumSpawnPlan)("C:\\tools\\appium-start.bat", ["--port", "4723"], {
            platform: "win32",
            comSpec: "cmd.exe",
        });
        (0, test_1.expect)(plan.commandKind).toBe("bat");
        (0, test_1.expect)(plan.spawnCommand).toBe("cmd.exe");
        (0, test_1.expect)(plan.spawnArgs.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
        (0, test_1.expect)(plan.spawnArgs[3]).toContain("appium-start.bat");
    });
    (0, test_1.test)("Windows + native executable keeps native launch", () => {
        const plan = (0, appium_server_manager_1.resolveAppiumSpawnPlan)("C:\\tools\\appium.exe", ["--port", "4723"], {
            platform: "win32",
            comSpec: "cmd.exe",
        });
        (0, test_1.expect)(plan.commandKind).toBe("native");
        (0, test_1.expect)(plan.spawnCommand).toBe("C:\\tools\\appium.exe");
        (0, test_1.expect)(plan.spawnArgs).toEqual(["--port", "4723"]);
    });
    (0, test_1.test)("Linux/macOS + native binary keeps direct launch", () => {
        const plan = (0, appium_server_manager_1.resolveAppiumSpawnPlan)("appium", ["--port", "4723"], {
            platform: "linux",
        });
        (0, test_1.expect)(plan.commandKind).toBe("native");
        (0, test_1.expect)(plan.spawnCommand).toBe("appium");
        (0, test_1.expect)(plan.spawnArgs).toEqual(["--port", "4723"]);
    });
    (0, test_1.test)("APPIUM_BIN inexistente clasifica appium_binary_not_found", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "missing-appium-binary";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0 }));
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(undefined);
            process.nextTick(() => {
                const err = Object.assign(new Error("spawn missing-appium-binary ENOENT"), { code: "ENOENT" });
                child.emit("error", err);
            });
            return child;
        });
        await (0, test_1.expect)((0, appium_server_manager_1.startAppiumServer)(4723)).rejects.toThrow(/appium_binary_not_found/i);
    });
    (0, test_1.test)("proceso Appium ya listo se reutiliza sin spawn", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        let spawnCalls = 0;
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: true, status: 200 }));
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            spawnCalls++;
            return createFakeChild(123);
        });
        const result = await (0, appium_server_manager_1.startAppiumServer)(4723);
        (0, test_1.expect)(result.reused).toBe(true);
        (0, test_1.expect)(result.external).toBe(true);
        (0, test_1.expect)(spawnCalls).toBe(0);
    });
    (0, test_1.test)("inicio concurrente o repetido evita procesos duplicados", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        let spawnCalls = 0;
        const invocations = [];
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0 }));
        (0, appium_server_manager_1.__setSpawnForTesting)((command, args) => {
            spawnCalls++;
            invocations.push({ command, args });
            const child = createFakeChild(9911);
            process.nextTick(() => child.emit("spawn"));
            return child;
        });
        await Promise.all([(0, appium_server_manager_1.startAppiumServer)(4723), (0, appium_server_manager_1.startAppiumServer)(4723)]);
        (0, test_1.expect)(spawnCalls).toBe(1);
        (0, test_1.expect)(invocations[0]?.command).toBe("appium");
        (0, test_1.expect)(invocations[0]?.args).toEqual(["--port", "4723"]);
    });
    (0, test_1.test)("error spawn EINVAL se clasifica como appium_spawn_invalid_argument", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium.cmd";
        (0, appium_server_manager_1.__setPlatformForTesting)("win32");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0 }));
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(undefined);
            process.nextTick(() => {
                const err = Object.assign(new Error("spawn EINVAL"), { code: "EINVAL" });
                child.emit("error", err);
            });
            return child;
        });
        await (0, test_1.expect)((0, appium_server_manager_1.startAppiumServer)(4723)).rejects.toThrow(/appium_spawn_invalid_argument/i);
    });
    (0, test_1.test)("spawn error desconocido se clasifica como appium_spawn_failed", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0 }));
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(undefined);
            process.nextTick(() => {
                const err = Object.assign(new Error("spawn EPERM"), { code: "EPERM" });
                child.emit("error", err);
            });
            return child;
        });
        await (0, test_1.expect)((0, appium_server_manager_1.startAppiumServer)(4723)).rejects.toThrow(/appium_spawn_failed/i);
    });
    (0, test_1.test)("timeout esperando /status se clasifica como appium_readiness_timeout", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        let probeCount = 0;
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => {
            probeCount++;
            return { ok: false, status: 0, error: "ECONNREFUSED" };
        });
        (0, appium_server_manager_1.__setPortProbeForTesting)(async () => false);
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(7788);
            process.nextTick(() => child.emit("spawn"));
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723);
        await (0, test_1.expect)((0, appium_server_manager_1.waitForReady)(5000)).rejects.toThrow(/appium_readiness_timeout/i);
        (0, test_1.expect)(probeCount).toBeGreaterThan(1);
    });
    (0, test_1.test)("proceso que llega a ready antes del timeout configurado", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        let attempts = 0;
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => {
            attempts++;
            if (attempts < 35)
                return { ok: false, status: 0, error: "ECONNREFUSED" };
            return { ok: true, status: 200 };
        });
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(8899);
            process.nextTick(() => child.emit("spawn"));
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723);
        await (0, test_1.expect)((0, appium_server_manager_1.waitForReady)(80000)).resolves.toBeUndefined();
        (0, test_1.expect)(attempts).toBeGreaterThan(30);
    });
    (0, test_1.test)("si proceso termina antes de readiness devuelve appium_process_exited sin esperar timeout completo", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(9901);
            process.nextTick(() => {
                child.emit("spawn");
                child.emit("exit", 1, null);
            });
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723);
        const startedAt = Date.now();
        await (0, test_1.expect)((0, appium_server_manager_1.waitForReady)(60000)).rejects.toThrow(/appium_process_exited/i);
        const elapsed = Date.now() - startedAt;
        (0, test_1.expect)(elapsed).toBeLessThan(2000);
    });
    (0, test_1.test)("timeout reporta processAlive y portListening cuando sigue vivo sin responder", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0, error: "ETIMEDOUT" }));
        (0, appium_server_manager_1.__setPortProbeForTesting)(async () => false);
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(9910);
            process.nextTick(() => child.emit("spawn"));
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723);
        let timeoutMessage = "";
        try {
            await (0, appium_server_manager_1.waitForReady)(5000);
        }
        catch (err) {
            timeoutMessage = err instanceof Error ? err.message : String(err);
        }
        (0, test_1.expect)(timeoutMessage).toContain("processAlive=true");
        (0, test_1.expect)(timeoutMessage).toContain("portListening=false");
    });
    (0, test_1.test)("fallo limpia estado y permite nuevo intento", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        let spawnCalls = 0;
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
        (0, appium_server_manager_1.__setPortProbeForTesting)(async () => false);
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            spawnCalls++;
            const child = createFakeChild(10010 + spawnCalls);
            process.nextTick(() => child.emit("spawn"));
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723);
        await (0, test_1.expect)((0, appium_server_manager_1.waitForReady)(5000)).rejects.toThrow(/appium_readiness_timeout/i);
        (0, test_1.expect)((0, appium_server_manager_1.getStatus)().running).toBe(false);
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: true, status: 200 }));
        const retry = await (0, appium_server_manager_1.startAppiumServer)(4723);
        (0, test_1.expect)(retry.reused).toBe(true);
    });
    (0, test_1.test)("stdout/stderr se sanitizan y limitan en errores", async () => {
        (0, test_1.expect)(originalAndroid).toBeDefined();
        if (!originalAndroid)
            return;
        originalAndroid.appiumBin = "appium";
        (0, appium_server_manager_1.__setPlatformForTesting)("linux");
        (0, appium_server_manager_1.__setHttpStatusCheckerForTesting)(async () => ({ ok: false, status: 0, error: "ECONNREFUSED" }));
        const logs = [];
        (0, appium_server_manager_1.__setSpawnForTesting)(() => {
            const child = createFakeChild(9933);
            process.nextTick(() => {
                child.stdout.emit("data", Buffer.from("token=12345 readying"));
                child.stderr.emit("data", Buffer.from("password=secret-value failed"));
                child.emit("spawn");
                child.emit("exit", 1, null);
            });
            return child;
        });
        await (0, appium_server_manager_1.startAppiumServer)(4723, (line) => logs.push(line));
        await (0, test_1.expect)((0, appium_server_manager_1.waitForReady)(5000, (line) => logs.push(line))).rejects.toThrow(/appium_process_exited/i);
        (0, test_1.expect)(logs.some((line) => line.includes("event=process_output"))).toBe(true);
        const fullLog = logs.join("\n");
        (0, test_1.expect)(fullLog).not.toContain("secret-value");
        (0, test_1.expect)(fullLog).not.toContain("12345");
    });
    (0, test_1.test)("APPIUM_START_TIMEOUT_MS usa default y limites seguros", () => {
        (0, test_1.expect)((0, appium_server_manager_1.resolveAppiumStartTimeoutMs)(undefined)).toBe(60000);
        process.env.APPIUM_START_TIMEOUT_MS = "500";
        (0, test_1.expect)((0, appium_server_manager_1.resolveAppiumStartTimeoutMs)(process.env.APPIUM_START_TIMEOUT_MS)).toBe(5000);
        process.env.APPIUM_START_TIMEOUT_MS = "999999";
        (0, test_1.expect)((0, appium_server_manager_1.resolveAppiumStartTimeoutMs)(process.env.APPIUM_START_TIMEOUT_MS)).toBe(300000);
    });
});
