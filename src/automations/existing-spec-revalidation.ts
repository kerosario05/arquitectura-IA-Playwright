import { createHash } from "node:crypto";
import { buildSemanticCoverageDiagnostics, defaultRunPlaywrightDiscovery, defaultRunTypeScriptValidation, type SpecGenerationSourceScenario } from "./spec-generation-hybrid";
import { computeTraceFidelity, validateSpecExecutionContract, type SpecExecutionContract } from "./spec-execution-contract";

export type ExistingSpecRevalidationInput = {
  specText: string;
  specPath?: string;
  sourceScenario?: SpecGenerationSourceScenario;
  executionContract?: SpecExecutionContract;
  semanticContext?: { requiredAssertions?: string[]; observableOracles?: SpecGenerationSourceScenario["observableOracles"]; scenarioSteps?: SpecGenerationSourceScenario["steps"]; semanticErrors?: string[] };
  runTypeScriptValidation?: typeof defaultRunTypeScriptValidation;
  runPlaywrightDiscovery?: typeof defaultRunPlaywrightDiscovery;
};

export type ExistingSpecRevalidationResult = {
  status: "passed" | "failed" | "insufficient_context";
  executionContractValidation?: ReturnType<typeof validateSpecExecutionContract>;
  traceFidelityValidation?: ReturnType<typeof computeTraceFidelity>;
  semanticCoverageValidation?: ReturnType<typeof buildSemanticCoverageDiagnostics>;
  typescriptValidation?: { passed: boolean; reason?: string };
  playwrightDiscoveryValidation?: { passed: boolean; discovered?: number; reason?: string };
  allRequiredGatesPassed: boolean;
  aiInvocationCount: 0;
  candidateGenerated: false;
  validatedSpecHash?: string;
};

export async function revalidateExistingSpecDeterministically(input: ExistingSpecRevalidationInput): Promise<ExistingSpecRevalidationResult> {
  const validatedSpecHash = createHash("sha256").update(input.specText, "utf8").digest("hex");
  if (!input.specText.trim() || !input.sourceScenario || !input.executionContract || !input.specPath) {
    return { status: "insufficient_context", allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
  }
  const executionContractValidation = validateSpecExecutionContract(input.executionContract);
  const traceFidelityValidation = computeTraceFidelity(input.specText, input.executionContract);
  const context = input.semanticContext;
  if (!context?.requiredAssertions || !context.observableOracles || !context.scenarioSteps) {
    return { status: "insufficient_context", executionContractValidation, traceFidelityValidation, allRequiredGatesPassed: false, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
  }
  const semanticCoverageValidation = buildSemanticCoverageDiagnostics({ semanticErrors: context.semanticErrors ?? [], requiredAssertions: context.requiredAssertions, observableOracles: context.observableOracles, scenarioSteps: context.scenarioSteps });
  const ts = await (input.runTypeScriptValidation ?? defaultRunTypeScriptValidation)(input.specPath);
  const typescriptValidation = { passed: ts.ok, reason: ts.ok ? undefined : ts.stderr };
  const discovery = ts.ok ? await (input.runPlaywrightDiscovery ?? defaultRunPlaywrightDiscovery)(input.specPath, { headless: true } as never) : undefined;
  const discovered = discovery ? (discovery.stdout + "\n" + discovery.stderr).match(/\b1\s+test\b/i) ? 1 : 0 : undefined;
  const playwrightDiscoveryValidation = { passed: Boolean(discovery?.ok && discovered === 1), discovered, reason: discovery?.ok ? undefined : (discovery?.stderr ?? "typescript_validation_failed") };
  const allRequiredGatesPassed = executionContractValidation.valid && traceFidelityValidation.status !== "failed" && semanticCoverageValidation.missingRequirements.length === 0 && ts.ok && playwrightDiscoveryValidation.passed;
  return { status: allRequiredGatesPassed ? "passed" : "failed", executionContractValidation, traceFidelityValidation, semanticCoverageValidation, typescriptValidation, playwrightDiscoveryValidation, allRequiredGatesPassed, aiInvocationCount: 0, candidateGenerated: false, validatedSpecHash };
}
