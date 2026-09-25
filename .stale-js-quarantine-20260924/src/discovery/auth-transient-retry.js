"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAuthTransientRetryMax = resolveAuthTransientRetryMax;
exports.isAuthTransientNoResponse = isAuthTransientNoResponse;
function resolveAuthTransientRetryMax(rawValue) {
    const parsed = Number(rawValue ?? "1");
    if (!Number.isFinite(parsed))
        return 1;
    return Math.min(1, Math.max(0, Math.floor(parsed)));
}
function isAuthTransientNoResponse(input) {
    const pendingRequest = input.events.some((event) => event.state === "pending");
    return input.submitClicked
        && input.requestObserved
        && !input.responseObserved
        && !input.requestFailed
        && pendingRequest
        && input.authSurfacePresent
        && !input.protectedSurfaceDetected
        && !input.terminalErrorVisible
        && input.absoluteDeadlineReached;
}
