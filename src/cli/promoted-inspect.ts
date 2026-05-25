import fs from "node:fs/promises";
import path from "node:path";

type Row = {
  caseSlug: string;
  strategy: "pom_runtime" | "inline_executor" | "unknown";
  usesPromotedRuntime: boolean;
  hasPromotedDataManifest: boolean;
  specPath: string;
  diagnosticsPath: string;
};

function parseArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return undefined;
  return argv[idx + 1];
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const appSlug = parseArg(process.argv.slice(2), "--app");
  const appsRoot = path.resolve("automations/apps");
  const appDirs = appSlug ? [path.join(appsRoot, appSlug)] : (await fs.readdir(appsRoot)).map((d) => path.join(appsRoot, d));
  const rows: Row[] = [];

  for (const appDir of appDirs) {
    const casesDir = path.join(appDir, "cases");
    if (!(await exists(casesDir))) continue;
    const caseSlugs = await fs.readdir(casesDir);
    for (const slug of caseSlugs) {
      const caseDir = path.join(casesDir, slug);
      const specPath = path.join(caseDir, "case.spec.ts");
      if (!(await exists(specPath))) continue;
      const specContent = await fs.readFile(specPath, "utf-8");
      const strategy = specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`)
        ? "pom_runtime"
        : specContent.includes(`PROMOTED_SPEC_STRATEGY = "inline_executor"`)
          ? "inline_executor"
          : "unknown";
      rows.push({
        caseSlug: slug,
        strategy,
        usesPromotedRuntime: specContent.includes("createPromotedSpecRuntime("),
        hasPromotedDataManifest: await exists(path.join(caseDir, "promoted-data.json")),
        specPath,
        diagnosticsPath: path.join(caseDir, "promotion-diagnostics.json")
      });
    }
  }

  if (rows.length === 0) {
    console.log("No promoted specs found.");
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.caseSlug} | strategy=${row.strategy} | usesPromotedRuntime=${row.usesPromotedRuntime} | ` +
      `hasPromotedDataManifest=${row.hasPromotedDataManifest} | spec=${row.specPath} | diagnostics=${row.diagnosticsPath}`
    );
  }
}

main().catch((error) => {
  console.error(`[promoted:inspect] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
