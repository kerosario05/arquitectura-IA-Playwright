import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import { materializeObservedPrimaryScenario, type RecordedScenario } from "./trace-to-scenario";
import { buildObservedScenarioTitle } from "./observed-scenario-title";

/**
 * One recording often walks several cases from a common hub: open the catalog, look at cards,
 * go back, look at accounts, go back, look at loans (recording 73f03712). The observed primary
 * replays all of it as one case; these are the cases themselves, one per branch.
 *
 * A branch ends where the walkthrough RETURNS to a page it had already visited -- detected by the
 * navigation reaching an earlier route of the current path, never by the label of the button
 * that did it (the kiosk back arrow is an unnamed icon). Each branch keeps the path that led to
 * the hub plus its own choices; the returns, and a closing logout, are left out.
 *
 * Scenarios are built on the FULL event list with the other branches' events replaced by inert
 * placeholders, so every `event-N`/`interaction-N` keeps the index it has in the recording and in
 * its semantic model -- lineage, hydration and route ownership all rely on those positions.
 */

const ACTION_KINDS = new Set<RecordedEvent["kind"]>(["tap", "fill", "press"]);

type ActionBlock = { actionIndex: number; start: number; end: number };

export type SubFlowBranch = {
  /** Indices (in the full event list) of the actions this branch replays. */
  actionIndices: number[];
  /** Every event index the branch keeps: the leading block plus its actions' blocks. */
  keptIndices: number[];
};

export function detectSubFlowBranches(events: readonly RecordedEvent[]): SubFlowBranch[] {
  const actionIndices = events.flatMap((event, index) => (ACTION_KINDS.has(event.kind) ? [index] : []));
  if (actionIndices.length < 2) return [];
  const blocks = actionBlocks(events, actionIndices);
  const leading = range(0, blocks[0].start - 1);

  const initialUrl = [...leading].reverse().map((index) => events[index]).find((event) => event.kind === "navigate" && event.url)?.url
    ?? events[blocks[0].actionIndex].url;
  if (!initialUrl) return [];

  const stack: string[] = [routeIdentity(initialUrl)];
  let kept: Array<{ block: ActionBlock; depth: number }> = [];
  let dirty = false;
  const branches: Array<Array<{ block: ActionBlock; depth: number }>> = [];

  for (const block of blocks) {
    const depth = stack.length - 1;
    let returnedTo: number | undefined;
    for (let index = block.start; index <= block.end; index += 1) {
      const event = events[index];
      if (event.kind !== "navigate" || !event.url) continue;
      const route = routeIdentity(event.url);
      if (route === stack[stack.length - 1]) continue;
      const earlier = stack.lastIndexOf(route);
      if (earlier >= 0) {
        returnedTo = earlier;
        stack.length = earlier + 1;
      } else {
        stack.push(route);
      }
    }
    if (returnedTo === undefined) {
      kept.push({ block, depth });
      dirty = true;
      continue;
    }
    // This action went back to a page of the current path: the branch walked so far ends here,
    // without the return itself. What led up to the page returned to stays for the next branch.
    if (dirty) branches.push([...kept]);
    kept = kept.filter((entry) => entry.depth < returnedTo!);
    dirty = false;
  }
  if (dirty) branches.push(kept);

  // A walkthrough that repeats a path, or that opens a page and comes straight back, yields a
  // branch that is the same case as, or only the start of, another one: not a case of its own.
  const signatures = branches.map((branch) => branch.map((entry) => actionSignature(events[entry.block.actionIndex])));
  const distinct = branches.filter((_, index) => {
    const own = signatures[index];
    return !signatures.some((other, otherIndex) => otherIndex !== index && (
      (other.length > own.length && own.every((part, position) => other[position] === part))
      || (other.length === own.length && otherIndex < index && own.every((part, position) => other[position] === part))
    ));
  });
  if (distinct.length < 2) return [];

  return distinct.map((branch) => ({
    actionIndices: branch.map((entry) => entry.block.actionIndex),
    keptIndices: [...leading, ...branch.flatMap((entry) => range(entry.block.start, entry.block.end))],
  }));
}

/**
 * The branch scenarios of a recording, each materialized with the same evidence gate as the
 * observed primary (a branch the recording cannot back is dropped, never half-built).
 */
export function buildSubFlowScenarios(
  trace: SessionTrace,
  events: readonly RecordedEvent[],
  primaryScenarioId: string,
): RecordedScenario[] {
  const branches = detectSubFlowBranches(events);
  const scenarios: RecordedScenario[] = [];
  branches.forEach((branch, branchIndex) => {
    const keep = new Set(branch.keptIndices);
    const masked = events.map((event, index) => (keep.has(index) ? event : inertPlaceholder(event)));
    // A branch with no readable screen or choice would only borrow the typed goal as its name:
    // there is no case to tell apart from the others.
    if (!buildObservedScenarioTitle(trace, masked)) return;
    const scenario = materializeObservedPrimaryScenario(trace, masked);
    if (!scenario) return;
    scenarios.push({
      ...scenario,
      scenarioId: `${primaryScenarioId}-FLOW-${branchIndex + 1}`,
      primary: false,
      scope: "sub_flow",
      description: `Sub-flujo ${branchIndex + 1} de ${branches.length} observado en la grabación: `
        + "el camino hasta la pantalla común más sus propias opciones, sin los regresos.",
      sourceEventRefs: branch.keptIndices.map((index) => `event-${index + 1}`),
    });
  });
  return scenarios;
}

/** Each action owns its pointer note just before it and everything up to the next action's block. */
function actionBlocks(events: readonly RecordedEvent[], actionIndices: readonly number[]): ActionBlock[] {
  const starts = actionIndices.map((actionIndex, position) => {
    const floor = position === 0 ? 0 : actionIndices[position - 1] + 1;
    for (let cursor = actionIndex - 1; cursor >= floor; cursor -= 1) {
      const candidate = events[cursor];
      if (candidate.kind === "note" && candidate.observationType === "pointer") return cursor;
      if (candidate.kind === "navigate") break;
    }
    return actionIndex;
  });
  return actionIndices.map((actionIndex, position) => ({
    actionIndex,
    start: starts[position],
    end: position + 1 < starts.length ? starts[position + 1] - 1 : events.length - 1,
  }));
}

/** What an action did, independent of when: its control and the page it was done on. */
function actionSignature(event: RecordedEvent): string {
  return `${event.kind}|${event.target?.label?.trim() ?? ""}|${event.url ? routeIdentity(event.url) : ""}`;
}

function inertPlaceholder(event: RecordedEvent): RecordedEvent {
  return {
    seq: event.seq,
    t: event.t,
    kind: "note",
    screenKey: event.screenKey,
    observationType: "sub_flow_excluded",
  } as unknown as RecordedEvent;
}

function routeIdentity(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "http://recording.local");
    return `${url.pathname || "/"}${url.search}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

function range(from: number, to: number): number[] {
  return to < from ? [] : Array.from({ length: to - from + 1 }, (_, offset) => from + offset);
}
