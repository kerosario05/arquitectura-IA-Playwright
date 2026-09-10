import type { Job } from "./job-store";
import type { MobileRouteLearningParams } from "./mobile-route-learning-runner";
import type { MobileStep } from "../../mobile/mobile-step-types";

/**
 * Auto-starting the route-learning walk when a launch is rejected for lacking route evidence.
 *
 * A launch answers `requires_route_learning` when the generated scenarios touch screens no run
 * has ever observed. That answer is correct — publishing them would put invented locators into
 * TestRail — but on its own it is a dead end: somebody has to go and fire `/route-learning` by
 * hand, so every new story stalls until a human notices. Starting the walk from here closes the
 * loop, and since the knowledge now accumulates, the cost is paid once per area of the app
 * instead of once per story.
 */

/** Job types that drive the emulator; two of them at once fight over the Appium session. */
const DEVICE_JOB_TYPES = new Set<Job["type"]>([
  "mobile-test-run",
  "mobile-launch-execution",
  "mobile-route-learning",
  "mobile-emulator-boot",
]);

const ACTIVE_JOB_STATUSES = new Set(["queued", "running"]);

/** How many labels are taken from the scenarios to steer the walk. */
const MAX_PREFER_LABELS = 4;

export function findDeviceBusyJob(jobs: Job[]): Job | null {
  return jobs.find((j) => DEVICE_JOB_TYPES.has(j.type) && ACTIVE_JOB_STATUSES.has(j.status)) ?? null;
}

/**
 * A route-learning walk currently holding the emulator.
 *
 * Auto-starting the walk made this collision reachable: the walk takes the Appium session lock,
 * and an execution launched while it runs fails deep inside session creation as
 * `mobile_session_state_unknown` — a message that says nothing about the real cause. Callers use
 * this to refuse early, naming the walk and its job id instead.
 */
export function findActiveRouteLearningJob(jobs: Job[]): Job | null {
  return jobs.find((j) => j.type === "mobile-route-learning" && ACTIVE_JOB_STATUSES.has(j.status)) ?? null;
}

/** How long a completed walk suppresses another one for the same app and flow. */
export const ROUTE_LEARNING_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * A walk for this same app and flow that already finished recently.
 *
 * Auto-starting on every launch created a loop the user experiences as "something is always
 * running": the launch starts a walk, the walk holds the emulator, the execution that follows is
 * refused, and retrying the launch starts yet another walk. Two identical walks for AA-96 ran
 * minutes apart and both ended the same way, learning nothing new. A walk that just covered this
 * flow has no more to say until something changes, so the next launch should proceed instead.
 */
export function findRecentRouteLearningJob(
  jobs: Job[],
  appSlug: string,
  flowId: string | undefined,
  now: number,
  withinMs: number = ROUTE_LEARNING_COOLDOWN_MS,
): Job | null {
  return (
    jobs.find((j) => {
      if (j.type !== "mobile-route-learning") return false;
      if (ACTIVE_JOB_STATUSES.has(j.status)) return false;
      if ((j.params?.appSlug as string) !== appSlug) return false;
      // A walk for a different story explored a different branch; it does not cover this one.
      if (flowId && (j.params?.flowId as string) !== flowId) return false;
      const finishedAt = Date.parse(j.completedAt ?? j.createdAt ?? "");
      return Number.isFinite(finishedAt) && now - finishedAt <= withinMs;
    }) ?? null
  );
}

export type RouteLearningCandidate = {
  scenarioId: string;
  sourceIssueKey?: string;
  title?: string;
  steps?: MobileStep[];
};

/**
 * Labels that steer the walk down the branch the story cares about.
 *
 * Taken from the scenarios' own opening clicks rather than invented: those targets are what the
 * generator derived from the story, so they point at the entry path it expects. Without steering
 * the learner wanders the app and may never reach the screens the story needs.
 */
