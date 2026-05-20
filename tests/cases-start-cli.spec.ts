import { test, expect } from "@playwright/test";

type CliArgs = {
  caseId: number;
  projectId?: string;
  suiteId?: string;
  headed: boolean;
  continueOnFailure: boolean;
  noReport: boolean;
  dryRun: boolean;
  json: boolean;
  autoPromote: boolean;
  autoHandoff: boolean;
  autoRepair: boolean;
  reuseExisting: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    caseId: 0,
    headed: false,
    continueOnFailure: false,
    noReport: false,
    dryRun: false,
    json: false,
    autoPromote: false,
    autoHandoff: false,
    autoRepair: false,
    reuseExisting: true
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--headed") {
      args.headed = true;
      continue;
    }
    if (token === "--continue-on-failure") {
      args.continueOnFailure = true;
      continue;
    }
    if (token === "--no-report") {
      args.noReport = true;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--auto-promote" || token === "--promote") {
      args.autoPromote = true;
      continue;
    }
    if (token === "--auto") {
      args.autoHandoff = true;
      args.autoPromote = true;
      continue;
    }
    if (token === "--auto-repair") {
      args.autoRepair = true;
      continue;
    }
    if (token === "--reuse-existing") {
      args.reuseExisting = true;
      continue;
    }
    if (token === "--no-reuse-existing") {
      args.reuseExisting = false;
      continue;
    }

    if (
      (token === "--case-id" || token === "--project-id" || token === "--suite-id") &&
      (!nextValue || nextValue.startsWith("--"))
    ) {
      throw new Error(`Missing value for ${token}`);
    }

    if (token === "--case-id") {
      args.caseId = Number(nextValue);
      if (!Number.isFinite(args.caseId) || args.caseId <= 0) {
        throw new Error(`Invalid --case-id value: ${nextValue}. Expected a positive integer.`);
      }
      i += 1;
      continue;
    }
    if (token === "--project-id") {
      args.projectId = nextValue;
      i += 1;
      continue;
    }
    if (token === "--suite-id") {
      args.suiteId = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.caseId <= 0) {
    throw new Error("--case-id is required. Usage: npm run cases:start -- --case-id <number>");
  }

  return args;
}

test("--auto-promote is parsed correctly", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-promote"]);
  expect(args.autoPromote).toBe(true);
});

test("--promote is parsed as alias for --auto-promote", () => {
  const args = parseArgs(["--case-id", "37619", "--promote"]);
  expect(args.autoPromote).toBe(true);
});

test("without --auto-promote, autoPromote is false", () => {
  const args = parseArgs(["--case-id", "37618"]);
  expect(args.autoPromote).toBe(false);
});

test("--auto-promote combined with --dry-run", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-promote", "--dry-run"]);
  expect(args.autoPromote).toBe(true);
  expect(args.dryRun).toBe(true);
});

test("--auto-promote combined with --no-report", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-promote", "--no-report"]);
  expect(args.autoPromote).toBe(true);
  expect(args.noReport).toBe(true);
});

test("--promote combined with --dry-run and --no-report", () => {
  const args = parseArgs(["--case-id", "37619", "--promote", "--dry-run", "--no-report"]);
  expect(args.autoPromote).toBe(true);
  expect(args.dryRun).toBe(true);
  expect(args.noReport).toBe(true);
});

test("all flags together work correctly", () => {
  const args = parseArgs([
    "--case-id", "37618",
    "--headed",
    "--auto-promote",
    "--no-report",
    "--dry-run",
    "--json"
  ]);
  expect(args.caseId).toBe(37618);
  expect(args.headed).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.noReport).toBe(true);
  expect(args.dryRun).toBe(true);
  expect(args.json).toBe(true);
});

test("--auto enables both autoHandoff and autoPromote", () => {
  const args = parseArgs(["--case-id", "37618", "--auto"]);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
});

test("--auto combined with --dry-run", () => {
  const args = parseArgs(["--case-id", "37618", "--auto", "--dry-run"]);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.dryRun).toBe(true);
});

test("--auto combined with --no-report", () => {
  const args = parseArgs(["--case-id", "37618", "--auto", "--no-report"]);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.noReport).toBe(true);
});

