import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestScenario } from "../types/testrail.types";

export type WriteScenariosOptions = {
  includeRaw?: boolean;
};

export async function writeScenariosToFile(
  scenarios: TestScenario[],
  outputPath: string,
  options?: WriteScenariosOptions
): Promise<void> {
  const includeRaw = options?.includeRaw ?? false;

  const dirName = path.dirname(outputPath);
  await mkdir(dirName, { recursive: true });

  const serialized = includeRaw
    ? scenarios
    : scenarios.map(({ raw: _raw, ...scenario }) => scenario);

  await writeFile(outputPath, JSON.stringify(serialized, null, 2), "utf-8");
}
