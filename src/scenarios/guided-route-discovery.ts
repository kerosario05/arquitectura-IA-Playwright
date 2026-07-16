import * as fs from "node:fs";
import * as path from "node:path";
import type {
  GuidedRouteDiscoveryRequest,
  GuidedRouteDiscoveryResponse,
  GuidedRouteDiscoveryCandidate,
} from "./scenario-types";

/**
 * Guided Route Discovery Runner
 *
 * Generic implementation for discovering a missing route by intent.
 *
 * Modes:
 * - dryRun=true: returns status="planned" (no execution)
 * - dryRun=false, no mode: returns candidate from config/knowledge (no browser)
 * - dryRun=false, mode=candidate_only: uses Playwright to navigate prefix
 *   and observe continuation candidates. Does NOT persist.
 *
 * No hardcoded modules, products, apps, or labels.
 */

type KnowledgeItem = {
  id: string;
  knowledgeKind: string;
  trustedForReuse?: boolean;
  validationStatus?: string;
  failureCount?: number;
  successCount?: number;
  clickTargets: string[];
  assertionTargets?: string[];
  coverageRefs?: string[];
  authTerms?: string[];
  manual?: boolean;
  rejectedReason?: string;
  confidenceScore?: number;
};

function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const appsDir = path.join(process.cwd(), "automations", "apps");
    const appConfigPath = path.join(appsDir, appSlug, "app.config.json");
    if (!fs.existsSync(appConfigPath)) return null;
    return JSON.parse(fs.readFileSync(appConfigPath, "utf-8"));
  } catch {
    return null;
  }
}

function getBaseUrlFromConfig(appConfig: Record<string, unknown> | null): string | null {
  return (appConfig?.baseUrl as string) || (appConfig?.appProfile as Record<string, unknown>)?.baseUrl as string || null;
}

function getRouteProfileFromConfig(appConfig: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!appConfig) return null;
  return (appConfig?.routeProfile as Record<string, unknown>) ?? null;
}

function extractEntrySteps(configRp: Record<string, unknown> | null): string[] {
  if (!configRp) return [];
  const steps: string[] = [];
  const entrySteps = configRp.entrySteps as Array<{ action: string; target: string }> | undefined;
  if (entrySteps) {
    for (const es of entrySteps) {
      if (es.action === "click" && es.target) steps.push(es.target);
    }
  }
  const entry = configRp.entry as Array<{ visibleLabel: string }> | undefined;
  if (entry) {
    for (const e of entry) {
      if (e.visibleLabel) steps.push(e.visibleLabel);
    }
  }
  return steps;
}

function extractVisibleControls(appConfig: Record<string, unknown> | null): string[] {
  if (!appConfig) return [];
  const controls = appConfig.visibleControls as string[] | undefined;
  if (controls && controls.length > 0) return controls;
  const profileControls = (appConfig.appProfile as Record<string, unknown>)?.visibleControls as string[] | undefined;
  return profileControls ?? [];
}

function buildCandidateFromConfig(
  appSlug: string, entrySteps: string[], visibleControls: string[], huIntent: string,
): GuidedRouteDiscoveryCandidate {
  return {
    routeName: `candidate_from_config_${appSlug}`,
    confidence: entrySteps.length > 0 ? "medium" : "low",
    source: "config",
    entrySteps: entrySteps.length > 0 ? entrySteps : undefined,
    targetHints: visibleControls.length > 0 ? visibleControls : undefined,
    observedLabels: visibleControls.length > 0 ? visibleControls.slice(0, 10) : undefined,
    matchedIntentSignals: [huIntent],
    diagnostics: entrySteps.length > 0
      ? [`${entrySteps.length} entry steps mapped from config`]
      : ["No entry steps found in config"],
  };
}

function loadKnowledgeItems(appSlug: string): KnowledgeItem[] {
  try {
    const kp = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
    if (!fs.existsSync(kp)) return [];
    const raw = JSON.parse(fs.readFileSync(kp, "utf-8"));
    return Array.isArray(raw.items) ? raw.items : [];
  } catch {
    return [];
  }
}

