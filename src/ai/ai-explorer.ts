import type {
  AiExplorerInput,
  AiExplorerOutput,
  AiExplorerProvider,
  AiExplorerProviderName
} from "./ai-explorer.types";

function isValidAction(value: string): value is AiExplorerOutput["action"] {
  return ["click", "fill", "select", "assert", "wait", "stop"].includes(value);
}

function isFiniteConfidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateAiExplorerOutputShape(output: unknown): output is AiExplorerOutput {
  if (!output || typeof output !== "object") return false;

  const candidate = output as Partial<AiExplorerOutput>;
  if (!candidate.action || !isValidAction(candidate.action)) return false;
  if (typeof candidate.target !== "string") return false;
  if (!isFiniteConfidence(candidate.confidence)) return false;
  if (typeof candidate.reason !== "string") return false;
  if (!Array.isArray(candidate.alternatives)) return false;
  if (typeof candidate.risk !== "string") return false;
  if (typeof candidate.requiresHumanApproval !== "boolean") return false;

  return candidate.alternatives.every((alternative) => {
    if (!alternative || typeof alternative !== "object") return false;
    const item = alternative as AiExplorerOutput["alternatives"][number];
    return isValidAction(item.action)
      && typeof item.target === "string"
      && typeof item.reason === "string"
      && (item.candidateId === undefined || typeof item.candidateId === "string");
  });
}

export class AIExplorer {
  constructor(
    public readonly provider: AiExplorerProviderName,
    private readonly adapter: AiExplorerProvider
  ) {}

  async propose(input: AiExplorerInput): Promise<AiExplorerOutput | null> {
    const output = await this.adapter.propose(input);
    if (output === null) {
      return null;
    }

    if (!validateAiExplorerOutputShape(output)) {
      throw new Error(`AI explorer provider "${this.adapter.name}" returned an invalid JSON contract.`);
    }

    return output;
  }
}

export function createNoopAiExplorerProvider(
  provider: AiExplorerProviderName = "custom"
): AiExplorerProvider {
  return {
    name: `${provider}-noop`,
    async propose(_input: AiExplorerInput): Promise<AiExplorerOutput | null> {
      return null;
    }
  };
}

export function createAIExplorer(options?: {
  provider?: AiExplorerProviderName;
  adapter?: AiExplorerProvider;
}): AIExplorer {
  const provider = options?.provider ?? "custom";
  const adapter = options?.adapter ?? createNoopAiExplorerProvider(provider);
  return new AIExplorer(provider, adapter);
}
