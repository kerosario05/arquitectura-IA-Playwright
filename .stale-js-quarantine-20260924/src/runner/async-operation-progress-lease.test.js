"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const async_operation_progress_lease_1 = require("./async-operation-progress-lease");
(0, node_test_1.default)("meaningful progress renews only the idle deadline", () => {
    const lease = new async_operation_progress_lease_1.AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 120000 });
    lease.recordMeaningfulProgress(9000);
    const snapshot = lease.snapshot();
    strict_1.default.equal(snapshot.lastMeaningfulProgressAt, 9000);
    strict_1.default.equal(snapshot.idleDeadline, 17000);
    strict_1.default.equal(snapshot.hardSafetyDeadline, 121000);
});
(0, node_test_1.default)("hard safety deadline is never renewed by late progress", () => {
    const lease = new async_operation_progress_lease_1.AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 120000 });
    const hardDeadline = lease.hardSafetyDeadline;
    lease.recordMeaningfulProgress(120000);
    lease.renewIdleDeadline(8000, 120500);
    strict_1.default.equal(lease.hardSafetyDeadline, hardDeadline);
    strict_1.default.equal(lease.idleDeadline, 121000);
});
(0, node_test_1.default)("idle deadline is capped by the hard safety deadline", () => {
    const lease = new async_operation_progress_lease_1.AsyncOperationProgressLease({ startedAt: 1000, idleWindowMs: 8000, hardSafetyCapMs: 10000 });
    lease.recordMeaningfulProgress(9000);
    strict_1.default.equal(lease.idleDeadline, 11000);
    strict_1.default.equal(lease.hardSafetyDeadline, 11000);
});
