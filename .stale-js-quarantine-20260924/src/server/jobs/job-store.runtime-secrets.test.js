"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const job_store_1 = require("./job-store");
(0, node_test_1.default)("job API never exposes transient runtime values and completion clears them", () => {
    const job = job_store_1.jobStore.create("discovery-batch", {
        runtimeEntriesByCase: {
            "case-1": [{
                    key: "auth.password",
                    value: "transient-value",
                    source: "user_provided_qa_credentials",
                    sensitive: true,
                }],
        },
    });
    const publicJob = job_store_1.jobStore.get(job.id);
    const publicEntries = (publicJob?.params.runtimeEntriesByCase)["case-1"];
    strict_1.default.deepEqual(publicEntries, [{
            key: "auth.password",
            source: "user_provided_qa_credentials",
            sensitive: true,
            present: true,
        }]);
    strict_1.default.equal(JSON.stringify(publicJob).includes("transient-value"), false);
    const internalJob = job_store_1.jobStore.getInternal(job.id);
    strict_1.default.equal(JSON.stringify(internalJob?.params).includes("transient-value"), true);
    job_store_1.jobStore.clearTransientParams(job.id);
    strict_1.default.equal(Object.prototype.hasOwnProperty.call(internalJob?.params ?? {}, "runtimeEntriesByCase"), false);
});
