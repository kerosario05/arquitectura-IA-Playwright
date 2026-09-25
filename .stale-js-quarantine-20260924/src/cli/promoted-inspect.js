"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
function parseArg(argv, name) {
    const idx = argv.indexOf(name);
    if (idx < 0)
        return undefined;
    return argv[idx + 1];
}
async function exists(p) {
    try {
        await promises_1.default.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function main() {
    const appSlug = parseArg(process.argv.slice(2), "--app");
    const appsRoot = node_path_1.default.resolve("automations/apps");
    const appDirs = appSlug ? [node_path_1.default.join(appsRoot, appSlug)] : (await promises_1.default.readdir(appsRoot)).map((d) => node_path_1.default.join(appsRoot, d));
    const rows = [];
    for (const appDir of appDirs) {
        const casesDir = node_path_1.default.join(appDir, "cases");
        if (!(await exists(casesDir)))
            continue;
        const caseSlugs = await promises_1.default.readdir(casesDir);
        for (const slug of caseSlugs) {
            const caseDir = node_path_1.default.join(casesDir, slug);
            const specPath = node_path_1.default.join(caseDir, "case.spec.ts");
            if (!(await exists(specPath)))
                continue;
            const specContent = await promises_1.default.readFile(specPath, "utf-8");
            const strategy = specContent.includes(`PROMOTED_SPEC_STRATEGY = "pom_runtime"`)
                ? "pom_runtime"
                : specContent.includes(`PROMOTED_SPEC_STRATEGY = "inline_executor"`)
                    ? "inline_executor"
                    : "unknown";
            rows.push({
                caseSlug: slug,
                strategy,
                usesPromotedRuntime: specContent.includes("createPromotedSpecRuntime("),
                hasPromotedDataManifest: await exists(node_path_1.default.join(caseDir, "promoted-data.json")),
                specPath,
                diagnosticsPath: node_path_1.default.join(caseDir, "promotion-diagnostics.json")
            });
        }
    }
    if (rows.length === 0) {
        console.log("No promoted specs found.");
        return;
    }
    for (const row of rows) {
        console.log(`${row.caseSlug} | strategy=${row.strategy} | usesPromotedRuntime=${row.usesPromotedRuntime} | ` +
            `hasPromotedDataManifest=${row.hasPromotedDataManifest} | spec=${row.specPath} | diagnostics=${row.diagnosticsPath}`);
    }
}
main().catch((error) => {
    console.error(`[promoted:inspect] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
