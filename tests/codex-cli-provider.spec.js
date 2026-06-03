"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_cli_provider_1 = require("../src/ai/providers/codex-cli-provider");
const ai_provider_types_1 = require("../src/ai/ai-provider.types");
const codex_cli_runner_1 = require("../src/agent/codex-cli-runner");
const node_events_1 = require("node:events");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
function withEnv(values, fn) {
    const previous = {};
    for (const key of Object.keys(values)) {
        previous[key] = process.env[key];
        if (values[key] === undefined)
            delete process.env[key];
        else
            process.env[key] = values[key];
    }
    try {
        fn();
    }
    finally {
        for (const key of Object.keys(values)) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
    }
}
(0, test_1.test)("CodexCliProvider lee repair-decision.json válido", async () => {
    let capturedWorkDir = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(result.providerName).toBe("codex");
        (0, test_1.expect)(result.parsedJson?.decision).toBe("repaired_plan");
        (0, test_1.expect)(result.parsedJson?.reason).toBe("Candidate is visible and safe");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider reporta output file faltante", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/did not write/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider maneja timeout", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/timed out/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider usa CODEX_CLI_COMMAND explícito", async () => {
    let capturedCommand = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        capturedCommand = command;
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(fullCommand).toBeTruthy();
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider pasa extraArgs correctamente", async () => {
    let capturedArgs = [];
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        capturedArgs = args;
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(capturedArgs).toContain("--model");
        (0, test_1.expect)(capturedArgs).toContain("codex");
        (0, test_1.expect)(capturedArgs).toContain("--skip-git-repo-check");
        (0, test_1.expect)(capturedArgs).toContain("--sandbox");
        (0, test_1.expect)(capturedArgs).toContain("workspace-write");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider sanitiza secretos en diagnostics", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(JSON.stringify(result.parsedJson)).not.toContain("secret123");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider maneja error de proceso", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stderr.emit("data", Buffer.from("Error message from codex"));
            child.emit("close", 1, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/did not write/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider reporta JSON inválido en archivo", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(async () => {
            const workDir = options.cwd || "";
            if (workDir) {
                const outputPath = path.join(workDir, "repair-decision.json");
                await fs.writeFile(outputPath, "This is not valid JSON at all", "utf-8");
            }
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/invalid json/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider acepta output válido aunque exitCode != 0", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(result.parsedJson?.decision).toBe("repaired_plan");
        (0, test_1.expect)(result.parsedJson?.candidateId).toBe("nav-products");
        (0, test_1.expect)(result.diagnostics?.warning).toBe("codex_exited_non_zero_but_output_valid");
        (0, test_1.expect)(result.diagnostics?.exitCode).toBe(1);
        (0, test_1.expect)(result.diagnostics?.stderr).toContain("non-fatal issue");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider falla con exitCode != 0 y repair-decision.json faltante", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stderr.emit("data", Buffer.from("Fatal error from codex"));
            child.emit("close", 1, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/did not write/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider falla con exitCode != 0 y repair-decision.json inválido", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/invalid json/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider CLI prompt es corto y referencia prompt.txt", async () => {
    let capturedPrompt = "";
    let capturedWorkDir = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(capturedPrompt).toContain("prompt.txt");
        (0, test_1.expect)(capturedPrompt).toContain("Read and follow");
        (0, test_1.expect)(capturedPrompt).not.toContain("OUTPUT FILE");
        (0, test_1.expect)(capturedPrompt).not.toContain("REQUIRED FIELDS");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider prompt.txt incluye outputPath absoluto e instrucciones file-output", async () => {
    let capturedWorkDir = "";
    let capturedPromptContent = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(async () => {
            capturedWorkDir = options.cwd || "";
            if (capturedWorkDir) {
                try {
                    capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
                }
                catch {
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(capturedPromptContent).toContain("repair-decision.json");
        (0, test_1.expect)(capturedPromptContent).toContain(".artifacts");
        (0, test_1.expect)(capturedPromptContent).toContain("OUTPUT FILE");
        (0, test_1.expect)(capturedPromptContent).toContain("Write EXACTLY one file at:");
        (0, test_1.expect)(capturedPromptContent).toContain("Do NOT write to stdout");
        (0, test_1.expect)(capturedPromptContent).toContain("repair-decision.schema.json");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider prompt.txt no contiene solo Respond with JSON", async () => {
    let capturedWorkDir = "";
    let capturedPromptContent = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(async () => {
            capturedWorkDir = options.cwd || "";
            if (capturedWorkDir) {
                try {
                    capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
                }
                catch {
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(capturedPromptContent).toContain("Write EXACTLY one file");
        (0, test_1.expect)(capturedPromptContent).toContain("Do NOT write to stdout");
        (0, test_1.expect)(capturedPromptContent).toContain("OUTPUT FILE");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider prompt.txt incluye contenido del user message", async () => {
    let capturedWorkDir = "";
    let capturedPromptContent = "";
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(async () => {
            capturedWorkDir = options.cwd || "";
            if (capturedWorkDir) {
                try {
                    capturedPromptContent = await fs.readFile(path.join(capturedWorkDir, "prompt.txt"), "utf-8");
                }
                catch {
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        (0, test_1.expect)(capturedPromptContent).toContain("USER REQUEST:");
        (0, test_1.expect)(capturedPromptContent).toContain("connection test");
        (0, test_1.expect)(capturedPromptContent).toContain("no_safe_action");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider log filenames son consistentes (codex-stdout.log, codex-stderr.log)", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
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
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        const runnerInput = (0, codex_cli_runner_1.__getLastRunnerInputForTesting)();
        (0, test_1.expect)(runnerInput).toBeDefined();
        (0, test_1.expect)(runnerInput?.stdoutLogPath).toContain("codex-stdout.log");
        (0, test_1.expect)(runnerInput?.stderrLogPath).toContain("codex-stderr.log");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider stdout fallback pasa cuando repair-decision.json falta y fallback habilitado", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from('{"decision":"no_safe_action","reason":"connection test"}'));
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        const result = await provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Connection test" }
            ],
            requireJson: true
        });
        (0, test_1.expect)(result.parsedJson?.decision).toBe("no_safe_action");
        (0, test_1.expect)(result.parsedJson?.reason).toBe("connection test");
        (0, test_1.expect)(result.diagnostics?.warning).toBe("codex_stdout_fallback_used");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider stdout fallback valida decision/reason", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from('{"decision":"repaired_plan","reason":"Found safe candidate","candidateId":"el-1","confidence":0.9}'));
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        const result = await provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Repair test" }
            ],
            requireJson: true
        });
        (0, test_1.expect)(result.parsedJson?.decision).toBe("repaired_plan");
        (0, test_1.expect)(result.parsedJson?.reason).toBe("Found safe candidate");
        (0, test_1.expect)(result.parsedJson?.candidateId).toBe("el-1");
        (0, test_1.expect)(result.parsedJson?.confidence).toBe(0.9);
        (0, test_1.expect)(result.diagnostics?.warning).toBe("codex_stdout_fallback_used");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider stdout fallback no acepta JSON inválido", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from("This is not JSON at all"));
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/did not write/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider sin fallback falla cuando repair-decision.json falta (AI Repair real)", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from('{"decision":"no_safe_action","reason":"stdout response"}'));
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
            allowStdoutJsonFallback: false
        });
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(ai_provider_types_1.AiProviderError);
        await (0, test_1.expect)(provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Test" }
            ],
            requireJson: true
        })).rejects.toThrow(/did not write/i);
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("CodexCliProvider stdout fallback extrae JSON de texto mixto", async () => {
    (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        child.kill = () => { };
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from("Some prefix text\n{\"decision\":\"no_safe_action\",\"reason\":\"connection test\"}\nSome suffix text"));
            child.emit("close", 0, null);
        }, 10);
        return child;
    }));
    try {
        const provider = new codex_cli_provider_1.CodexCliProvider({
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
        const result = await provider.completeJson({
            messages: [
                { role: "system", content: "Return JSON only" },
                { role: "user", content: "Connection test" }
            ],
            requireJson: true
        });
        (0, test_1.expect)(result.parsedJson?.decision).toBe("no_safe_action");
        (0, test_1.expect)(result.parsedJson?.reason).toBe("connection test");
        (0, test_1.expect)(result.diagnostics?.warning).toBe("codex_stdout_fallback_used");
    }
    finally {
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
