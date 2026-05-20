import type { BrowserName, LoginMode } from "./env.types";

export type ExecutionStatus = "passed" | "failed";

export type EvidenceFile = {
  name: string;
  path: string;
};

export type SmokeExecutionResult = {
  status: ExecutionStatus;
  baseUrl: string;
  loginMode: LoginMode;
  browser: BrowserName;
  headless: boolean;
  evidenceDir: string;
  startedAt: string;
  finishedAt: string;
  error?: string;
};
