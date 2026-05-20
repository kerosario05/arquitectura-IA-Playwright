import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectRegistry } from "../types/object-registry.types";
import { assertValidObjectRegistry } from "./object-registry-validator";

const defaultRegistryPath = path.resolve("src/registry/object-registry.json");

export async function loadObjectRegistry(filePath?: string): Promise<ObjectRegistry> {
  const resolvedPath = filePath ? path.resolve(filePath) : defaultRegistryPath;
  const content = await readFile(resolvedPath, "utf-8");
  const parsed = JSON.parse(content) as unknown;
  assertValidObjectRegistry(parsed);
  return parsed;
}

export async function saveObjectRegistry(registry: ObjectRegistry, filePath?: string): Promise<void> {
  assertValidObjectRegistry(registry);
  const resolvedPath = filePath ? path.resolve(filePath) : defaultRegistryPath;
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(registry, null, 2), "utf-8");
}
