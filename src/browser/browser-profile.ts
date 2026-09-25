import path from "node:path";

export function resolveQaBrowserProfilePath(rawValue?: string, cwd = process.cwd()): string | undefined {
  const configured = rawValue?.trim();
  if (!configured) return undefined;
  return path.resolve(cwd, configured);
}
