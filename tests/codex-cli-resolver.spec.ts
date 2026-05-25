import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import type { ExecException } from "node:child_process";
import { resolveCodexCliPath, __setExecFileForTesting } from "../src/agent/codex-cli-resolver";

test("uses CODEX_CLI_PATH when it exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-cli-resolver-"));
  const bin = path.join(dir, "codex.cmd");
  await fs.writeFile(bin, "@echo off\necho ok\n", "utf-8");

  const resolved = await resolveCodexCliPath({
    env: { ...process.env, CODEX_CLI_PATH: bin },
    platform: "win32",
    cwd: dir
  });

  expect(resolved.found).toBe(true);
  if (resolved.found) {
    expect(resolved.source).toBe("CODEX_CLI_PATH");
    expect(resolved.command).toContain("codex.cmd");
  }
});

test("returns codex_cli_path_invalid when CODEX_CLI_PATH is missing", async () => {
  const resolved = await resolveCodexCliPath({
    env: { ...process.env, CODEX_CLI_PATH: path.join(process.cwd(), ".missing", "codex.cmd") },
    platform: "win32",
    cwd: process.cwd()
  });

  expect(resolved.found).toBe(false);
  if (!resolved.found) {
    expect(resolved.reason).toBe("codex_cli_path_invalid");
  }
});

test("resolves from PATH on windows with codex.cmd", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-cli-resolver-path-"));
  const bin = path.join(dir, "codex.cmd");
  await fs.writeFile(bin, "@echo off\necho ok\n", "utf-8");
  const env = { ...process.env, PATH: dir };

  const resolved = await resolveCodexCliPath({ env, platform: "win32", cwd: dir });
  expect(resolved.found).toBe(true);
  if (resolved.found) {
    expect(resolved.source).toBe("PATH");
    expect(resolved.command).toContain("codex.cmd");
  }
});

test("resolves from npm prefix when PATH misses codex", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-cli-resolver-npm-"));
  const prefix = path.join(dir, "npm-global");
  await fs.mkdir(prefix, { recursive: true });
  const bin = path.join(prefix, "codex.cmd");
  await fs.writeFile(bin, "@echo off\necho ok\n", "utf-8");

  __setExecFileForTesting(((command: string, args: string[], _options: unknown, callback: (error: ExecException | null, stdout: string, stderr: string) => void) => {
    if (args.join(" ") === "prefix -g") {
      callback?.(null as any, prefix, "");
      return {} as any;
    }
    if (args.join(" ") === "bin -g") {
      callback?.(null as any, prefix, "");
      return {} as any;
    }
    callback?.(null as any, "", "");
    return {} as any;
  }) as any);

  const resolved = await resolveCodexCliPath({
    env: { ...process.env, PATH: "" },
    platform: "win32",
    cwd: dir
  });
  __setExecFileForTesting(undefined);

  expect(resolved.found).toBe(true);
  if (resolved.found) {
    expect(["npm_global_prefix", "npm_bin"]).toContain(resolved.source);
    expect(resolved.command).toContain("codex.cmd");
  }
});

test("not found returns recommendation and no hardcoded user paths", async () => {
  __setExecFileForTesting(((command: string, args: string[], _options: unknown, callback: (error: ExecException | null, stdout: string, stderr: string) => void) => {
    callback?.(null as any, "", "");
    return {} as any;
  }) as any);
  const resolved = await resolveCodexCliPath({
    env: { ...process.env, PATH: "" },
    platform: "win32",
    cwd: process.cwd()
  });
  __setExecFileForTesting(undefined);

  expect(resolved.found).toBe(false);
  if (!resolved.found) {
    expect(resolved.reason).toBe("codex_cli_not_found");
    expect(resolved.recommendation).toContain("CODEX_CLI_PATH");
    expect(resolved.attempted.every((a) => !a.command.toLowerCase().includes("\\users\\") || a.exists)).toBe(true);
  }
});
