import { resolveDriverName, withConnection } from "./sql-connection";
import { toIso } from "./row-utils";
import type { TestDesignScenario } from "../test-design/test-design.types";

/**
 * Append-only usage history of the test design module (`TestDesignEvent`).
 *
 * Drafts only keep their current state: a regeneration replaces AI output and a
 * deleted scenario is gone. The dashboard needs what happened over time, so each
 * meaningful step records an event with its numbers in `detailsJson`.
 */

export type PublishedCase = {
  caseId: number;
  title: string;
  status: "created" | "updated" | "recreated";
  origin: TestDesignScenario["origin"];
  edited: boolean;
  type: TestDesignScenario["type"];
  /** Data fields still empty when published. */
  dataMissing: number;
};

export type TestDesignEventDetails = {
  draft_created: { stories: number };
  generation_completed: { generated: number; kept: number; replaced: number };
  generation_failed: { error: string };
  scenario_removed: { removed: Array<{ origin: TestDesignScenario["origin"]; edited: boolean }> };
  published_testrail: { cases: PublishedCase[]; failed: number };
  backfill_done: { drafts: number };
};

export type TestDesignEventType = keyof TestDesignEventDetails;

export type TestDesignEventInput<T extends TestDesignEventType = TestDesignEventType> = {
  eventType: T;
  draftId?: string | null;
  storyId?: string | null;
  projectSlug?: string | null;
  issueKey?: string | null;
  userId?: string | null;
  userName?: string | null;
  details: TestDesignEventDetails[T];
  /** Defaults to now; the backfill passes the original timestamps. */
  occurredAt?: string;
};

export type TestDesignEvent = {
  [T in TestDesignEventType]: {
    id: number;
    eventType: T;
    draftId: string | null;
    storyId: string | null;
    projectSlug: string | null;
    issueKey: string | null;
    userId: string | null;
    userName: string | null;
    occurredAt: string;
    details: TestDesignEventDetails[T];
  };
}[TestDesignEventType];

type EventRow = {
  id: unknown;
  eventType: string;
  draftId: string | null;
  storyId: string | null;
  projectSlug: string | null;
  issueKey: string | null;
  userId: string | null;
  userName: string | null;
  occurredAt: unknown;
  detailsJson: unknown;
};

/**
 * Timestamp parameter for the active driver. SQLite stores ISO-8601 text and compares
 * it as text; SQL Server converts the string to datetime2, which rejects the "Z".
 */
export function sqlTimestamp(value: Date | string): string {
  const iso = new Date(value).toISOString();
  return resolveDriverName() === "sqlserver" ? iso.replace("T", " ").replace("Z", "") : iso;
}

function parseDetails(raw: unknown): unknown {
  if (raw === null || raw === undefined) return {};
  const json = Buffer.isBuffer(raw) ? raw.toString("utf16le") : String(raw);
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function recordEvent<T extends TestDesignEventType>(input: TestDesignEventInput<T>): Promise<void> {
  await withConnection(async (c) => {
    const columns = ["eventType", "draftId", "storyId", "projectSlug", "issueKey", "userId", "userName", "detailsJson"];
    const params: unknown[] = [
      input.eventType,
      input.draftId ?? null,
      input.storyId ?? null,
      input.projectSlug ?? null,
      input.issueKey?.toUpperCase() ?? null,
      input.userId ?? null,
      input.userName ?? null,
      // UTF-16 for SQL Server NVARCHAR, like the other JSON columns (titles carry accents).
      Buffer.from(JSON.stringify(input.details), "utf16le"),
    ];
    if (input.occurredAt) {
      columns.push("occurredAt");
      params.push(sqlTimestamp(input.occurredAt));
    }
    await c.query(
      `INSERT INTO dbo.TestDesignEvent (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
      params,
    );
  });
}

/**
 * Usage history must never break the action it describes: a failure to record is
 * logged and swallowed.
 */
export async function recordEventSafely<T extends TestDesignEventType>(input: TestDesignEventInput<T>): Promise<void> {
  try {
    await recordEvent(input);
  } catch (err) {
    console.warn(`[test-design:events] no se pudo registrar ${input.eventType}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Events with `from <= occurredAt < to`, oldest first. */
export async function listEvents(range: { from: Date; to: Date }): Promise<TestDesignEvent[]> {
  return withConnection(async (c) => {
    const rows = await c.query<EventRow>(
      `SELECT id, eventType, draftId, storyId, projectSlug, issueKey, userId, userName, occurredAt, detailsJson
         FROM dbo.TestDesignEvent
        WHERE occurredAt >= ? AND occurredAt < ?
        ORDER BY occurredAt, id`,
      [sqlTimestamp(range.from), sqlTimestamp(range.to)],
    );
    return rows.map(
      (row) =>
        ({
          id: Number(row.id),
          eventType: row.eventType as TestDesignEventType,
          draftId: row.draftId ?? null,
          storyId: row.storyId ?? null,
          projectSlug: row.projectSlug ?? null,
          issueKey: row.issueKey ?? null,
          userId: row.userId ?? null,
          userName: row.userName ?? null,
          occurredAt: toIso(row.occurredAt),
          details: parseDetails(row.detailsJson),
        }) as TestDesignEvent,
    );
  });
}

/** Drafts that already have history (lowercase ids), so a backfill never duplicates them. */
export async function listEventDraftIds(): Promise<Set<string>> {
  return withConnection(async (c) => {
    const rows = await c.query<{ draftId: string | null }>(
      `SELECT DISTINCT draftId FROM dbo.TestDesignEvent WHERE draftId IS NOT NULL`,
    );
    return new Set(rows.map((r) => String(r.draftId).toLowerCase()));
  });
}

export async function hasEventOfType(eventType: TestDesignEventType): Promise<boolean> {
  return withConnection(async (c) => {
    const rows = await c.query<{ n: unknown }>(`SELECT COUNT(*) AS n FROM dbo.TestDesignEvent WHERE eventType = ?`, [eventType]);
    return Number(rows[0]?.n ?? 0) > 0;
  });
}
