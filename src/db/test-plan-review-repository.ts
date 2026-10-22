import { withConnection } from "./sql-connection";
import { toIso } from "./row-utils";
import { sqlTimestamp } from "./test-design-event-repository";

/**
 * QA review history of test plans (`TestPlanReview`). A row is written when a
 * reviewer accepts a plan as valid without changes, or commits changes to it.
 * The latest row per file tells whether the plan's current content was reviewed;
 * the whole history feeds the dashboard.
 */

export type TestPlanReviewOutcome = "accepted" | "committed";

export interface TestPlanReviewInput {
  projectSlug: string;
  branch: string;
  issueKey: string;
  filePath: string;
  outcome: TestPlanReviewOutcome;
  headSha: string;
  blobSha: string;
  commitSha?: string | null;
  scenarioCount: number;
  editedCount?: number;
  addedCount?: number;
  removedCount?: number;
  note?: string | null;
  userId?: string | null;
  userName?: string | null;
}

export interface TestPlanReview extends Required<Omit<TestPlanReviewInput, "commitSha" | "note" | "userId" | "userName">> {
  id: number;
  commitSha: string | null;
  note: string | null;
  userId: string | null;
  userName: string | null;
  reviewedAt: string;
}

type Row = Omit<TestPlanReview, "reviewedAt" | "id"> & { id: unknown; reviewedAt: unknown };

const COLUMNS =
  "id, projectSlug, branch, issueKey, filePath, outcome, headSha, blobSha, commitSha, scenarioCount, editedCount, addedCount, removedCount, note, userId, userName, reviewedAt";

function toReview(row: Row): TestPlanReview {
  return {
    ...row,
    id: Number(row.id),
    issueKey: String(row.issueKey).toUpperCase(),
    scenarioCount: Number(row.scenarioCount) || 0,
    editedCount: Number(row.editedCount) || 0,
    addedCount: Number(row.addedCount) || 0,
    removedCount: Number(row.removedCount) || 0,
    outcome: row.outcome === "committed" ? "committed" : "accepted",
    reviewedAt: toIso(row.reviewedAt),
  };
}

export async function recordReview(input: TestPlanReviewInput): Promise<void> {
  await withConnection(async (c) => {
    await c.query(
      `INSERT INTO dbo.TestPlanReview
         (projectSlug, branch, issueKey, filePath, outcome, headSha, blobSha, commitSha,
          scenarioCount, editedCount, addedCount, removedCount, note, userId, userName)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.projectSlug,
        input.branch,
        input.issueKey.toUpperCase(),
        input.filePath,
        input.outcome,
        input.headSha,
        input.blobSha,
        input.commitSha ?? null,
        input.scenarioCount,
        input.editedCount ?? 0,
        input.addedCount ?? 0,
        input.removedCount ?? 0,
        input.note?.trim() || null,
        input.userId ?? null,
        input.userName ?? null,
      ],
    );
  });
}

/** Latest review per file of a project, keyed by file path. */
export async function latestReviewsByFile(projectSlug: string, filePaths: string[]): Promise<Map<string, TestPlanReview>> {
  const result = new Map<string, TestPlanReview>();
  if (!filePaths.length) return result;
  await withConnection(async (c) => {
    const rows = await c.query<Row>(
      `SELECT ${COLUMNS} FROM dbo.TestPlanReview
        WHERE projectSlug = ? AND filePath IN (${filePaths.map(() => "?").join(", ")})
        ORDER BY reviewedAt, id`,
      [projectSlug, ...filePaths],
    );
    for (const row of rows) result.set(row.filePath, toReview(row));
  });
  return result;
}

/** Reviews with `from <= reviewedAt < to`, oldest first. */
export async function listReviews(range: { from: Date; to: Date }): Promise<TestPlanReview[]> {
  return withConnection(async (c) => {
    const rows = await c.query<Row>(
      `SELECT ${COLUMNS} FROM dbo.TestPlanReview
        WHERE reviewedAt >= ? AND reviewedAt < ?
        ORDER BY reviewedAt, id`,
      [sqlTimestamp(range.from), sqlTimestamp(range.to)],
    );
    return rows.map(toReview);
  });
}
