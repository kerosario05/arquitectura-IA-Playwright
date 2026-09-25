"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const promote_plan_1 = require("./promote-plan");
const automation_naming_1 = require("./automation-naming");
const app_profile_1 = require("./app-profile");
const automation_promotion_types_1 = require("../types/automation-promotion.types");
function withEnv(vars, fn) {
    const original = {};
    for (const [key, value] of Object.entries(vars)) {
        original[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    return fn().finally(() => {
        for (const [key, value] of Object.entries(original)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    });
}
function buildPlan() {
    return {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        createdAt: new Date().toISOString(),
        scenario: {
            source: "manual",
            externalId: "C42940",
            title: "Acceder a Transacciones y servicios para iniciar autenticacion"
        },
        requiredData: [],
        steps: [
            {
                index: 1,
                action: "click",
                description: "Iniciar",
                target: { strategy: "text", value: "Iniciar" }
            }
        ]
    };
}
(0, node_test_1.default)("existing spec is not counted as freshly written when promotion is blocked", async () => {
    const outputRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "promote-spec-written-"));
    const plan = buildPlan();
    const appProfile = {
        appSlug: "arquitectura-automatizacion",
        source: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    const automationId = (0, automation_naming_1.buildAutomationId)({
        externalId: plan.scenario.externalId,
        caseId: plan.scenario.caseId,
        title: plan.scenario.title
    });
    const appPaths = (0, app_profile_1.buildAppAutomationPaths)(appProfile, automationId, outputRoot, "detalle-kiosko");
    const previousSpecContent = "// previous spec should remain untouched\nexport {};\n";
    await promises_1.default.mkdir(node_path_1.default.dirname(appPaths.specPath), { recursive: true });
    await promises_1.default.writeFile(appPaths.specPath, previousSpecContent, "utf-8");
    await withEnv({ AI_SPEC_GENERATION_ENABLED: "false" }, async () => {
        const result = await (0, promote_plan_1.promoteExecutionPlan)({
            plan,
            outputRoot,
            appProfileObject: appProfile,
            source: "discovery",
            sectionSlug: "detalle-kiosko",
            promotionPolicy: {
                ...automation_promotion_types_1.DEFAULT_PROMOTION_POLICY,
                specMode: "inline-debug",
                requirePageObjects: false,
                allowInlineFallback: true,
                blockPromotionWhenPageObjectMissing: false
            },
            sourceScenario: {
                title: plan.scenario.title,
                steps: [{ index: 1, action: "click", description: "Iniciar" }],
                expectedResult: "Debe visualizarse el flujo de autenticacion"
            }
        });
        node_assert_1.default.strictEqual(result.status, "spec_failed");
        const metadata = result.metadata?.specGeneration;
        node_assert_1.default.ok(metadata);
        node_assert_1.default.strictEqual(metadata?.specWritten, false);
        node_assert_1.default.strictEqual(metadata?.previousSpec?.existed, true);
        node_assert_1.default.ok(typeof metadata?.previousSpec?.hash === "string" && metadata.previousSpec.hash.length > 0);
        node_assert_1.default.ok(typeof metadata?.previousSpec?.lastModifiedAt === "string" && metadata.previousSpec.lastModifiedAt.length > 0);
        const currentSpec = await promises_1.default.readFile(appPaths.specPath, "utf-8");
        node_assert_1.default.strictEqual(currentSpec, previousSpecContent);
    });
});
