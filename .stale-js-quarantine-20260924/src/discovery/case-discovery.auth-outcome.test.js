"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_1 = require("./case-discovery");
function event(overrides) {
    return {
        method: "POST",
        resourceType: "fetch",
        path: "/redacted",
        state: "completed",
        ...overrides,
    };
}
(0, node_test_1.default)("classifies an authentication 5xx response before business actions", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: true,
        events: [event({ status: 504, statusCategory: "5xx" })],
        afterPath: "/redacted",
        loadingObserved: true,
        errorSurfaceObserved: true,
    });
    strict_1.default.equal(outcome.classification, "AUTH_INFRASTRUCTURE_FAILURE");
    strict_1.default.equal(outcome.authRequestObserved, true);
    strict_1.default.equal(outcome.authResponseObserved, true);
    strict_1.default.equal(outcome.authHttpStatus, 504);
    strict_1.default.equal(outcome.businessSurfaceReached, false);
});
(0, node_test_1.default)("classifies a pending authentication request as timeout with progress", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: true,
        events: [event({ state: "pending", status: undefined, statusCategory: undefined })],
        afterPath: "/redacted",
        loadingObserved: true,
        errorSurfaceObserved: false,
    });
    strict_1.default.equal(outcome.classification, "AUTH_TIMEOUT_WITH_PROGRESS");
    strict_1.default.equal(outcome.authRequestObserved, true);
    strict_1.default.equal(outcome.authResponseObserved, false);
});
(0, node_test_1.default)("recognizes the business surface after a successful authentication response", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: false,
        events: [event({ status: 200, statusCategory: "2xx", path: "/redacted" })],
        afterPath: "/redacted-business",
        loadingObserved: false,
        errorSurfaceObserved: false,
    });
    strict_1.default.equal(outcome.classification, "BUSINESS_SURFACE_REACHED");
    strict_1.default.equal(outcome.postLoginUrlClass, "business_surface");
    strict_1.default.equal(outcome.businessSurfaceReached, true);
});
(0, node_test_1.default)("preserves the auth submission 303 and accepts its successful business redirect", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: true,
        events: [
            event({
                path: "/auth-entry",
                status: 303,
                statusCategory: "3xx",
                redirectObserved: true,
                redirectChain: [{ status: 303 }, { status: 307, targetPath: "/business", followupPath: "/business", followupMethod: "GET", followupState: "completed", followupStatus: 200 }],
            }),
            event({ method: "GET", path: "/business", status: 200, statusCategory: "2xx" }),
        ],
        afterPath: "/business",
        loadingObserved: true,
        errorSurfaceObserved: false,
    });
    strict_1.default.equal(outcome.authSubmissionStatus, 303);
    strict_1.default.equal(outcome.authHttpStatus, 303);
    strict_1.default.deepEqual(outcome.redirectStatuses, [303, 307]);
    strict_1.default.equal(outcome.followupNavigationStatus, 200);
    strict_1.default.equal(outcome.businessSurfaceReached, true);
    strict_1.default.equal(outcome.classification, "BUSINESS_SURFACE_REACHED");
});
(0, node_test_1.default)("pending non-critical assets do not block an observed business surface", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: true,
        events: [
            event({ path: "/auth-entry", status: 303, statusCategory: "3xx" }),
            event({ method: "GET", resourceType: "document", path: "/business", status: 200, statusCategory: "2xx" }),
            event({ method: "GET", resourceType: "image", path: "/asset.svg", state: "pending", status: undefined }),
        ],
        afterPath: "/business",
        loadingObserved: true,
        errorSurfaceObserved: false,
        businessCandidateObserved: true,
        nextRecordedBusinessTargetVisible: true,
    });
    strict_1.default.equal(outcome.businessSurfaceReached, true);
    strict_1.default.equal(outcome.nextRecordedBusinessTargetVisible, true);
});
(0, node_test_1.default)("completed submission that remains on the auth surface is a navigation failure", () => {
    const outcome = (0, case_discovery_1.classifyAuthenticationOutcome)({
        beforeAuthDetected: true,
        afterAuthDetected: true,
        events: [event({ path: "/auth-entry", status: 303, statusCategory: "3xx" })],
        afterPath: "/auth-entry",
        loadingObserved: false,
        errorSurfaceObserved: false,
    });
    strict_1.default.equal(outcome.businessSurfaceReached, false);
    strict_1.default.equal(outcome.classification, "POST_AUTH_NAVIGATION_FAILURE");
});
(0, node_test_1.default)("a completed auth boundary cannot be reclassified by later business actions", () => {
    strict_1.default.equal((0, case_discovery_1.shouldClassifyAuthenticationBoundary)({
        authDetectedBeforeAction: true,
        authenticationBoundaryCompleted: true,
        relevantNetworkObserved: true,
        unstableSurface: false,
        authErrorSurfaceObserved: false,
    }), false);
});
