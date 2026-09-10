import assert from "node:assert";
import { derivePreferLabels, extractSteeringLabel, findActiveRouteLearningJob, findDeviceBusyJob, findRecentRouteLearningJob, isFlowAlreadyLearned, planRouteLearningAutostart } from "./mobile-route-learning-autostart";
import type { Job } from "./job-store";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function job(over: Partial<Job>): Job {
  return {
    id: "j1",
    type: "mobile-launch-execution",
    status: "running",
    params: {},
    createdAt: new Date().toISOString(),
    logs: [],
    ...over,
  } as Job;
}

/** AA-96, the story that hit `requires_route_learning`: its opening clicks name the entry path. */
const AA96 = [
  {
    scenarioId: "MOBILE-AA-96-001",
    sourceIssueKey: "AA-96",
    title: "Presentación y consulta del Convenio Único",
    steps: [
      { action: "launchApp" as const, description: "Abrir la aplicación" },
      {
        action: "click" as const,
        description: "Crear cuenta",
        target: { strategy: "androidUiAutomator" as const, value: 'new UiSelector().descriptionContains("Crea tu cuenta")' },
      },
      { action: "click" as const, description: "Continuar", target: { strategy: "accessibilityId" as const, value: "Continuar" } },
    ],
  },
];

const BASE = { appSlug: "app-conversacional", routeLearningScenarios: AA96, hasApp: true, autoEnabled: true, busyJob: null };

describe("findDeviceBusyJob", () => {
  test("reports a running execution as holding the device", () => {
    assert.strictEqual(findDeviceBusyJob([job({ type: "mobile-launch-execution", status: "running" })])?.id, "j1");
  });

  test("a queued walk counts too — it is about to take the device", () => {
    assert.ok(findDeviceBusyJob([job({ type: "mobile-route-learning", status: "queued" })]));
  });

  test("finished jobs do not hold it", () => {
    assert.strictEqual(findDeviceBusyJob([job({ status: "done" }), job({ status: "failed" })]), null);
  });

  test("jobs that never touch the emulator are ignored", () => {
    assert.strictEqual(findDeviceBusyJob([job({ type: "scenario-preview", status: "running" })]), null);
  });
});

describe("derivePreferLabels", () => {
  test("reads the entry label out of the UiSelector, in entry-path order", () => {
    // Before this, the first click was dropped and only "continuar" survived — too generic to
    // steer the walk, which then stopped on loop_detected three screens in.
    assert.deepStrictEqual(derivePreferLabels(AA96), ["crea tu cuenta", "continuar"]);
  });

  test("never emits selector syntax as a label", () => {
    assert.ok(!derivePreferLabels(AA96).some((l) => /uiselector|descriptioncontains|\(/.test(l)));
  });

  test("no clicks yields no steering rather than a bad guess", () => {
    assert.deepStrictEqual(derivePreferLabels([{ scenarioId: "x", steps: [{ action: "launchApp", description: "Abrir" }] }]), []);
  });
});

describe("planRouteLearningAutostart", () => {
  test("starts the walk for a story blocked on route learning", () => {
    const plan = planRouteLearningAutostart(BASE);
    assert.strictEqual(plan.start, true);
    assert.strictEqual(plan.params?.appSlug, "app-conversacional");
    assert.strictEqual(plan.params?.flowId, "AA-96");
  });

  test("never authorizes a commit during the walk", () => {
    assert.strictEqual(planRouteLearningAutostart(BASE).params?.stopBeforeSubmit, true);
  });

  test("does nothing when no scenario needs learning", () => {
    const plan = planRouteLearningAutostart({ ...BASE, routeLearningScenarios: [] });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "no_scenarios_require_learning");
  });

  test("defers while another job holds the emulator", () => {
    const plan = planRouteLearningAutostart({ ...BASE, busyJob: job({ id: "busy-1" }) });
    assert.strictEqual(plan.start, false);
    assert.match(plan.reason, /^device_busy;jobId=busy-1/);
  });

  test("respects an explicit opt-out", () => {
    const plan = planRouteLearningAutostart({ ...BASE, autoEnabled: false });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "disabled_by_request");
  });

  test("declines without an appSlug — nothing would be learned", () => {
    const plan = planRouteLearningAutostart({ ...BASE, appSlug: "  " });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "missing_app_slug");
  });

  test("declines when no app can be resolved to drive", () => {
    const plan = planRouteLearningAutostart({ ...BASE, hasApp: false });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "no_resolvable_app");
  });

  test("carries the caller's app identity into the walk", () => {
    const plan = planRouteLearningAutostart({ ...BASE, base: { appPackage: "com.appconversacionalbsc", headless: false } });
    assert.strictEqual(plan.params?.appPackage, "com.appconversacionalbsc");
    assert.strictEqual(plan.params?.headless, false);
  });
});

describe("findActiveRouteLearningJob", () => {
  test("reports a running walk — the one that blocked run 8d772587", () => {
    const found = findActiveRouteLearningJob([job({ id: "3a2ea04a", type: "mobile-route-learning", status: "running" })]);
    assert.strictEqual(found?.id, "3a2ea04a");
  });

  test("a queued walk counts: it is about to take the session lock", () => {
    assert.ok(findActiveRouteLearningJob([job({ type: "mobile-route-learning", status: "queued" })]));
  });

  test("a finished walk does not block anything", () => {
    assert.strictEqual(findActiveRouteLearningJob([job({ type: "mobile-route-learning", status: "done" })]), null);
  });

  test("an execution is not a walk — this guard only covers route learning", () => {
    assert.strictEqual(findActiveRouteLearningJob([job({ type: "mobile-launch-execution", status: "running" })]), null);
  });
});

