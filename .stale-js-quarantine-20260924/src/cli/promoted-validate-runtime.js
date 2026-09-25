"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPromotedRuntimeValidation = runPromotedRuntimeValidation;
const promoted_runtime_contract_1 = require("../automations/runtime/promoted-runtime-contract");
function parseArg(argv, name) {
    const idx = argv.indexOf(name);
    if (idx < 0)
        return undefined;
    return argv[idx + 1];
}
async function runPromotedRuntimeValidation(appSlug) {
    const specs = await (0, promoted_runtime_contract_1.collectPromotedSpecs)(appSlug);
    if (specs.length === 0) {
        return {
            totalSpecs: 0,
            pomRuntimeCount: 0,
            inlineCount: 0,
            invalidCount: 0,
            errors: []
        };
    }
    let pomRuntimeCount = 0;
    let inlineCount = 0;
    let invalidCount = 0;
    const errors = [];
    for (const spec of specs) {
        const result = await (0, promoted_runtime_contract_1.validatePromotedSpecRuntimeContract)(spec.specPath, spec.diagnosticsPath);
        if (result.strategy === "pom_runtime")
            pomRuntimeCount += 1;
        if (result.strategy === "inline_executor")
            inlineCount += 1;
        if (!result.valid)
            invalidCount += 1;
        if (!result.valid) {
            errors.push(`${spec.caseSlug} | strategy=${result.strategy} | valid=false | errors=${result.errors.join(", ")} | spec=${spec.specPath}`);
        }
    }
    return {
        totalSpecs: specs.length,
        pomRuntimeCount,
        inlineCount,
        invalidCount,
        errors
    };
}
async function main() {
    const appSlug = parseArg(process.argv.slice(2), "--app");
    const summary = await runPromotedRuntimeValidation(appSlug);
    if (summary.totalSpecs === 0) {
        console.log("No promoted specs found.");
        return;
    }
    for (const error of summary.errors) {
        console.error(error);
    }
    console.log(`total specs: ${summary.totalSpecs}`);
    console.log(`pom_runtime count: ${summary.pomRuntimeCount}`);
    console.log(`inline_executor count: ${summary.inlineCount}`);
    console.log(`invalid count: ${summary.invalidCount}`);
    if (summary.invalidCount > 0) {
        process.exitCode = 1;
    }
}
const isDirectExecution = typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
if (isDirectExecution) {
    main().catch((error) => {
        console.error(`[promoted:validate-runtime] ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
    });
}
