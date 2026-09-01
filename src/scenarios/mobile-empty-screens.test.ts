import assert from "node:assert";
import { buildMobileScenarioMessages } from "./mobile-scenario-prompt-builder";
import type { JiraIssueSource } from "./scenario-types";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

const fakeIssue: JiraIssueSource = {
  key: "AA-93",
  summary: "Login usuario",
  description: "El usuario debe poder loguearse",
  acceptanceCriteria: "Se muestra pantalla de login",
  labels: [],
  components: [],
  status: "To Do",
  issueType: "Historia"
};

console.log("\nbuildMobileScenarioMessages — empty-screens routeProfile");

test("TEST 1 — routeProfile without screens property must not crash", () => {
  const routeProfile = {
    appSlug: "appconversacional",
    packageName: "com.appconversacionalbsc",
    appName: "appconversacional",
    platform: "android" as const,
    mainActivity: "com.appconversacionalbsc.MainActivity",
    updatedAt: "2026-08-28T00:00:00.000Z"
  } as any;
  const messages = buildMobileScenarioMessages(fakeIssue, routeProfile, []);
  assert.ok(Array.isArray(messages), "must return messages array");
  assert.strictEqual(messages.length, 2, "must have system + user message");
  assert.strictEqual(messages[0].role, "system");
  assert.strictEqual(messages[1].role, "user");
});

test("TEST 2 — routeProfile with empty screens must not crash", () => {
  const routeProfile = {
    appSlug: "appconversacional",
    packageName: "com.appconversacionalbsc",
    appName: "appconversacional",
    platform: "android" as const,
    mainActivity: "com.appconversacionalbsc.MainActivity",
    screens: {},
    updatedAt: "2026-08-28T00:00:00.000Z"
  };
  const messages = buildMobileScenarioMessages(fakeIssue, routeProfile, []);
  assert.ok(Array.isArray(messages), "must return messages array");
  assert.strictEqual(messages.length, 2, "must have system + user message");
});

test("TEST 3 — null routeProfile must not crash", () => {
  const messages = buildMobileScenarioMessages(fakeIssue, null, []);
  assert.ok(Array.isArray(messages), "must return messages array");
  assert.strictEqual(messages.length, 2, "must have system + user message");
});

console.log("\nAll tests completed.");
