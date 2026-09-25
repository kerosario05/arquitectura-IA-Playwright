import { test, expect } from "@playwright/test";
import { logAuthResolution } from "../src/discovery/auth-input-resolver";

test("redacts authentication values in resolution logs while preserving runtime inputs", () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  try {
    logAuthResolution({
      success: true,
      data: { username: "runtime-user", password: "runtime-password", otp: "123456" },
      sources: { username: "runtime", password: "runtime", otp: "runtime" },
      errors: [],
    });
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  expect(output).not.toContain("runtime-user");
  expect(output).not.toContain("runtime-password");
  expect(output).not.toContain("123456");
  expect(output).toContain("value=****** sensitive=true");
});