/** UiSelector methods whose argument is human-readable text; resourceId/className are not. */
const UI_SELECTOR_TEXT_METHOD = /\b(?:description|descriptionContains|descriptionStartsWith|descriptionMatches|text|textContains|textStartsWith|textMatches)\s*\(\s*"((?:[^"\\]|\\.)*)"/;
/** XPath predicates that carry a visible label. */
const XPATH_LABEL = /@(?:content-desc|text)\s*=\s*'([^']+)'|@(?:content-desc|text)\s*=\s*"([^"]+)"|text\(\)\s*=\s*'([^']+)'/;

/**
 * Pulls the human-readable label out of a step target, whatever strategy it uses.
 *
 * The first attempt only accepted plain values, so a target like
 * `descriptionContains("Crea tu cuenta en minutos")` was discarded whole — and with it the only
 * label that actually identifies the entry into the flow. The walk was then steered by
 * "Continuar" alone, which is too generic to move it anywhere, and it stopped on `loop_detected`
 * three screens in. The label is inside the expression; reading it is what makes the hint useful.
 */
export function extractSteeringLabel(target?: { strategy?: string; value?: string }): string | null {
  const value = target?.value?.trim();
  if (!value) return null;
  switch (target?.strategy) {
    case "accessibilityId":
      return value;
    case "androidUiAutomator": {
      const m = UI_SELECTOR_TEXT_METHOD.exec(value);
      // resourceId("…")/className("…") carry no label, so an expression without a text method
      // yields nothing rather than a technical string the learner cannot match against.
      return m?.[1]?.replace(/\\(.)/g, "$1").trim() || null;
    }
    case "xpath": {
      const m = XPATH_LABEL.exec(value);
      return (m?.[1] ?? m?.[2] ?? m?.[3])?.trim() || null;
    }
    default:
      // className / id are technical identities, never labels.
      return null;
  }
}

export function derivePreferLabels(scenarios: RouteLearningCandidate[]): string[] {
  const labels: string[] = [];
  for (const scenario of scenarios) {
    for (const step of (scenario.steps ?? []).slice(0, 4)) {
      if (step.action !== "click") continue;
      const label = extractSteeringLabel(step.target);
      if (!label) continue;
      // Scenario order is entry-path order, so the first click stays the first hint.
      const normalized = label.toLowerCase();
      if (!labels.includes(normalized)) labels.push(normalized);
      if (labels.length >= MAX_PREFER_LABELS) return labels;
    }
  }
  return labels;
}

export type AutostartDecision = {
  start: boolean;
  reason: string;
  params?: MobileRouteLearningParams;
};

export function planRouteLearningAutostart(input: {
  appSlug?: string;
  routeLearningScenarios: RouteLearningCandidate[];
  hasApp: boolean;
  autoEnabled: boolean;
  busyJob: Job | null;
  /** Story key used as the walk flowId; also what the profile records. */
  flowId?: string;
  /** A completed walk for the same app and flow inside the cooldown, if any. */
  recentWalk?: Job | null;
  /** True when the app profile already records a flow for this story — survives restarts. */
  flowAlreadyLearned?: boolean;
  base?: { apkPath?: string; appPackage?: string; appActivity?: string; avdName?: string; headless?: boolean };
}): AutostartDecision {
  if (input.routeLearningScenarios.length === 0) {
    return { start: false, reason: "no_scenarios_require_learning" };
  }
  if (!input.autoEnabled) {
    return { start: false, reason: "disabled_by_request" };
  }
  const appSlug = input.appSlug?.trim();
  if (!appSlug) {
    // appSlug is what ties the walk's observations to an app profile; without it nothing is learned.
    return { start: false, reason: "missing_app_slug" };
  }
  if (!input.hasApp) {
    return { start: false, reason: "no_resolvable_app" };
  }
  if (input.busyJob) {
    // Deferred rather than queued: the walk drives the emulator, and starting a second session
    // while a run holds one turns a missing route into a flaky run.
    return { start: false, reason: `device_busy;jobId=${input.busyJob.id};type=${input.busyJob.type}` };
  }
  if (input.flowAlreadyLearned) {
    // The durable half of the cooldown. Job history lives only in memory, so a server restart
    // erased it and the next launch walked the same flow all over again — the loop survived the
    // very fix meant to stop it. The walk records what it covered in the app profile's `flows`,
    // and that record outlives the process.
    return { start: false, reason: `flow_already_learned;flowId=${input.flowId ?? "-"}` };
  }
  if (input.recentWalk) {
    // Letting the launch through is the point: repeating the walk only re-blocks the execution.
    return { start: false, reason: `recent_walk;jobId=${input.recentWalk.id}` };
  }

  const issueKey = input.flowId ?? input.routeLearningScenarios.find((s) => s.sourceIssueKey)?.sourceIssueKey;
  const preferLabels = derivePreferLabels(input.routeLearningScenarios);

  return {
    start: true,
    reason: `auto;scenarios=${input.routeLearningScenarios.length}`,
    params: {
      appSlug,
      ...(input.base?.apkPath ? { apkPath: input.base.apkPath } : {}),
      ...(input.base?.appPackage ? { appPackage: input.base.appPackage } : {}),
      ...(input.base?.appActivity ? { appActivity: input.base.appActivity } : {}),
      ...(input.base?.avdName ? { avdName: input.base.avdName } : {}),
      ...(input.base?.headless !== undefined ? { headless: input.base.headless } : {}),
      ...(issueKey ? { flowId: issueKey, triggerKeywords: [issueKey.toLowerCase()] } : {}),
      ...(preferLabels.length > 0 ? { preferLabels } : {}),
      // The walk observes; it must never press a control that commits the flow.
      stopBeforeSubmit: true,
    },
  };
}

/**
 * Whether the app profile already records a walk for this story.
 *
 * The walk writes what it covered into `mobile.config.json` under `flows`, keyed by the story.
 * Reading it back is what makes the cooldown survive a server restart, which the in-memory job
 * history could not.
 */
export function isFlowAlreadyLearned(
  profile: { flows?: Record<string, unknown> } | null | undefined,
  flowId: string | undefined,
): boolean {
  if (!flowId || !profile?.flows) return false;
  const wanted = flowId.trim().toLowerCase();
  return Object.keys(profile.flows).some((k) => k.trim().toLowerCase() === wanted);
}