function filterEligibleKnowledge(items: KnowledgeItem[]): KnowledgeItem[] {
  return items.filter((item) =>
    item.trustedForReuse === true &&
    item.validationStatus === "validated" &&
    (item.failureCount ?? 0) === 0 &&
    item.manual !== true &&
    !item.rejectedReason &&
    Array.isArray(item.clickTargets) &&
    item.clickTargets.length > 0 &&
    ["route_prefix", "route_functional", "scenario_validated"].includes(item.knowledgeKind)
  );
}

function scoreKnowledgeItems(items: KnowledgeItem[]): Array<{ item: KnowledgeItem; score: number }> {
  return items.map((item) => {
    let score = 0;
    const refs = (item.coverageRefs ?? []).join(" ");
    if (item.trustedForReuse) score += 50;
    if (item.validationStatus === "validated") score += 30;
    if (item.knowledgeKind === "route_prefix") score += 25;
    else if (item.knowledgeKind === "route_functional") score += 15;
    if (/accessLevel:private|accessLevel:authenticated/.test(refs)) score += 20;
    if (/startsFrom:public_initial|startsFrom:authenticated_state/.test(refs)) score += 10;
    if (/endsAt:auth_gate/.test(refs)) score += 5;
    if (Array.isArray(item.authTerms) && item.authTerms.length > 0) score += 15;
    if ((item.successCount ?? 0) > 0) score += 10;
    if (item.confidenceScore && item.confidenceScore >= 60) score += 10;
    const allClicks = (item.clickTargets ?? []).join(" ").toLowerCase();
    if (/informaci\u00f3n de productos|catalogo de productos|listado de productos/.test(allClicks)) score -= 25;
    return { item, score };
  }).sort((a, b) => b.score - a.score);
}

function buildKnowledgeCandidate(
  best: { item: KnowledgeItem; score: number }, huIntent: string,
): GuidedRouteDiscoveryCandidate {
  return {
    routeName: `knowledge_prefix_${best.item.id.slice(0, 12)}`,
    confidence: best.score >= 70 ? "high" : best.score >= 40 ? "medium" : "low",
    source: "knowledge_base",
    entrySteps: best.item.clickTargets,
    targetHints: best.item.assertionTargets && best.item.assertionTargets.length > 0 ? best.item.assertionTargets : undefined,
    observedLabels: best.item.clickTargets,
    matchedIntentSignals: [huIntent],
    diagnostics: [
      `knowledge candidate id=${best.item.id} kind=${best.item.knowledgeKind} score=${best.score}`,
      `clickTargets=${best.item.clickTargets.length} assertionTargets=${(best.item.assertionTargets ?? []).length}`,
    ],
  };
}

