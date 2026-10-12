import assert from "node:assert/strict";
import test from "node:test";
import type { PublishedCase, TestDesignEvent } from "../db/test-design-event-repository";
import { computeTestDesignMetrics, metricsRanges } from "./test-design-metrics";

const now = new Date("2026-10-31T12:00:00.000Z");
const ranges = metricsRanges(30, now);
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

let id = 0;
function ev(partial: Partial<TestDesignEvent> & Pick<TestDesignEvent, "eventType" | "details">): TestDesignEvent {
  id += 1;
  return {
    id,
    draftId: "d1",
    storyId: "s1",
    projectSlug: "kiosko",
    issueKey: "PAY-1",
    userId: "u1",
    userName: "ana",
    occurredAt: daysAgo(1),
    ...partial,
  } as TestDesignEvent;
}

const pc = (caseId: number, over: Partial<PublishedCase> = {}): PublishedCase => ({
  caseId,
  title: `Caso ${caseId}`,
  status: "created",
  origin: "ai",
  edited: false,
  type: "functional",
  dataMissing: 0,
  ...over,
});

const events: TestDesignEvent[] = [
  ev({ eventType: "draft_created", details: { stories: 2 }, occurredAt: daysAgo(20) }),
  ev({ eventType: "generation_completed", details: { generated: 10, kept: 0, replaced: 2 }, occurredAt: daysAgo(20) }),
  ev({ eventType: "scenario_removed", details: { removed: [{ origin: "ai", edited: false }, { origin: "manual", edited: false }] }, occurredAt: daysAgo(19) }),
  ev({
    eventType: "published_testrail",
    occurredAt: daysAgo(18),
    details: {
      cases: [
        pc(101),
        pc(102, { edited: true, type: "negative", dataMissing: 2 }),
        pc(103, { origin: "manual", type: "edge" }),
      ],
      failed: 1,
    },
  }),
  ev({
    eventType: "published_testrail",
    occurredAt: daysAgo(2),
    issueKey: "PAY-2",
    details: { cases: [pc(101, { status: "updated" }), pc(104, { status: "recreated" })], failed: 0 },
  }),
  // Another project and another person.
  ev({ eventType: "draft_created", projectSlug: "fenix", userName: "beto", details: { stories: 1 }, occurredAt: daysAgo(5) }),
  ev({
    eventType: "published_testrail",
    projectSlug: "fenix",
    userName: "beto",
    issueKey: "FX-9",
    occurredAt: daysAgo(4),
    details: { cases: [pc(201, { origin: "manual" })], failed: 0 },
  }),
  // Previous period and outside both.
  ev({ eventType: "published_testrail", occurredAt: daysAgo(40), details: { cases: [pc(90), pc(91)], failed: 0 } }),
  ev({ eventType: "published_testrail", occurredAt: daysAgo(100), details: { cases: [pc(80)], failed: 0 } }),
  ev({ eventType: "backfill_done", projectSlug: null, details: { drafts: 3 }, occurredAt: daysAgo(1) }),
];

const names = new Map([
  ["kiosko", "Kiosko"],
  ["fenix", "Fenix"],
]);

test("counts new and updated cases, failures and the previous period", () => {
  const m = computeTestDesignMetrics(events, ranges, { projectSlugs: null, projectNames: names });
  assert.equal(m.period.days, 30);
  assert.deepEqual(
    { ...m.testRail, weekly: undefined },
    { casesNew: 5, casesUpdated: 1, casesFailed: 1, previousCasesNew: 2, weekly: undefined },
  );
});

test("splits new cases by AI contribution and counts what the AI proposed and lost", () => {
  const m = computeTestDesignMetrics(events, ranges, { projectSlugs: null });
  // 101 ai, 102 ai edited, 103 manual, 104 ai (recreated), 201 manual
  assert.deepEqual(m.ai, { unchanged: 2, edited: 1, manual: 2, generated: 10, discarded: 3 });
  assert.deepEqual(m.types, { functional: 3, negative: 1, edge: 1, regression: 0, other: 0 });
  assert.deepEqual(m.data, { complete: 4, pending: 1 });
});

test("usage, per project and per person", () => {
  const m = computeTestDesignMetrics(events, ranges, { projectSlugs: null, projectNames: names });
  assert.deepEqual(m.usage, { drafts: 2, storiesCovered: 3, people: 2, projects: 2 });
  assert.deepEqual(m.byProject, [
    { projectSlug: "kiosko", projectName: "Kiosko", casesNew: 4, stories: 2, aiShare: 0.75 },
    { projectSlug: "fenix", projectName: "Fenix", casesNew: 1, stories: 1, aiShare: 0 },
  ]);
  assert.deepEqual(m.byPerson, [
    { name: "ana", casesNew: 4, drafts: 1 },
    { name: "beto", casesNew: 1, drafts: 1 },
  ]);
});

test("weekly buckets cover the period from its start", () => {
  const m = computeTestDesignMetrics(events, ranges, { projectSlugs: null });
  assert.equal(m.testRail.weekly.length, 5);
  assert.equal(m.testRail.weekly[0].weekStart, ranges.current.from.toISOString());
  assert.deepEqual(
    m.testRail.weekly.map((w) => [w.casesNew, w.casesUpdated]),
    [[0, 0], [3, 0], [0, 0], [1, 0], [1, 1]],
  );
});

test("recent cases are newest first and link to TestRail", () => {
  const m = computeTestDesignMetrics(events, ranges, {
    projectSlugs: null,
    projectNames: names,
    testRailBaseUrl: "https://tr.example.com",
    recentLimit: 3,
  });
  assert.deepEqual(m.recent.map((r) => r.caseId), [104, 201, 101]);
  assert.equal(m.recent[0].caseUrl, "https://tr.example.com/index.php?/cases/view/104");
  assert.equal(m.recent[1].projectName, "Fenix");
});

test("a scoped user only sees the projects it was granted", () => {
  const m = computeTestDesignMetrics(events, ranges, { projectSlugs: new Set(["fenix"]) });
  assert.equal(m.testRail.casesNew, 1);
  assert.equal(m.usage.drafts, 1);
  assert.equal(m.ai.generated, 0);
  assert.deepEqual(m.byProject.map((p) => p.projectSlug), ["fenix"]);
  assert.equal(computeTestDesignMetrics(events, ranges, { projectSlugs: new Set() }).testRail.casesNew, 0);
});
