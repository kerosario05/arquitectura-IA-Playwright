import fs from "fs";
import path from "path";
import type { McpScenario } from "../../scenarios/scenario-types";
import type { VirtualCase } from "../../types/scenario-preview.types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-preview-runs");

export type CaseOutcome = { id: string; status: string; failureReason?: string };

export type RerunPrepareResult = {
  ok: true;
  scenarios: McpScenario[];
  selectedCount: number;
  totalCount: number;
  sourceJobId: string;
  rerunMode: "failed_only" | "all";
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
} | {
  ok: false;
  error: string;
  message: string;
};

type JobMetadata = {
  appSlug?: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
  sourceJobId?: string;
  rerunMode?: string;
};

function virtualCaseToScenario(vc: VirtualCase): McpScenario {
  return {
    sourceIssueKey: vc.sourceIssueKey,
    title: vc.title,
    steps: vc.steps,
    preconditions: vc.preconditions ?? [],
    expectedResult: vc.expectedResult,
    type: vc.type ?? "Functional",
    database: "QA",
    isConverted: 0,
    automationType: vc.automationType ?? "ui_with_auth_gate",
    setupStrategy: vc.setupStrategy ?? "auth_gate",
    appSlug: vc.appSlug,
    targetAppSlug: vc.targetAppSlug,
    targetAppName: vc.targetAppName,
    routeProfile: vc.routeProfile ?? "",
    dataRequirements: vc.dataRequirements ?? "",
    nonExecutableCriteria: "",
    mcpExecutable: vc.mcpExecutable !== false,
  };
}

function loadJobMetadata(sourceDir: string): JobMetadata {
  const metaPath = path.join(sourceDir, "job.json");
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as JobMetadata;
    } catch {
      // ignore parse errors
    }
  }
  return {};
}

export function prepareRerun(
  sourceJobId: string,
  mode: "failed_only" | "all",
): RerunPrepareResult {
  const sourceDir = path.join(ARTIFACTS_DIR, sourceJobId);
  const previewPath = path.join(sourceDir, "preview-scenarios.json");

  if (!fs.existsSync(previewPath)) {
    return { ok: false, error: "missing_preview_scenarios", message: `Source job ${sourceJobId} has no preview-scenarios.json at ${previewPath}` };
  }

  let allScenarios: VirtualCase[];
  try {
    allScenarios = JSON.parse(fs.readFileSync(previewPath, "utf-8")) as VirtualCase[];
  } catch (err) {
    return { ok: false, error: "parse_error", message: `Failed to parse preview-scenarios.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (allScenarios.length === 0) {
    return { ok: false, error: "empty_scenarios", message: "preview-scenarios.json contains no scenarios." };
  }

  // Extract metadata from artifacts
  const metadata = loadJobMetadata(sourceDir);
  const appSlug = metadata.appSlug || allScenarios[0]?.appSlug || "unknown";
  const targetAppSlug = metadata.targetAppSlug || allScenarios[0]?.targetAppSlug || appSlug;
  const targetAppName = metadata.targetAppName || allScenarios[0]?.targetAppName || targetAppSlug;
  const sectionName = metadata.sectionName;
  const sectionSlug = metadata.sectionSlug;

  let selectedVcs: VirtualCase[];

  if (mode === "failed_only") {
    const resultsPath = path.join(sourceDir, "results.json");

    if (!fs.existsSync(resultsPath)) {
      return { ok: false, error: "missing_results", message: `Source job ${sourceJobId} has no results.json. Cannot determine failed cases. Use mode=all instead.` };
    }

    let results: { caseResults?: CaseOutcome[] };
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
    } catch (err) {
      return { ok: false, error: "parse_error", message: `Failed to parse results.json: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!results.caseResults || results.caseResults.length === 0) {
      return { ok: false, error: "no_case_results", message: "No per-case results found in results.json. Cannot filter failed cases. Use mode=all instead." };
    }

    const failedIds = new Set(
      results.caseResults
        .filter((c) => c.status === "failed" || c.status === "review_needed")
        .map((c) => c.id),
    );

    selectedVcs = allScenarios.filter((vc) => failedIds.has(vc.displayId) || failedIds.has(vc.id));

    if (selectedVcs.length === 0) {
      return {
        ok: false,
        error: "no_failures",
        message: `No failed scenarios found in source job ${sourceJobId}. All ${allScenarios.length} scenarios passed.`,
      };
    }
  } else {
    selectedVcs = [...allScenarios];
  }

  const scenarios: McpScenario[] = selectedVcs.map(virtualCaseToScenario);

  return {
    ok: true,
    scenarios,
    selectedCount: scenarios.length,
    totalCount: allScenarios.length,
    sourceJobId,
    rerunMode: mode,
    appSlug,
    targetAppSlug,
    targetAppName,
    sectionName,
    sectionSlug,
    options: metadata.options,
  };
}
