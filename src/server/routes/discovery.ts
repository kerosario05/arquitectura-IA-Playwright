import express from "express";
import {
  discoverPrivateCatalogAuthenticated,
  logPrivateDiscoveryResult,
  type AuthenticatedPrivateDiscoveryRequest,
} from "../../discovery/authenticated-private-discovery";

export const discoveryRouter = express.Router();

/**
 * POST /api/discovery/private
 * Request authenticated private catalog discovery
 */
discoveryRouter.post("/private", async (req, res) => {
  try {
    // Request-level flags must win over env so internal QA Lab discovery stays headless.
    const requestHeadless = req.body.headless === true;
    const requestHeaded = req.body.headed === true;
    const envHeaded = process.env.HEADLESS === "false" || process.env.PLAYWRIGHT_HEADLESS === "false";

    const isHeaded = requestHeadless ? false : requestHeaded ? true : envHeaded;
    const source = requestHeadless || requestHeaded ? "request" : envHeaded ? "env" : "default";
    console.log(`[private-discovery] browserMode headed=${isHeaded} headless=${!isHeaded} source=${source}`);

    const request: AuthenticatedPrivateDiscoveryRequest = {
      appSlug: req.body.appSlug,
      issueKey: req.body.issueKey,
      huText: req.body.huText,
      title: req.body.title,
      text: req.body.text,
      description: req.body.description,
      steps: req.body.steps,
      case: req.body.case,
      issue: req.body.issue,
      intent: req.body.intent,
      suggestedRoute: req.body.suggestedRoute,
      dryRun: req.body.dryRun !== false,
      headed: isHeaded,
    };

    const businessSource = request.huText ? "huText" : request.title ? "title" : request.text ? "text" : request.description ? "description" : request.steps?.length ? "steps" : request.case ? "case" : request.issue ? "issue" : "none";
    console.log(`[private-discovery] business_context source=${businessSource} hasHuText=${Boolean(request.huText)} hasTitle=${Boolean(request.title)} hasText=${Boolean(request.text)} hasDescription=${Boolean(request.description)} stepsCount=${request.steps?.length ?? 0} hasCase=${Boolean(request.case)} hasIssue=${Boolean(request.issue)}`);

    if (!request.appSlug) {
      res.status(400).json({
        ok: false,
        error: "missing_app_slug",
        message: "appSlug is required",
      });
      return;
    }

    const result = await discoverPrivateCatalogAuthenticated(request);
    logPrivateDiscoveryResult(result);

    res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[discovery-router] error: ${message}`, err);
    res.status(500).json({
      ok: false,
      error: "internal_error",
      message,
    });
  }
});
