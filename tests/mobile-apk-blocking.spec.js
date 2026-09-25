"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("node:fs"));
const appium_session_1 = require("../src/mobile/appium-session");
const job_store_1 = require("../src/server/jobs/job-store");
const mobile_test_runner_1 = require("../src/server/jobs/mobile-test-runner");
const mobile_rerun_artifacts_1 = require("../src/server/jobs/mobile-rerun-artifacts");
const mobile_launch_execution_runner_1 = require("../src/server/jobs/mobile-launch-execution-runner");
const mobile_step_executor_1 = require("../src/mobile/mobile-step-executor");
const mobile_step_types_1 = require("../src/mobile/mobile-step-types");
function readyInfraState() {
    return {
        deviceId: "emulator-5554",
        emulatorStartedByRunner: false,
        ownership: "external_reused",
        ownershipReason: "already_running_reused",
    };
}
function buildTarget(apkPath) {
    return {
        avdName: "Pixel_7_Pro",
        headless: false,
        bootTimeoutMs: 120000,
        appiumPort: 4723,
        apkPath,
        appPackage: "com.example.app",
        appActivity: "MainActivity",
    };
}
test_1.test.describe("mobile apk preflight validation", () => {
    (0, test_1.test)("accepts an existing readable .apk file", () => {
        const target = buildTarget("C:\\apps\\mobile.apk");
        const validated = (0, mobile_test_runner_1.validateResolvedMobileTarget)(target, {
            existsSync: () => true,
            statSync: () => ({ isFile: () => true }),
            accessSync: () => undefined,
        });
        (0, test_1.expect)(validated.apkPath?.toLowerCase()).toContain("mobile.apk");
    });
    (0, test_1.test)("rejects missing apk path with mobile_apk_not_found", () => {
        (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)(buildTarget("C:\\apps\\missing.apk"), {
            existsSync: () => false,
            statSync: () => ({ isFile: () => true }),
            accessSync: () => undefined,
        })).toThrow(/mobile_apk_not_found|APK file not found/i);
    });
    (0, test_1.test)("rejects directory path", () => {
        (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)(buildTarget("C:\\apps\\folder.apk"), {
            existsSync: () => true,
            statSync: () => ({ isFile: () => false }),
            accessSync: () => undefined,
        })).toThrow(/does not point to a file/i);
    });
    (0, test_1.test)("rejects non-apk extension", () => {
        (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)(buildTarget("C:\\apps\\mobile.zip"), {
            existsSync: () => true,
            statSync: () => ({ isFile: () => true }),
            accessSync: () => undefined,
        })).toThrow(/must end with \.apk/i);
    });
    (0, test_1.test)("rejects literal unexpanded expression", () => {
        (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)(buildTarget("$env:LOCALAPPDATA\\Android\\mobile.apk"), {
            existsSync: () => true,
            statSync: () => ({ isFile: () => true }),
            accessSync: () => undefined,
        })).toThrow(/unexpanded environment expression/i);
    });
    (0, test_1.test)("rejects unreadable apk", () => {
        (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)(buildTarget("C:\\apps\\mobile.apk"), {
            existsSync: () => true,
            statSync: () => ({ isFile: () => true }),
            accessSync: () => {
                throw new Error("denied");
            },
        })).toThrow(/not readable/i);
    });
});
test_1.test.describe("mobile session retry classifier", () => {
    test_1.test.beforeEach(() => {
        (0, appium_session_1.__resetRemoteForTesting)();
    });
    test_1.test.afterEach(() => {
        (0, appium_session_1.__resetRemoteForTesting)();
    });
    (0, test_1.test)("classifies permanent apk path failures as non-recoverable", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("The application at C:\\apps\\missing.apk does not exist or is not accessible");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_apk_not_accessible");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
    (0, test_1.test)("does not retry session creation on permanent apk failure", async () => {
        let attempts = 0;
        (0, appium_session_1.__setRemoteForTesting)(async () => {
            attempts++;
            throw new Error("The application at C:\\apps\\missing.apk does not exist or is not accessible");
        });
        await (0, test_1.expect)((0, appium_session_1.createSession)({ appiumPort: 4723, apkPath: "C:\\apps\\missing.apk", maxSessionAttempts: 4 })).rejects.toThrow(/mobile_apk_not_accessible/i);
        (0, test_1.expect)(attempts).toBe(1);
    });
    (0, test_1.test)("createSession makes exactly one POST /session attempt — coordinator owns retry logic", async () => {
        // createSession no longer retries internally; the coordinator handles retry.
        // A transient failure is thrown immediately so the coordinator can decide whether
        // to retry after cleanup.
        let attempts = 0;
        (0, appium_session_1.__setRemoteForTesting)(async () => {
            attempts++;
            throw new Error("ECONNREFUSED");
        });
        await (0, test_1.expect)((0, appium_session_1.createSession)({ appiumPort: 4723, appPackage: "com.example.app" })).rejects.toThrow(/mobile_session_transient_unavailable|ECONNREFUSED/i);
        (0, test_1.expect)(attempts).toBe(1);
    });
    (0, test_1.test)("classifies device busy as transient infrastructure", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("Session could not be created because device is busy");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_device_temporarily_busy");
        (0, test_1.expect)(c.recoverable).toBe(true);
    });
    (0, test_1.test)("resolves bounded mobile session retry backoff", () => {
        (0, test_1.expect)((0, appium_session_1.resolveMobileSessionRetryBackoffMs)(undefined)).toBe(1250);
        process.env.MOBILE_SESSION_RETRY_BACKOFF_MS = "100";
        (0, test_1.expect)((0, appium_session_1.resolveMobileSessionRetryBackoffMs)(process.env.MOBILE_SESSION_RETRY_BACKOFF_MS)).toBe(250);
        process.env.MOBILE_SESSION_RETRY_BACKOFF_MS = "20000";
        (0, test_1.expect)((0, appium_session_1.resolveMobileSessionRetryBackoffMs)(process.env.MOBILE_SESSION_RETRY_BACKOFF_MS)).toBe(10000);
        delete process.env.MOBILE_SESSION_RETRY_BACKOFF_MS;
    });
});
test_1.test.describe("mobile emulator ownership derivation", () => {
    (0, test_1.test)("marks already-running reused emulator as external ownership", () => {
        const state = (0, mobile_test_runner_1.determineEmulatorOwnership)("already_running");
        (0, test_1.expect)(state.emulatorStartedByRunner).toBe(false);
        (0, test_1.expect)(state.ownership).toBe("external_reused");
    });
    (0, test_1.test)("marks reused start result as external ownership", () => {
        const state = (0, mobile_test_runner_1.determineEmulatorOwnership)({ reused: true, external: false });
        (0, test_1.expect)(state.emulatorStartedByRunner).toBe(false);
        (0, test_1.expect)(state.ownership).toBe("external_reused");
    });
    (0, test_1.test)("marks runner-started emulator only when start result proves ownership", () => {
        const state = (0, mobile_test_runner_1.determineEmulatorOwnership)({ reused: false, external: false });
        (0, test_1.expect)(state.emulatorStartedByRunner).toBe(true);
        (0, test_1.expect)(state.ownership).toBe("runner");
    });
});
(0, test_1.test)("executeMobileStep sends exact Unicode selector to Appium without mutation", async () => {
    const originalTarget = "¿Aún no tienes usuario o cuenta? áéíóú ÁÉÍÓÚ ñÑ üÜ ¡Hola! € “quote” 😀 東京";
    const receivedSelectors = [];
    const fakeElement = {
        waitForDisplayed: async () => undefined,
        click: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => true,
    };
    const fakeBrowser = {
        $: async (selector) => {
            receivedSelectors.push(selector);
            return fakeElement;
        },
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "click",
        description: "Tap registro",
        target: { strategy: "accessibilityId", value: originalTarget },
    }, 0);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(receivedSelectors.length).toBeGreaterThan(0);
    (0, test_1.expect)(receivedSelectors.every((selector) => selector === `~${originalTarget}`)).toBe(true);
});
(0, test_1.test)("executeMobileStep repairs generic mojibake selector before resolving target", async () => {
    const mojibakeTarget = "Â¿AÃºn no tienes usuario o cuenta?";
    const receivedSelectors = [];
    const fakeElement = {
        waitForDisplayed: async () => undefined,
        click: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => true,
    };
    const fakeBrowser = {
        $: async (selector) => {
            receivedSelectors.push(selector);
            return fakeElement;
        },
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "click",
        description: "Tap registro",
        target: { strategy: "accessibilityId", value: mojibakeTarget },
    }, 0);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(receivedSelectors.length).toBeGreaterThan(0);
    (0, test_1.expect)(receivedSelectors[0]).toBe("~¿Aún no tienes usuario o cuenta?");
});
(0, test_1.test)("executeMobileStep prioritizes stable identifiers over ordinal instance fallback", async () => {
    const attemptedSelectors = [];
    let filledValue = "";
    const fakeBrowser = {
        getPageSource: async () => `<hierarchy><node class="android.widget.EditText" resource-id="com.example:id/document_input" content-desc="" text="" /></hierarchy>`,
        $: async (selector) => {
            attemptedSelectors.push(selector);
            if (selector === `android=new UiSelector().resourceId("com.example:id/document_input")`) {
                return {
                    waitForDisplayed: async () => undefined,
                    waitForExist: async () => undefined,
                    setValue: async (value) => { filledValue = value; },
                    getAttribute: async (name) => (name === "text" ? filledValue : ""),
                    getText: async () => filledValue,
                    isExisting: async () => true,
                    isEnabled: async () => true,
                };
            }
            return {
                waitForDisplayed: async () => {
                    throw new Error("not found");
                },
                waitForExist: async () => {
                    throw new Error("not found");
                },
                setValue: async () => undefined,
                getAttribute: async () => "",
                getText: async () => "",
                isExisting: async () => false,
                isEnabled: async () => true,
            };
        },
        hideKeyboard: async () => undefined,
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "fill",
        description: "Ingresar documento",
        target: {
            strategy: "androidUiAutomator",
            value: `new UiSelector().className("android.widget.EditText").instance(0)`,
        },
        value: "1234567890",
    }, 1);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(attemptedSelectors[0]).toContain(`className("android.widget.EditText").instance(0)`);
    (0, test_1.expect)(attemptedSelectors).toContain(`android=new UiSelector().resourceId("com.example:id/document_input")`);
});
(0, test_1.test)("executeMobileStep reports missing submit-gate conditions when continue stays disabled", async () => {
    const fakeElement = {
        waitForDisplayed: async () => undefined,
        click: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => false,
    };
    const fakeBrowser = {
        $: async () => fakeElement,
        getPageSource: async () => '<node content-desc="Continuar" enabled="false" clickable="false" />'
            + '<node checkable="true" checked="false" content-desc="Acepto términos y condiciones" />',
        hideKeyboard: async () => undefined,
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "click",
        description: "Continuar",
        target: { strategy: "accessibilityId", value: "Continuar" },
        timeoutMs: 200,
    }, 0);
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.errorMessage).toContain("data_precondition_failure");
    (0, test_1.expect)(result.errorMessage).toContain("termsAccepted=false");
    (0, test_1.expect)(result.errorMessage).toContain("buttonEnabled=false");
});
(0, test_1.test)("applyDataOverrides preserves open_selector -> select_option -> fill route", () => {
    const steps = [
        {
            action: "click",
            description: "Seleccionar tipo de documento",
            target: { strategy: "androidUiAutomator", value: 'new UiSelector().text("Documento")' },
        },
        {
            action: "fill",
            description: "Ingresar identificación",
            target: { strategy: "androidUiAutomator", value: 'new UiSelector().className("android.widget.EditText").instance(0)' },
            value: "123",
        },
    ];
    const requiredData = [
        {
            key: "tipo_documento",
            label: "Tipo de documento",
            kind: "select",
            stepIndex: 0,
            exampleValue: "Documento",
            sensitive: false,
            options: ["Documento", "Pasaporte"],
            applyTargetTemplate: { strategy: "androidUiAutomator", value: 'new UiSelector().text("{{value}}")' },
        },
    ];
    const applied = (0, mobile_step_types_1.applyDataOverrides)(steps, { 0: "Documento" }, requiredData);
    (0, test_1.expect)(applied).toHaveLength(3);
    (0, test_1.expect)(applied[0]?.actionRole).toBe("open_selector");
    (0, test_1.expect)(applied[0]?.expectedState).toBe("selector_open");
    (0, test_1.expect)(applied[1]?.actionRole).toBe("select_option");
    (0, test_1.expect)(applied[1]?.expectedState).toBe("option_selected");
    (0, test_1.expect)(applied[1]?.requiredNextTarget).toEqual(steps[1]?.target);
    (0, test_1.expect)(applied[2]?.action).toBe("fill");
});
(0, test_1.test)("executeMobileStep fill fails when value is not observed after setValue", async () => {
    const fakeElement = {
        waitForDisplayed: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => true,
        setValue: async () => undefined,
        getAttribute: async () => "",
        getText: async () => "",
    };
    const fakeBrowser = {
        $: async () => fakeElement,
        hideKeyboard: async () => undefined,
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "fill",
        description: "Ingresar documento",
        target: { strategy: "id", value: "com.example:id/document" },
        value: "402123",
    }, 0);
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.errorMessage).toContain("data_precondition_failure: fill not accepted");
});
(0, test_1.test)("executeMobileStep fill success persists fieldAccepted observation", async () => {
    let currentValue = "";
    const fakeElement = {
        waitForDisplayed: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => true,
        setValue: async (value) => { currentValue = value; },
        getAttribute: async (name) => (name === "text" ? currentValue : ""),
        getText: async () => currentValue,
    };
    const fakeBrowser = {
        $: async () => fakeElement,
        hideKeyboard: async () => undefined,
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "fill",
        description: "Ingresar documento",
        target: { strategy: "id", value: "com.example:id/document" },
        value: "402123",
    }, 0);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.fieldAccepted).toBe(true);
    (0, test_1.expect)(result.acceptanceSource).toContain("text");
});
(0, test_1.test)("submit gate consumes fill observation instead of defaulting fieldAccepted=false", async () => {
    let currentInputValue = "";
    const inputElement = {
        waitForDisplayed: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => true,
        setValue: async (value) => { currentInputValue = value; },
        getAttribute: async (name) => (name === "text" ? currentInputValue : ""),
        getText: async () => currentInputValue,
    };
    const continueElement = {
        waitForDisplayed: async () => undefined,
        isExisting: async () => true,
        isEnabled: async () => false,
        click: async () => undefined,
        getAttribute: async () => "",
        getText: async () => "",
    };
    const fakeBrowser = {
        $: async (selector) => {
            if (selector.includes("resourceId(\"com.example:id/document\")"))
                return inputElement;
            return continueElement;
        },
        getPageSource: async () => '<node content-desc="Continuar" enabled="false" clickable="false" />',
        hideKeyboard: async () => undefined,
        saveScreenshot: async () => undefined,
    };
    const fillResult = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "fill",
        description: "Ingresar documento",
        target: { strategy: "id", value: "com.example:id/document" },
        value: "402123",
    }, 0);
    (0, test_1.expect)(fillResult.status).toBe("passed");
    const clickResult = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "click",
        description: "Continuar",
        target: { strategy: "accessibilityId", value: "Continuar" },
        timeoutMs: 200,
    }, 1);
    (0, test_1.expect)(clickResult.status).toBe("failed");
    (0, test_1.expect)(clickResult.errorMessage).toContain("fieldAccepted=true");
});
(0, test_1.test)("mobile launch execution blocks before first scenario when apk is missing", async () => {
    let ensureInfraCalls = 0;
    let runScenarioCalls = 0;
    let syncCalls = 0;
    let consolidateCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-test",
        testRunId: 3875,
        apkPath: "C:\\path\\that\\does-not-exist.apk",
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 43018, scenarioId: "MOBILE-AA-88-001" }],
        scenarios: [
            { scenarioId: "MOBILE-AA-88-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-88-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => {
            ensureInfraCalls++;
            return readyInfraState();
        },
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            return { passed: 1, failed: 0, artifactsDir: "", results: [] };
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => {
            consolidateCalls++;
        },
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.reasonCode).toBe("mobile_apk_not_found");
    (0, test_1.expect)(ensureInfraCalls).toBe(0);
    (0, test_1.expect)(runScenarioCalls).toBe(0);
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(consolidateCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("infra block"))).toBe(true);
});
(0, test_1.test)("rejects when appPackage and apkPath are both missing", () => {
    (0, test_1.expect)(() => (0, mobile_test_runner_1.validateResolvedMobileTarget)({
        avdName: "Pixel_7_Pro",
        headless: false,
        bootTimeoutMs: 120000,
        appiumPort: 4723,
        appPackage: undefined,
        appActivity: undefined,
        apkPath: undefined,
    })).toThrow(/Either apkPath or appPackage is required/i);
});
(0, test_1.test)("mobile launch execution marks pre-step session timeout as infrastructure and stops remaining scenarios", async () => {
    const previousBlocked = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    let runScenarioCalls = 0;
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-session-timeout-no-mapping",
        testRunId: 3875,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 43018, scenarioId: "MOBILE-AA-94-001" },
            { caseId: 43019, scenarioId: "MOBILE-AA-94-002" },
        ],
        scenarios: [
            { scenarioId: "MOBILE-AA-94-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-94-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            throw new Error("mobile_session_transient_unavailable: The operation was aborted due to timeout when running http://127.0.0.1:4723/session");
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.reasonCode).toBe("mobile_session_transient_unavailable");
    (0, test_1.expect)(runScenarioCalls).toBe(1);
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("infra-sync skipped reason=no_blocked_status_mapping"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("defect created"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("defect updated"))).toBe(false);
    if (previousBlocked === undefined)
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else
        process.env.TESTRAIL_STATUS_BLOCKED_ID = previousBlocked;
});
(0, test_1.test)("mobile launch execution syncs blocked status for infra timeout when mapping exists", async () => {
    const previousBlocked = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    process.env.TESTRAIL_STATUS_BLOCKED_ID = "2";
    const syncInputs = [];
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-session-timeout-with-mapping",
        testRunId: 3875,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 43018, scenarioId: "MOBILE-AA-94-001" }],
        scenarios: [{ scenarioId: "MOBILE-AA-94-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] }],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => {
            throw new Error("mobile_session_transient_unavailable: timeout creating Appium session");
        },
        syncResultFn: async (input) => {
            syncInputs.push({ discoveryStatus: input.discoveryStatus, caseId: input.caseId, scenarioId: input.scenarioId });
            return { statusId: 2, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(syncInputs).toEqual([{ discoveryStatus: "blocked_infrastructure", caseId: 43018, scenarioId: "MOBILE-AA-94-001" }]);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("infra-sync=synced statusId=2"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("defect created"))).toBe(false);
    if (previousBlocked === undefined)
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else
        process.env.TESTRAIL_STATUS_BLOCKED_ID = previousBlocked;
});
(0, test_1.test)("mobile launch execution propagates emulator ownership from infra readiness state", async () => {
    let observedStartedByRunner;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-ownership-propagation",
        testRunId: 4801,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 93001, scenarioId: "MOBILE-AA-94-001" }],
        scenarios: [{ scenarioId: "MOBILE-AA-94-001", title: "Escenario ownership", steps: [{ action: "launchApp", description: "Abrir app" }] }],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => ({
            deviceId: "emulator-7777",
            emulatorStartedByRunner: false,
            ownership: "external_reused",
            ownershipReason: "already_running_reused",
        }),
        runOneScenarioFn: async (opts) => {
            observedStartedByRunner = opts.emulatorStartedByRunner;
            return { passed: 1, failed: 0, artifactsDir: "", results: [] };
        },
        syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
        consolidateEvidenceFn: async () => undefined,
    });
    (0, test_1.expect)(observedStartedByRunner).toBe(false);
});
(0, test_1.test)("passed scenario summary never reports blocking failures", async () => {
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-summary-coherence",
        testRunId: 4803,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 93021, scenarioId: "MOBILE-AA-94-010" }],
        scenarios: [{ scenarioId: "MOBILE-AA-94-010", title: "Escenario assertion-only", steps: [{ action: "launchApp", description: "Abrir app" }] }],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => ({
            passed: 1,
            failed: 1,
            artifactsDir: "",
            results: [
                { index: 0, action: "click", status: "passed", durationMs: 5 },
                { index: 1, action: "assertVisible", status: "failed", errorMessage: "Expected element to be visible", durationMs: 6 },
            ],
        }),
        syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    const summaryLine = updated?.logs.find((line) => line.includes("[mobile:launch] scenario MOBILE-AA-94-010 finished status=passed"));
    (0, test_1.expect)(summaryLine).toBeTruthy();
    (0, test_1.expect)(summaryLine).toContain("blockingFailed=0");
    (0, test_1.expect)(summaryLine).toContain("nonBlockingFailed=1");
    (0, test_1.expect)(summaryLine?.includes("failed=1")).toBe(false);
});
(0, test_1.test)("automation/data-precondition failures do not sync as functional defects to Jira or TestRail", async () => {
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-non-functional-sync-skip",
        testRunId: 4804,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 93031, scenarioId: "MOBILE-AA-94-011" }],
        scenarios: [{ scenarioId: "MOBILE-AA-94-011", title: "Escenario no funcional", steps: [{ action: "launchApp", description: "Abrir app" }] }],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => ({
            passed: 0,
            failed: 1,
            artifactsDir: "C:\\tmp\\artifacts",
            results: [
                {
                    index: 1,
                    action: "click",
                    status: "failed",
                    reasonCode: "navigation_dependency_primary_failure",
                    errorMessage: "click target not found: {\"strategy\":\"accessibilityId\",\"value\":\"Â¿AÃºn no tienes usuario o cuenta?\"}",
                    defectEligible: false,
                    durationMs: 10,
                },
            ],
        }),
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated).toBeTruthy();
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("defect created"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("defect updated"))).toBe(false);
});
(0, test_1.test)("mobile_text_encoding_invalid is treated as infrastructure block with no functional sync", async () => {
    const previousBlocked = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    let runScenarioCalls = 0;
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-encoding-invalid",
        testRunId: 4802,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 93011, scenarioId: "MOBILE-AA-94-001" },
            { caseId: 93012, scenarioId: "MOBILE-AA-94-002" },
        ],
        scenarios: [
            { scenarioId: "MOBILE-AA-94-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-94-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            throw new Error("mobile_text_encoding_invalid: replacement character detected in step payload");
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.reasonCode).toBe("mobile_text_encoding_invalid");
    (0, test_1.expect)(runScenarioCalls).toBe(1);
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("functionalDefectSyncSkipped=true"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("testRailFunctionalStatusSkipped=true"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("skipped_infrastructure_blocked"))).toBe(true);
    if (previousBlocked === undefined)
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else
        process.env.TESTRAIL_STATUS_BLOCKED_ID = previousBlocked;
});
(0, test_1.test)("startMobileLaunchExecutionJobWithDeps classifies failed scenario and persists structured category", async () => {
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-classification-persist",
        testRunId: 4810,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 94001, scenarioId: "MOBILE-AA-94-001" }],
        scenarios: [
            { scenarioId: "MOBILE-AA-94-001", title: "Escenario clasificación", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => ({
            passed: 0,
            failed: 1,
            artifactsDir: "",
            results: [
                {
                    index: 4,
                    action: "fill",
                    description: "Ingresar documento",
                    status: "failed",
                    reasonCode: "target_not_found",
                    errorMessage: "fill target not found",
                    durationMs: 6,
                },
            ],
        }),
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("completed_with_failures");
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("failureCategory=automation_failure"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("firstFailureStep=5"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("causalStepIndex=4"))).toBe(true);
    const persisted = (0, mobile_rerun_artifacts_1.readMobileExecutionResults)(job.id);
    (0, test_1.expect)(persisted).toBeTruthy();
    (0, test_1.expect)(persisted?.[0]?.failureCategory).toBe("automation_failure");
    const resultsPath = (0, mobile_rerun_artifacts_1.getMobileExecutionResultsPath)(job.id);
    if (fs.existsSync(resultsPath))
        fs.unlinkSync(resultsPath);
});
(0, test_1.test)("classification errors never replace the original scenario failure", async () => {
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-classification-safe-fallback",
        testRunId: 4811,
        appSlug: "app-mobile",
        publishedCases: [{ caseId: 94002, scenarioId: "MOBILE-AA-94-002" }],
        scenarios: [
            { scenarioId: "MOBILE-AA-94-002", title: "Escenario fallback clasificación", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => ({
            passed: 0,
            failed: 1,
            artifactsDir: "",
            results: [
                {
                    index: 4,
                    action: "fill",
                    description: "Ingresar documento",
                    status: "failed",
                    reasonCode: "target_not_found",
                    errorMessage: { broken: true },
                    durationMs: 7,
                },
            ],
        }),
        syncResultFn: async () => ({ statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() }),
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("completed_with_failures");
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("[mobile:classify] status=error"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("reasonCode=target_not_found"))).toBe(true);
});
(0, test_1.test)("non_executable_precondition is blocked before infra and does not block next scenario", async () => {
    let ensureInfraCalls = 0;
    let runScenarioCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-precheck-before-infra",
        testRunId: 4812,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 94003, scenarioId: "MOBILE-AA-94-003" },
            { caseId: 94004, scenarioId: "MOBILE-AA-94-004" },
        ],
        scenarios: [
            {
                scenarioId: "MOBILE-AA-94-003",
                title: "Bloqueo técnico no inducible",
                steps: [
                    { action: "launchApp", description: "Abrir app" },
                    { action: "assertVisible", description: "Verificar inconveniente técnico", target: { strategy: "accessibilityId", value: "Ocurrió un inconveniente técnico" } },
                ],
            },
            {
                scenarioId: "MOBILE-AA-94-004",
                title: "Escenario ejecutable",
                steps: [{ action: "launchApp", description: "Abrir app" }],
            },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => {
            ensureInfraCalls++;
            return readyInfraState();
        },
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            return { passed: 1, failed: 0, blocked: 0, artifactsDir: "", results: [] };
        },
        syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(ensureInfraCalls).toBe(1);
    (0, test_1.expect)(runScenarioCalls).toBe(1);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("scenario MOBILE-AA-94-003 blocked reasonCode=non_executable_precondition"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("status=blocked passed=0 failed=0"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("blocked=1"))).toBe(true);
});
(0, test_1.test)("classifyScenarioFailure is callable from runtime path", () => {
    (0, test_1.expect)((0, mobile_launch_execution_runner_1.classifyScenarioFailure)([
        {
            index: 2,
            status: "failed",
            action: "fill",
            reasonCode: "target_not_found",
            errorMessage: "fill target not found",
        },
    ])).toBe("automation_failure");
});
(0, test_1.test)("classifyScenarioFailure uses data_precondition_failure only for structured precondition evidence", () => {
    (0, test_1.expect)((0, mobile_launch_execution_runner_1.classifyScenarioFailure)([
        {
            index: 3,
            status: "failed",
            action: "click",
            reasonCode: "data_precondition_failure",
            errorMessage: "data_precondition_failure: submit gate not satisfied",
        },
    ])).toBe("data_precondition_failure");
});
(0, test_1.test)("navigation primary failure skips dependent steps and stores selector diagnostics", async () => {
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    let executeCalls = 0;
    let closed = 0;
    const fakeBrowser = {
        terminateApp: async () => undefined,
        activateApp: async () => undefined,
        getPageSource: async () => `<node class="android.widget.TextView" text="¿Aún no tienes usuario o cuenta?" content-desc="" resource-id="com.example:id/sign_up_hint" />`,
        deleteSession: async () => undefined,
    };
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setCloseSessionForTesting)(async () => {
            closed++;
        });
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => {
            executeCalls++;
            if (index === 0) {
                return { index, action: step.action, description: step.description, status: "passed", durationMs: 5 };
            }
            if (index === 1) {
                return {
                    index,
                    action: step.action,
                    description: step.description,
                    status: "failed",
                    errorMessage: "click target not found (even after closing any blocking modal): {\"strategy\":\"accessibilityId\",\"value\":\"¿Aún no tienes usuario o cuenta?\"}",
                    durationMs: 7,
                };
            }
            return { index, action: step.action, description: step.description, status: "passed", durationMs: 4 };
        });
        const result = await (0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            apkPath: "C:\\apps\\mobile.apk",
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "launchApp", description: "Abrir app" },
                { action: "click", description: "Ir a registro", target: { strategy: "accessibilityId", value: "¿Aún no tienes usuario o cuenta?" } },
                { action: "click", description: "Paso dependiente 1", target: { strategy: "accessibilityId", value: "next-1" } },
                { action: "fill", description: "Paso dependiente 2", target: { strategy: "id", value: "input-1" }, value: "123" },
            ],
            evidenceScenarioId: "MOBILE-AA-94-003",
            evidenceScenarioTitle: "Escenario navegación",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
            appSlug: "app-mobile",
            sourceIssueKey: "AA-94",
        }, () => undefined);
        (0, test_1.expect)(executeCalls).toBe(2);
        (0, test_1.expect)(closed).toBe(1);
        (0, test_1.expect)(result.failed).toBe(1);
        (0, test_1.expect)(result.results[1]?.reasonCode).toBe("target_not_found");
        (0, test_1.expect)(result.results[2]?.status).toBe("skipped_dependency_failed");
        (0, test_1.expect)(result.results[2]?.reasonCode).toBe("skipped_due_to_prior_failure");
        (0, test_1.expect)(result.results[3]?.status).toBe("skipped_dependency_failed");
        (0, test_1.expect)(result.results[1]?.diagnosticsPath).toBeTruthy();
        (0, test_1.expect)(fs.existsSync(result.results[1]?.diagnosticsPath || "")).toBe(true);
    }
    finally {
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
(0, test_1.test)("assertVisible transition miss skips dependent steps as prior-transition failure", async () => {
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    let pageSourceReads = 0;
    const fakeBrowser = {
        terminateApp: async () => undefined,
        activateApp: async () => undefined,
        getPageSource: async () => {
            pageSourceReads++;
            if (pageSourceReads < 3)
                return `<node class="android.widget.TextView" text="Pantalla alternativa" />`;
            return `<node class="android.widget.TextView" text="Correo electrónico" />`;
        },
        deleteSession: async () => undefined,
    };
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => {
            if (index === 0 || index === 1) {
                return { index, action: step.action, description: step.description, status: "passed", durationMs: 5 };
            }
            if (index === 2) {
                return {
                    index,
                    action: step.action,
                    description: step.description,
                    status: "failed",
                    errorMessage: "Expected element to be visible: {\"strategy\":\"accessibilityId\",\"value\":\"Correo electrónico\"}",
                    durationMs: 6,
                };
            }
            return { index, action: step.action, description: step.description, status: "passed", durationMs: 3 };
        });
        const result = await (0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            apkPath: "C:\\apps\\mobile.apk",
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "launchApp", description: "Abrir app" },
                { action: "click", description: "Continuar", target: { strategy: "accessibilityId", value: "Continuar" } },
                { action: "assertVisible", description: "Validar pantalla de contacto", target: { strategy: "accessibilityId", value: "Correo electrónico" } },
                { action: "click", description: "Paso dependiente", target: { strategy: "accessibilityId", value: "Mis datos no son correctos" } },
            ],
            evidenceScenarioId: "MOBILE-AA-94-002",
            evidenceScenarioTitle: "Escenario transición alterna",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
            appSlug: "app-mobile",
        }, () => undefined);
        (0, test_1.expect)(result.results[2]?.reasonCode).toBe("transition_not_reached");
        (0, test_1.expect)(result.results[3]?.status).toBe("skipped_dependency_failed");
        (0, test_1.expect)(result.results[3]?.reasonCode).toBe("skipped_due_to_prior_failure");
    }
    finally {
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
(0, test_1.test)("click without observable transition fails with transition_not_reached", async () => {
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    const fakeBrowser = {
        terminateApp: async () => undefined,
        activateApp: async () => undefined,
        getPageSource: async () => `<hierarchy><node text="Pantalla actual" /></hierarchy>`,
        deleteSession: async () => undefined,
    };
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => ({
            index,
            action: step.action,
            description: step.description,
            status: "passed",
            durationMs: 3,
        }));
        const result = await (0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "click", description: "Continuar", target: { strategy: "accessibilityId", value: "Continuar" } },
                { action: "fill", description: "Siguiente paso", target: { strategy: "id", value: "com.example:id/nextInput" }, value: "1" },
            ],
            evidenceScenarioId: "MOBILE-AA-TR-001",
            evidenceScenarioTitle: "Sin transición observable",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
        }, () => undefined);
        (0, test_1.expect)(result.failed).toBe(1);
        (0, test_1.expect)(result.results[0]?.reasonCode).toBe("transition_not_reached");
        (0, test_1.expect)(result.results[1]?.reasonCode).toBe("skipped_due_to_prior_failure");
    }
    finally {
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
(0, test_1.test)("click with observable transition signal is marked as passed", async () => {
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    let pageSourceReads = 0;
    const fakeBrowser = {
        terminateApp: async () => undefined,
        activateApp: async () => undefined,
        getPageSource: async () => {
            pageSourceReads++;
            if (pageSourceReads < 2)
                return `<hierarchy><node text="Pantalla actual" /></hierarchy>`;
            return `<hierarchy><node content-desc="com.example:id/nextInput" /></hierarchy>`;
        },
        deleteSession: async () => undefined,
    };
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => ({
            index,
            action: step.action,
            description: step.description,
            status: "passed",
            durationMs: 3,
        }));
        const result = await (0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "click", description: "Continuar", target: { strategy: "accessibilityId", value: "Continuar" } },
                { action: "fill", description: "Siguiente paso", target: { strategy: "id", value: "com.example:id/nextInput" }, value: "1" },
            ],
            evidenceScenarioId: "MOBILE-AA-TR-002",
            evidenceScenarioTitle: "Con transición observable",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
        }, () => undefined);
        (0, test_1.expect)(result.failed).toBe(0);
        (0, test_1.expect)(result.results[0]?.status).toBe("passed");
    }
    finally {
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
(0, test_1.test)("runOneScenario releases session lock when step execution throws", async () => {
    (0, mobile_test_runner_1.__resetCoordinatorForTesting)();
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    const fakeBrowser = {
        terminateApp: async () => undefined,
        activateApp: async () => undefined,
        deleteSession: async () => undefined,
        getPageSource: async () => "<hierarchy />",
    };
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async () => {
            throw new Error("forced_step_executor_crash");
        });
        await (0, test_1.expect)((0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            deviceId: "emulator-5554",
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [{ action: "click", description: "Step 1", target: { strategy: "id", value: "btn1" } }],
            evidenceScenarioId: "MOBILE-AA-LOCK-001",
            evidenceScenarioTitle: "Lock release",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
        }, () => undefined)).rejects.toThrow(/forced_step_executor_crash/);
        const lockKey = "127.0.0.1:4723|emulator-5554|8200";
        (0, test_1.expect)((0, mobile_test_runner_1.__getCoordinatorLockForTesting)(lockKey)).toBeUndefined();
    }
    finally {
        (0, mobile_test_runner_1.__resetCoordinatorForTesting)();
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
// ─── ADB Broken pipe / mobile_adb_unhealthy ───────────────────────────────────
test_1.test.describe("ADB Broken pipe classification", () => {
    (0, test_1.test)("classifies adbExec Broken pipe as mobile_adb_unhealthy (non-recoverable)", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("Error executing adbExec adb.exe -P 5037 -s emulator-5554 shell settings delete global hidden_api_policy; exit code 224; Failure calling service settings: Broken pipe (32)");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_adb_unhealthy");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
    (0, test_1.test)("classifies 'Broken pipe' message as mobile_adb_unhealthy", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("ADB shell failed: Broken pipe");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_adb_unhealthy");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
    (0, test_1.test)("classifies 'failure calling service settings' as mobile_adb_unhealthy", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("Failure calling service settings: Broken pipe (32)");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_adb_unhealthy");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
    (0, test_1.test)("generic session failure (not adb-related) still returns mobile_session_create_failed", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("Some unexpected Appium internal error");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_session_create_failed");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
});
// ─── Infrastructure block: mobile_session_create_failed stops the run ─────────
(0, test_1.test)("mobile_session_create_failed from session attempt is classified as infra block — stops run, no Jira, no TestRail", async () => {
    const previousBlocked = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    let runScenarioCalls = 0;
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-adb-create-failed",
        testRunId: 3900,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 50001, scenarioId: "MOBILE-AA-95-001" },
            { caseId: 50002, scenarioId: "MOBILE-AA-95-002" },
        ],
        scenarios: [
            { scenarioId: "MOBILE-AA-95-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-95-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => readyInfraState(),
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            throw new Error("mobile_session_create_failed: Error executing adbExec adb.exe -P 5037 -s emulator-5554 shell settings delete global hidden_api_policy");
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.reasonCode).toBe("mobile_session_create_failed");
    // Run stopped after the first scenario attempt — second scenario was never tried.
    (0, test_1.expect)(runScenarioCalls).toBe(1);
    // No TestRail sync because no blocked-status mapping.
    (0, test_1.expect)(syncCalls).toBe(0);
    // No Jira defects.
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("defect created"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("defect updated"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("infra block"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("infra-sync skipped reason=no_blocked_status_mapping"))).toBe(true);
    if (previousBlocked === undefined)
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else
        process.env.TESTRAIL_STATUS_BLOCKED_ID = previousBlocked;
});
// ─── Infrastructure block: mobile_adb_unhealthy stops the run ─────────────────
(0, test_1.test)("mobile_adb_unhealthy from adb preflight is classified as infra block — stops run, no Jira, no TestRail", async () => {
    const previousBlocked = process.env.TESTRAIL_STATUS_BLOCKED_ID;
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    let runScenarioCalls = 0;
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-adb-unhealthy",
        testRunId: 3901,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 50010, scenarioId: "MOBILE-AA-96-001" },
            { caseId: 50011, scenarioId: "MOBILE-AA-96-002" },
        ],
        scenarios: [
            { scenarioId: "MOBILE-AA-96-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-96-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        // ensureMobileInfra throws the ADB preflight error before any scenario runs.
        ensureMobileInfraFn: async () => {
            throw new Error("mobile_adb_unhealthy: stage=settings reason=adb_broken_pipe deviceId=emulator-5554");
        },
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            return { passed: 1, failed: 0, artifactsDir: "", results: [] };
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    // ensureMobileInfra throws before scenario loop — no scenarios were attempted.
    (0, test_1.expect)(runScenarioCalls).toBe(0);
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("defect created"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("defect updated"))).toBe(false);
    (0, test_1.expect)(updated?.logs.some((l) => l.includes("infra block"))).toBe(true);
    if (previousBlocked === undefined)
        delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
    else
        process.env.TESTRAIL_STATUS_BLOCKED_ID = previousBlocked;
});
(0, test_1.test)("executeMobileStep classifies socket hang up as mobile_automation_channel_lost", async () => {
    const fakeBrowser = {
        $: async () => {
            throw new Error("socket hang up");
        },
        saveScreenshot: async () => undefined,
    };
    const result = await (0, mobile_step_executor_1.executeMobileStep)(fakeBrowser, {
        action: "click",
        description: "Tap next",
        target: { strategy: "id", value: "com.example:id/next" },
    }, 0);
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.errorMessage).toContain("mobile_automation_channel_lost:");
});
(0, test_1.test)("runOneScenario aborts immediately when mobile automation channel is lost", async () => {
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    const fakeBrowser = {
        activateApp: async () => undefined,
        terminateApp: async () => undefined,
        deleteSession: async () => undefined,
        getPageSource: async () => "<hierarchy />",
    };
    let executeCalls = 0;
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => fakeBrowser);
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => {
            executeCalls++;
            if (index === 0) {
                return {
                    index,
                    action: step.action,
                    description: step.description,
                    status: "failed",
                    errorMessage: "mobile_automation_channel_lost: socket hang up",
                    durationMs: 5,
                };
            }
            return {
                index,
                action: step.action,
                description: step.description,
                status: "passed",
                durationMs: 3,
            };
        });
        await (0, test_1.expect)((0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "click", description: "step 1", target: { strategy: "id", value: "id1" } },
                { action: "click", description: "step 2", target: { strategy: "id", value: "id2" } },
                { action: "fill", description: "step 3", target: { strategy: "id", value: "id3" }, value: "x" },
            ],
            evidenceScenarioId: "MOBILE-AA-100-001",
            evidenceScenarioTitle: "Channel lost",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
        }, () => undefined)).rejects.toThrow(/mobile_automation_channel_lost/i);
        (0, test_1.expect)(executeCalls).toBe(1);
    }
    finally {
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
(0, test_1.test)("technical-error scenario without deterministic induction is blocked as non_executable_precondition", async () => {
    (0, mobile_test_runner_1.__resetCoordinatorForTesting)();
    (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
    (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
    (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    const fakeBrowser = {
        activateApp: async () => undefined,
        terminateApp: async () => undefined,
        deleteSession: async () => undefined,
        getPageSource: async () => "<hierarchy />",
    };
    let executeCalls = 0;
    let createCalls = 0;
    try {
        (0, mobile_test_runner_1.__setCreateSessionForTesting)(async () => {
            createCalls++;
            return fakeBrowser;
        });
        (0, mobile_test_runner_1.__setExecuteMobileStepForTesting)(async (_browser, step, index) => {
            executeCalls++;
            return { index, action: step.action, description: step.description, status: "passed", durationMs: 2 };
        });
        const result = await (0, mobile_test_runner_1.runOneScenario)({
            appiumPort: 4723,
            systemPort: 8200,
            appPackage: "com.example.app",
            appActivity: "MainActivity",
            steps: [
                { action: "launchApp", description: "Abrir app" },
                { action: "assertVisible", description: "Verificar inconveniente técnico", target: { strategy: "accessibilityId", value: "Ocurrió un inconveniente técnico" } },
                { action: "assertVisible", description: "Verificar botón Reintentar", target: { strategy: "accessibilityId", value: "Reintentar" } },
            ],
            evidenceScenarioId: "MOBILE-AA-94-003",
            evidenceScenarioTitle: "Error técnico no inducible",
            runId: `unit-${Date.now()}`,
            sectionSlug: "android",
            appSlug: "app-mobile",
        }, () => undefined);
        (0, test_1.expect)(executeCalls).toBe(0);
        (0, test_1.expect)(createCalls).toBe(0);
        (0, test_1.expect)(result.failed).toBe(0);
        (0, test_1.expect)(result.blocked).toBe(1);
        (0, test_1.expect)(result.blockedReasonCode).toBe("non_executable_precondition");
        (0, test_1.expect)(result.results[0]?.reasonCode).toBe("non_executable_precondition");
        (0, test_1.expect)(result.results[1]?.reasonCode).toBe("skipped_due_to_prior_failure");
        const lockKey = "127.0.0.1:4723|127.0.0.1:4723|8200";
        (0, test_1.expect)((0, mobile_test_runner_1.__getCoordinatorLockForTesting)(lockKey)).toBeUndefined();
    }
    finally {
        (0, mobile_test_runner_1.__resetCoordinatorForTesting)();
        (0, mobile_test_runner_1.__resetCreateSessionForTesting)();
        (0, mobile_test_runner_1.__resetCloseSessionForTesting)();
        (0, mobile_test_runner_1.__resetExecuteMobileStepForTesting)();
    }
});
