import { Router } from "express";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { generateScenarioPreview } from "../../scenarios/scenario-preview.service";
import type { ScenarioPreviewRequest } from "../../scenarios/scenario-types";

export const testrailRouter = Router();

function client(): TestRailClient {
  return new TestRailClient(requireTestRailConfig(config));
}

export async function resolveSectionCases(
  tr: Pick<TestRailClient, "getSection" | "getCases">,
  params: { sectionId: number; projectId?: number; suiteId?: number },
) {
  const section = await tr.getSection(params.sectionId);
  if (!section) {
    return {
      status: 404,
      body: {
        ok: false,
        error: "section_not_found",
        message: "No se encontró la sección en TestRail",
        sectionId: params.sectionId,
        projectId: params.projectId,
        suiteId: params.suiteId,
      },
    };
  }

  const effectiveProjectId = params.projectId ?? section.project_id;
  const effectiveSuiteId = params.suiteId ?? section.suite_id;

  console.log(
    `[testrail:cases] sectionId=${params.sectionId} projectId=${effectiveProjectId ?? "unknown"} suiteId=${effectiveSuiteId ?? "unknown"}`
  );

  if (!effectiveProjectId) {
    return {
      status: 400,
      body: {
        ok: false,
        error: "invalid_request",
        message: "projectId is required or must be present on the TestRail section",
        sectionId: params.sectionId,
      },
    };
  }

  const cases = await tr.getCases(
    String(effectiveProjectId),
    effectiveSuiteId ? String(effectiveSuiteId) : undefined,
    String(params.sectionId),
  );

  return {
    status: 200,
    body: {
      ok: true,
      sectionId: params.sectionId,
      projectId: effectiveProjectId,
      suiteId: effectiveSuiteId,
      cases,
    },
  };
}

// ── Sections cache ────────────────────────────────────────────────────────────
const SECTIONS_CACHE_TTL_MS = Number(process.env.TESTRAIL_SECTIONS_CACHE_TTL_MS) || 300_000;
const SECTIONS_STALE_TTL_MS = Number(process.env.TESTRAIL_SECTIONS_STALE_TTL_MS) || 1_800_000;

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
  expiresAt: number;
  staleExpiresAt: number;
}

const sectionsCache = new Map<string, CacheEntry<unknown>>();
const sectionsInflight = new Map<string, Promise<unknown>>();
const sectionsRateLimit = new Map<string, { retryAt: number; retryAfterSeconds: number }>();

function cacheGet(key: string): { data: unknown; stale: boolean } | null {
  const entry = sectionsCache.get(key);
  if (!entry) return null;
  const now = Date.now();
  if (now > entry.staleExpiresAt) {
    sectionsCache.delete(key);
    return null;
  }
  return { data: entry.data, stale: now > entry.expiresAt };
}

function cacheSet(key: string, data: unknown): void {
  const now = Date.now();
  sectionsCache.set(key, {
    data,
    fetchedAt: now,
    expiresAt: now + SECTIONS_CACHE_TTL_MS,
    staleExpiresAt: now + SECTIONS_STALE_TTL_MS,
  });
}

function rateLimitGet(key: string): { retryAt: number; retryAfterSeconds: number } | null {
  const entry = sectionsRateLimit.get(key);
  if (!entry) return null;
  if (Date.now() > entry.retryAt) {
    sectionsRateLimit.delete(key);
    return null;
  }
  return entry;
}

function rateLimitSet(key: string, retryAfterSeconds: number): void {
  sectionsRateLimit.set(key, {
    retryAt: Date.now() + retryAfterSeconds * 1000,
    retryAfterSeconds,
  });
}

function extractRetryAfterSeconds(message: string): number | null {
  const match = message.match(/Retry after (\d+)/i);
  return match ? Number(match[1]) : null;
}

