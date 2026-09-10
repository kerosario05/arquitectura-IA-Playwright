import { test, expect } from "@playwright/test";
import { jobStore } from "../src/server/jobs/job-store";
import { buildRediscoveryCreateHandoffLine } from "../src/server/jobs/launch-orchestrator";
import { resolveJobStoreSourceJobId } from "../src/server/routes/runs";
import { buildDiscoveryPreviewArgs, buildRediscoveryProvenanceLine, resolveRediscoveryIntent, startDiscoveryBatchRun } from "../src/server/jobs/discovery-batch-runner";

// Helper to simulate the route handler validation logic
function validateDiscoveryBatchRequest(body: Record<string, unknown>): { ok: true } | { ok: false; status: number; error: string; invalidIds?: unknown[] } {
  const caseIds = body.caseIds as unknown[] | undefined;

  if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0) {
    return { ok: false, status: 400, error: "caseIds is required and must be a non-empty array" };
  }

  const invalidIds = caseIds.filter((id: unknown) => !Number.isInteger(id) || (id as number) <= 0);
  if (invalidIds.length > 0) {
    return { ok: false, status: 400, error: "All caseIds must be positive integers", invalidIds };
  }

  return { ok: true };
}

// ── Route validation tests ──

test("discovery-batch route: returns 400 if caseIds is missing", () => {
  const result = validateDiscoveryBatchRequest({});
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("caseIds is required and must be a non-empty array");
  }
});

test("discovery-batch route: returns 400 if caseIds is empty array", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("caseIds is required and must be a non-empty array");
  }
});

test("discovery-batch route: returns 400 if caseIds contains non-numeric values", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: ["abc", 123] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.error).toBe("All caseIds must be positive integers");
    expect(result.invalidIds).toContain("abc");
  }
});

test("discovery-batch route: returns 400 if caseIds contains negative numbers", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [1, -5, 3] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.invalidIds).toContain(-5);
  }
});

test("discovery-batch route: returns 400 if caseIds contains zero", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [0, 1] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.invalidIds).toContain(0);
  }
});

test("discovery-batch route: returns 400 if caseIds contains floats", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [1.5, 2] });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.status).toBe(400);
    expect(result.invalidIds).toContain(1.5);
  }
});

test("discovery-batch route: accepts valid numeric caseIds", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [38133, 38134] });
  expect(result.ok).toBe(true);
});

test("discovery-batch route: accepts single caseId", () => {
  const result = validateDiscoveryBatchRequest({ caseIds: [100] });
  expect(result.ok).toBe(true);
});

test("rediscovery provenance: preserves false, true, and undefined without coercion", () => {
  const cases = [
    { value: false, expected: { explicit: false, source: "none" } },
    { value: true, expected: { explicit: true, source: "user_request" } },
    { value: undefined, expected: { explicit: false, source: "none" } },
  ] as const;

  for (const entry of cases) {
    const intent = resolveRediscoveryIntent({ forceRediscovery: entry.value, rerunActive: false });
    const line = buildRediscoveryProvenanceLine({ boundary: "intent_input", value: entry.value });
    expect(line).toContain(`value=${entry.value === undefined ? "undefined" : entry.value}`);
    expect(line).toContain(`type=${entry.value === undefined ? "undefined" : "boolean"}`);
    expect(intent.explicit).toBe(entry.expected.explicit);
    expect(intent.source).toBe(entry.expected.source);
  }
});

test("rediscovery provenance: marks an absent producer property without inventing a value", () => {
  const line = buildRediscoveryProvenanceLine({
    boundary: "pre_job_store",
    sourceEndpoint: "/api/runs/launch-execution",
    jobType: "discovery-batch",
    correlationField: "launchId",
    correlationValue: "launch-test",
    valueSource: "absent",
  });

  expect(line).toContain("propertyPresent=false");
  expect(line).toContain("value=undefined");
  expect(line).toContain("type=undefined");
  expect(line).toContain("valueSource=absent");
  expect(line).toContain("launchId=launch-test");
});

test("rediscovery create handoff: correlates pre-create and stored snapshots", () => {
  const cases = [
    { value: undefined, present: false },
    { value: false, present: true },
    { value: true, present: true },
  ];

  for (const entry of cases) {
    const line = buildRediscoveryCreateHandoffLine({
      launchId: "launch-test",
      jobId: "job-test",
      prePresent: entry.present,
      preValue: entry.value,
      storedPresent: entry.present,
      storedValue: entry.value,
    });
    expect(line).toContain("boundary=create_handoff producer=launch_execution");
    expect(line).toContain("launchId=launch-test jobId=job-test");
    expect(line).toContain(`prePresent=${entry.present} preValue=${entry.value === undefined ? "undefined" : entry.value} preType=${entry.value === undefined ? "undefined" : "boolean"}`);
    expect(line).toContain(`storedPresent=${entry.present} storedValue=${entry.value === undefined ? "undefined" : entry.value} storedType=${entry.value === undefined ? "undefined" : "boolean"}`);
  }
});

