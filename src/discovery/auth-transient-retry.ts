export type AuthTransientNetworkEvent = {
  state: "completed" | "pending" | "failed";
  status?: number;
};

export type AuthTransientRetryInput = {
  submitClicked: boolean;
  requestObserved: boolean;
  responseObserved: boolean;
  requestFailed: boolean;
  authSurfacePresent: boolean;
  protectedSurfaceDetected: boolean;
  terminalErrorVisible: boolean;
  absoluteDeadlineReached: boolean;
  events: AuthTransientNetworkEvent[];
};

export function resolveAuthTransientRetryMax(rawValue: string | undefined): number {
  const parsed = Number(rawValue ?? "1");
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(1, Math.max(0, Math.floor(parsed)));
}

export function isAuthTransientNoResponse(input: AuthTransientRetryInput): boolean {
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
