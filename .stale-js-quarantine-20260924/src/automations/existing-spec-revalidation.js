"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.revalidateExistingSpecDeterministically = revalidateExistingSpecDeterministically;
const node_crypto_1 = require("node:crypto");
const spec_generation_hybrid_1 = require("./spec-generation-hybrid");
const spec_execution_contract_1 = require("./spec-execution-contract");
async function revalidateExistingSpecDeterministically(input) {
    const validatedSpecHash = (0, node_crypto_1.createHash)("sha256").update(input.specText, "utf8").digest("hex");
    if (!input.specText.trim() || !input.sourceScenario || !input.executionContract || !input.specPath) {
        return { status: "insufficient_context", allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
    }
    const executionContractValidation = (0, spec_execution_contract_1.validateSpecExecutionContract)(input.executionContract);
    const traceFidelityValidation = (0, spec_execution_contract_1.computeTraceFidelity)(input.specText, input.executionContract);
    const context = input.semanticContext;
    if (!context?.requiredAssertions || !context.observableOracles || !context.scenarioSteps) {
        return { status: "insufficient_context", executionContractValidation, traceFidelityValidation, allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
    }
    const semanticCoverageValidation = (0, spec_generation_hybrid_1.buildSemanticCoverageDiagnostics)({ semanticErrors: context.semanticErrors ?? [], requiredAssertions: context.requiredAssertions, observableOracles: context.observableOracles, scenarioSteps: context.scenarioSteps });
    const ts = await (input.runTypeScriptValidation ?? spec_generation_hybrid_1.defaultRunTypeScriptValidation)(input.specPath);
    const typescriptValidation = { passed: ts.ok, reason: ts.ok ? undefined : ts.stderr };
    const discovery = ts.ok ? await (input.runPlaywrightDiscovery ?? spec_generation_hybrid_1.defaultRunPlaywrightDiscovery)(input.specPath, { headless: true }) : undefined;
    const discovered = discovery ? (discovery.stdout + "\n" + discovery.stderr).match(/\b1\s+test\b/i) ? 1 : 0 : undefined;
    const playwrightDiscoveryValidation = { passed: Boolean(discovery?.ok && discovered === 1), discovered, reason: discovery?.ok ? undefined : (discovery?.stderr ?? "typescript_validation_failed") };
    const allRequiredGatesPassed = executionContractValidation.valid && traceFidelityValidation.status !== "failed" && semanticCoverageValidation.missingRequirements.length === 0 && ts.ok && playwrightDiscoveryValidation.passed;
    return { status: allRequiredGatesPassed ? "passed" : "failed", executionContractValidation, traceFidelityValidation, semanticCoverageValidation, typescriptValidation, playwrightDiscoveryValidation, allRequiredGatesPassed, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
}