test("job_store provenance: distinguishes direct and rerun sourceJobId", () => {
  expect(resolveJobStoreSourceJobId({ forceRediscovery: true })).toBe("none");
  expect(resolveJobStoreSourceJobId({ forceRediscovery: true, sourceJobId: "previous-job" })).toBe("previous-job");
});

// ── Job store tests ──

test("jobStore: creates discovery-batch job with correct type", () => {
  const job = jobStore.create("discovery-batch", { caseIds: [1, 2, 3] });
  expect(job.type).toBe("discovery-batch");
  expect(job.status).toBe("queued");
  expect(job.params.caseIds).toEqual([1, 2, 3]);
});

test("jobStore: discovery-batch job is retrievable", () => {
  const job = jobStore.create("discovery-batch", { caseIds: [42] });
  const retrieved = jobStore.get(job.id);
  expect(retrieved).toBeDefined();
  expect(retrieved?.type).toBe("discovery-batch");
  expect(retrieved?.params.caseIds).toEqual([42]);
});

test("jobStore: discovery-batch job appears in list", () => {
  const before = jobStore.list().length;
  jobStore.create("discovery-batch", { caseIds: [99] });
  const after = jobStore.list().length;
  expect(after).toBe(before + 1);
});

// ── Runner argument construction tests ──

// Extract argument building logic for testing
function buildDiscoveryBatchArgs(params: {
  caseIds: number[];
  appSlug?: string;
  sectionName?: string;
  overwrite?: boolean;
  autoPromote?: boolean;
  autoPom?: boolean;
  rerunActive?: boolean;
  headed?: boolean;
}): { cmd: string; args: string[]; caseIdsStr: string } {
  const caseIdsStr = params.caseIds.join(",");
  const args: string[] = [
    "run",
    "discovery:batch",
    "--",
    "--case-ids",
    caseIdsStr,
  ];

  if (params.appSlug) {
    args.push("--app", params.appSlug);
  }
  if (params.overwrite !== false) {
    args.push("--overwrite");
  }
  if (params.autoPromote !== false) {
    args.push("--auto-promote");
  }
  if (params.autoPom !== false) {
    args.push("--auto-pom");
  }
  if (params.rerunActive !== false) {
    args.push("--rerun-active");
  }
  if (params.headed) {
    args.push("--headed");
  }

  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";

  return { cmd, args, caseIdsStr };
}

test("runner: builds correct args for basic caseIds", () => {
  const { cmd, args, caseIdsStr } = buildDiscoveryBatchArgs({
    caseIds: [38133, 38134],
  });

  expect(caseIdsStr).toBe("38133,38134");
  expect(caseIdsStr).not.toMatch(/,\s/); // no space after comma
  expect(args).toContain("--case-ids");
  expect(args).toContain("38133,38134");
  expect(args).toContain("--overwrite");
  expect(args).toContain("--auto-promote");
  expect(args).toContain("--auto-pom");
  expect(args).toContain("--rerun-active");
  expect(process.platform === "win32" ? cmd === "npm.cmd" : cmd === "npm").toBe(true);
});

test("runner: no space after comma in caseIds string", () => {
  const { caseIdsStr } = buildDiscoveryBatchArgs({
    caseIds: [1, 2, 3, 4, 5],
  });
  expect(caseIdsStr).toBe("1,2,3,4,5");
  expect(caseIdsStr).not.toMatch(/\s/);
});

test("runner: includes --app when appSlug is provided", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    appSlug: "kiosko",
  });
  expect(args).toContain("--app");
  expect(args).toContain("kiosko");
});

test("runner: serializes structured routeProfile for discovery preview", () => {
  const routeProfile = {
    name: "kiosko",
    entry: [{ businessLabel: "home", visibleLabel: "Home" }],
    aliases: {},
    intermediates: {},
    domainTerms: { home: ["Home"] },
    visibleControls: ["Home"],
    representativeFixture: {},
    notes: [],
  };
  const args = buildDiscoveryPreviewArgs({
    previewPath: "preview.json",
    appSlug: "kiosko",
    routeProfile,
  });
  const profileIndex = args.indexOf("--route-profile-json");
  expect(profileIndex).toBeGreaterThanOrEqual(0);
  expect(JSON.parse(args[profileIndex + 1])).toEqual(routeProfile);
});

