export type CodexCliRunnerInput = {
  command: string;
  extraArgs: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
};

export type CodexCliRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: string;
};

export type CodexAutoRepairInput = {
  handoffDir: string;
  requestPath: string;
  instructionsPath: string;
  responsePath: string;
  schemaPath: string;
  projectRoot: string;
  timeoutMs: number;
  codexCommand: string;
  codexExtraArgs: string[];
  promptMode?: "compact" | "verbose";
};

export type CodexAutoRepairResult = {
  success: boolean;
  responsePath: string;
  exitCode?: number;
  error?: string;
  timedOut?: boolean;
};
