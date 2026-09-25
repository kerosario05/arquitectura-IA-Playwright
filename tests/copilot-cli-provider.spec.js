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
const copilot_cli_provider_1 = require("../src/ai/providers/copilot-cli-provider");
const node_events_1 = require("node:events");
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
class MockChildProcess extends node_events_1.EventEmitter {
    stdout = new node_events_1.EventEmitter();
    stderr = new node_events_1.EventEmitter();
    kill() { }
}
(0, test_1.test)("copilot-cli with long prompt creates prompt.txt", async () => {
    let capturedCwd;
    let capturedArgs = [];
    let promptFileWasWritten = false;
    const mockSpawn = (cmd, args, options) => {
        capturedCwd = options?.cwd;
        capturedArgs = args;
        // Check if prompt.txt exists in cwd
        if (capturedCwd) {
            const promptPath = path.join(capturedCwd, "prompt.txt");
            fs.access(promptPath).then(() => {
                promptFileWasWritten = true;
            }).catch(() => {
                // File might not exist yet
            });
        }
        const child = new MockChildProcess();
        setTimeout(() => {
            // After spawn is called, check again if file exists
            if (capturedCwd && !promptFileWasWritten) {
                const promptPath = path.join(capturedCwd, "prompt.txt");
                fs.access(promptPath).then(() => {
                    promptFileWasWritten = true;
                }).catch(() => {
                    // File might still not exist
                });
            }
            child.stdout.emit("data", Buffer.from('{"ok":true}'));
            child.emit("close", 0);
        }, 10);
        return child;
    };
    (0, copilot_cli_provider_1.__setSpawnForTesting)(mockSpawn);
    const provider = new copilot_cli_provider_1.CopilotCliProvider({
        enabled: true,
        provider: "copilot_cli",
        providerName: "copilot",
        baseUrl: "",
        apiKey: "",
        model: "claude-haiku-4.5",
        timeoutMs: 5000,
        requireJson: true,
        requireJsonSchema: false,
        command: "copilot",
        extraArgs: []
    });
    const longSystemMessage = "X".repeat(17653);
    const longUserMessage = "Y".repeat(2231);
    const response = await provider.completeJson({
        purpose: "test",
        messages: [
            { role: "system", content: longSystemMessage },
            { role: "user", content: longUserMessage }
        ]
    });
    (0, test_1.expect)(response.parsedJson).toEqual({ ok: true });
    // Verify short prompt is passed, not the full long one
    const promptArg = capturedArgs[capturedArgs.indexOf("-p") + 1];
    (0, test_1.expect)(promptArg).toBeDefined();
    (0, test_1.expect)(promptArg?.length).toBeLessThan(500); // Short prompt
    (0, test_1.expect)(promptArg).toContain("prompt.txt");
    (0, test_1.expect)(promptArg).not.toContain("X".repeat(100)); // Not the long system message
    // Verify cwd is set
    (0, test_1.expect)(capturedCwd).toBeDefined();
    (0, test_1.expect)(capturedCwd).toContain(".artifacts");
    // Verify model and flags are correct
    (0, test_1.expect)(capturedArgs.join(" ")).toContain("--model");
    (0, test_1.expect)(capturedArgs.join(" ")).toContain("claude-haiku-4.5");
    (0, test_1.expect)(capturedArgs.join(" ")).toContain("--no-ask-user");
    (0, test_1.expect)(capturedArgs.join(" ")).toContain("-s");
});
(0, test_1.test)("copilot-cli uses cmd.exe on Windows .cmd files", async () => {
    let spawnCmd;
    let spawnArgs = [];
    let spawnOptions;
    const mockSpawn = (cmd, args, options) => {
        spawnCmd = cmd;
        spawnArgs = args;
        spawnOptions = options;
        const child = new MockChildProcess();
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from('{"ok":true}'));
            child.emit("close", 0);
        }, 10);
        return child;
    };
    (0, copilot_cli_provider_1.__setSpawnForTesting)(mockSpawn);
    // Mock Windows platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
        const provider = new copilot_cli_provider_1.CopilotCliProvider({
            enabled: true,
            provider: "copilot_cli",
            providerName: "copilot",
            baseUrl: "",
            apiKey: "",
            model: "claude-haiku-4.5",
            timeoutMs: 5000,
            requireJson: true,
            requireJsonSchema: false,
            command: "C:\\path\\to\\copilot.cmd",
            extraArgs: []
        });
        await provider.completeJson({
            purpose: "test",
            messages: [{ role: "user", content: "test" }]
        });
        // Verify cmd.exe is used
        (0, test_1.expect)(spawnCmd).toBe("cmd.exe");
        (0, test_1.expect)(spawnArgs[0]).toBe("/d");
        (0, test_1.expect)(spawnArgs[1]).toBe("/s");
        (0, test_1.expect)(spawnArgs[2]).toBe("/c");
        (0, test_1.expect)(spawnArgs[3]).toContain("copilot.cmd");
        // Verify -p and the short prompt are preserved as separate args
        (0, test_1.expect)(spawnArgs).toContain("-p");
        (0, test_1.expect)(spawnArgs).toContain("--model");
        (0, test_1.expect)(spawnArgs).toContain("claude-haiku-4.5");
        // Verify windowsHide is set
        (0, test_1.expect)(spawnOptions?.windowsHide).toBe(true);
        (0, test_1.expect)(spawnOptions?.cwd).toBeDefined();
    }
    finally {
        Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
});
(0, test_1.test)("copilot-cli handles non-zero exit code", async () => {
    const mockSpawn = () => {
        const child = new MockChildProcess();
        setTimeout(() => {
            child.stderr.emit("data", Buffer.from("The command line is too long."));
            child.emit("close", 1);
        }, 10);
        return child;
    };
    (0, copilot_cli_provider_1.__setSpawnForTesting)(mockSpawn);
    const provider = new copilot_cli_provider_1.CopilotCliProvider({
        enabled: true,
        provider: "copilot_cli",
        providerName: "copilot",
        baseUrl: "",
        apiKey: "",
        model: "claude-haiku-4.5",
        timeoutMs: 5000,
        requireJson: true,
        requireJsonSchema: false,
        command: "copilot"
    });
    await (0, test_1.expect)(provider.completeJson({
        purpose: "scenario_generation",
        messages: [{ role: "user", content: "test" }]
    })).rejects.toThrow(/copilot_cli_execution_failed|exited with code 1/);
});
(0, test_1.test)("copilot-cli handles empty output", async () => {
    const mockSpawn = () => {
        const child = new MockChildProcess();
        setTimeout(() => {
            child.stdout.emit("data", Buffer.from(""));
            child.emit("close", 0);
        }, 10);
        return child;
    };
    (0, copilot_cli_provider_1.__setSpawnForTesting)(mockSpawn);
    const provider = new copilot_cli_provider_1.CopilotCliProvider({
        enabled: true,
        provider: "copilot_cli",
        providerName: "copilot",
        baseUrl: "",
        apiKey: "",
        model: "claude-haiku-4.5",
        timeoutMs: 5000,
        requireJson: true,
        requireJsonSchema: false,
        command: "copilot"
    });
    await (0, test_1.expect)(provider.completeJson({
        purpose: "scenario_generation",
        messages: [{ role: "user", content: "test" }]
    })).rejects.toThrow(/copilot_cli_empty_output|empty stdout/);
});
