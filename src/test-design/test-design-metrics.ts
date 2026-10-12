import type { TestDesignEvent } from "../db/test-design-event-repository";
import { testRailCaseUrl } from "./jira-subtask-formatter";
import type { TestDesignScenarioType } from "./test-design.types";

/**
 * Dashboard summary of the test design module, computed from `TestDesignEvent`.
 *
 * "New" cases are the ones created in TestRail (a deleted case created again
 * counts as new); "updated" are republished existing cases. AI contribution is
 * measured on new cases: AI as generated, AI adjusted by a person, or written by
 * hand. Pure: the caller loads the events and decides the scope.
 */

export type MetricsRange = { from: Date; to: Date };

export type TestDesignMetrics = {
  period: { from: string; to: string; days: number };
  usage: { drafts: number; storiesCovered: number; people: number; projects: number };
  testRail: {
    casesNew: number;
    casesUpdated: number;
    casesFailed: number;
    /** New cases in the previous period of the same length, for the trend. */
    previousCasesNew: number;
    weekly: Array<{ weekStart: string; casesNew: number; casesUpdated: number }>;
  };
  ai: {
    unchanged: number;
    edited: number;
    manual: number;
    generated: number;
    /** AI scenarios replaced by a regeneration or deleted before reaching TestRail. */
    discarded: number;
  };
  types: Record<TestDesignScenarioType, number>;
  data: { complete: number; pending: number };
  byProject: Array<{ projectSlug: string; projectName: string; casesNew: number; stories: number; aiShare: number }>;
  byPerson: Array<{ name: string; casesNew: number; drafts: number }>;
  recent: Array<{
    caseId: number;
    caseUrl: string | null;
    title: string;
    issueKey: string | null;
    projectSlug: string | null;
    projectName: string | null;
    origin: "ai" | "manual";
    edited: boolean;
    publishedAt: string;
  }>;
};

