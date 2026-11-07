import type { TestDesignDraftWithStories } from "./test-design.types";

/**
 * Dashboard metrics for the cases authored in Test Design: how many were designed,
 * how many reached TestRail, and how those TestRail cases did when executed.
 *
 * A design case is linked to its executions through its TestRail case id, the
 * same id every launch manifest records. Pure: the route supplies the drafts the
 * caller may see and the per-case execution results.
 */

export type DesignCaseExecution = {
  caseId: number;
  result: "passed" | "failed";
  launchId: string;
  executedAt: string;
};

export type TestDesignExecutionMetrics = {
  period: { days: number; from: string; to: string };
  funnel: {
    /** Scenarios in active (non-archived) drafts. */
    designed: number;
    /** Design cases that exist in TestRail. */
    published: number;
    /** Published cases with at least one result in the period. */
    executed: number;
    /** Executed cases whose latest result in the period passed. */
    passed: number;
    failed: number;
    notExecuted: number;
  };
  /** passed / executed, or null when nothing ran in the period. */
  passRate: number | null;
  /** Individual executions in the period (a case run twice counts twice). */
  executions: number;
  weekly: Array<{ weekStart: string; passed: number; failed: number }>;
  byProject: Array<{
    projectSlug: string;
    projectName: string;
    published: number;
    executed: number;
    passed: number;
    failed: number;
  }>;
  recent: Array<{
    caseId: number;
    title: string;
    issueKey: string;
    projectSlug: string | null;
    projectName: string | null;
    result: "passed" | "failed";
    executedAt: string;
    launchId: string;
    caseUrl: string | null;
  }>;
};

type DesignCase = {
  caseId: number;
  title: string;
  issueKey: string;
  projectSlug: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 8;

export function executionMetricsRange(days: number, now = new Date()): { days: number; from: Date; to: Date } {
  return { days, from: new Date(now.getTime() - days * DAY_MS), to: now };
}

export function computeTestDesignExecutionMetrics(
  drafts: TestDesignDraftWithStories[],
  executions: DesignCaseExecution[],
  range: { days: number; from: Date; to: Date },
  options: { projectNames?: ReadonlyMap<string, string>; testRailBaseUrl?: string | null } = {},
): TestDesignExecutionMetrics {
  const projectName = (slug: string | null) => (slug ? options.projectNames?.get(slug.toLowerCase()) ?? slug : null);

  let designed = 0;
  // Keyed by case id: the same TestRail case can appear in two drafts (copied or
  // republished); it is one case, and the most recently updated draft names it.
  const cases = new Map<number, DesignCase & { updatedAt: string }>();
  for (const draft of drafts) {
    for (const story of draft.stories) {
      for (const scenario of story.scenarios) {
        if (draft.status !== "archived") designed += 1;
        const caseId = scenario.testRailCaseId;
        if (typeof caseId !== "number" || caseId <= 0) continue;
        const existing = cases.get(caseId);
        if (existing && existing.updatedAt >= story.updatedAt) continue;
        cases.set(caseId, {
          caseId,
          title: scenario.title,
          issueKey: story.issueKey,
          projectSlug: draft.projectSlug,
          updatedAt: story.updatedAt,
        });
      }
    }
  }

  const from = range.from.getTime();
  const to = range.to.getTime();
  const inPeriod = executions
    .filter((e) => cases.has(e.caseId))
    .filter((e) => {
      const at = Date.parse(e.executedAt);
      return Number.isFinite(at) && at >= from && at <= to;
    })
    .sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));

  const latest = new Map<number, DesignCaseExecution>();
  for (const e of inPeriod) latest.set(e.caseId, e);

  let passed = 0;
  let failed = 0;
  for (const e of latest.values()) {
    if (e.result === "passed") passed += 1;
    else failed += 1;
  }
  const executed = latest.size;

  const weekCount = Math.max(1, Math.ceil(range.days / 7));
  const weekly = Array.from({ length: weekCount }, (_, i) => ({
    // The oldest bucket can reach before the period when days is not a multiple of 7.
    weekStart: new Date(Math.max(from, to - (weekCount - i) * 7 * DAY_MS)).toISOString(),
    passed: 0,
    failed: 0,
  }));
  for (const e of inPeriod) {
    const weeksAgo = Math.floor((to - Date.parse(e.executedAt)) / (7 * DAY_MS));
    const bucket = weekly[weekCount - 1 - Math.min(weeksAgo, weekCount - 1)];
    if (e.result === "passed") bucket.passed += 1;
    else bucket.failed += 1;
  }

  const projects = new Map<string, TestDesignExecutionMetrics["byProject"][number]>();
  for (const c of cases.values()) {
    const slug = c.projectSlug ?? "";
    const row = projects.get(slug.toLowerCase()) ?? {
      projectSlug: slug,
      projectName: projectName(c.projectSlug) ?? "Sin proyecto",
      published: 0,
      executed: 0,
      passed: 0,
      failed: 0,
    };
    row.published += 1;
    const run = latest.get(c.caseId);
    if (run) {
      row.executed += 1;
      if (run.result === "passed") row.passed += 1;
      else row.failed += 1;
    }
    projects.set(slug.toLowerCase(), row);
  }

  const baseUrl = options.testRailBaseUrl?.trim().replace(/\/+$/, "") || null;
  const recent = inPeriod
    .slice(-RECENT_LIMIT)
    .reverse()
    .map((e) => {
      const c = cases.get(e.caseId)!;
      return {
        caseId: e.caseId,
        title: c.title,
        issueKey: c.issueKey,
        projectSlug: c.projectSlug,
        projectName: projectName(c.projectSlug),
        result: e.result,
        executedAt: e.executedAt,
        launchId: e.launchId,
        caseUrl: baseUrl ? `${baseUrl}/index.php?/cases/view/${e.caseId}` : null,
      };
    });

  return {
    period: { days: range.days, from: range.from.toISOString(), to: range.to.toISOString() },
    funnel: { designed, published: cases.size, executed, passed, failed, notExecuted: cases.size - executed },
    passRate: executed > 0 ? passed / executed : null,
    executions: inPeriod.length,
    weekly,
    byProject: [...projects.values()].sort((a, b) => b.executed - a.executed || b.published - a.published),
    recent,
  };
}
