import assert from "node:assert";
import {
  buildAppProfilePromptContext,
  formatAppProfileContext,
  buildEntryPathBlockFromContext,
  sanitizeForPrompt,
  sanitizeObject,
  logAppProfileContext,
} from "./scenario-prompt-context";
import type { McpRouteProfile } from "./scenario-types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

const mockRouteProfile: McpRouteProfile = {
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
  { action: "click" as const, target: "Iniciar sesión", when: "Login page is displayed" },
  { action: "click" as const, target: "Aceptar", when: "Terms dialog appears" },
];

function captureStdout(fn: () => void): string {
  const logs: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: any) => {
    logs.push(String(chunk));
    return true;
  };
  try {
    fn();
  } finally {
    process.stdout.write = write;
  }
  return logs.join("");
}

describe("buildAppProfilePromptContext", () => {
  test("builds context with routeProfile and entrySteps", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
      entrySteps: mockEntrySteps,
      loginMode: "form",
    });
    assert.strictEqual(ctx.appSlug, "test-app");
    assert.strictEqual(ctx.routeProfileName, "Login Flow Route");
    assert.strictEqual(ctx.loginMode, "form");
    assert.strictEqual(ctx.entrySteps.length, 2);
    assert.strictEqual(ctx.entrySteps[0].action, "click");
    assert.strictEqual(ctx.entrySteps[0].target, "Iniciar sesión");
    assert.strictEqual(ctx.entrySteps[0].when, "Login page is displayed");
    assert.strictEqual(ctx.present, true);
    assert.deepStrictEqual(ctx.navigationHints, mockRouteProfile.intermediates);
    assert.deepStrictEqual(ctx.aliases, mockRouteProfile.aliases);
    assert.deepStrictEqual(ctx.domainTerms, mockRouteProfile.domainTerms);
    assert.deepStrictEqual(ctx.visibleControls, mockRouteProfile.visibleControls);
  });

  test("builds context without routeProfile", () => {
    const ctx = buildAppProfilePromptContext("test-app", {});
    assert.strictEqual(ctx.appSlug, "test-app");
    assert.strictEqual(ctx.routeProfileName, undefined);
    assert.strictEqual(ctx.loginMode, undefined);
    assert.strictEqual(ctx.entrySteps.length, 0);
    assert.strictEqual(ctx.present, false);
    assert.deepStrictEqual(ctx.navigationHints, {});
    assert.deepStrictEqual(ctx.aliases, {});
    assert.deepStrictEqual(ctx.domainTerms, {});
    assert.deepStrictEqual(ctx.visibleControls, []);
  });

  test("builds context with entrySteps but no routeProfile", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      entrySteps: [{ action: "click", target: "Login" }],
    });
    assert.strictEqual(ctx.entrySteps.length, 1);
    assert.strictEqual(ctx.routeProfileName, undefined);
    assert.strictEqual(Object.keys(ctx.navigationHints).length, 0);
    assert.strictEqual(ctx.present, true);
  });

  test("builds context with routeProfile but no entrySteps", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: {
        name: "Test Route",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
      } as McpRouteProfile,
    });
    assert.strictEqual(ctx.entrySteps.length, 0);
    assert.strictEqual(ctx.routeProfileName, "Test Route");
    assert.strictEqual(ctx.present, true);
    assert.strictEqual(Object.keys(ctx.navigationHints).length, 0);
  });

  test("routeProfile with no name is treated as absent", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: {
        name: "",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: [],
        representativeFixture: {},
        notes: [],
      } as McpRouteProfile,
    });
    assert.strictEqual(ctx.routeProfileName, undefined);
    assert.strictEqual(ctx.present, false);
  });

  test("targetAppSlug and targetAppName are propagated", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      targetAppSlug: "target-app",
      targetAppName: "Target Application",
    });
    assert.strictEqual(ctx.targetAppSlug, "target-app");
    assert.strictEqual(ctx.targetAppName, "Target Application");
  });

  test("null routeProfile yields present=false", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: null,
    });
    assert.strictEqual(ctx.present, false);
    assert.strictEqual(ctx.routeProfileName, undefined);
  });
});

describe("formatAppProfileContext", () => {
  test("returns empty string when not present", () => {
    const ctx = buildAppProfilePromptContext("test-app", {});
    assert.strictEqual(formatAppProfileContext(ctx), "");
  });

  test("includes appSlug and routeProfile", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
    });
    const result = formatAppProfileContext(ctx);
    assert.ok(result.includes("appSlug: test-app"));
    assert.ok(result.includes("routeProfile: Login Flow Route"));
    assert.ok(result.includes("Visible controls:"));
    assert.ok(result.includes("Navigation hints:"));
  });

  test("includes entry steps when present", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      entrySteps: mockEntrySteps,
    });
    const result = formatAppProfileContext(ctx);
    assert.ok(result.includes("Entry steps:"));
    assert.ok(result.includes('click "Iniciar sesión"'));
    assert.ok(result.includes("(Login page is displayed)"));
    assert.ok(result.includes('click "Aceptar"'));
  });

  test("includes loginMode", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
      loginMode: "basic",
    });
    const result = formatAppProfileContext(ctx);
    assert.ok(result.includes("loginMode: basic"));
  });

  test("includes targetAppSlug and targetAppName", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
      targetAppSlug: "target-app",
      targetAppName: "Target App",
    });
    const result = formatAppProfileContext(ctx);
    assert.ok(result.includes("targetAppSlug: target-app"));
    assert.ok(result.includes("targetAppName: Target App"));
  });

  test("does not include entry steps section when empty", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
    });
    const result = formatAppProfileContext(ctx);
    assert.ok(!result.includes("Entry steps:"));
  });
});

