import fs from "node:fs/promises";
import path from "node:path";
import { evaluateGeneratedJiraSuite, type JiraGenerationEvaluationInput } from "../jira/jira-generation-evaluation";

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args[args.indexOf("--input") + 1];
  const outputPath = args.includes("--output") ? args[args.indexOf("--output") + 1] : undefined;
  if (!args.includes("--input") || !inputPath || inputPath.startsWith("--")) {
    throw new Error("Usage: npm run jira:generation:evaluate -- --input <suite.json> [--output <report.json>]");
  }
  if (args.includes("--output") && (!outputPath || outputPath.startsWith("--"))) throw new Error("Missing --output report path");
  if (outputPath && path.resolve(outputPath) === path.resolve(inputPath)) throw new Error("Report must not overwrite evaluation input");
  const input: unknown = JSON.parse(await fs.readFile(inputPath, "utf8"));
  if (!input || typeof input !== "object" || !Array.isArray((input as JiraGenerationEvaluationInput).issues)
    || !Array.isArray((input as JiraGenerationEvaluationInput).scenarios)) throw new Error("Invalid evaluation input: issues and scenarios arrays required");
  const report = evaluateGeneratedJiraSuite(input as JiraGenerationEvaluationInput);
  const serialized = JSON.stringify(report, null, 2);
  if (outputPath) { await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true }); await fs.writeFile(outputPath, serialized); }
  console.log(serialized);
  if (!report.evaluationPassed) process.exitCode = 1;
}
void main().catch(error => { console.error(error instanceof SyntaxError ? "Invalid evaluation JSON" : error.message); process.exitCode = 1; });
