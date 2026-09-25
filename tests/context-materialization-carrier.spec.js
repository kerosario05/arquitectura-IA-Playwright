"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
(0, test_1.test)("reads contextMaterialized from the job-scoped structured child result", async () => {
    const jobId = "carrier-test";
    const resultPath = (0, discovery_batch_runner_1.buildBatchResultPath)(jobId);
    await promises_1.default.mkdir(node_path_1.default.dirname(resultPath), { recursive: true });
    await promises_1.default.writeFile(resultPath, JSON.stringify({
        cases: [{ caseId: 123, status: "discovered_passed", contextMaterialized: true }],
    }), "utf8");
    try {
        const result = await (0, discovery_batch_runner_1.readStructuredChildResult)(resultPath, 123);
        (0, test_1.expect)(result).toEqual({ status: "discovered_passed", contextMaterialized: true });
    }
    finally {
        await promises_1.default.rm(resultPath, { force: true });
    }
});
(0, test_1.test)("keeps legacy child results compatible and does not infer the signal", async () => {
    const jobId = "carrier-legacy-test";
    const resultPath = (0, discovery_batch_runner_1.buildBatchResultPath)(jobId);
    await promises_1.default.mkdir(node_path_1.default.dirname(resultPath), { recursive: true });
    await promises_1.default.writeFile(resultPath, JSON.stringify({
        cases: [{ caseId: 123, status: "discovered_passed" }],
    }), "utf8");
    try {
        const result = await (0, discovery_batch_runner_1.readStructuredChildResult)(resultPath, 123);
        (0, test_1.expect)(result).toEqual({ status: "discovered_passed", contextMaterialized: false });
    }
    finally {
        await promises_1.default.rm(resultPath, { force: true });
    }
});
(0, test_1.test)("forwards the deterministic batch result path through child environment", () => {
    const env = (0, discovery_batch_runner_1.buildDiscoveryChildEnv)({}, undefined, (0, discovery_batch_runner_1.buildBatchResultPath)("carrier-env-test"));
    (0, test_1.expect)(env.DISCOVERY_BATCH_RESULT_PATH).toContain("carrier-env-test.json");
});