export type MetricsOptions = {
  /** null = every project (allProjects users); otherwise only these slugs (lowercase). */
  projectSlugs: ReadonlySet<string> | null;
  projectNames?: ReadonlyMap<string, string>;
  testRailBaseUrl?: string | null;
  recentLimit?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function metricsRanges(days: number, now = new Date()): { current: MetricsRange; previous: MetricsRange } {
  const to = now;
  const from = new Date(to.getTime() - days * DAY_MS);
  return { current: { from, to }, previous: { from: new Date(from.getTime() - days * DAY_MS), to: from } };
}

function inScope(event: TestDesignEvent, scope: ReadonlySet<string> | null): boolean {
  if (event.eventType === "backfill_done") return false;
  if (scope === null) return true;
  return Boolean(event.projectSlug && scope.has(event.projectSlug.toLowerCase()));
}

function inRange(event: TestDesignEvent, range: MetricsRange): boolean {
  const at = new Date(event.occurredAt).getTime();
  return at >= range.from.getTime() && at < range.to.getTime();
}

function newCasesOf(event: TestDesignEvent) {
  return event.eventType === "published_testrail"
    ? event.details.cases.filter((c) => c.status === "created" || c.status === "recreated")
    : [];
}

export function computeTestDesignMetrics(
  events: TestDesignEvent[],
  ranges: { current: MetricsRange; previous: MetricsRange },
  options: MetricsOptions,
): TestDesignMetrics {
  const scoped = events.filter((e) => inScope(e, options.projectSlugs));
  const current = scoped.filter((e) => inRange(e, ranges.current));
  const previous = scoped.filter((e) => inRange(e, ranges.previous));
  const nameOf = (slug: string | null) => (slug ? options.projectNames?.get(slug.toLowerCase()) ?? slug : null);
  const days = Math.round((ranges.current.to.getTime() - ranges.current.from.getTime()) / DAY_MS);

  const weeks: TestDesignMetrics["testRail"]["weekly"] = [];
  for (let start = ranges.current.from.getTime(); start < ranges.current.to.getTime(); start += 7 * DAY_MS) {
    weeks.push({ weekStart: new Date(start).toISOString(), casesNew: 0, casesUpdated: 0 });
  }
  const weekOf = (iso: string) =>
    Math.min(weeks.length - 1, Math.floor((new Date(iso).getTime() - ranges.current.from.getTime()) / (7 * DAY_MS)));

  const metrics: TestDesignMetrics = {
    period: { from: ranges.current.from.toISOString(), to: ranges.current.to.toISOString(), days },
    usage: { drafts: 0, storiesCovered: 0, people: 0, projects: 0 },
    testRail: {
      casesNew: 0,
      casesUpdated: 0,
      casesFailed: 0,
      previousCasesNew: previous.reduce((sum, e) => sum + newCasesOf(e).length, 0),
      weekly: weeks,
    },
    ai: { unchanged: 0, edited: 0, manual: 0, generated: 0, discarded: 0 },
    types: { functional: 0, negative: 0, edge: 0, regression: 0, other: 0 },
    data: { complete: 0, pending: 0 },
    byProject: [],
    byPerson: [],
    recent: [],
  };

  const people = new Set<string>();
  const projects = new Set<string>();
  const stories = new Set<string>();
  const projectStats = new Map<string, { casesNew: number; ai: number; stories: Set<string> }>();
  const personStats = new Map<string, { casesNew: number; drafts: number }>();
  const recent: TestDesignMetrics["recent"] = [];
  const person = (e: TestDesignEvent) => {
    const name = e.userName ?? "—";
    const stats = personStats.get(name) ?? { casesNew: 0, drafts: 0 };
    personStats.set(name, stats);
    return stats;
  };
  const project = (slug: string) => {
    const key = slug.toLowerCase();
    const stats = projectStats.get(key) ?? { casesNew: 0, ai: 0, stories: new Set<string>() };
    projectStats.set(key, stats);
    return stats;
  };

  for (const e of current) {
    if (e.userName) people.add(e.userName);
    if (e.projectSlug) projects.add(e.projectSlug.toLowerCase());

    switch (e.eventType) {
      case "draft_created":
        metrics.usage.drafts += 1;
        person(e).drafts += 1;
        break;
      case "generation_completed":
        metrics.ai.generated += e.details.generated;
        metrics.ai.discarded += e.details.replaced;
        break;
      case "scenario_removed":
        metrics.ai.discarded += e.details.removed.filter((r) => r.origin === "ai").length;
        break;
      case "published_testrail": {
        metrics.testRail.casesFailed += e.details.failed;
        for (const c of e.details.cases) {
          if (c.status === "updated") {
            metrics.testRail.casesUpdated += 1;
            weeks[weekOf(e.occurredAt)].casesUpdated += 1;
            continue;
          }
          metrics.testRail.casesNew += 1;
          weeks[weekOf(e.occurredAt)].casesNew += 1;
          if (c.origin === "manual") metrics.ai.manual += 1;
          else if (c.edited) metrics.ai.edited += 1;
          else metrics.ai.unchanged += 1;
          metrics.types[c.type] = (metrics.types[c.type] ?? 0) + 1;
          if (c.dataMissing > 0) metrics.data.pending += 1;
          else metrics.data.complete += 1;
          person(e).casesNew += 1;
          if (e.issueKey) stories.add(e.issueKey);
          if (e.projectSlug) {
            const stats = project(e.projectSlug);
            stats.casesNew += 1;
            if (c.origin === "ai") stats.ai += 1;
            if (e.issueKey) stats.stories.add(e.issueKey);
          }
          recent.push({
            caseId: c.caseId,
            caseUrl: options.testRailBaseUrl ? testRailCaseUrl(options.testRailBaseUrl, c.caseId) : null,
            title: c.title,
            issueKey: e.issueKey,
            projectSlug: e.projectSlug,
            projectName: nameOf(e.projectSlug),
            origin: c.origin,
            edited: c.edited,
            publishedAt: e.occurredAt,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  metrics.usage.people = people.size;
  metrics.usage.projects = projects.size;
  metrics.usage.storiesCovered = stories.size;
  metrics.byProject = [...projectStats.entries()]
    .map(([slug, s]) => ({
      projectSlug: slug,
      projectName: nameOf(slug) ?? slug,
      casesNew: s.casesNew,
      stories: s.stories.size,
      aiShare: s.casesNew > 0 ? s.ai / s.casesNew : 0,
    }))
    .sort((a, b) => b.casesNew - a.casesNew);
  metrics.byPerson = [...personStats.entries()]
    .map(([name, s]) => ({ name, ...s }))
    .filter((p) => p.casesNew > 0 || p.drafts > 0)
    .sort((a, b) => b.casesNew - a.casesNew || b.drafts - a.drafts);
  metrics.recent = recent
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, options.recentLimit ?? 8);
  return metrics;
}
