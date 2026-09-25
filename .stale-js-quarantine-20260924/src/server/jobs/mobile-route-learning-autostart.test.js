"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_route_learning_autostart_1 = require("./mobile-route-learning-autostart");
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
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
function job(over) {
    return {
        id: "j1",
        type: "mobile-launch-execution",
        status: "running",
        params: {},
        createdAt: new Date().toISOString(),
        logs: [],
        ...over,
    };
}
/** AA-96, the story that hit `requires_route_learning`: its opening clicks name the entry path. */
const AA96 = [
    {
        scenarioId: "MOBILE-AA-96-001",
        sourceIssueKey: "AA-96",
        title: "Presentación y consulta del Convenio Único",
        steps: [
            { action: "launchApp", description: "Abrir la aplicación" },
            {
                action: "click",
                description: "Crear cuenta",
                target: { strategy: "androidUiAutomator", value: 'new UiSelector().descriptionContains("Crea tu cuenta")' },
            },
            { action: "click", description: "Continuar", target: { strategy: "accessibilityId", value: "Continuar" } },
        ],
    },
];
const BASE = { appSlug: "app-conversacional", routeLearningScenarios: AA96, hasApp: true, autoEnabled: true, busyJob: null };
describe("findDeviceBusyJob", () => {
    test("reports a running execution as holding the device", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findDeviceBusyJob)([job({ type: "mobile-launch-execution", status: "running" })])?.id, "j1");
    });
    test("a queued walk counts too — it is about to take the device", () => {
        node_assert_1.default.ok((0, mobile_route_learning_autostart_1.findDeviceBusyJob)([job({ type: "mobile-route-learning", status: "queued" })]));
    });
    test("finished jobs do not hold it", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findDeviceBusyJob)([job({ status: "done" }), job({ status: "failed" })]), null);
    });
    test("jobs that never touch the emulator are ignored", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findDeviceBusyJob)([job({ type: "scenario-preview", status: "running" })]), null);
    });
});
describe("derivePreferLabels", () => {
    test("reads the entry label out of the UiSelector, in entry-path order", () => {
        // Before this, the first click was dropped and only "continuar" survived — too generic to
        // steer the walk, which then stopped on loop_detected three screens in.
        node_assert_1.default.deepStrictEqual((0, mobile_route_learning_autostart_1.derivePreferLabels)(AA96), ["crea tu cuenta", "continuar"]);
    });
    test("never emits selector syntax as a label", () => {
        node_assert_1.default.ok(!(0, mobile_route_learning_autostart_1.derivePreferLabels)(AA96).some((l) => /uiselector|descriptioncontains|\(/.test(l)));
    });
    test("no clicks yields no steering rather than a bad guess", () => {
        node_assert_1.default.deepStrictEqual((0, mobile_route_learning_autostart_1.derivePreferLabels)([{ scenarioId: "x", steps: [{ action: "launchApp", description: "Abrir" }] }]), []);
    });
});
describe("planRouteLearningAutostart", () => {
    test("starts the walk for a story blocked on route learning", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)(BASE);
        node_assert_1.default.strictEqual(plan.start, true);
        node_assert_1.default.strictEqual(plan.params?.appSlug, "app-conversacional");
        node_assert_1.default.strictEqual(plan.params?.flowId, "AA-96");
    });
    test("never authorizes a commit during the walk", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.planRouteLearningAutostart)(BASE).params?.stopBeforeSubmit, true);
    });
    test("does nothing when no scenario needs learning", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, routeLearningScenarios: [] });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "no_scenarios_require_learning");
    });
    test("defers while another job holds the emulator", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, busyJob: job({ id: "busy-1" }) });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.match(plan.reason, /^device_busy;jobId=busy-1/);
    });
    test("respects an explicit opt-out", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, autoEnabled: false });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "disabled_by_request");
    });
    test("declines without an appSlug — nothing would be learned", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, appSlug: "  " });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "missing_app_slug");
    });
    test("declines when no app can be resolved to drive", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, hasApp: false });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "no_resolvable_app");
    });
    test("carries the caller's app identity into the walk", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, base: { appPackage: "com.appconversacionalbsc", headless: false } });
        node_assert_1.default.strictEqual(plan.params?.appPackage, "com.appconversacionalbsc");
        node_assert_1.default.strictEqual(plan.params?.headless, false);
    });
});
describe("findActiveRouteLearningJob", () => {
    test("reports a running walk — the one that blocked run 8d772587", () => {
        const found = (0, mobile_route_learning_autostart_1.findActiveRouteLearningJob)([job({ id: "3a2ea04a", type: "mobile-route-learning", status: "running" })]);
        node_assert_1.default.strictEqual(found?.id, "3a2ea04a");
    });
    test("a queued walk counts: it is about to take the session lock", () => {
        node_assert_1.default.ok((0, mobile_route_learning_autostart_1.findActiveRouteLearningJob)([job({ type: "mobile-route-learning", status: "queued" })]));
    });
    test("a finished walk does not block anything", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findActiveRouteLearningJob)([job({ type: "mobile-route-learning", status: "done" })]), null);
    });
    test("an execution is not a walk — this guard only covers route learning", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findActiveRouteLearningJob)([job({ type: "mobile-launch-execution", status: "running" })]), null);
    });
});
describe("extractSteeringLabel", () => {
    test("an accessibilityId is already the label", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "accessibilityId", value: "Continuar" }), "Continuar");
    });
    test("reads descriptionContains — the real AA-96 entry target", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({
            strategy: "androidUiAutomator",
            value: 'new UiSelector().descriptionContains("Crea tu cuenta en minutos")',
        }), "Crea tu cuenta en minutos");
    });
    test("reads text() selectors too", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "androidUiAutomator", value: 'new UiSelector().text("Enviar código")' }), "Enviar código");
    });
    test("yields nothing for resourceId — a technical identity, not a label", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "androidUiAutomator", value: 'new UiSelector().resourceId("com.app:id/btn")' }), null);
    });
    test("yields nothing for className — the OTP box selector steers nowhere", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "androidUiAutomator", value: 'new UiSelector().className("android.widget.EditText")' }), null);
    });
    test("unescapes an embedded quote", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "androidUiAutomator", value: 'new UiSelector().text("Di \\"hola\\"")' }), 'Di "hola"');
    });
    test("reads an xpath content-desc predicate", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "xpath", value: "//*[@content-desc='Continuar']" }), "Continuar");
    });
    test("an id target is not a label", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "id", value: "btn_continuar" }), null);
    });
    test("an empty target yields nothing", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)(undefined), null);
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.extractSteeringLabel)({ strategy: "accessibilityId", value: "   " }), null);
    });
});
describe("cooldown: no repeated walk for the same flow", () => {
    const NOW = Date.parse("2026-09-04T20:45:00.000Z");
    const walk = (over = {}) => job({
        id: "bd1a554e",
        type: "mobile-route-learning",
        status: "done",
        params: { appSlug: "app-conversacional", flowId: "AA-96" },
        completedAt: "2026-09-04T20:39:50.000Z",
        ...over,
    });
    test("finds the walk that just ran for this flow — the AA-96 loop", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)([walk()], "app-conversacional", "AA-96", NOW)?.id, "bd1a554e");
    });
    test("a walk for another story does not cover this one", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)([walk({ params: { appSlug: "app-conversacional", flowId: "AA-93" } })], "app-conversacional", "AA-96", NOW), null);
    });
    test("a walk for another app never counts", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)([walk({ params: { appSlug: "otra-app", flowId: "AA-96" } })], "app-conversacional", "AA-96", NOW), null);
    });
    test("outside the cooldown the walk is worth repeating", () => {
        const old = walk({ completedAt: "2026-09-04T19:00:00.000Z" });
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)([old], "app-conversacional", "AA-96", NOW), null);
    });
    test("a still-running walk is not 'recent' — that is the busy check's job", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.findRecentRouteLearningJob)([walk({ status: "running" })], "app-conversacional", "AA-96", NOW), null);
    });
    test("the plan stands down and says why", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, recentWalk: walk() });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "recent_walk;jobId=bd1a554e");
    });
    test("with no recent walk it still starts", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, recentWalk: null }).start, true);
    });
});
describe("durable cooldown via the app profile", () => {
    // The walk records what it covered under `flows`. This is what survives a restart, which the
    // in-memory job history did not — the loop came back the moment the server was restarted.
    const PROFILE = { flows: { "AA-96": {}, "aa-93": {}, registro: {} } };
    test("recognises the flow the walk already recorded", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(PROFILE, "AA-96"), true);
    });
    test("matches case-insensitively — the walk writes both casings", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(PROFILE, "aa-96"), true);
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(PROFILE, "AA-93"), true);
    });
    test("a story never walked is not suppressed", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(PROFILE, "AA-99"), false);
    });
    test("no profile and no flowId are both safe", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(null, "AA-96"), false);
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)(PROFILE, undefined), false);
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.isFlowAlreadyLearned)({}, "AA-96"), false);
    });
    test("the plan stands down on an already-learned flow, even with empty job history", () => {
        const plan = (0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, flowId: "AA-96", flowAlreadyLearned: true });
        node_assert_1.default.strictEqual(plan.start, false);
        node_assert_1.default.strictEqual(plan.reason, "flow_already_learned;flowId=AA-96");
    });
    test("an unlearned flow still starts the walk", () => {
        node_assert_1.default.strictEqual((0, mobile_route_learning_autostart_1.planRouteLearningAutostart)({ ...BASE, flowId: "AA-99", flowAlreadyLearned: false }).start, true);
    });
});
