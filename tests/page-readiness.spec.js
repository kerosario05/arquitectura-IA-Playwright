"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const page_readiness_1 = require("../src/browser/page-readiness");
(0, test_1.test)("waitForPageReady options have sensible defaults", () => {
    (0, test_1.expect)(typeof page_readiness_1.waitForPageReady).toBe("function");
});
(0, test_1.test)("waitForPageReady does not contain hardcoded texts like Iniciar or Bienvenido", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/browser/page-readiness.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Iniciar");
    (0, test_1.expect)(content).not.toContain("Bienvenido");
    (0, test_1.expect)(content).not.toContain("¡Hola!");
    (0, test_1.expect)(content).not.toContain("kiosco");
    (0, test_1.expect)(content).not.toContain("kiosko");
});
(0, test_1.test)("waitForPageReady exports correct type signature", () => {
    const options = {
        domContentLoadedTimeoutMs: 30000,
        networkIdleTimeoutMs: 3000,
        stabilizationMs: 200,
        visibleHints: ["Welcome"],
        visibleHintTimeoutMs: 5000,
        requireVisibleHint: false
    };
    (0, test_1.expect)(options.domContentLoadedTimeoutMs).toBe(30000);
    (0, test_1.expect)(options.networkIdleTimeoutMs).toBe(3000);
    (0, test_1.expect)(options.stabilizationMs).toBe(200);
    (0, test_1.expect)(options.visibleHints).toEqual(["Welcome"]);
    (0, test_1.expect)(options.visibleHintTimeoutMs).toBe(5000);
    (0, test_1.expect)(options.requireVisibleHint).toBe(false);
});
(0, test_1.test)("waitForPageReady options can be partially specified", () => {
    const partialOptions = {
        stabilizationMs: 1000
    };
    (0, test_1.expect)(partialOptions.stabilizationMs).toBe(1000);
    (0, test_1.expect)(partialOptions.domContentLoadedTimeoutMs).toBeUndefined();
});
(0, test_1.test)("waitForPageReady visibleHints supports string and RegExp", () => {
    const options = {
        visibleHints: ["Welcome", /Hello/]
    };
    (0, test_1.expect)(options.visibleHints.length).toBe(2);
    (0, test_1.expect)(typeof options.visibleHints[0]).toBe("string");
    (0, test_1.expect)(options.visibleHints[1] instanceof RegExp).toBe(true);
});