test("--auto combined with all other flags", () => {
  const args = parseArgs([
    "--case-id", "37618",
    "--auto",
    "--headed",
    "--no-report",
    "--dry-run",
    "--json"
  ]);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.headed).toBe(true);
  expect(args.noReport).toBe(true);
  expect(args.dryRun).toBe(true);
  expect(args.json).toBe(true);
});

test("without --auto, autoHandoff is false", () => {
  const args = parseArgs(["--case-id", "37618"]);
  expect(args.autoHandoff).toBe(false);
});

test("--auto-promote alone does not enable autoHandoff", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-promote"]);
  expect(args.autoHandoff).toBe(false);
  expect(args.autoPromote).toBe(true);
});

test("--auto-repair is parsed correctly", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-repair"]);
  expect(args.autoRepair).toBe(true);
});

test("--auto-repair does not enable autoHandoff or autoPromote", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-repair"]);
  expect(args.autoRepair).toBe(true);
  expect(args.autoHandoff).toBe(false);
  expect(args.autoPromote).toBe(false);
});

test("--auto-repair combined with --auto and --auto-promote", () => {
  const args = parseArgs(["--case-id", "37618", "--auto", "--auto-repair"]);
  expect(args.autoRepair).toBe(true);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
});

test("--auto-repair combined with --dry-run", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-repair", "--dry-run"]);
  expect(args.autoRepair).toBe(true);
  expect(args.dryRun).toBe(true);
});

test("--auto-repair combined with --no-report", () => {
  const args = parseArgs(["--case-id", "37618", "--auto-repair", "--no-report"]);
  expect(args.autoRepair).toBe(true);
  expect(args.noReport).toBe(true);
});

test("without --auto-repair, autoRepair is false", () => {
  const args = parseArgs(["--case-id", "37618"]);
  expect(args.autoRepair).toBe(false);
});

test("reuseExisting is true by default", () => {
  const args = parseArgs(["--case-id", "37618"]);
  expect(args.reuseExisting).toBe(true);
});

test("--reuse-existing is parsed correctly", () => {
  const args = parseArgs(["--case-id", "37618", "--reuse-existing"]);
  expect(args.reuseExisting).toBe(true);
});

test("--no-reuse-existing is parsed correctly", () => {
  const args = parseArgs(["--case-id", "37618", "--no-reuse-existing"]);
  expect(args.reuseExisting).toBe(false);
});

test("--auto enables reuseExisting by default", () => {
  const args = parseArgs(["--case-id", "37618", "--auto"]);
  expect(args.reuseExisting).toBe(true);
});

test("--no-reuse-existing combined with --auto", () => {
  const args = parseArgs(["--case-id", "37618", "--auto", "--no-reuse-existing"]);
  expect(args.autoHandoff).toBe(true);
  expect(args.autoPromote).toBe(true);
  expect(args.reuseExisting).toBe(false);
});

type MockHandoffResult = {
  created: boolean;
  handoffDir?: string;
  requestPath?: string;
  instructionsPath?: string;
  schemaPath?: string;
  responsePath?: string;
  dryRun: boolean;
  reason?: string;
};

type MockAutoRepairResult = {
  attempted: boolean;
  success: boolean;
  dryRun: boolean;
  error?: string;
};

