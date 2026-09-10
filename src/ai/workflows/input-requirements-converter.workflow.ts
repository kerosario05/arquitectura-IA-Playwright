import type { WorkflowDefinition } from "./workflow-runner";

export const inputRequirementsConverterWorkflow: WorkflowDefinition = {
  id: "input-requirements-converter",
  name: "Input Requirements Converter",
  steps: [
    {
      id: "analyze-testrail-contract",
      name: "Analyze TestRail contract",
      instruction: "Analyze the available TestRail case contract without inventing requirements.",
      type: "analysis",
      status: "pending",
    },
    {
      id: "create-converter-module",
      name: "Create converter module",
      instruction: "Create the converter module only from approved contractual declarations.",
      type: "implementation",
      status: "pending",
    },
    {
      id: "validate-parser",
      name: "Validate parser",
      instruction: "Validate the converter output with the existing requirements parser.",
      type: "validation",
      status: "pending",
    },
  ],
};