async function fetchSectionsWithCache(projectIdNum: number, suiteIdNum: number) {
  const key = `${projectIdNum}:${suiteIdNum}`;

  // 1. Check rate limit block
  const rlBlock = rateLimitGet(key);
  if (rlBlock) {
    const remaining = Math.ceil((rlBlock.retryAt - Date.now()) / 1000);
    console.log(`[testrail:sections] rate_limit_cache_hit projectId=${projectIdNum} suiteId=${suiteIdNum} retryAfterSeconds=${remaining}`);

    // 2. Stale cache fallback
    const stale = cacheGet(key);
    if (stale) {
      console.log(`[testrail:sections] stale_cache_used projectId=${projectIdNum} suiteId=${suiteIdNum} stale=${stale.stale}`);
      return {
        status: 200,
        body: {
          ...(stale.data as Record<string, unknown>),
          cached: true,
          stale: stale.stale,
          rateLimited: true,
          retryAfterSeconds: remaining,
        },
      };
    }

    console.log(`[testrail:sections] skipped_due_to_rate_limit projectId=${projectIdNum} suiteId=${suiteIdNum}`);
    return {
      status: 429,
      body: {
        ok: false,
        error: "testrail_rate_limited",
        message: `TestRail rate limit active. Retry after ${remaining} seconds.`,
        retryAfterSeconds: remaining,
        projectId: projectIdNum,
        suiteId: suiteIdNum,
        cachedRateLimit: true,
      },
    };
  }

  // 3. Check cache (fresh or stale)
  const cached = cacheGet(key);
  if (cached && !cached.stale) {
    console.log(`[testrail:sections] cache_hit projectId=${projectIdNum} suiteId=${suiteIdNum}`);
    return { status: 200, body: { ...(cached.data as Record<string, unknown>), cached: true } };
  }

  // 4. In-flight deduplication
  const existing = sectionsInflight.get(key);
  if (existing) {
    console.log(`[testrail:sections] inflight_join projectId=${projectIdNum} suiteId=${suiteIdNum}`);
    const result = await existing;
    return result as { status: number; body: Record<string, unknown> };
  }

  // 5. Cache miss or stale — fetch from TestRail
  console.log(`[testrail:sections] cache_miss projectId=${projectIdNum} suiteId=${suiteIdNum} stale=${cached ? 'yes' : 'no'}`);

  const promise = (async (): Promise<{ status: number; body: Record<string, unknown> }> => {
    try {
      const tr = client();
      const rawSections = await tr.getSections(String(projectIdNum), String(suiteIdNum));

      const sectionMap = new Map<number, { id: number; name: string; suite_id: number; parent_id: number | null; depth: number }>();
      for (const s of rawSections) {
        sectionMap.set(s.id, {
          id: s.id,
          name: s.name,
          suite_id: s.suite_id,
          parent_id: s.parent_id ?? null,
          depth: s.depth ?? 0,
        });
      }

      const sections = rawSections.map((s) => {
        const parts: string[] = [];
        let current: { id: number; name: string; parent_id: number | null } | null = {
          id: s.id,
          name: s.name,
          parent_id: s.parent_id ?? null,
        };
        const visited = new Set<number>();
        while (current && !visited.has(current.id)) {
          visited.add(current.id);
          parts.unshift(current.name);
          if (!current.parent_id) break;
          const parent = sectionMap.get(current.parent_id);
          current = parent ? { id: parent.id, name: parent.name, parent_id: parent.parent_id } : null;
        }

        return {
          id: s.id,
          name: s.name,
          suite_id: s.suite_id,
          parent_id: s.parent_id ?? null,
          depth: s.depth ?? 0,
          displayName: parts.length > 0 ? parts.join(" / ") : s.name,
        };
      });

      console.log(`[testrail:sections] loaded ${sections.length} sections`);

      const result = { ok: true, projectId: projectIdNum, suiteId: suiteIdNum, sections, cached: false };
      cacheSet(key, result);

      return { status: 200, body: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Handle 429
      if (message.includes("429") || message.includes("Rate Limit")) {
        const retryAfter = extractRetryAfterSeconds(message) ?? 60;
        console.error(`[testrail:sections] rate_limited projectId=${projectIdNum} suiteId=${suiteIdNum} retryAfterSeconds=${retryAfter}`);
        rateLimitSet(key, retryAfter);

        // Stale cache fallback
        const stale = cacheGet(key);
        if (stale) {
          console.log(`[testrail:sections] stale_cache_fallback projectId=${projectIdNum} suiteId=${suiteIdNum} count=${(stale.data as any)?.sections?.length ?? 0}`);
          return {
            status: 200,
            body: {
              ...(stale.data as Record<string, unknown>),
              cached: true,
              stale: stale.stale,
              rateLimited: true,
              retryAfterSeconds: retryAfter,
            },
          };
        }

        return {
          status: 429,
          body: {
            ok: false,
            error: "testrail_rate_limited",
            message: `TestRail rate limit exceeded. Retry after ${retryAfter} seconds.`,
            retryAfterSeconds: retryAfter,
            projectId: projectIdNum,
            suiteId: suiteIdNum,
            cachedRateLimit: true,
          },
        };
      }

      console.error(`[testrail:sections] failed projectId=${projectIdNum} suiteId=${suiteIdNum} error=${message}`);

      return {
        status: 502,
        body: {
          ok: false,
          error: "testrail_sections_fetch_failed",
          message,
          projectId: projectIdNum,
          suiteId: suiteIdNum,
        },
      };
    } finally {
      sectionsInflight.delete(key);
    }
  })();

  sectionsInflight.set(key, promise);
  return promise;
}

testrailRouter.get("/status", async (_req, res, next) => {
  try {
    const result = await client().testConnection();
    res.json({
      ok: result.ok,
      userEmail: result.userEmail,
      projectId: config.integrations.testRail?.projectId,
      suiteId: config.integrations.testRail?.suiteId,
      sectionId: config.integrations.testRail?.sectionId
    });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects", async (req, res, next) => {
  try {
    const tr = client();
    const withCounts = req.query["counts"] === "true";
    const projects = await tr.getProjects();

    const enriched = await Promise.all(
      projects.map(async (project) => {
        try {
          const suites = await tr.getSuites(String(project.id));

          if (!withCounts) {
            return { ...project, suites };
          }

          const suitesWithCounts = await Promise.all(
            suites.map(async (suite) => {
              const { count, hasMore } = await tr.getCaseCount(String(project.id), String(suite.id));
              return { ...suite, caseCount: count, caseCountApproximate: hasMore };
            })
          );
          const totalCaseCount = suitesWithCounts.reduce((sum, s) => sum + s.caseCount, 0);
          return { ...project, suites: suitesWithCounts, totalCaseCount };
        } catch {
          return { ...project, suites: [] };
        }
      })
    );

    res.json({ projects: enriched });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects/:projectId/suites", async (req, res, next) => {
  try {
    const suites = await client().getSuites(req.params.projectId);
    res.json({ suites });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/projects/:projectId/suites/:suiteId/sections", async (req, res, next) => {
  try {
    const sections = await client().getSections(req.params.projectId, req.params.suiteId);
    res.json({ sections });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/runs", async (_req, res, next) => {
  try {
    const projectId = config.integrations.testRail?.projectId;
    if (!projectId) {
      res.status(400).json({ error: "TESTRAIL_PROJECT_ID not configured" });
      return;
    }
    const suiteId = config.integrations.testRail?.suiteId;
    const runs = await client().getRuns(projectId, suiteId);
    res.json({ runs });
  } catch (err) {
    next(err);
  }
});

testrailRouter.get("/sections", async (req, res) => {
  const { projectId, suiteId } = req.query;

  if (!projectId) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "projectId is required" });
    return;
  }
  if (!suiteId) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "suiteId is required" });
    return;
  }

  const projectIdNum = Number(projectId);
  const suiteIdNum = Number(suiteId);

  if (!Number.isFinite(projectIdNum) || String(projectIdNum) !== String(projectId)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "projectId must be numeric" });
    return;
  }
  if (!Number.isFinite(suiteIdNum) || String(suiteIdNum) !== String(suiteId)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "suiteId must be numeric" });
    return;
  }

  const result = await fetchSectionsWithCache(projectIdNum, suiteIdNum);
  res.status(result.status).json(result.body);
});

