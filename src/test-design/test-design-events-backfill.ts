import * as repo from "../db/test-design-repository";
import * as events from "../db/test-design-event-repository";
import { missingDataCount } from "./test-data";

/**
 * One-time history for drafts that predate `TestDesignEvent`.
 *
 * Only what the drafts still show can be rebuilt: when each was created, the AI
 * scenarios they hold, and the cases already in TestRail (dated at the story's
 * last publish). What was discarded back then is gone, so "discarded" starts
 * counting from now. Drafts that already have events are skipped, and a
 * `backfill_done` marker makes later calls a no-op.
 */

let running: Promise<number> | null = null;

export function ensureTestDesignBackfill(): Promise<number> {
  running ??= runBackfill().catch((err) => {
    running = null;
    console.warn(`[test-design:events] backfill falló: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  });
  return running;
}

/** For tests: forget that the backfill already ran in this process. */
export function resetBackfillForTesting(): void {
  running = null;
}

async function runBackfill(): Promise<number> {
  if (await events.hasEventOfType("backfill_done")) return 0;
  const known = await events.listEventDraftIds();
  const summaries = await repo.listDrafts({ includeArchived: true });
  let rebuilt = 0;

  for (const summary of summaries) {
    if (known.has(summary.id.toLowerCase())) continue;
    const draft = await repo.getDraft(summary.id);
    if (!draft) continue;
    const actor = { userId: draft.createdBy, userName: draft.createdByName };
    await events.recordEvent({
      eventType: "draft_created",
      draftId: draft.id,
      projectSlug: draft.projectSlug,
      ...actor,
      details: { stories: draft.stories.length },
      occurredAt: draft.createdAt,
    });

    for (const story of draft.stories) {
      const base = { draftId: draft.id, storyId: story.id, projectSlug: draft.projectSlug, issueKey: story.issueKey, ...actor };
      const ai = story.scenarios.filter((s) => s.origin === "ai").length;
      if (story.generationStatus === "ready" && ai > 0) {
        await events.recordEvent({
          ...base,
          eventType: "generation_completed",
          details: { generated: ai, kept: story.scenarios.length - ai, replaced: 0 },
          occurredAt: story.createdAt,
        });
      }
      const published = story.scenarios.filter((s) => s.testRailCaseId !== null);
      if (story.testRailPublishedAt && published.length > 0) {
        await events.recordEvent({
          ...base,
          eventType: "published_testrail",
          details: {
            cases: published.map((s) => ({
              caseId: s.testRailCaseId!,
              title: s.title,
              status: "created" as const,
              origin: s.origin,
              edited: s.edited,
              type: s.type,
              dataMissing: missingDataCount(s),
            })),
            failed: 0,
          },
          occurredAt: story.testRailPublishedAt,
        });
      }
    }
    rebuilt += 1;
  }

  await events.recordEvent({ eventType: "backfill_done", details: { drafts: rebuilt } });
  if (rebuilt > 0) console.log(`[test-design:events] historial reconstruido para ${rebuilt} borradores`);
  return rebuilt;
}