function formatHandoffOutput(handoff: MockHandoffResult, autoRepair?: MockAutoRepairResult): string {
  const lines: string[] = [];

  if (handoff.dryRun) {
    lines.push("[cases:start] Dry-run: would create agent handoff if plan was not validated.");
  } else if (handoff.reason === "plan_needs_discovery") {
    lines.push("");
    lines.push("=== SNAPSHOT GAP DETECTED ===");
    if (handoff.handoffDir) {
      lines.push(`Handoff directory: ${handoff.handoffDir}`);
    }
    lines.push("");
    lines.push("The requested flow requires browser discovery because target elements are not present in the captured snapshot.");
    lines.push("Codex cannot resolve locators for elements not visible in the snapshot without executing Playwright.");
    lines.push("");
    lines.push("Next steps:");
    lines.push("");
    lines.push(`npm.cmd run discovery:case -- --case-id ${handoff.handoffDir?.split("handoff-C")[1] ?? "37750"} --headed`);
  } else if (handoff.created && !autoRepair?.attempted) {
    const hasAllPaths = handoff.requestPath
      && handoff.instructionsPath
      && handoff.schemaPath
      && handoff.responsePath;

    if (!hasAllPaths) {
      lines.push("");
      lines.push("[cases:start] Handoff was created but some file paths are missing. Check the handoff directory for available files.");
      if (handoff.handoffDir) {
        lines.push(`Handoff directory: ${handoff.handoffDir}`);
      }
    } else {
      lines.push("");
      lines.push("=== AGENT HANDOFF PREPARED ===");
      lines.push(`Handoff directory: ${handoff.handoffDir}`);
      lines.push(`Request: ${handoff.requestPath}`);
      lines.push(`Instructions: ${handoff.instructionsPath}`);
      lines.push(`Schema: ${handoff.schemaPath}`);
      lines.push(`Response template: ${handoff.responsePath}`);
      lines.push("");
      lines.push("Next steps:");
      lines.push("");
      lines.push("1. Have Codex fill in the response template:");
      lines.push(`   Open ${handoff.instructionsPath} in VS Code with Codex`);
      lines.push("");
      lines.push("2. Validate the agent response and generate repaired plans:");
      lines.push(`   npm.cmd run agent:validate -- --response "${handoff.responsePath}" --request "${handoff.requestPath}" --output-plans .artifacts/plans/agent-plans.json`);
      lines.push("");
      lines.push("3. Execute the repaired plans:");
      lines.push(`   npm.cmd run plans:execute -- --plans .artifacts/plans/agent-plans.json --headed`);
    }
  }

  return lines.join("\n");
}

test("snapshot gap => does not print AGENT HANDOFF PREPARED", () => {
  const handoff: MockHandoffResult = {
    created: false,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
    dryRun: false,
    reason: "plan_needs_discovery"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).not.toContain("AGENT HANDOFF PREPARED");
  expect(output).toContain("SNAPSHOT GAP DETECTED");
});

test("snapshot gap => does not print undefined paths", () => {
  const handoff: MockHandoffResult = {
    created: false,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
    dryRun: false,
    reason: "plan_needs_discovery"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).not.toContain("undefined");
  expect(output).not.toContain("Request: undefined");
  expect(output).not.toContain("Instructions: undefined");
  expect(output).not.toContain("Schema: undefined");
  expect(output).not.toContain("Response template: undefined");
});

test("snapshot gap => status needs_discovery message is shown", () => {
  const handoff: MockHandoffResult = {
    created: false,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
    dryRun: false,
    reason: "plan_needs_discovery"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).toContain("browser discovery");
  expect(output).toContain("target elements are not present in the captured snapshot");
  expect(output).toContain("Codex cannot resolve locators");
});

test("snapshot gap => next steps suggest discovery:case not Codex", () => {
  const handoff: MockHandoffResult = {
    created: false,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37750",
    dryRun: false,
    reason: "plan_needs_discovery"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).toContain("discovery:case");
  expect(output).toContain("--case-id 37750");
  expect(output).not.toContain("agent:validate");
  expect(output).not.toContain("Have Codex fill in");
});

test("normal handoff with all paths prints real paths", () => {
  const handoff: MockHandoffResult = {
    created: true,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37618",
    requestPath: "C:\\artifacts\\cases\\handoff-C37618\\handoff-request.json",
    instructionsPath: "C:\\artifacts\\cases\\handoff-C37618\\handoff-instructions.md",
    schemaPath: "C:\\artifacts\\cases\\handoff-C37618\\agent-response.schema.json",
    responsePath: "C:\\artifacts\\cases\\handoff-C37618\\agent-response.json",
    dryRun: false,
    reason: "plan_needs_repair"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).toContain("AGENT HANDOFF PREPARED");
  expect(output).toContain("handoff-request.json");
  expect(output).toContain("handoff-instructions.md");
  expect(output).toContain("agent-response.schema.json");
  expect(output).toContain("agent-response.json");
  expect(output).not.toContain("undefined");
});

test("handoff with missing paths shows error not undefined", () => {
  const handoff: MockHandoffResult = {
    created: true,
    handoffDir: "C:\\artifacts\\cases\\handoff-C37618",
    dryRun: false,
    reason: "plan_needs_repair"
  };

  const output = formatHandoffOutput(handoff);

  expect(output).not.toContain("undefined");
  expect(output).toContain("some file paths are missing");
  expect(output).toContain("handoff-C37618");
});
