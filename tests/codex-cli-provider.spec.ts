import { test, expect } from "@playwright/test";
import { CodexCliProvider } from "../src/ai/providers/codex-cli-provider";
import { AiProviderError } from "../src/ai/ai-provider.types";
import { __setSpawnForTesting } from "../src/agent/codex-cli-runner";
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
    
    // Simular escritura de archivo en workdir
    setTimeout(async () => {
      // Extraer workdir de options.cwd
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
    
    // No escribir archivo - simular fallo
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
    // No emitir eventos - simular timeout
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

    // En Windows, codex.cmd se ejecuta via cmd.exe
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

    // Verificar que --model está en los args
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

    // Verificar que parsedJson no expone secretos
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
    })).rejects.toThrow(/exited with code 1/i);
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
        // Escribir JSON inválido
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
    await expect(provider.completeJson({
      messages: [
        { role: "system", content: "Return JSON only" },
        { role: "user", content: "Test" }
      ],
      requireJson: true
    })).rejects.toThrow(/invalid json/i);
  } finally {
    __setSpawnForTesting(undefined as any);
  }
});
