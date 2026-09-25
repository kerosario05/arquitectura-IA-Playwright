"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePromotedBrowserMode = resolvePromotedBrowserMode;
exports.applyPromotedBrowserMode = applyPromotedBrowserMode;
function parseBoolean(value) {
    return typeof value === "string" && value.trim().toLowerCase() === "true";
}
function resolvePromotedBrowserMode(input) {
    if (input.headedFlag) {
        return { mode: "headed", source: "explicit_cli_flag" };
    }
    if (input.headlessFlag) {
        return { mode: "headless", source: "explicit_cli_flag" };
    }
    if (parseBoolean(input.automationHeadless)) {
        return {
            mode: "headless",
            source: input.automationSource?.trim() || "qa_lab_automatic",
        };
    }
    return { mode: "config", source: "default_config" };
}
function applyPromotedBrowserMode(input) {
    const playwrightArgs = [...input.playwrightArgs];
    const playwrightEnv = {
        ...input.baseEnv,
    };
    if (input.browserMode.mode === "headed") {
        playwrightArgs.push("--headed");
        playwrightEnv.HEADLESS = "false";
        return { playwrightArgs, playwrightEnv };
    }
    if (input.browserMode.mode === "headless") {
        // Playwright Test CLI has --headed but no --headless; force through env/config contract.
        playwrightEnv.HEADLESS = "true";
        delete playwrightEnv.PWDEBUG;
    }
    return { playwrightArgs, playwrightEnv };
}