describe("buildEntryPathBlockFromContext", () => {
  test("returns REQUIRED ENTRY PATH block when entrySteps have click actions", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      entrySteps: mockEntrySteps,
    });
    const block = buildEntryPathBlockFromContext(ctx);
    assert.ok(block.includes("REQUIRED ENTRY PATH:"));
    assert.ok(block.includes('Clic en "Iniciar sesión".'));
    assert.ok(block.includes('Clic en "Aceptar".'));
    assert.ok(block.includes("Do not generate manual login"));
    assert.ok(block.includes("AuthGate/AuthFlow will resolve"));
  });

  test("returns empty string when no entrySteps", () => {
    const ctx = buildAppProfilePromptContext("test-app", {});
    assert.strictEqual(buildEntryPathBlockFromContext(ctx), "");
  });

  test("filters non-click actions", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      entrySteps: [
        { action: "type", target: "username" },
        { action: "click", target: "Login" },
      ],
    });
    const block = buildEntryPathBlockFromContext(ctx);
    assert.ok(block.includes('Clic en "Login".'));
    assert.ok(!block.includes("username"));
    assert.strictEqual((block.match(/Clic en /g) || []).length, 1);
  });

  test("returns empty when all actions are non-click", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      entrySteps: [
        { action: "navigate", target: "/home" },
        { action: "type", target: "search" },
      ],
    });
    assert.strictEqual(buildEntryPathBlockFromContext(ctx), "");
  });
});

describe("sanitizeForPrompt", () => {
  test("redacts known secret patterns in text", () => {
    const result = sanitizeForPrompt("My password=secret123 and token=abc");
    assert.ok(!result.includes("secret123"));
    assert.ok(!result.includes("abc"));
  });

  test("redacts key=value patterns for password/token/secret/apiKey", () => {
    assert.strictEqual(sanitizeForPrompt("password=mysecret"), "password=[REDACTED]");
    assert.strictEqual(sanitizeForPrompt('token: "abc123"'), "token=[REDACTED]");
    assert.strictEqual(sanitizeForPrompt("secret=myvalue"), "secret=[REDACTED]");
  });

  test("does not alter normal text", () => {
    const text = "This is a normal prompt with no secrets.";
    assert.strictEqual(sanitizeForPrompt(text), text);
  });

  test("redacts env var references", () => {
    const result = sanitizeForPrompt("Use APP_PASSWORD for auth");
    assert.ok(!result.includes("APP_PASSWORD"));
    assert.ok(result.includes("[REDACTED]"));
  });
});

describe("sanitizeObject", () => {
  test("redacts secret fields by key name", () => {
    const obj = sanitizeObject({
      username: "admin",
      password: "p@ss",
      token: "abc123",
      apiKey: "xyz",
      normalField: "hello",
    });
    assert.strictEqual(obj.username, "[REDACTED]");
    assert.strictEqual(obj.password, "[REDACTED]");
    assert.strictEqual(obj.token, "[REDACTED]");
    assert.strictEqual(obj.apiKey, "[REDACTED]");
    assert.strictEqual(obj.normalField, "hello");
  });

  test("redacts env-var-like field names", () => {
    const obj = sanitizeObject({
      APP_PASSWORD: "secret",
      JIRA_API_TOKEN: "token123",
      normalKey: "visible",
    });
    assert.strictEqual(obj.APP_PASSWORD, "[REDACTED]");
    assert.strictEqual(obj.JIRA_API_TOKEN, "[REDACTED]");
    assert.strictEqual(obj.normalKey, "visible");
  });

  test("truncates long strings", () => {
    const long = "a".repeat(300);
    const obj = sanitizeObject({ data: long });
    assert.strictEqual(obj.data!.toString().length, 200 + "...[truncated]".length);
    assert.ok(obj.data!.toString().endsWith("...[truncated]"));
  });

  test("passes through non-object types", () => {
    const obj = sanitizeObject({ num: 42, flag: true, nested: { key: "val" } });
    assert.strictEqual(obj.num, 42);
    assert.strictEqual(obj.flag, true);
    assert.deepStrictEqual(obj.nested, { key: "val" });
  });
});

describe("logAppProfileContext", () => {
  test("logs context summary without values", () => {
    const ctx = buildAppProfilePromptContext("test-app", {
      routeProfile: mockRouteProfile,
      entrySteps: mockEntrySteps,
      loginMode: "form",
    });
    const output = captureStdout(() => logAppProfileContext(ctx));
    assert.ok(output.includes("appProfileContext included=true"));
    assert.ok(output.includes("appSlug=test-app"));
    assert.ok(output.includes("routeProfile present=true"));
    assert.ok(output.includes("entrySteps count=2"));
    assert.ok(output.includes("navigationHints count=2"));
    assert.ok(output.includes("domainTerms count=1"));
    assert.ok(output.includes("visibleControls count=3"));
    assert.ok(output.includes("aliases count=1"));
  });

  test("logs absent context correctly", () => {
    const ctx = buildAppProfilePromptContext("test-app", {});
    const output = captureStdout(() => logAppProfileContext(ctx));
    assert.ok(output.includes("appProfileContext included=false"));
    assert.ok(output.includes("entrySteps count=0"));
  });
});
