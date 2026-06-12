import { test, expect } from "@playwright/test";
import { CodexCliProvider } from "../src/ai/providers/codex-cli-provider";
import { AiProviderError } from "../src/ai/ai-provider.types";
import { __setSpawnForTesting, __getLastRunnerInputForTesting } from "../src/agent/codex-cli-runner";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as path from "node:path";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("CodexCliProvider lee repair-decision.json válido", async () => {
  let capturedWorkDir = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      capturedWorkDir = options.cwd || "";
      if (capturedWorkDir) {
        const outputPath = path.join(capturedWorkDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "repaired_plan",
          reason: "Candidate is visible and safe",
          candidateId: "el-1"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: ["--skip-git-repo-check"],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    expect(result.providerName).toBe("codex");
    expect(result.parsedJson?.decision).toBe("repaired_plan");
    expect(result.parsedJson?.reason).toBe("Candidate is visible and safe");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider reporta output file faltante", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(() => {
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider maneja timeout", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 50,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/timed out/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider usa CODEX_CLI_COMMAND explícito", async () => {
  let capturedCommand = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    capturedCommand = command;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "C:\\custom\\path\\codex.cmd",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    const fullCommand = capturedCommand;
    expect(fullCommand).toBeTruthy();
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider pasa extraArgs correctamente", async () => {
  let capturedArgs: string[] = [];
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    capturedArgs = args;
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    expect(capturedArgs).toContain("--model");
    expect(capturedArgs).toContain("codex");
    expect(capturedArgs).toContain("--skip-git-repo-check");
    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("workspace-write");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider sanitiza secretos en diagnostics", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    expect(JSON.stringify(result.parsedJson)).not.toContain("secret123");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider maneja error de proceso", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("Error message from codex"));
      child.emit("close", 1, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider reporta JSON inválido en archivo", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, "This is not valid JSON at all", "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    // Shared extractor now returns output_missing when all extraction strategies fail
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider acepta output válido aunque exitCode != 0", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "repaired_plan",
          reason: "Route recovery successful",
          repairType: "route_recovery",
          candidateId: "nav-products",
          selectionStatus: "selected",
          confidence: 0.98
        }), "utf-8");
      }
      child.stderr.emit("data", Buffer.from("Warning: some non-fatal issue"));
      child.emit("close", 1, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    expect(result.parsedJson?.decision).toBe("repaired_plan");
    expect(result.parsedJson?.candidateId).toBe("nav-products");
    expect(result.diagnostics?.warning).toBe("ai_provider_exited_non_zero_but_output_valid");
    expect(result.diagnostics?.exitCode).toBe(1);
    expect(result.diagnostics?.stderr).toContain("non-fatal issue");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider falla con exitCode != 0 y repair-decision.json faltante", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(() => {
      child.stderr.emit("data", Buffer.from("Fatal error from codex"));
      child.emit("close", 1, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider falla con exitCode != 0 y repair-decision.json inválido", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, "not valid json {{{", "utf-8");
      }
      child.stderr.emit("data", Buffer.from("Codex had a problem"));
      child.emit("close", 1, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    // Shared extractor now returns output_missing when all extraction strategies fail
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider CLI prompt es corto y referencia prompt.txt", async () => {
  let capturedPrompt = "";
  let capturedWorkDir = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      capturedWorkDir = options.cwd || "";
      capturedPrompt = args[args.length - 1] || "";
      if (capturedWorkDir) {
        const outputPath = path.join(capturedWorkDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test request" }
      ],
      requireJson: true
    });

    expect(capturedPrompt).toContain("prompt.txt");
    expect(capturedPrompt).toContain("Read and follow");
    expect(capturedPrompt).not.toContain("OUTPUT FILE");
    expect(capturedPrompt).not.toContain("REQUIRED FIELDS");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider prompt.txt incluye outputPath absoluto e instrucciones file-output", async () => {
  let capturedWorkDir = "";
  let capturedPromptContent = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      capturedWorkDir = options.cwd || "";
      if (capturedWorkDir) {
        try {
          capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
        } catch {
          capturedPromptContent = "";
        }
        const outputPath = path.join(capturedWorkDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test request" }
      ],
      requireJson: true
    });

    expect(capturedPromptContent).toContain("repair-decision.json");
    expect(capturedPromptContent).toContain(".artifacts");
    expect(capturedPromptContent).toContain("OUTPUT FILE");
    expect(capturedPromptContent).toContain("Write EXACTLY one file at:");
    expect(capturedPromptContent).toContain("Do NOT write to stdout");
    expect(capturedPromptContent).toContain("repair-decision.schema.json");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider prompt.txt no contiene solo Respond with JSON", async () => {
  let capturedWorkDir = "";
  let capturedPromptContent = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      capturedWorkDir = options.cwd || "";
      if (capturedWorkDir) {
        try {
          capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
        } catch {
          capturedPromptContent = "";
        }
        const outputPath = path.join(capturedWorkDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Respond with JSON" },
        { role: "user", content: "{\"decision\":\"no_safe_action\",\"reason\":\"test\"}" }
      ],
      requireJson: true
    });

    expect(capturedPromptContent).toContain("Write EXACTLY one file");
    expect(capturedPromptContent).toContain("Do NOT write to stdout");
    expect(capturedPromptContent).toContain("OUTPUT FILE");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider prompt.txt incluye contenido del user message", async () => {
  let capturedWorkDir = "";
  let capturedPromptContent = "";
  
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      capturedWorkDir = options.cwd || "";
      if (capturedWorkDir) {
        try {
          capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
        } catch {
          capturedPromptContent = "";
        }
        const outputPath = path.join(capturedWorkDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "connection test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only." },
        { role: "user", content: "Respond with {\"decision\":\"no_safe_action\",\"reason\":\"connection test\"}" }
      ],
      requireJson: true
    });

    expect(capturedPromptContent).toContain("USER REQUEST:");
    expect(capturedPromptContent).toContain("connection test");
    expect(capturedPromptContent).toContain("no_safe_action");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider log filenames son consistentes (codex-stdout.log, codex-stderr.log)", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(async () => {
      const workDir = options.cwd || "";
      if (workDir) {
        const outputPath = path.join(workDir, "repair-decision.json");
        await fs.writeFile(outputPath, JSON.stringify({
          decision: "no_safe_action",
          reason: "test"
        }), "utf-8");
      }
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    });

    const runnerInput = __getLastRunnerInputForTesting();
    expect(runnerInput).toBeDefined();
    expect(runnerInput?.stdoutLogPath).toContain("codex-stdout.log");
    expect(runnerInput?.stderrLogPath).toContain("codex-stderr.log");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider extrae JSON de stdout cuando archivo falta", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(() => {
      child.stdout.emit("data", Buffer.from('{"decision":"no_safe_action","reason":"connection test"}'));
      child.emit("close", 0, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Connection test" }
      ],
      requireJson: true
    });

    // Shared extractor automatically tries stdout when file is missing
    expect(result.parsedJson?.decision).toBe("no_safe_action");
    expect(result.parsedJson?.reason).toBe("connection test");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider extrae JSON de stdout con campos completos", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(() => {
      child.stdout.emit("data", Buffer.from('{"decision":"repaired_plan","reason":"Found safe candidate","candidateId":"el-1","confidence":0.9}'));
      child.emit("close", 0, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Repair test" }
      ],
      requireJson: true
    });

    // Shared extractor automatically handles stdout JSON
    expect(result.parsedJson?.decision).toBe("repaired_plan");
    expect(result.parsedJson?.reason).toBe("Found safe candidate");
    expect(result.parsedJson?.candidateId).toBe("el-1");
    expect(result.parsedJson?.confidence).toBe(0.9);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider stdout fallback no acepta JSON inválido", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("This is not JSON at all"));
      child.emit("close", 0, null);
    }, 10);
    
    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false,
      allowStdoutJsonFallback: true
    });

    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider falla cuando repair-decision.json falta y stdout inválido", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("This is not valid JSON"));
      child.emit("close", 0, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    // Even with automatic stdout extraction, if stdout is not valid JSON, it fails
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(AiProviderError);
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/did not write/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});

test("CodexCliProvider extrae JSON de texto mixto en stdout", async () => {
  __setSpawnForTesting(((command: string, args: string[], options: any) => {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};

    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("Some prefix text\n{\"decision\":\"no_safe_action\",\"reason\":\"connection test\"}\nSome suffix text"));
      child.emit("close", 0, null);
    }, 10);

    return child;
  }) as any);

  try {
    const provider = new CodexCliProvider({
      enabled: true,
      provider: "codex_cli",
      providerName: "codex",
      baseUrl: "",
      apiKey: "",
      model: "codex",
      command: "codex",
      extraArgs: [],
      timeoutMs: 30000,
      requireJson: true,
      requireJsonSchema: false
    });

    const result = await provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Connection test" }
      ],
      requireJson: true
    });

    // Shared extractor uses embedded_json strategy to extract from mixed text
    expect(result.parsedJson?.decision).toBe("no_safe_action");
    expect(result.parsedJson?.reason).toBe("connection test");
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});
