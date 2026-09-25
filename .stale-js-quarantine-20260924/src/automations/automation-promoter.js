"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.promoteDiscoveryAutomation = promoteDiscoveryAutomation;
const node_path_1 = __importDefault(require("node:path"));
const promote_plan_1 = require("./promote-plan");
async function promoteDiscoveryAutomation(input) {
    const discoveredConfidences = input.promotedObjects.map((object) => {
        const tag = object.tags?.find((value) => value.startsWith("confidence:"));
        return tag ? Number(tag.split(":")[1]) : undefined;
    }).filter((value) => typeof value === "number" && Number.isFinite(value));
    const averageConfidence = discoveredConfidences.length
        ? discoveredConfidences.reduce((sum, value) => sum + value, 0) / discoveredConfidences.length
        : 0;
    const minConfidence = discoveredConfidences.length ? Math.min(...discoveredConfidences) : 0;
    return (0, promote_plan_1.promoteExecutionPlan)({
        plan: input.plan,
        sourcePlanPath: node_path_1.default.join(input.discoveryDir, "discovered-plans.pending.json"),
        source: "discovery",
        overwrite: false
    }, false, {
        discoveryDir: input.discoveryDir,
        confidenceSummary: {
            promotedCount: input.promotedObjects.length,
            averageConfidence,
            minConfidence
        },
        promotedObjects: input.promotedObjects.map((object) => object.key)
    });
}