testrailRouter.get("/sections/:sectionId/cases", async (req, res, next) => {
  try {
    const sectionId = Number(req.params.sectionId);
    if (!Number.isFinite(sectionId) || String(sectionId) !== req.params.sectionId) {
      res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "sectionId must be numeric",
        sectionId: req.params.sectionId,
      });
      return;
    }

    const projectId = req.query.projectId ? Number(req.query.projectId) : undefined;
    const suiteId = req.query.suiteId ? Number(req.query.suiteId) : undefined;

    if (req.query.projectId && (!Number.isFinite(projectId) || String(projectId) !== String(req.query.projectId))) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "projectId must be numeric" });
      return;
    }
    if (req.query.suiteId && (!Number.isFinite(suiteId) || String(suiteId) !== String(req.query.suiteId))) {
      res.status(400).json({ ok: false, error: "invalid_request", message: "suiteId must be numeric" });
      return;
    }

    const result = await resolveSectionCases(client(), { sectionId, projectId, suiteId });
    res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
});

testrailRouter.post("/cases/preview", async (req, res) => {
  try {
    const body = req.body as ScenarioPreviewRequest;
    const result = await generateScenarioPreview(body);

    if (!result.ok) {
      const errorResult = result as Extract<typeof result, { ok: false }>;
      const status = errorResult.error === "no_active_sprint" ? 404 : errorResult.error === "invalid_request" ? 400 : 502;
      res.status(status).json(errorResult);
      return;
    }

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[testrail:cases:preview] failed error=${message}`);
    res.status(502).json({
      ok: false,
      error: "scenario_generation_failed",
      message: "AI generation failed or timed out",
    });
  }
});
