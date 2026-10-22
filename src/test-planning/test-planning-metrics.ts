import type { TestPlanReview } from "../db/test-plan-review-repository";

/**
 * Dashboard numbers for the "Planificación de pruebas" module, computed from the
 * review history. A plan (file) counts once per period, with its latest outcome;
 * scenario counters add up every committed change.
 */

export interface TestPlanningMetrics {
  /** Distinct plans reviewed in the period. */
  plansReviewed: number;
  /** Of those, latest outcome "accepted" (valid as written by the spec tool). */
  acceptedAsIs: number;
  /** Of those, latest outcome "committed" (QA had to change them). */
  withChanges: number;
  /** acceptedAsIs / plansReviewed, 0..1 (null with no plans). */
  acceptanceRate: number | null;
  commits: number;
  scenariosReviewed: number;
  scenariosEdited: number;
  scenariosAdded: number;
  scenariosRemoved: number;
  byReviewer: Array<{ userName: string; reviews: number; commits: number }>;
  recent: Array<{
    projectSlug: string;
    issueKey: string;
    branch: string;
    outcome: TestPlanReview["outcome"];
    userName: string | null;
    reviewedAt: string;
    edited: number;
    added: number;
    removed: number;
    commitSha: string | null;
  }>;
}

export function computeTestPlanningMetrics(reviews: TestPlanReview[], recentLimit = 10): TestPlanningMetrics {
  const latest = new Map<string, TestPlanReview>();
  for (const review of reviews) latest.set(`${review.projectSlug.toLowerCase()}|${review.filePath}`, review);
  const plans = [...latest.values()];
  const acceptedAsIs = plans.filter((r) => r.outcome === "accepted").length;
  const committed = reviews.filter((r) => r.outcome === "committed");

  const reviewers = new Map<string, { userName: string; reviews: number; commits: number }>();
  for (const review of reviews) {
    const name = review.userName ?? "—";
    const entry = reviewers.get(name) ?? { userName: name, reviews: 0, commits: 0 };
    entry.reviews += 1;
    if (review.outcome === "committed") entry.commits += 1;
    reviewers.set(name, entry);
  }

  return {
    plansReviewed: plans.length,
    acceptedAsIs,
    withChanges: plans.length - acceptedAsIs,
    acceptanceRate: plans.length ? acceptedAsIs / plans.length : null,
    commits: committed.length,
    scenariosReviewed: plans.reduce((n, r) => n + r.scenarioCount, 0),
    scenariosEdited: committed.reduce((n, r) => n + r.editedCount, 0),
    scenariosAdded: committed.reduce((n, r) => n + r.addedCount, 0),
    scenariosRemoved: committed.reduce((n, r) => n + r.removedCount, 0),
    byReviewer: [...reviewers.values()].sort((a, b) => b.reviews - a.reviews),
    recent: [...reviews]
      .reverse()
      .slice(0, recentLimit)
      .map((r) => ({
        projectSlug: r.projectSlug,
        issueKey: r.issueKey,
        branch: r.branch,
        outcome: r.outcome,
        userName: r.userName,
        reviewedAt: r.reviewedAt,
        edited: r.editedCount,
        added: r.addedCount,
        removed: r.removedCount,
        commitSha: r.commitSha,
      })),
  };
}
