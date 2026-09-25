"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const auth_input_resolver_1 = require("../src/discovery/auth-input-resolver");
(0, test_1.test)("redacts authentication values in resolution logs while preserving runtime inputs", () => {
    const lines = [];
    const originalLog = console.log;
    console.log = (...args) => lines.push(args.map(String).join(" "));
    try {
        (0, auth_input_resolver_1.logAuthResolution)({
            success: true,
            data: { username: "runtime-user", password: "runtime-password", otp: "123456" },
            sources: { username: "runtime", password: "runtime", otp: "runtime" },
            errors: [],
        });
    }
    finally {
        console.log = originalLog;
    }
    const output = lines.join("\n");
    (0, test_1.expect)(output).not.toContain("runtime-user");
    (0, test_1.expect)(output).not.toContain("runtime-password");
    (0, test_1.expect)(output).not.toContain("123456");
    (0, test_1.expect)(output).toContain("value=****** sensitive=true");
});
