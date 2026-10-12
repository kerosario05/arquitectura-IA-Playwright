import type { DbConnection } from "./db-connection";
import { withConnection, withTransaction } from "./sql-connection";
import { placeholders, toIso, toIsoOrNull } from "./row-utils";
import type {
  TestDesignDraft,
  TestDesignDraftStatus,
  TestDesignDraftStory,
  TestDesignDraftSummary,
  TestDesignDraftWithStories,
  TestDesignGenerationStatus,
  TestDesignScenario,
  TestDesignTestRailTarget,
} from "../test-design/test-design.types";

/**
 * Persistence for test design drafts (`TestDesignDraft`) and the stories they
 * hold (`TestDesignDraftStory`).
 *
 * Scenarios live as one JSON document per story: the panel always edits and
 * saves a story's whole list (reorder, add, delete), so a per-row table would
 * only add diffing with nothing gained. Validation happens before this layer
 * (src/test-design/test-design.validation.ts); stored JSON is trusted on read.
 */

export type DraftIssueInput = { issueKey: string; issueSummary?: string };

export type CreateDraftInput = {
  jiraProjectKey: string;
  projectSlug?: string | null;
  title?: string | null;
  testRail?: Partial<TestDesignTestRailTarget>;
  instructions?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  issues: DraftIssueInput[];
};

export type UpdateDraftInput = {
  title?: string | null;
  projectSlug?: string | null;
  testRail?: Partial<TestDesignTestRailTarget>;
  instructions?: string | null;
  status?: TestDesignDraftStatus;
};

export type ListDraftsFilter = {
  createdBy?: string;
  jiraProjectKey?: string;
  includeArchived?: boolean;
};

type DraftRow = {
  id: string;
  title: string | null;
  projectSlug: string | null;
  jiraProjectKey: string;
  testRailProjectId: unknown;
  testRailSuiteId: unknown;
  testRailSectionId: unknown;
  instructions: string | null;
  status: string;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: unknown;
  updatedAt: unknown;
};

type StoryRow = {
  id: string;
  draftId: string;
  issueKey: string;
  issueSummary: string | null;
  position: unknown;
  generationStatus: string;
  generationError: string | null;
  scenariosJson: unknown;
  jiraSubtaskKey: string | null;
  jiraPublishedAt: unknown;
  testRailPublishedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};

const DRAFT_COLUMN_LIST = [
  "id",
  "title",
  "projectSlug",
  "jiraProjectKey",
  "testRailProjectId",
  "testRailSuiteId",
  "testRailSectionId",
  "instructions",
  "status",
  "createdBy",
  "createdByName",
  "createdAt",
  "updatedAt",
];
const DRAFT_COLUMNS = DRAFT_COLUMN_LIST.join(", ");
const DRAFT_OUTPUT = DRAFT_COLUMN_LIST.map((c) => `INSERTED.${c}`).join(", ");

const STORY_COLUMN_LIST = [
  "id",
  "draftId",
  "issueKey",
  "issueSummary",
  "position",
  "generationStatus",
  "generationError",
  "scenariosJson",
  "jiraSubtaskKey",
  "jiraPublishedAt",
  "testRailPublishedAt",
  "createdAt",
  "updatedAt",
];
const STORY_COLUMNS = STORY_COLUMN_LIST.join(", ");

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function normalizeIssueKey(key: string): string {
  return key.trim().toUpperCase();
}

function mapDraft(row: DraftRow): TestDesignDraft {
  return {
    id: row.id,
    title: row.title ?? null,
    projectSlug: row.projectSlug ?? null,
    jiraProjectKey: row.jiraProjectKey,
    testRail: {
      projectId: toIntOrNull(row.testRailProjectId),
      suiteId: toIntOrNull(row.testRailSuiteId),
      sectionId: toIntOrNull(row.testRailSectionId),
    },
    instructions: row.instructions ?? null,
    status: row.status as TestDesignDraftStatus,
    createdBy: row.createdBy ?? null,
    createdByName: row.createdByName ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Scenario text is user-authored Spanish (accents, ñ). SQL Server's NVARCHAR
 * binding needs UTF-16LE for that, as the knowledge persisters do; the SQLite
 * driver decodes the buffer back to text.
 */
function jsonParam(scenarios: TestDesignScenario[]): Buffer {
  return Buffer.from(JSON.stringify(scenarios), "utf16le");
}

function parseScenarios(raw: unknown): TestDesignScenario[] {
  if (raw === null || raw === undefined) return [];
  const json = Buffer.isBuffer(raw) ? raw.toString("utf16le") : String(raw);
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as TestDesignScenario[]) : [];
  } catch {
    return [];
  }
}