export async function runGuidedRouteDiscovery(
  request: GuidedRouteDiscoveryRequest,
): Promise<GuidedRouteDiscoveryResponse> {
  const { appSlug, issueKey, huIntent, reasonCode } = request;
  const dryRun = request.dryRun !== false;
  const mode = request.mode;

  console.log(
    `[guided-route-discovery] requested appSlug=${appSlug} issue=${issueKey} huIntent=${huIntent} reason=${reasonCode} dryRun=${dryRun} mode=${mode ?? "standard"}`,
  );

  // ── Validate payload ──
  const missing: string[] = [];
  if (!appSlug?.trim()) missing.push("appSlug");
  if (!issueKey?.trim()) missing.push("issueKey");
  if (!huIntent?.trim()) missing.push("huIntent");
  if (!reasonCode?.trim()) missing.push("reasonCode");

  if (missing.length > 0) {
    console.log(`[guided-route-discovery] skipped reason=insufficient_payload missing=${missing.join(",")}`);
    return { ok: false, status: "insufficient_payload", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug: appSlug ?? "", issueKey: issueKey ?? "", huIntent: huIntent ?? "", reasonCode: reasonCode ?? "", nextAction: "provide_required_fields", candidateRoute: null, observations: missing.map((f) => ({ step: `validate_${f}`, status: "skipped", detail: `Missing required field: ${f}` })), warnings: [`Insufficient payload: ${missing.join(", ")}`], message: `Missing required fields: ${missing.join(", ")}`, dryRun };
  }

  // ── dryRun=true → plan ──
  if (dryRun) {
    console.log(`[guided-route-discovery] planned discoveryType=intent_route_discovery`);
    return { ok: true, status: "planned", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "run_guided_route_discovery", candidateRoute: null, observations: [
      { step: "validate_issue_context", status: "skipped", detail: "not executed (dryRun=true)" },
      { step: "authenticate_user", status: "skipped", detail: "not executed (dryRun=true)" },
      { step: "navigate_ui", status: "skipped", detail: "not executed (dryRun=true)" },
      { step: "observe_transitions", status: "skipped", detail: "not executed (dryRun=true)" },
    ], warnings: ["dryRun=true: planned only, no execution."], message: `Guided route discovery planned for issue=${issueKey}. Set dryRun=false to execute.`, dryRun: true };
  }

  // ── dryRun=false → load runtime context ──
  const appConfig = loadAppConfigSync(appSlug);
  const baseUrl = getBaseUrlFromConfig(appConfig);
  const configRp = getRouteProfileFromConfig(appConfig);

  if (!baseUrl) {
    console.log(`[guided-route-discovery] runtimeContext missing baseUrl=no`);
    return { ok: false, status: "insufficient_runtime_context", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "configure_app_base_url", candidateRoute: null, observations: [{ step: "load_app_config", status: "failed", detail: `No baseUrl for appSlug=${appSlug}` }], warnings: ["Runtime context insufficient: baseUrl missing."], message: `Cannot discover route for ${appSlug}: baseUrl not configured.`, dryRun: false };
  }

  const entrySteps = extractEntrySteps(configRp);
  const visibleControls = extractVisibleControls(appConfig);
  console.log(`[guided-route-discovery] runtimeContext baseUrl=yes entrySteps=${entrySteps.length} visibleControls=${visibleControls.length}`);

  const isMismatch = reasonCode === "route_profile_intent_mismatch";

  // ── candidate_only mode: real Playwright navigation ──
  if (!dryRun && mode === "candidate_only") {
    const knowledgeItems = loadKnowledgeItems(appSlug);
    const eligible = filterEligibleKnowledge(knowledgeItems);
    console.log(`[guided-route-discovery] knowledge candidates scanned=${knowledgeItems.length} eligible=${eligible.length}`);

    if (eligible.length === 0) {
      console.log(`[guided-route-discovery] candidate_only aborted reason=no_eligible_knowledge`);
      return { ok: false, status: "no_candidate_found", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "configure_knowledge_prefix", candidateRoute: null, observations: [{ step: "load_knowledge", status: "failed", detail: "No eligible knowledge items" }], warnings: ["No eligible knowledge prefix found for guided navigation."], message: `Cannot run guided discovery: no trusted knowledge prefix for ${appSlug}.`, dryRun: false };
    }

    const scored = scoreKnowledgeItems(eligible);
    const best = scored[0];
    const prefixTargets = best.item.clickTargets;

    console.log(`[guided-route-discovery] knowledge prefix selected id=${best.item.id} source=knowledge_base targets=${prefixTargets.length}`);
    console.log(`[guided-route-discovery] prefix navigation started appSlug=${appSlug} targets=${prefixTargets.length}`);

    // Attempt Playwright navigation
    let playwrightAvailable = false;
    try {
      const { chromium } = await import("playwright");
      playwrightAvailable = true;
    } catch {
      playwrightAvailable = false;
    }

    if (!playwrightAvailable) {
      console.log(`[guided-route-discovery] candidate_only skipped reason=playwright_unavailable`);
      // Fall back to knowledge candidate without browser
      const candidate = buildKnowledgeCandidate(best, huIntent);
      return { ok: true, status: "candidate_found", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "validate_candidate_route", candidateRoute: candidate, observations: [
        { step: "load_knowledge", status: "completed", detail: `prefix=${best.item.id} targets=${prefixTargets.length}` },
        { step: "playwright_browser", status: "failed", detail: "Playwright not available in this runtime" },
      ], warnings: ["Playwright unavailable: candidate from knowledge only (not navigated)."], message: `Candidate route prefix found from knowledge (no browser navigation).`, dryRun: false };
    }

    // Playwright is available - execute real navigation
    try {
      const { chromium } = await import("playwright");
      const { waitForPageReady } = await import("../browser/page-readiness");

      const headlessMode = request.headless !== false;
console.log(`[guided-route-discovery] browser headless=${headlessMode}`);
const browser = await chromium.launch({ headless: headlessMode });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const navigationObservations: Array<{ step: string; status: "completed" | "failed" | "pending"; detail: string }> = [];

      try {
        // Navigate to base URL
        await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await waitForPageReady(page, { domContentLoadedTimeoutMs: 10000, stabilizationMs: 500 });
        navigationObservations.push({ step: "navigate_base_url", status: "completed", detail: `baseUrl=${baseUrl}` });

        // Execute prefix clicks
        let prefixCompleted = true;
        for (let i = 0; i < prefixTargets.length; i++) {
          const target = prefixTargets[i];
          const locators = [
            page.getByRole("button", { name: target }),
            page.getByRole("link", { name: target }),
            page.getByText(target, { exact: true }),
            page.getByText(target),
          ];
          let clicked = false;
          for (const locator of locators) {
            try {
              await locator.first().click({ timeout: 5000 });
              await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 300 });
              clicked = true;
              console.log(`[guided-route-discovery] prefix step clicked index=${i} target="${target}"`);
              break;
            } catch { /* try next locator */ }
          }
          if (!clicked) {
            console.log(`[guided-route-discovery] prefix step failed index=${i} target="${target}"`);
            prefixCompleted = false;
            break;
          }
        }

        if (!prefixCompleted) {
          await browser.close();
          return { ok: false, status: "prefix_failed", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "review_prefix_targets", candidateRoute: null, observations: [...navigationObservations, { step: "prefix_navigation", status: "failed", detail: `Failed at step ${prefixTargets.length}` }], warnings: ["Prefix navigation failed: some click targets not found on page."], message: `Prefix navigation incomplete for ${appSlug}. Verify knowledge prefix targets match current UI.`, dryRun: false };
        }

        console.log(`[guided-route-discovery] prefix navigation completed currentUrl=${page.url()}`);

        // Detect auth gate after prefix
        const currentUrl = page.url().toLowerCase();
        const pageText = await page.evaluate(() => document.body?.textContent ?? "").catch(() => "");
        const hasAuthUrl = /auth|login|identificaci|otp|phone|verificac/i.test(currentUrl);
        const hasAuthText = /(iniciar sesi|autentic|identificac|otp|c.digo|contrase|password)/i.test(pageText);
        const authGateDetected = hasAuthUrl || hasAuthText;

        if (authGateDetected) {
          console.log(`[guided-route-discovery] auth gate detected type=${hasAuthUrl ? "url" : "text"} url=${currentUrl}`);
          navigationObservations.push({ step: "auth_gate", status: "pending", detail: `Auth gate detected (${hasAuthUrl ? "url" : "text"})` });

          // Attempt AuthFlow using credentials from app config
          const loginMode = (appConfig?.loginMode as string) || "no_login";
          console.log(`[guided-route-discovery] auth flow starting loginMode=${loginMode}`);

          let authSuccess = false;
          try {
            if (loginMode === "password") {
              const username = appConfig?.username || process.env.APP_USERNAME || "";
              const password = appConfig?.password || process.env.APP_PASSWORD || "";
              if (username && password) {
                // Try common login patterns
                const usernameLocators = [page.getByLabel(/usuario|username|email|c.dula|identificac/i), page.locator('input[type="text"]').first(), page.locator('input[name*="user" i], input[name*="email" i], input[name*="ident" i]').first()];
                const passwordLocators = [page.getByLabel(/contraseña|password|pin|clave/i), page.locator('input[type="password"]').first()];
                const submitLocators = [page.getByRole("button", { name: /ingresar|acceder|entrar|login|continuar|iniciar/i }), page.getByRole("button").first()];

                for (const loc of usernameLocators) {
                  try { await loc.fill(username); break; } catch { continue; }
                }
                for (const loc of passwordLocators) {
                  try { await loc.fill(password); break; } catch { continue; }
                }
                for (const loc of submitLocators) {
                  try { await loc.click({ timeout: 5000 }); break; } catch { continue; }
                }
                await waitForPageReady(page, { domContentLoadedTimeoutMs: 10000, stabilizationMs: 500 });
                authSuccess = true;
              }
            } else {
              console.log(`[guided-route-discovery] auth flow skipped reason=unsupported_loginMode loginMode=${loginMode}`);
            }
          } catch (authErr: any) {
            console.log(`[guided-route-discovery] auth flow failed reason=${authErr?.message ?? "unknown"}`);
          }

          if (authSuccess) {
            console.log(`[guided-route-discovery] auth flow completed=true`);
            navigationObservations.push({ step: "auth_gate", status: "completed", detail: "Auth flow completed" });
          } else {
            console.log(`[guided-route-discovery] auth flow completed=false`);
            navigationObservations.push({ step: "auth_gate", status: "failed", detail: "Auth flow failed" });
            await browser.close();
            return {
              ok: false, status: "auth_failed", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery",
              appSlug, issueKey, huIntent, reasonCode, nextAction: "configure_auth_credentials",
              candidateRoute: null,
              observations: [...navigationObservations],
              warnings: ["Auth gate detected but authentication failed."],
              message: `Auth flow failed for ${appSlug}. Check credentials or loginMode configuration.`,
              dryRun: false, persisted: false, mode: "candidate_only",
              sideEffects: { persistedConfig: false, persistedKnowledge: false, promotedScenarios: false, executedMcp: false, publishedTestRail: false },
            };
          }
        } else {
          navigationObservations.push({ step: "auth_gate", status: "completed", detail: "No auth gate detected" });
        }

        // Scan current page for continuation options
        const { scanCurrentPage } = await import("../explorer/page-scanner");
        const snapshot = await scanCurrentPage(page);
        const snapshotElements = snapshot.elements || [];

        const labels = snapshotElements
          .filter((e: any) => e.text && e.text.length > 2)
          .map((e: any) => e.text)
          .filter((t: string, i: number, a: string[]) => a.indexOf(t) === i);

        const buttons = snapshotElements
          .filter((e: any) => (e.tagName === "button" || e.role === "button") && e.text && e.visible !== false)
          .map((e: any) => e.text)
          .filter(Boolean);

        const links = snapshotElements
          .filter((e: any) => (e.tagName === "a" || e.role === "link") && e.text && e.visible !== false)
          .map((e: any) => e.text)
          .filter(Boolean);

        console.log(`[guided-route-discovery] continuation snapshot labels=${labels.length} buttons=${buttons.length} links=${links.length}`);

        

        // Score continuation candidates against HU text
        const huText = [request.jiraSummary ?? "", request.jiraDescription ?? "", request.acceptanceCriteria ?? ""]
          .filter(Boolean).join(" ").toLowerCase();

        const sensitiveActions = ["confirmar", "enviar", "solicitar", "generar", "pagar", "transferir", "finalizar"];
        const candidateClicks = [...buttons, ...links].filter((t: string) => !sensitiveActions.some((s) => t.toLowerCase().includes(s)));
        const scoredCandidates = candidateClicks.map((t: string) => {
          const tl = t.toLowerCase();
          const matchScore = huText ? (huText.includes(tl) ? 3 : 0) + (huText.split(" ").some((w) => tl.includes(w) || w.includes(tl)) ? 1 : 0) : 1;
          return { target: t, score: matchScore };
        }).sort((a, b) => b.score - a.score);

        console.log(`[guided-route-discovery] continuation candidates found=${scoredCandidates.length}`);

        // Build candidate route
        const candidateSteps = [...prefixTargets];
        const topCandidates = scoredCandidates.filter((c) => c.score > 0).slice(0, 3);
        if (topCandidates.length > 0) {
          candidateSteps.push(`[candidate] ${topCandidates[0].target}`);
        }

        const candidateRoute: GuidedRouteDiscoveryCandidate = {
          routeName: `guided_discovery_${issueKey}`,
          confidence: topCandidates.length > 0 ? "medium" : "low",
          source: "runtime_observation",
          entrySteps: prefixTargets,
          targetHints: topCandidates.map((c) => c.target),
          observedLabels: labels.slice(0, 15),
          matchedIntentSignals: [huIntent],
          diagnostics: [
            `prefix navigation: ${prefixCompleted ? "completed" : "failed"}`,
            `continuation candidates: ${scoredCandidates.length}`,
            `top candidate: ${topCandidates[0]?.target ?? "none"}`,
            `requiresHumanReview: true`,
          ],
        };

        console.log(`[guided-route-discovery] candidate selected confidence=${candidateRoute.confidence}`);
        console.log(`[guided-route-discovery] persistence skipped reason=candidate_only`);
        console.log(`[guided-route-discovery] knowledge persistence skipped reason=candidate_only`);
        console.log(`[guided-route-discovery] scenarios not promoted reason=candidate_only`);
        console.log(`[guided-route-discovery] mcp execution skipped reason=candidate_only`);
        console.log(`[guided-route-discovery] testRail publish skipped reason=candidate_only`);

        await browser.close();

        return {
          ok: true,
          status: topCandidates.length > 0 ? "candidate_found" : "partial_candidate",
          discoveryType: "intent_route_discovery",
          recommendedMode: "guided_route_discovery",
          appSlug,
          issueKey,
          huIntent,
          reasonCode,
          nextAction: topCandidates.length > 0 ? "validate_candidate_route" : "review_human",
          candidateRoute,
          observations: [
            ...navigationObservations,
            { step: "prefix_navigation", status: prefixCompleted ? "completed" : "failed", detail: `${prefixTargets.length} steps` },
            { step: "continuation_scan", status: "completed", detail: `${labels.length} labels, ${buttons.length} buttons, ${links.length} links, ${scoredCandidates.length} candidates` },
            { step: "persistence", status: "skipped", detail: "candidate_only mode — not persisted" },
            { step: "knowledge_persistence", status: "skipped", detail: "candidate_only mode — not persisted" },
          ],
          warnings: [
            "Guided route discovery executed in candidate_only mode.",
            topCandidates.length === 0 ? "No continuation candidates found. Human review required." : "Candidate route requires human review before persistence.",
            "Not persisted. Not promoted. Not executed via MCP.",
          ],
          message: topCandidates.length > 0
            ? `Guided discovery completed for issue=${issueKey}. Prefix navigated (${prefixTargets.length} steps), ${scoredCandidates.length} continuation candidates found. Top candidate: ${topCandidates[0].target}.`
            : `Guided discovery completed for issue=${issueKey}. Prefix navigated but no continuation candidates found matching HU intent.`,
          dryRun: false,
          persisted: false,
          mode: "candidate_only",
          sideEffects: {
            persistedConfig: false,
            persistedKnowledge: false,
            promotedScenarios: false,
            executedMcp: false,
            publishedTestRail: false,
          },
        };
      } catch (navErr: any) {
        await browser.close().catch(() => {});
        console.log(`[guided-route-discovery] execution failed reason=${navErr?.message ?? "unknown"}`);
        return { ok: false, status: "execution_failed", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "check_browser_connectivity", candidateRoute: null, observations: [{ step: "playwright_navigation", status: "failed", detail: navErr?.message ?? "unknown" }], warnings: ["Guided route discovery execution failed."], message: `Navigation failed: ${navErr?.message ?? "unknown"}`, dryRun: false };
      }
    } catch (err: any) {
      console.log(`[guided-route-discovery] execution failed reason=${err?.message ?? "playwright_not_available"}`);
      return { ok: false, status: "execution_failed", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "install_playwright", candidateRoute: null, observations: [{ step: "playwright_setup", status: "failed", detail: err?.message ?? "unknown" }], warnings: ["Playwright setup failed."], message: `Browser automation not available: ${err?.message ?? "unknown"}`, dryRun: false };
    }
  }

  // ── dryRun=false, standard mode: candidate from config/knowledge (no browser) ──
  if (isMismatch) {
    console.log(`[guided-route-discovery] config candidate skipped reason=route_profile_intent_mismatch`);

    // Try knowledge fallback
    const knowledgeItems = loadKnowledgeItems(appSlug);
    const eligible = filterEligibleKnowledge(knowledgeItems);
    console.log(`[guided-route-discovery] knowledge candidates scanned=${knowledgeItems.length} eligible=${eligible.length}`);

    if (eligible.length > 0) {
      const scored = scoreKnowledgeItems(eligible);
      const best = scored[0];
      console.log(`[guided-route-discovery] knowledge candidate selected id=${best.item.id} kind=${best.item.knowledgeKind} score=${best.score} clicks=${best.item.clickTargets.length}`);
      const candidate = buildKnowledgeCandidate(best, huIntent);
      return { ok: true, status: "candidate_found", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "validate_candidate_route", candidateRoute: candidate, observations: [
        { step: "config_candidate_rejected", status: "completed", detail: "route_profile_intent_mismatch" },
        { step: "knowledge_candidate", status: "completed", detail: `id=${best.item.id} kind=${best.item.knowledgeKind} score=${best.score}` },
      ], warnings: ["Config route profile rejected. Candidate from trusted knowledge."], message: `Candidate route prefix found from knowledge for issue=${issueKey}.`, dryRun: false };
    }

    console.log(`[guided-route-discovery] knowledge candidate skipped reason=knowledge_unavailable`);
    return { ok: false, status: "no_candidate_found", discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: "configure_route_profile", candidateRoute: null, observations: [
      { step: "config_candidate_rejected", status: "completed", detail: "route_profile_intent_mismatch" },
      { step: "knowledge_search", status: "failed", detail: "No eligible knowledge items" },
    ], warnings: ["No candidate found. Knowledge unavailable or incompatible."], message: `No candidate route for issue=${issueKey}: incompatible config and no trusted knowledge fallback.`, dryRun: false };
  }

  // Config candidate (not mismatch)
  const candidate = buildCandidateFromConfig(appSlug, entrySteps, visibleControls, huIntent);
  const configStatus = candidate.confidence === "low" && entrySteps.length === 0 ? "no_candidate_found" : "candidate_found";
  console.log(`[guided-route-discovery] candidate status=${configStatus} confidence=${candidate.confidence} source=config`);
  console.log(`[guided-route-discovery] persistence skipped reason=phase_candidate_only`);
  console.log(`[guided-route-discovery] scenarios skipped reason=phase_candidate_only`);
  return { ok: configStatus === "candidate_found", status: configStatus, discoveryType: "intent_route_discovery", recommendedMode: "guided_route_discovery", appSlug, issueKey, huIntent, reasonCode, nextAction: configStatus === "candidate_found" ? "validate_candidate_route" : "configure_entry_steps", candidateRoute: configStatus === "candidate_found" ? candidate : null, observations: [
    { step: "load_app_config", status: "completed", detail: `Config loaded for ${appSlug}` },
    { step: "assess_candidate", status: configStatus === "candidate_found" ? "completed" : "failed", detail: `confidence=${candidate.confidence}` },
  ], warnings: configStatus === "candidate_found" ? ["Candidate route found from config."] : ["No entry steps found."], message: configStatus === "candidate_found" ? `Candidate route found for issue=${issueKey}.` : `No candidate route for issue=${issueKey}.`, dryRun: false };
}
