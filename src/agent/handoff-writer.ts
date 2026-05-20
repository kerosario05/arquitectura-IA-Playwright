import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentHandoffRequest } from "../types/agent-handoff.types";
import { buildAgentHandoffInstructions } from "./handoff-instructions";
import { agentHandoffResponseJsonSchema } from "./agent-response.schema";

export async function writeAgentHandoffPackage(input: {
  request: AgentHandoffRequest;
  outputDir: string;
}): Promise<{
  requestPath: string;
  instructionsPath: string;
  schemaPath: string;
  responsePath: string;
}> {
  await mkdir(input.outputDir, { recursive: true });

  const requestPath = path.join(input.outputDir, "handoff-request.json");
  const instructionsPath = path.join(input.outputDir, "handoff-instructions.md");
  const schemaPath = path.join(input.outputDir, "agent-response.schema.json");
  const responsePath = path.join(input.outputDir, "agent-response.json");

  await writeFile(requestPath, JSON.stringify(input.request, null, 2), "utf-8");
  await writeFile(instructionsPath, buildAgentHandoffInstructions(input.request), "utf-8");
  await writeFile(schemaPath, JSON.stringify(agentHandoffResponseJsonSchema, null, 2), "utf-8");
  await writeFile(
    responsePath,
    JSON.stringify(
      {
        version: "1.0",
        generatedAt: "",
        plans: [],
        proposedObjects: [],
        unresolvedQuestions: [],
        rationale: []
      },
      null,
      2
    ),
    "utf-8"
  );

  return { requestPath, instructionsPath, schemaPath, responsePath };
}
