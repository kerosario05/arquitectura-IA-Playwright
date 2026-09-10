import path from "node:path";

export function resolveQaBrowserProfilePath(rawValue?: string, cwd = process.cwd()): string {
  const configured = rawValue?.trim();
  return path.resolve(cwd, configured || ".artifacts/browser/qa-profile");
}
