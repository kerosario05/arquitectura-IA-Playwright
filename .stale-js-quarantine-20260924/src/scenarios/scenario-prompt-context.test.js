"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const scenario_prompt_context_1 = require("./scenario-prompt-context");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
const mockRouteProfile = {
    name: "Login Flow Route",
    entry: [{ businessLabel: "login", visibleLabel: "Iniciar sesión" }],
    intermediates: {
        dashboard: ["overview", "reports"],
        settings: ["profile"],
    },
    aliases: {
        iniciar: ["login", "signin"],
    },
    domainTerms: {
        module: "dashboard",
    },
    visibleControls: ["button", "input", "dropdown"],
    representativeFixture: {},
    notes: [],
};
const mockEntrySteps = [
    { action: "click", target: "Iniciar sesión", when: "Login page is displayed" },
    { action: "click", target: "Aceptar", when: "Terms dialog appears" },
];
function captureStdout(fn) {
    const logs = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => {
        logs.push(String(chunk));
        return true;
    };
    try {
        fn();
    }
    finally {
        process.stdout.write = write;
    }
    return logs.join("");
}
describe("buildAppProfilePromptContext", () => {
    test("builds context with routeProfile and entrySteps", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
            entrySteps: mockEntrySteps,
            loginMode: "form",
        });
        node_assert_1.default.strictEqual(ctx.appSlug, "test-app");
        node_assert_1.default.strictEqual(ctx.routeProfileName, "Login Flow Route");
        node_assert_1.default.strictEqual(ctx.loginMode, "form");
        node_assert_1.default.strictEqual(ctx.entrySteps.length, 2);
        node_assert_1.default.strictEqual(ctx.entrySteps[0].action, "click");
        node_assert_1.default.strictEqual(ctx.entrySteps[0].target, "Iniciar sesión");
        node_assert_1.default.strictEqual(ctx.entrySteps[0].when, "Login page is displayed");
        node_assert_1.default.strictEqual(ctx.present, true);
        node_assert_1.default.deepStrictEqual(ctx.navigationHints, mockRouteProfile.intermediates);
        node_assert_1.default.deepStrictEqual(ctx.aliases, mockRouteProfile.aliases);
        node_assert_1.default.deepStrictEqual(ctx.domainTerms, mockRouteProfile.domainTerms);
        node_assert_1.default.deepStrictEqual(ctx.visibleControls, mockRouteProfile.visibleControls);
    });
    test("builds context without routeProfile", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {});
        node_assert_1.default.strictEqual(ctx.appSlug, "test-app");
        node_assert_1.default.strictEqual(ctx.routeProfileName, undefined);
        node_assert_1.default.strictEqual(ctx.loginMode, undefined);
        node_assert_1.default.strictEqual(ctx.entrySteps.length, 0);
        node_assert_1.default.strictEqual(ctx.present, false);
        node_assert_1.default.deepStrictEqual(ctx.navigationHints, {});
        node_assert_1.default.deepStrictEqual(ctx.aliases, {});
        node_assert_1.default.deepStrictEqual(ctx.domainTerms, {});
        node_assert_1.default.deepStrictEqual(ctx.visibleControls, []);
    });
    test("builds context with entrySteps but no routeProfile", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            entrySteps: [{ action: "click", target: "Login" }],
        });
        node_assert_1.default.strictEqual(ctx.entrySteps.length, 1);
        node_assert_1.default.strictEqual(ctx.routeProfileName, undefined);
        node_assert_1.default.strictEqual(Object.keys(ctx.navigationHints).length, 0);
        node_assert_1.default.strictEqual(ctx.present, true);
    });
    test("builds context with routeProfile but no entrySteps", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: {
                name: "Test Route",
                entry: [],
                aliases: {},
                intermediates: {},
                domainTerms: {},
                visibleControls: [],
                representativeFixture: {},
                notes: [],
            },
        });
        node_assert_1.default.strictEqual(ctx.entrySteps.length, 0);
        node_assert_1.default.strictEqual(ctx.routeProfileName, "Test Route");
        node_assert_1.default.strictEqual(ctx.present, true);
        node_assert_1.default.strictEqual(Object.keys(ctx.navigationHints).length, 0);
    });
    test("routeProfile with no name is treated as absent", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: {
                name: "",
                entry: [],
                aliases: {},
                intermediates: {},
                domainTerms: {},
                visibleControls: [],
                representativeFixture: {},
                notes: [],
            },
        });
        node_assert_1.default.strictEqual(ctx.routeProfileName, undefined);
        node_assert_1.default.strictEqual(ctx.present, false);
    });
    test("targetAppSlug and targetAppName are propagated", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            targetAppSlug: "target-app",
            targetAppName: "Target Application",
        });
        node_assert_1.default.strictEqual(ctx.targetAppSlug, "target-app");
        node_assert_1.default.strictEqual(ctx.targetAppName, "Target Application");
    });
    test("null routeProfile yields present=false", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: null,
        });
        node_assert_1.default.strictEqual(ctx.present, false);
        node_assert_1.default.strictEqual(ctx.routeProfileName, undefined);
    });
});
describe("formatAppProfileContext", () => {
    test("returns empty string when not present", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {});
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.formatAppProfileContext)(ctx), "");
    });
    test("includes appSlug and routeProfile", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
        });
        const result = (0, scenario_prompt_context_1.formatAppProfileContext)(ctx);
        node_assert_1.default.ok(result.includes("appSlug: test-app"));
        node_assert_1.default.ok(result.includes("routeProfile: Login Flow Route"));
        node_assert_1.default.ok(result.includes("Visible controls:"));
        node_assert_1.default.ok(result.includes("Navigation hints:"));
    });
    test("includes entry steps when present", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            entrySteps: mockEntrySteps,
        });
        const result = (0, scenario_prompt_context_1.formatAppProfileContext)(ctx);
        node_assert_1.default.ok(result.includes("Entry steps:"));
        node_assert_1.default.ok(result.includes('click "Iniciar sesión"'));
        node_assert_1.default.ok(result.includes("(Login page is displayed)"));
        node_assert_1.default.ok(result.includes('click "Aceptar"'));
    });
    test("includes loginMode", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
            loginMode: "basic",
        });
        const result = (0, scenario_prompt_context_1.formatAppProfileContext)(ctx);
        node_assert_1.default.ok(result.includes("loginMode: basic"));
    });
    test("includes targetAppSlug and targetAppName", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
            targetAppSlug: "target-app",
            targetAppName: "Target App",
        });
        const result = (0, scenario_prompt_context_1.formatAppProfileContext)(ctx);
        node_assert_1.default.ok(result.includes("targetAppSlug: target-app"));
        node_assert_1.default.ok(result.includes("targetAppName: Target App"));
    });
    test("does not include entry steps section when empty", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
        });
        const result = (0, scenario_prompt_context_1.formatAppProfileContext)(ctx);
        node_assert_1.default.ok(!result.includes("Entry steps:"));
    });
});
describe("buildEntryPathBlockFromContext", () => {
    test("returns REQUIRED ENTRY PATH block when entrySteps have click actions", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            entrySteps: mockEntrySteps,
        });
        const block = (0, scenario_prompt_context_1.buildEntryPathBlockFromContext)(ctx);
        node_assert_1.default.ok(block.includes("REQUIRED ENTRY PATH:"));
        node_assert_1.default.ok(block.includes('Clic en "Iniciar sesión".'));
        node_assert_1.default.ok(block.includes('Clic en "Aceptar".'));
        node_assert_1.default.ok(block.includes("Do not generate manual login"));
        node_assert_1.default.ok(block.includes("AuthGate/AuthFlow will resolve"));
    });
    test("returns empty string when no entrySteps", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {});
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.buildEntryPathBlockFromContext)(ctx), "");
    });
    test("filters non-click actions", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            entrySteps: [
                { action: "type", target: "username" },
                { action: "click", target: "Login" },
            ],
        });
        const block = (0, scenario_prompt_context_1.buildEntryPathBlockFromContext)(ctx);
        node_assert_1.default.ok(block.includes('Clic en "Login".'));
        node_assert_1.default.ok(!block.includes("username"));
        node_assert_1.default.strictEqual((block.match(/Clic en /g) || []).length, 1);
    });
    test("returns empty when all actions are non-click", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            entrySteps: [
                { action: "navigate", target: "/home" },
                { action: "type", target: "search" },
            ],
        });
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.buildEntryPathBlockFromContext)(ctx), "");
    });
});
describe("sanitizeForPrompt", () => {
    test("redacts known secret patterns in text", () => {
        const result = (0, scenario_prompt_context_1.sanitizeForPrompt)("My password=secret123 and token=abc");
        node_assert_1.default.ok(!result.includes("secret123"));
        node_assert_1.default.ok(!result.includes("abc"));
    });
    test("redacts key=value patterns for password/token/secret/apiKey", () => {
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.sanitizeForPrompt)("password=mysecret"), "password=[REDACTED]");
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.sanitizeForPrompt)('token: "abc123"'), "token=[REDACTED]");
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.sanitizeForPrompt)("secret=myvalue"), "secret=[REDACTED]");
    });
    test("does not alter normal text", () => {
        const text = "This is a normal prompt with no secrets.";
        node_assert_1.default.strictEqual((0, scenario_prompt_context_1.sanitizeForPrompt)(text), text);
    });
    test("redacts env var references", () => {
        const result = (0, scenario_prompt_context_1.sanitizeForPrompt)("Use APP_PASSWORD for auth");
        node_assert_1.default.ok(!result.includes("APP_PASSWORD"));
        node_assert_1.default.ok(result.includes("[REDACTED]"));
    });
});
describe("sanitizeObject", () => {
    test("redacts secret fields by key name", () => {
        const obj = (0, scenario_prompt_context_1.sanitizeObject)({
            username: "admin",
            password: "p@ss",
            token: "abc123",
            apiKey: "xyz",
            normalField: "hello",
        });
        node_assert_1.default.strictEqual(obj.username, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.password, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.token, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.apiKey, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.normalField, "hello");
    });
    test("redacts env-var-like field names", () => {
        const obj = (0, scenario_prompt_context_1.sanitizeObject)({
            APP_PASSWORD: "secret",
            JIRA_API_TOKEN: "token123",
            normalKey: "visible",
        });
        node_assert_1.default.strictEqual(obj.APP_PASSWORD, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.JIRA_API_TOKEN, "[REDACTED]");
        node_assert_1.default.strictEqual(obj.normalKey, "visible");
    });
    test("truncates long strings", () => {
        const long = "a".repeat(300);
        const obj = (0, scenario_prompt_context_1.sanitizeObject)({ data: long });
        node_assert_1.default.strictEqual(obj.data.toString().length, 200 + "...[truncated]".length);
        node_assert_1.default.ok(obj.data.toString().endsWith("...[truncated]"));
    });
    test("passes through non-object types", () => {
        const obj = (0, scenario_prompt_context_1.sanitizeObject)({ num: 42, flag: true, nested: { key: "val" } });
        node_assert_1.default.strictEqual(obj.num, 42);
        node_assert_1.default.strictEqual(obj.flag, true);
        node_assert_1.default.deepStrictEqual(obj.nested, { key: "val" });
    });
});
describe("logAppProfileContext", () => {
    test("logs context summary without values", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {
            routeProfile: mockRouteProfile,
            entrySteps: mockEntrySteps,
            loginMode: "form",
        });
        const output = captureStdout(() => (0, scenario_prompt_context_1.logAppProfileContext)(ctx));
        node_assert_1.default.ok(output.includes("appProfileContext included=true"));
        node_assert_1.default.ok(output.includes("appSlug=test-app"));
        node_assert_1.default.ok(output.includes("routeProfile present=true"));
        node_assert_1.default.ok(output.includes("entrySteps count=2"));
        node_assert_1.default.ok(output.includes("navigationHints count=2"));
        node_assert_1.default.ok(output.includes("domainTerms count=1"));
        node_assert_1.default.ok(output.includes("visibleControls count=3"));
        node_assert_1.default.ok(output.includes("aliases count=1"));
    });
    test("logs absent context correctly", () => {
        const ctx = (0, scenario_prompt_context_1.buildAppProfilePromptContext)("test-app", {});
        const output = captureStdout(() => (0, scenario_prompt_context_1.logAppProfileContext)(ctx));
        node_assert_1.default.ok(output.includes("appProfileContext included=false"));
        node_assert_1.default.ok(output.includes("entrySteps count=0"));
    });
});
