import type { Page } from "playwright";
import { waitForStableInteractiveScreen, type ScreenProgressProbe, type ScreenStabilityResult } from "../runner/execution-plan-executor";

/** Wait for the recorded destination and then for its own loading state to settle. */
export async function waitForRecordedPressTransition(
  page: Page,
  routeReached: () => boolean,
  progressProbe: () => ScreenProgressProbe,
): Promise<ScreenStabilityResult> {
  const navigation = await waitForStableInteractiveScreen(page, {
    completionProbe: async () => ({ completed: routeReached(), signal: "recorded_route" }),
    completionDeadline: "absolute",
    progressProbe,
    waitForPendingTransport: true,
  });
  if (!navigation.stable) return navigation;
  const settled = await waitForStableInteractiveScreen(page, { progressProbe, waitForPendingTransport: true });
  return {
    ...settled,
    waitedMs: navigation.waitedMs + settled.waitedMs,
    signals: [...new Set([...navigation.signals, ...settled.signals])],
    progressSignals: [...new Set([...navigation.progressSignals, ...settled.progressSignals])],
  };
}
