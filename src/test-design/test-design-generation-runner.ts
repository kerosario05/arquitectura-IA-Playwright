import type { AiProvider } from "../ai/ai-provider.types";
import * as repo from "../db/test-design-repository";
import {
  generateTestDesignScenarios,
  keptScenarioTitles,
  mergeRegenerated,
  testDesignReviewWarning,
} from "./test-design-generator";
import type { TestDesignDraftStory, TestDesignJiraIssue } from "./test-design.types";

/**
 * Runs scenario generation for the stories of a draft in the background.
 *
 * Progress is persisted per story (`generationStatus`), so the panel polls the
 * draft instead of a job id, and a failed story never blocks the others. The
 * draft's own status is left alone: two runs on one draft can finish in any
 * order, and the panel derives "generating" from the stories.
 *
 * The in-memory `running` set is what tells a live run from one a restart killed:
 * a story stored as "generating" that is not in it was interrupted.
 */

export type GenerationDeps = {
  createProvider: () => Promise<AiProvider>;
  loadIssue: (issueKey: string) => Promise<TestDesignJiraIssue>;
};

export const INTERRUPTED_MESSAGE =
  "La generación se interrumpió (el servidor se reinició). Vuelve a generar esta historia.";

const running = new Set<string>();

export function isStoryRunning(storyId: string): boolean {
  return running.has(storyId.toLowerCase());
}

export function generationConcurrency(): number {
  const n = Number(process.env.TEST_DESIGN_CONCURRENCY);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 2;
}

export class GenerationConflictError extends Error {
  constructor(public readonly issueKeys: string[]) {
    super(`Ya se está generando: ${issueKeys.join(", ")}`);
    this.name = "GenerationConflictError";
  }
}

export type StartGenerationOptions = {
  /** Extra guidance for this run only, on top of the draft's instructions. */
  instructions?: string | null;
  /** Project-scoped Jira knowledge profile linked to the draft. */
  appSlug?: string | null;
};

/**
 * Marks the stories as generating and returns once that is stored; the AI calls
 * continue in the background. The returned promise of `done` is for tests.
 */
export async function startGeneration(
  draftId: string,
  stories: TestDesignDraftStory[],
  draftInstructions: string | null,
  deps: GenerationDeps,
  options: StartGenerationOptions = {},
): Promise<{ done: Promise<void> }> {
  const busy = stories.filter((s) => isStoryRunning(s.id));
  if (busy.length > 0) throw new GenerationConflictError(busy.map((s) => s.issueKey));
  if (stories.length === 0) return { done: Promise.resolve() };

  for (const story of stories) running.add(story.id.toLowerCase());
  try {
    for (const story of stories) {
      await repo.setStoryGeneration(draftId, story.id, { status: "generating" });
    }
  } catch (err) {
    for (const story of stories) running.delete(story.id.toLowerCase());
    throw err;
  }

  const instructions = [draftInstructions, options.instructions].filter((t) => t?.trim()).join("\n\n");
  const done = runAll(draftId, stories, instructions || null, options.appSlug?.trim() || "", deps);
  return { done };
}

async function runAll(
  draftId: string,
  stories: TestDesignDraftStory[],
  instructions: string | null,
  appSlug: string,
  deps: GenerationDeps,
): Promise<void> {
  let provider: AiProvider;
  try {
    provider = await deps.createProvider();
  } catch (err) {
    const message = `Proveedor de IA no disponible: ${err instanceof Error ? err.message : String(err)}`;
    for (const story of stories) await finish(draftId, story, { status: "failed", error: message });
    return;
  }

  const queue = [...stories];
  const workers = Array.from({ length: Math.min(generationConcurrency(), queue.length) }, async () => {
    for (let story = queue.shift(); story; story = queue.shift()) {
      await generateOne(draftId, story, instructions, appSlug, provider, deps);
    }
  });
  await Promise.all(workers);
}

async function generateOne(
  draftId: string,
  story: TestDesignDraftStory,
  instructions: string | null,
  appSlug: string,
  provider: AiProvider,
  deps: GenerationDeps,
): Promise<void> {
  const started = Date.now();
  try {
    const issue = await deps.loadIssue(story.issueKey);
    const generated = await generateTestDesignScenarios(issue, {
      provider,
      appSlug,
      instructions,
      existingTitles: keptScenarioTitles(story.scenarios),
    });
    // Re-read: the story may have been edited while the model was working.
    const current = (await repo.getStory(draftId, story.id))?.scenarios ?? story.scenarios;
    const scenarios = mergeRegenerated(current, generated);
    const reviewWarning = testDesignReviewWarning(generated);
    await finish(draftId, story, {
      status: reviewWarning ? "failed" : "ready",
      ...(reviewWarning ? { error: reviewWarning } : {}),
      scenarios,
      issueSummary: issue.summary,
    });
    console.log(
      `[test-design:generation] ${story.issueKey} ${reviewWarning ? "incompleta; borradores para revisión" : "lista"}: ${generated.length} generados, ` +
        `${scenarios.length} en total (${Date.now() - started} ms)`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[test-design:generation] ${story.issueKey} falló: ${message}`);
    await finish(draftId, story, { status: "failed", error: message.slice(0, 2000) });
  }
}

async function finish(
  draftId: string,
  story: TestDesignDraftStory,
  update: repo.StoryGenerationUpdate,
): Promise<void> {
  try {
    await repo.setStoryGeneration(draftId, story.id, update);
  } finally {
    running.delete(story.id.toLowerCase());
  }
}

/**
 * Stories left "generating" by a run that no longer exists (server restart) are
 * turned into failures so the panel offers a retry instead of spinning forever.
 */
export async function settleInterruptedStories<T extends { id: string; stories: TestDesignDraftStory[] }>(
  draft: T,
): Promise<T> {
  const stale = draft.stories.filter((s) => s.generationStatus === "generating" && !isStoryRunning(s.id));
  if (stale.length === 0) return draft;
  for (const story of stale) {
    await repo.setStoryGeneration(draft.id, story.id, { status: "failed", error: INTERRUPTED_MESSAGE });
  }
  return {
    ...draft,
    stories: draft.stories.map((s) =>
      stale.includes(s) ? { ...s, generationStatus: "failed" as const, generationError: INTERRUPTED_MESSAGE } : s,
    ),
  };
}
