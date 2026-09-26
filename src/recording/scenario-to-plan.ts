import type {
  ExecutionPlan,
  ExecutionPlanStep,
  LocatorStrategy,
  PlanTarget,
  RequiredDataRef,
} from "../types/execution-plan.types";
import type { RecordedScenario, RecordedWebStep } from "./trace-to-scenario";

/**
 * Turns a recorded web walkthrough into an execution plan the framework can run.
 *
 * A recorded scenario already carries the same shape a plan does — an ordered list of actions
 * with a target and a description — so this is a translation, not a derivation: no step is
 * invented, dropped or reordered.
 *
 * The one place the two disagree on numbering: a plan's `index` starts at 1 (the validator
 * rejects 0), while the scenario's `requiredData` points at its own 0-based step positions.
 * The steps stay one-to-one, so a recorded index still identifies the same step here.
 *
 * What it does resolve are three mismatches between the recorder's vocabulary and the
 * executor's, each of which would otherwise fail at run time rather than here.
 */

/** Locator strategies the recorder emits, mapped to the ones the executor resolves. */
const STRATEGY_MAP: Record<string, LocatorStrategy> = {
  "data-testid": "testId",
  // `getByLabel` matches aria-label as well as a real <label>, which is what the recorder saw.
  "aria-label": "label",
  role: "role",
  css: "css",
  text: "text",
};

/**
 * Builds the target for one recorded step.
 *
 * The `role` strategy is the one that cannot pass through unchanged: the recorder packs the
 * role and the accessible name into a single string (`button|Continuar`) because a recorded
 * locator is one value, while `getByRole` needs them apart.
 */
function toPlanTarget(target: { strategy: string; value: string } | undefined): PlanTarget | undefined {
  if (!target) return undefined;
  const strategy = STRATEGY_MAP[target.strategy];
  if (!strategy) return undefined;

  if (strategy === "role") {
    const [role, ...rest] = target.value.split("|");
    const name = rest.join("|").trim();
    if (!role.trim() || !name) return undefined;
    return { strategy: "role", role: role.trim(), name };
  }

  return { strategy, value: target.value };
}

/**
 * The part of a URL worth asserting.
 *
 * Asserting the whole URL back would fail on anything the app appends — a session id, a
 * redirect token — so the path is what carries the meaning of "the flow landed here". The
 * executor matches it as an unanchored expression, so a longer URL containing this path
 * still passes.
 */
function urlAssertion(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname || rawUrl;
  } catch {
    return rawUrl;
  }
}

export type RecordedPlanBuild = {
  plan: ExecutionPlan;
  /**
   * The literals the walkthrough actually typed, keyed by the same key the steps reference.
   *
   * They are handed to the data context as SUGGESTED values rather than written into the
   * steps: a value the reviewer typed into the panel has to be able to win over the one the
   * recording happened to use, and `resolveStepValue` gives an inline `value` absolute
   * priority. Sensitive fields contribute nothing here — their value was never stored.
   */
  suggestedData: Record<string, string>;
};

export type ToExecutionPlanOptions = {
  /** The app's base URL, to tell the opening navigation from one the flow produced. */
  baseUrl?: string;
};

/**
 * Converts one recorded scenario into a runnable plan.
 *
 * The plan is born `draft` on purpose. `promoteExecutionPlan` only accepts `validated`, and
 * that contract is the point: in this framework a plan earns its spec by running, not by
 * being written. The caller flips the status after a successful execution.
 */
export function toExecutionPlan(
  scenario: RecordedScenario,
  options: ToExecutionPlanOptions = {},
): RecordedPlanBuild {
  const steps: ExecutionPlanStep[] = [];
  const suggestedData: Record<string, string> = {};
  const dataByStep = new Map(scenario.requiredData.map((field) => [field.stepIndex, field]));
  let openingNavigationUsed = false;

  scenario.webSteps.forEach((recorded: RecordedWebStep, index) => {
    const description = recorded.description;
    const target = toPlanTarget(recorded.target);

    if (recorded.action === "navigate") {
      const url = recorded.value ?? "";
      const isOpening = !openingNavigationUsed && (!options.baseUrl || url === options.baseUrl);
      if (isOpening) {
        openingNavigationUsed = true;
        steps.push({ index: steps.length + 1, action: "navigate", target: "APP_BASE_URL", description });
        return;
      }
      // Every later navigation is something the app did in response to a click — the web
      // recorder emits them from `framenavigated`, not from an action the person took. As a
      // step it would re-navigate and skip the flow; as an assertion it proves the click
      // landed where the recording says it landed.
      steps.push({
        index: steps.length + 1,
        action: "assertUrl",
        expected: urlAssertion(url),
        description: `Verificar que la URL corresponde a ${urlAssertion(url)}`,
      });
      return;
    }

    if (recorded.action === "fill") {
      const field = dataByStep.get(index);
      const key = field?.key ?? `campo_${index}`;
      if (field && !field.sensitive && recorded.value) {
        suggestedData[key] = recorded.value;
      }
      steps.push({ index: steps.length + 1, action: "fill", target, valueKey: key, description });
      return;
    }

    if (recorded.action === "assert") {
      steps.push({ index: steps.length + 1, action: "assertVisible", target, description });
      return;
    }

    if (recorded.action === "wait") {
      steps.push({ index: steps.length + 1, action: "waitFor", target, description });
      return;
    }

    steps.push({ index: steps.length + 1, action: "click", target, description });
  });

  const requiredData: RequiredDataRef[] = scenario.requiredData.map((field) => ({
    key: field.key,
    required: true,
    // A sensitive field was never stored, so nothing resolves it until someone supplies it.
    resolved: !field.sensitive && Boolean(field.exampleValue),
    sensitive: field.sensitive,
    source: field.sensitive ? "reviewer_input" : "recording",
  }));

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "manual",
    status: "draft",
    scenario: {
      source: "manual",
      externalId: scenario.scenarioId,
      caseId: scenario.testRailCaseId,
      title: scenario.title,
    },
    requiredData,
    steps,
    notes: [`Plan derivado de la grabación ${scenario.sourceRecordingId}.`],
    createdAt: new Date().toISOString(),
  };

  return { plan, suggestedData };
}