describe("extractSteeringLabel", () => {
  test("an accessibilityId is already the label", () => {
    assert.strictEqual(extractSteeringLabel({ strategy: "accessibilityId", value: "Continuar" }), "Continuar");
  });

  test("reads descriptionContains — the real AA-96 entry target", () => {
    assert.strictEqual(
      extractSteeringLabel({
        strategy: "androidUiAutomator",
        value: 'new UiSelector().descriptionContains("Crea tu cuenta en minutos")',
      }),
      "Crea tu cuenta en minutos",
    );
  });

  test("reads text() selectors too", () => {
    assert.strictEqual(
      extractSteeringLabel({ strategy: "androidUiAutomator", value: 'new UiSelector().text("Enviar código")' }),
      "Enviar código",
    );
  });

  test("yields nothing for resourceId — a technical identity, not a label", () => {
    assert.strictEqual(
      extractSteeringLabel({ strategy: "androidUiAutomator", value: 'new UiSelector().resourceId("com.app:id/btn")' }),
      null,
    );
  });

  test("yields nothing for className — the OTP box selector steers nowhere", () => {
    assert.strictEqual(
      extractSteeringLabel({ strategy: "androidUiAutomator", value: 'new UiSelector().className("android.widget.EditText")' }),
      null,
    );
  });

  test("unescapes an embedded quote", () => {
    assert.strictEqual(
      extractSteeringLabel({ strategy: "androidUiAutomator", value: 'new UiSelector().text("Di \\"hola\\"")' }),
      'Di "hola"',
    );
  });

  test("reads an xpath content-desc predicate", () => {
    assert.strictEqual(extractSteeringLabel({ strategy: "xpath", value: "//*[@content-desc='Continuar']" }), "Continuar");
  });

  test("an id target is not a label", () => {
    assert.strictEqual(extractSteeringLabel({ strategy: "id", value: "btn_continuar" }), null);
  });

  test("an empty target yields nothing", () => {
    assert.strictEqual(extractSteeringLabel(undefined), null);
    assert.strictEqual(extractSteeringLabel({ strategy: "accessibilityId", value: "   " }), null);
  });
});

describe("cooldown: no repeated walk for the same flow", () => {
  const NOW = Date.parse("2026-09-04T20:45:00.000Z");
  const walk = (over: Partial<Job> = {}) =>
    job({
      id: "bd1a554e",
      type: "mobile-route-learning",
      status: "done",
      params: { appSlug: "app-conversacional", flowId: "AA-96" },
      completedAt: "2026-09-04T20:39:50.000Z",
      ...over,
    });

  test("finds the walk that just ran for this flow — the AA-96 loop", () => {
    assert.strictEqual(findRecentRouteLearningJob([walk()], "app-conversacional", "AA-96", NOW)?.id, "bd1a554e");
  });

  test("a walk for another story does not cover this one", () => {
    assert.strictEqual(
      findRecentRouteLearningJob([walk({ params: { appSlug: "app-conversacional", flowId: "AA-93" } })], "app-conversacional", "AA-96", NOW),
      null,
    );
  });

  test("a walk for another app never counts", () => {
    assert.strictEqual(findRecentRouteLearningJob([walk({ params: { appSlug: "otra-app", flowId: "AA-96" } })], "app-conversacional", "AA-96", NOW), null);
  });

  test("outside the cooldown the walk is worth repeating", () => {
    const old = walk({ completedAt: "2026-09-04T19:00:00.000Z" });
    assert.strictEqual(findRecentRouteLearningJob([old], "app-conversacional", "AA-96", NOW), null);
  });

  test("a still-running walk is not 'recent' — that is the busy check's job", () => {
    assert.strictEqual(findRecentRouteLearningJob([walk({ status: "running" })], "app-conversacional", "AA-96", NOW), null);
  });

  test("the plan stands down and says why", () => {
    const plan = planRouteLearningAutostart({ ...BASE, recentWalk: walk() });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "recent_walk;jobId=bd1a554e");
  });

  test("with no recent walk it still starts", () => {
    assert.strictEqual(planRouteLearningAutostart({ ...BASE, recentWalk: null }).start, true);
  });
});

describe("durable cooldown via the app profile", () => {
  // The walk records what it covered under `flows`. This is what survives a restart, which the
  // in-memory job history did not — the loop came back the moment the server was restarted.
  const PROFILE = { flows: { "AA-96": {}, "aa-93": {}, registro: {} } };

  test("recognises the flow the walk already recorded", () => {
    assert.strictEqual(isFlowAlreadyLearned(PROFILE, "AA-96"), true);
  });

  test("matches case-insensitively — the walk writes both casings", () => {
    assert.strictEqual(isFlowAlreadyLearned(PROFILE, "aa-96"), true);
    assert.strictEqual(isFlowAlreadyLearned(PROFILE, "AA-93"), true);
  });

  test("a story never walked is not suppressed", () => {
    assert.strictEqual(isFlowAlreadyLearned(PROFILE, "AA-99"), false);
  });

  test("no profile and no flowId are both safe", () => {
    assert.strictEqual(isFlowAlreadyLearned(null, "AA-96"), false);
    assert.strictEqual(isFlowAlreadyLearned(PROFILE, undefined), false);
    assert.strictEqual(isFlowAlreadyLearned({}, "AA-96"), false);
  });

  test("the plan stands down on an already-learned flow, even with empty job history", () => {
    const plan = planRouteLearningAutostart({ ...BASE, flowId: "AA-96", flowAlreadyLearned: true });
    assert.strictEqual(plan.start, false);
    assert.strictEqual(plan.reason, "flow_already_learned;flowId=AA-96");
  });

  test("an unlearned flow still starts the walk", () => {
    assert.strictEqual(planRouteLearningAutostart({ ...BASE, flowId: "AA-99", flowAlreadyLearned: false }).start, true);
  });
});