test("runner: does not include --app when appSlug is not provided", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
  });
  expect(args).not.toContain("--app");
});

test("runner: includes --headed when headed is true", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    headed: true,
  });
  expect(args).toContain("--headed");
});

test("runner: does not include --headed when headed is false", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    headed: false,
  });
  expect(args).not.toContain("--headed");
});

test("runner: omits --overwrite when overwrite is explicitly false", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    overwrite: false,
  });
  expect(args).not.toContain("--overwrite");
});

test("runner: omits --auto-promote when autoPromote is explicitly false", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    autoPromote: false,
  });
  expect(args).not.toContain("--auto-promote");
});

test("runner: omits --auto-pom when autoPom is explicitly false", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    autoPom: false,
  });
  expect(args).not.toContain("--auto-pom");
});

test("runner: omits --rerun-active when rerunActive is explicitly false", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [100],
    rerunActive: false,
  });
  expect(args).not.toContain("--rerun-active");
});

test("runner: args are safe array elements (no shell concatenation)", () => {
  const { args } = buildDiscoveryBatchArgs({
    caseIds: [38133, 38134],
    appSlug: "kiosko",
  });

  // Each arg should be a separate array element, not concatenated
  const caseIdsIndex = args.indexOf("--case-ids");
  expect(caseIdsIndex).toBeGreaterThanOrEqual(0);
  expect(args[caseIdsIndex + 1]).toBe("38133,38134");
  expect(args[caseIdsIndex + 1]).not.toContain(" ");

  const appIndex = args.indexOf("--app");
  expect(appIndex).toBeGreaterThanOrEqual(0);
  expect(args[appIndex + 1]).toBe("kiosko");
});

test("runner: full command matches expected format", () => {
  const { cmd, args } = buildDiscoveryBatchArgs({
    caseIds: [38133, 38134],
    appSlug: "kiosko",
    overwrite: true,
    autoPromote: true,
    autoPom: true,
    rerunActive: true,
  });

  const fullCmd = `${cmd} ${args.join(" ")}`;
  const expectedParts = [
    process.platform === "win32" ? "npm.cmd" : "npm",
    "run",
    "discovery:batch",
    "--",
    "--case-ids",
    "38133,38134",
    "--app",
    "kiosko",
    "--overwrite",
    "--auto-promote",
    "--auto-pom",
    "--rerun-active",
  ];

  for (const part of expectedParts) {
    expect(fullCmd).toContain(part);
  }
});

// ── Runner execution tests ──

test("runner: fails job when caseIds is empty", () => {
  const job = jobStore.create("discovery-batch", { caseIds: [] });
  startDiscoveryBatchRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.logs.some((l: string) => l.includes("no caseIds provided"))).toBe(true);
});

test("runner: fails job when caseIds is missing", () => {
  const job = jobStore.create("discovery-batch", {});
  startDiscoveryBatchRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.logs.some((l: string) => l.includes("no caseIds provided"))).toBe(true);
});

test("runner: starts job with valid caseIds and logs basic info", () => {
  const job = jobStore.create("discovery-batch", {
    caseIds: [38133, 38134],
    appSlug: "kiosko",
  });
  startDiscoveryBatchRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");
  expect(updated?.logs.some((l: string) => l.includes("caseIds=38133,38134"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("appSlug=kiosko"))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("command="))).toBe(true);
  expect(updated?.logs.some((l: string) => l.includes("started"))).toBe(true);
});

test("runner: summary includes caseIds and command", () => {
  const job = jobStore.create("discovery-batch", {
    caseIds: [100, 200],
    appSlug: "test-app",
  });
  startDiscoveryBatchRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.summary?.caseIds).toEqual([100, 200]);
  expect(updated?.summary?.command).toBeDefined();
  if (updated?.summary?.command) {
    expect(updated.summary.command).toContain("discovery:batch");
    expect(updated.summary.command).toContain("100,200");
  }
});

test("runner: does not use unsafe shell string concatenation", () => {
  const job = jobStore.create("discovery-batch", {
    caseIds: [38133, 38134],
    appSlug: "kiosko; rm -rf /",
  });
  startDiscoveryBatchRun(job.id);

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("running");

  // The command should have the appSlug as a separate argument, not concatenated into a shell string
  const commandLog = updated?.logs.find((l: string) => l.includes("command="));
  expect(commandLog).toBeDefined();
  // The dangerous string should be properly escaped as an array element
  expect(commandLog).toContain("--app");
  expect(commandLog).toContain("kiosko; rm -rf /");
});
