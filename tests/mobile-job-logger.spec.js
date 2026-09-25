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
const fs = __importStar(require("node:fs"));
const test_1 = require("@playwright/test");
const mobile_job_logger_1 = require("../src/server/jobs/mobile-job-logger");
function withEnv(name, value, fn) {
    const prev = process.env[name];
    process.env[name] = value;
    try {
        fn();
    }
    finally {
        if (prev === undefined)
            delete process.env[name];
        else
            process.env[name] = prev;
    }
}
(0, test_1.test)("info suppresses ordinary appium process_output but keeps critical infra signal", () => {
    withEnv("MOBILE_LOG_LEVEL", "info", () => {
        const lines = [];
        const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
            runId: `log-info-${Date.now()}`,
            appendLog: (line) => lines.push(line),
        });
        logger.log('[appium] event=process_output stream=stdout bytes=120 preview="Calling AppiumDriver.someCommand"');
        logger.log('[appium] event=process_output stream=stderr bytes=88 preview="socket hang up while proxying command"');
        logger.flush();
        (0, test_1.expect)(lines.some((line) => line.includes("Calling AppiumDriver"))).toBe(false);
        (0, test_1.expect)(lines.some((line) => line.includes("appium stream_error"))).toBe(true);
    });
});
(0, test_1.test)("debug keeps additional readiness diagnostics", () => {
    withEnv("MOBILE_LOG_LEVEL", "debug", () => {
        const lines = [];
        const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
            runId: `log-debug-${Date.now()}`,
            appendLog: (line) => lines.push(line),
        });
        logger.log("[appium] event=readiness_attempts attempts=12 readiness_elapsed_ms=4500 last_readiness_error=ECONNREFUSED");
        logger.flush();
        (0, test_1.expect)(lines.some((line) => line.includes("event=readiness_attempts"))).toBe(true);
    });
});
(0, test_1.test)("visible feed never receives xml or large base64 payloads", () => {
    withEnv("MOBILE_LOG_LEVEL", "info", () => {
        const lines = [];
        const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
            runId: `log-sanitize-${Date.now()}`,
            appendLog: (line) => lines.push(line),
        });
        logger.log('[mobile:scenario] raw page source <?xml version="1.0"?><hierarchy><node text="hola"/></hierarchy>');
        logger.log(`[mobile:scenario] screenshot=${"A".repeat(400)}`);
        logger.flush();
        (0, test_1.expect)(lines.some((line) => line.includes("<hierarchy>"))).toBe(false);
        (0, test_1.expect)(lines.some((line) => line.includes("AAAAAA"))).toBe(false);
    });
});
(0, test_1.test)("deduplicates repeated critical errors and reports suppressedDuplicates", () => {
    withEnv("MOBILE_LOG_LEVEL", "info", () => {
        const lines = [];
        const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
            runId: `log-dedupe-${Date.now()}`,
            appendLog: (line) => lines.push(line),
        });
        for (let i = 0; i < 100; i++) {
            logger.log('[appium] event=process_output stream=stderr bytes=100 preview="instrumentation process is not running (probably crashed)"');
        }
        logger.flush();
        const streamErrors = lines.filter((line) => line.includes("appium stream_error"));
        (0, test_1.expect)(streamErrors.length).toBe(1);
        (0, test_1.expect)(lines.some((line) => line.includes("suppressedDuplicates=99"))).toBe(true);
    });
});
(0, test_1.test)("trace file enforces size cap and secret redaction", () => {
    withEnv("MOBILE_LOG_LEVEL", "trace", () => {
        withEnv("MOBILE_APP_TRACE_MAX_BYTES", "1024", () => {
            const runId = `log-trace-${Date.now()}`;
            const lines = [];
            const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
                runId,
                appendLog: (line) => lines.push(line),
            });
            for (let i = 0; i < 12; i++) {
                logger.traceAppiumChunk({
                    stream: "stdout",
                    bytes: 300,
                    text: `token=abc123 chunk=${i} ${"X".repeat(260)}`,
                });
            }
            logger.flush();
            const diag = lines.find((line) => line.includes("[mobile:diagnostics]"));
            (0, test_1.expect)(diag).toBeTruthy();
            const tracePath = diag?.match(/\bpath=([^\s]+)\b/)?.[1] ?? "";
            (0, test_1.expect)(tracePath.length).toBeGreaterThan(0);
            (0, test_1.expect)(fs.existsSync(tracePath)).toBe(true);
            const content = fs.readFileSync(tracePath, "utf8");
            (0, test_1.expect)(content).not.toContain("abc123");
            (0, test_1.expect)(content).toContain("truncated");
        });
    });
});
(0, test_1.test)("synthetic mobile run reduces visible events by at least 90%", () => {
    withEnv("MOBILE_LOG_LEVEL", "info", () => {
        const lines = [];
        const logger = (0, mobile_job_logger_1.createMobileJobLogger)({
            runId: `log-volume-${Date.now()}`,
            appendLog: (line) => lines.push(line),
        });
        logger.log("[mobile:run] started runId=synthetic scenarios=1 appSlug=app-mobile");
        for (let i = 0; i < 9912; i++) {
            logger.log(`[appium] event=process_output stream=stdout bytes=80 preview="Proxying [POST /session/${i}] to [POST /wd/hub/session/${i}]"`);
        }
        for (let i = 0; i < 120; i++) {
            logger.log(`[mobile:scenario] step=${(i % 10) + 1}/10 status=passed durationMs=12`);
        }
        logger.log("[mobile:run] finished status=done passed=1 failed=0 blocked=0");
        logger.flush();
        const before = 10044;
        const after = lines.length;
        (0, test_1.expect)(after).toBeLessThan(300);
        (0, test_1.expect)(after).toBeLessThanOrEqual(Math.floor(before * 0.1));
    });
});