function mapStory(row: StoryRow): TestDesignDraftStory {
  return {
    id: row.id,
    draftId: row.draftId,
    issueKey: row.issueKey,
    issueSummary: row.issueSummary ?? "",
    position: toIntOrNull(row.position) ?? 0,
    generationStatus: row.generationStatus as TestDesignGenerationStatus,
    generationError: row.generationError ?? null,
    scenarios: parseScenarios(row.scenariosJson),
    jiraSubtaskKey: row.jiraSubtaskKey ?? null,
    jiraPublishedAt: toIsoOrNull(row.jiraPublishedAt),
    testRailPublishedAt: toIsoOrNull(row.testRailPublishedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

async function touchDraft(c: DbConnection, draftId: string): Promise<void> {
  await c.query(`UPDATE dbo.TestDesignDraft SET updatedAt = SYSUTCDATETIME() WHERE id = ?`, [draftId]);
}

async function insertStories(
  c: DbConnection,
  draftId: string,
  issues: DraftIssueInput[],
  startPosition: number,
): Promise<number> {
  const existing = await c.query<{ issueKey: string }>(
    `SELECT issueKey FROM dbo.TestDesignDraftStory WHERE draftId = ?`,
    [draftId],
  );
  const seen = new Set(existing.map((row) => normalizeIssueKey(row.issueKey)));
  let position = startPosition;
  let inserted = 0;
  for (const issue of issues) {
    const key = normalizeIssueKey(issue.issueKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    await c.query(
      `INSERT INTO dbo.TestDesignDraftStory (draftId, issueKey, issueSummary, position)
       VALUES (?, ?, ?, ?)`,
      [draftId, key, issue.issueSummary?.trim() ?? "", position],
    );
    position += 1;
    inserted += 1;
  }
  return inserted;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

export async function createDraft(input: CreateDraftInput): Promise<TestDesignDraftWithStories> {
  const jiraProjectKey = input.jiraProjectKey.trim().toUpperCase();
  if (!jiraProjectKey) throw new Error("jiraProjectKey is required");

  const id = await withTransaction(async (c) => {
    const rows = await c.query<DraftRow>(
      `INSERT INTO dbo.TestDesignDraft
         (title, projectSlug, jiraProjectKey, testRailProjectId, testRailSuiteId, testRailSectionId,
          instructions, createdBy, createdByName)
       OUTPUT ${DRAFT_OUTPUT}
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.title?.trim() || null,
        input.projectSlug?.trim() || null,
        jiraProjectKey,
        input.testRail?.projectId ?? null,
        input.testRail?.suiteId ?? null,
        input.testRail?.sectionId ?? null,
        input.instructions?.trim() || null,
        input.createdBy ?? null,
        input.createdByName ?? null,
      ],
    );
    const draftId = rows[0].id;
    await insertStories(c, draftId, input.issues, 0);
    return draftId;
  });

  const created = await getDraft(id);
  if (!created) throw new Error(`draft ${id} vanished right after creation`);
  return created;
}

export async function getDraft(id: string): Promise<TestDesignDraftWithStories | null> {
  return withConnection(async (c) => {
    const drafts = await c.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM dbo.TestDesignDraft WHERE id = ?`,
      [id],
    );
    if (drafts.length === 0) return null;
    const stories = await c.query<StoryRow>(
      `SELECT ${STORY_COLUMNS} FROM dbo.TestDesignDraftStory WHERE draftId = ? ORDER BY position, issueKey`,
      [id],
    );
    return { ...mapDraft(drafts[0]), stories: stories.map(mapStory) };
  });
}

/** Newest first. Story and scenario counts are computed from the stored JSON. */
export async function listDrafts(filter: ListDraftsFilter = {}): Promise<TestDesignDraftSummary[]> {
  return withConnection(async (c) => {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.createdBy) {
      where.push("createdBy = ?");
      params.push(filter.createdBy);
    }
    if (filter.jiraProjectKey) {
      where.push("jiraProjectKey = ?");
      params.push(filter.jiraProjectKey.trim().toUpperCase());
    }
    if (!filter.includeArchived) where.push("status <> 'archived'");

    const drafts = await c.query<DraftRow>(
      `SELECT ${DRAFT_COLUMNS} FROM dbo.TestDesignDraft
       ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY updatedAt DESC`,
      params,
    );
    if (drafts.length === 0) return [];

    const ids = drafts.map((d) => d.id);
    const stories = await c.query<Pick<StoryRow, "draftId" | "issueKey" | "scenariosJson" | "position">>(
      `SELECT draftId, issueKey, scenariosJson, position FROM dbo.TestDesignDraftStory
       WHERE draftId IN (${placeholders(ids.length)})
       ORDER BY position, issueKey`,
      ids,
    );
    const byDraft = new Map<string, { keys: string[]; scenarios: number }>();
    for (const story of stories) {
      const key = story.draftId.toLowerCase();
      const entry = byDraft.get(key) ?? { keys: [], scenarios: 0 };
      entry.keys.push(story.issueKey);
      entry.scenarios += parseScenarios(story.scenariosJson).length;
      byDraft.set(key, entry);
    }

    return drafts.map((row) => {
      const entry = byDraft.get(row.id.toLowerCase()) ?? { keys: [], scenarios: 0 };
      return {
        ...mapDraft(row),
        storyCount: entry.keys.length,
        scenarioCount: entry.scenarios,
        issueKeys: entry.keys,
      };
    });
  });
}

export async function updateDraft(id: string, patch: UpdateDraftInput): Promise<TestDesignDraft | null> {
  return withConnection(async (c) => {
    const sets: string[] = [];
    const params: unknown[] = [];
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`);
      params.push(value);
    };
    if (patch.title !== undefined) set("title", patch.title?.trim() || null);
    if (patch.projectSlug !== undefined) set("projectSlug", patch.projectSlug?.trim() || null);
    if (patch.instructions !== undefined) set("instructions", patch.instructions?.trim() || null);
    if (patch.status !== undefined) set("status", patch.status);
    if (patch.testRail?.projectId !== undefined) set("testRailProjectId", patch.testRail.projectId);
    if (patch.testRail?.suiteId !== undefined) set("testRailSuiteId", patch.testRail.suiteId);
    if (patch.testRail?.sectionId !== undefined) set("testRailSectionId", patch.testRail.sectionId);

    if (sets.length > 0) {
      sets.push("updatedAt = SYSUTCDATETIME()");
      await c.query(`UPDATE dbo.TestDesignDraft SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    }
    const rows = await c.query<DraftRow>(`SELECT ${DRAFT_COLUMNS} FROM dbo.TestDesignDraft WHERE id = ?`, [id]);
    return rows.length > 0 ? mapDraft(rows[0]) : null;
  });
}

/** Archiving keeps the rows (and the published links) but hides the draft from the default list. */
export async function archiveDraft(id: string): Promise<boolean> {
  return withConnection(async (c) => {
    const rows = await c.query<{ id: string }>(
      `UPDATE dbo.TestDesignDraft SET status = 'archived', updatedAt = SYSUTCDATETIME()
       OUTPUT INSERTED.id
       WHERE id = ?`,
      [id],
    );
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

/** Adds stories after the existing ones; keys already in the draft are skipped. Returns how many were added. */
export async function addStories(draftId: string, issues: DraftIssueInput[]): Promise<number> {
  return withTransaction(async (c) => {
    const max = await c.query<{ maxPosition: unknown }>(
      `SELECT MAX(position) AS maxPosition FROM dbo.TestDesignDraftStory WHERE draftId = ?`,
      [draftId],
    );
    const start = (toIntOrNull(max[0]?.maxPosition) ?? -1) + 1;
    const inserted = await insertStories(c, draftId, issues, start);
    if (inserted > 0) await touchDraft(c, draftId);
    return inserted;
  });
}

export async function removeStory(draftId: string, storyId: string): Promise<boolean> {
  return withTransaction(async (c) => {
    const rows = await c.query<{ id: string }>(
      `DELETE FROM dbo.TestDesignDraftStory OUTPUT DELETED.id WHERE draftId = ? AND id = ?`,
      [draftId, storyId],
    );
    if (rows.length > 0) await touchDraft(c, draftId);
    return rows.length > 0;
  });
}

export async function getStory(draftId: string, storyId: string): Promise<TestDesignDraftStory | null> {
  return withConnection(async (c) => {
    const rows = await c.query<StoryRow>(
      `SELECT ${STORY_COLUMNS} FROM dbo.TestDesignDraftStory WHERE draftId = ? AND id = ?`,
      [draftId, storyId],
    );
    return rows.length > 0 ? mapStory(rows[0]) : null;
  });
}

/** Replaces a story's scenario list. Callers pass normalized scenarios. */
export async function saveStoryScenarios(
  draftId: string,
  storyId: string,
  scenarios: TestDesignScenario[],
): Promise<TestDesignDraftStory | null> {
  return withTransaction(async (c) => {
    const updated = await c.query<{ id: string }>(
      `UPDATE dbo.TestDesignDraftStory SET scenariosJson = ?, updatedAt = SYSUTCDATETIME()
       OUTPUT INSERTED.id
       WHERE draftId = ? AND id = ?`,
      [jsonParam(scenarios), draftId, storyId],
    );
    if (updated.length === 0) return null;
    await touchDraft(c, draftId);
    const rows = await c.query<StoryRow>(
      `SELECT ${STORY_COLUMNS} FROM dbo.TestDesignDraftStory WHERE id = ?`,
      [storyId],
    );
    return mapStory(rows[0]);
  });
}

export type StoryGenerationUpdate = {
  status: TestDesignGenerationStatus;
  error?: string | null;
  /** Only written when provided (a "generating" update leaves the current list alone). */
  scenarios?: TestDesignScenario[];
  issueSummary?: string;
};

export async function setStoryGeneration(
  draftId: string,
  storyId: string,
  update: StoryGenerationUpdate,
): Promise<void> {
  await withTransaction(async (c) => {
    const sets = ["generationStatus = ?", "generationError = ?", "updatedAt = SYSUTCDATETIME()"];
    const params: unknown[] = [update.status, update.error ?? null];
    if (update.scenarios !== undefined) {
      sets.push("scenariosJson = ?");
      params.push(jsonParam(update.scenarios));
    }
    if (update.issueSummary !== undefined) {
      sets.push("issueSummary = ?");
      params.push(update.issueSummary);
    }
    await c.query(
      `UPDATE dbo.TestDesignDraftStory SET ${sets.join(", ")} WHERE draftId = ? AND id = ?`,
      [...params, draftId, storyId],
    );
    await touchDraft(c, draftId);
  });
}

export type StoryPublication =
  | { destination: "testrail"; scenarios: TestDesignScenario[] }
  | { destination: "jira"; subtaskKey: string };

/** Records a successful publish: TestRail case ids land in the scenarios, the Jira sub-task key on the story. */
export async function markStoryPublished(
  draftId: string,
  storyId: string,
  publication: StoryPublication,
): Promise<void> {
  await withTransaction(async (c) => {
    if (publication.destination === "testrail") {
      await c.query(
        `UPDATE dbo.TestDesignDraftStory
         SET scenariosJson = ?, testRailPublishedAt = SYSUTCDATETIME(), updatedAt = SYSUTCDATETIME()
         WHERE draftId = ? AND id = ?`,
        [jsonParam(publication.scenarios), draftId, storyId],
      );
    } else {
      await c.query(
        `UPDATE dbo.TestDesignDraftStory
         SET jiraSubtaskKey = ?, jiraPublishedAt = SYSUTCDATETIME(), updatedAt = SYSUTCDATETIME()
         WHERE draftId = ? AND id = ?`,
        [publication.subtaskKey.trim().toUpperCase(), draftId, storyId],
      );
    }
    await touchDraft(c, draftId);
  });
}
