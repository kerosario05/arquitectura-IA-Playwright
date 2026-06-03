"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_cli_runner_1 = require("../src/agent/codex-cli-runner");
const node_events_1 = require("node:events");
(0, test_1.test)("escapeDoubleQuotes escapes double quotes in prompt", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.escapeDoubleQuotes)('say "hello"')).toBe('say \\"hello\\"');
});
(0, test_1.test)("escapeDoubleQuotes leaves clean strings unchanged", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.escapeDoubleQuotes)("hello world")).toBe("hello world");
});
(0, test_1.test)("buildCommand produces correct order: command exec extraArgs prompt", () => {
    const input = {
        command: "codex",
        extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
        prompt: "Read the file",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const command = (0, codex_cli_runner_1.buildCommand)(input);
    (0, test_1.expect)(command).toBe('codex exec --skip-git-repo-check --sandbox workspace-write "Read the file"');
});
(0, test_1.test)("buildCommand works with empty extraArgs", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Simple task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const command = (0, codex_cli_runner_1.buildCommand)(input);
    (0, test_1.expect)(command).toBe('codex exec "Simple task"');
});
(0, test_1.test)("buildCommand works with absolute path command", () => {
    const input = {
        command: "C:\\Users\\radames\\AppData\\Roaming\\npm\\codex.cmd",
        extraArgs: ["--skip-git-repo-check"],
        prompt: "Task",
        cwd: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000
    };
    const command = (0, codex_cli_runner_1.buildCommand)(input);
    (0, test_1.expect)(command).toContain("codex.cmd");
    (0, test_1.expect)(command).toContain("--skip-git-repo-check");
    (0, test_1.expect)(command).toContain('"Task"');
    (0, test_1.expect)(command.startsWith("C:\\")).toBe(true);
});
(0, test_1.test)("buildCommand quotes command path with spaces", () => {
    const input = {
        command: "C:\\Program Files\\codex.cmd",
        extraArgs: [],
        prompt: "Task",
        cwd: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000
    };
    const command = (0, codex_cli_runner_1.buildCommand)(input);
    (0, test_1.expect)(command).toContain('"C:\\Program Files\\codex.cmd"');
});
(0, test_1.test)("buildCommand escapes double quotes in prompt", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: 'Write {"key": "value"} to file',
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const command = (0, codex_cli_runner_1.buildCommand)(input);
    (0, test_1.expect)(command).toContain('Write {\\"key\\": \\"value\\"} to file');
});
(0, test_1.test)("formatCodexCliError includes exitCode, command, cwd", () => {
    const input = {
        command: "codex",
        extraArgs: ["--skip-git-repo-check"],
        prompt: "Task",
        cwd: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "some output",
        stderr: "some error",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("exited with code 1");
    (0, test_1.expect)(message).toContain("codex exec --skip-git-repo-check");
    (0, test_1.expect)(message).toContain("C:\\MisProyectos\\MCP");
});
(0, test_1.test)("formatCodexCliError includes stdout when present", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "codex-cli 0.131.0\nProcessing...",
        stderr: "",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("Stdout");
    (0, test_1.expect)(message).toContain("codex-cli 0.131.0");
});
(0, test_1.test)("formatCodexCliError includes stderr when present", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "",
        stderr: "Error: Not inside a trusted directory",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("Stderr");
    (0, test_1.expect)(message).toContain("Not inside a trusted directory");
});
(0, test_1.test)("formatCodexCliError includes signal when present", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        signal: "SIGTERM",
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("SIGTERM");
});
(0, test_1.test)("formatCodexCliError suggests --skip-git-repo-check when stderr contains trusted directory", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "",
        stderr: "Error: Not inside a trusted directory. Run with --skip-git-repo-check.",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("--skip-git-repo-check");
    (0, test_1.expect)(message).toContain("Suggestions");
});
(0, test_1.test)("formatCodexCliError suggests --sandbox workspace-write when stderr contains read-only", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "",
        stderr: "Error: Cannot write to read-only sandbox.",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("--sandbox workspace-write");
});
(0, test_1.test)("formatCodexCliError suggests absolute path when command not found", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const result = {
        exitCode: 1,
        stdout: "",
        stderr: "'codex' is not recognized as an internal or external command",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("CODEX_CLI_COMMAND");
    (0, test_1.expect)(message).toContain("codex.cmd");
});
(0, test_1.test)("formatCodexCliError truncates long stdout", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const longOutput = "x".repeat(2000);
    const result = {
        exitCode: 1,
        stdout: longOutput,
        stderr: "",
        timedOut: false,
        durationMs: 10
    };
    const message = (0, codex_cli_runner_1.formatCodexCliError)(result, input);
    (0, test_1.expect)(message).toContain("truncated");
    (0, test_1.expect)(message).not.toContain("x".repeat(2000));
});
(0, test_1.test)("buildErrorSuggestions returns empty when no known patterns", () => {
    const suggestions = (0, codex_cli_runner_1.buildErrorSuggestions)("Some unknown error", "codex exec task");
    (0, test_1.expect)(suggestions).toBe("");
});
(0, test_1.test)("buildErrorSuggestions detects trusted directory error", () => {
    const suggestions = (0, codex_cli_runner_1.buildErrorSuggestions)("Not inside a trusted directory", "codex exec task");
    (0, test_1.expect)(suggestions).toContain("--skip-git-repo-check");
});
(0, test_1.test)("buildErrorSuggestions detects sandbox write error", () => {
    const suggestions = (0, codex_cli_runner_1.buildErrorSuggestions)("permission denied: cannot write in read-only mode", "codex exec task");
    (0, test_1.expect)(suggestions).toContain("--sandbox workspace-write");
});
(0, test_1.test)("buildErrorSuggestions detects command not found", () => {
    const suggestions = (0, codex_cli_runner_1.buildErrorSuggestions)("codex: command not found", "codex exec task");
    (0, test_1.expect)(suggestions).toContain("CODEX_CLI_COMMAND");
    (0, test_1.expect)(suggestions).toContain("codex.cmd");
});
(0, test_1.test)("buildErrorSuggestions detects EACCES error", () => {
    const suggestions = (0, codex_cli_runner_1.buildErrorSuggestions)("EACCES: permission denied", "codex exec task");
    (0, test_1.expect)(suggestions).toContain("--sandbox workspace-write");
});
(0, test_1.test)("formatCodexTimeoutError includes timeoutMs", () => {
    const input = {
        command: "codex",
        extraArgs: ["--skip-git-repo-check"],
        prompt: "Task",
        cwd: "C:\\MisProyectos\\MCP",
        timeoutMs: 300000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "C:\\handoff\\dir", "C:\\handoff\\dir\\agent-response.json");
    (0, test_1.expect)(message).toContain("300000");
    (0, test_1.expect)(message).toContain("timed out");
});
// --- Windows cmd.exe resolution tests ---
(0, test_1.test)("needsCmdExe returns true for .cmd on win32", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex.cmd", "win32")).toBe(true);
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("C:\\npm\\codex.cmd", "win32")).toBe(true);
});
(0, test_1.test)("needsCmdExe returns true for .bat on win32", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("runner.bat", "win32")).toBe(true);
});
(0, test_1.test)("needsCmdExe returns false for plain command on win32", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex", "win32")).toBe(false);
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("node", "win32")).toBe(false);
});
(0, test_1.test)("needsCmdExe returns false on non-win32 regardless of extension", () => {
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex.cmd", "linux")).toBe(false);
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex.bat", "darwin")).toBe(false);
    (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex", "linux")).toBe(false);
});
(0, test_1.test)("needsCmdExe defaults to currentPlatform seam", () => {
    (0, codex_cli_runner_1.__setPlatformForTesting)("win32");
    try {
        (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex.cmd")).toBe(true);
        (0, test_1.expect)((0, codex_cli_runner_1.needsCmdExe)("codex")).toBe(false);
    }
    finally {
        (0, codex_cli_runner_1.__setPlatformForTesting)(undefined);
    }
});
(0, test_1.test)("resolveSpawnCommand wraps .cmd in cmd.exe on win32", () => {
    const input = {
        command: "C:\\Users\\radames\\AppData\\Roaming\\npm\\codex.cmd",
        extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
        prompt: "Read context-pack.json and fix targets",
        cwd: "C:\\MisProyectos\\MCP",
        timeoutMs: 5000
    };
    const resolved = (0, codex_cli_runner_1.resolveSpawnCommand)(input, "win32");
    (0, test_1.expect)(resolved.spawnCommand).toBe("cmd.exe");
    (0, test_1.expect)(resolved.spawnArgs[0]).toBe("/d");
    (0, test_1.expect)(resolved.spawnArgs[1]).toBe("/s");
    (0, test_1.expect)(resolved.spawnArgs[2]).toBe("/c");
    (0, test_1.expect)(resolved.spawnArgs[3]).toContain("codex.cmd");
    (0, test_1.expect)(resolved.spawnArgs).toContain("--skip-git-repo-check");
    (0, test_1.expect)(resolved.spawnArgs).toContain("--sandbox");
    (0, test_1.expect)(resolved.spawnArgs).toContain("workspace-write");
    (0, test_1.expect)(resolved.spawnArgs).toContain("Read context-pack.json and fix targets");
});
(0, test_1.test)("resolveSpawnCommand does not wrap plain command on win32", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const resolved = (0, codex_cli_runner_1.resolveSpawnCommand)(input, "win32");
    (0, test_1.expect)(resolved.spawnCommand).toBe("codex");
    (0, test_1.expect)(resolved.spawnArgs[0]).toBe("exec");
    (0, test_1.expect)(resolved.spawnArgs[1]).toBe("Task");
    (0, test_1.expect)(resolved.spawnCommand).not.toBe("cmd.exe");
});
(0, test_1.test)("resolveSpawnCommand does not wrap on linux even with .cmd", () => {
    const input = {
        command: "codex.cmd",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const resolved = (0, codex_cli_runner_1.resolveSpawnCommand)(input, "linux");
    (0, test_1.expect)(resolved.spawnCommand).toBe("codex.cmd");
    (0, test_1.expect)(resolved.spawnCommand).not.toBe("cmd.exe");
});
(0, test_1.test)("resolveSpawnCommand displayCommand matches buildCommand output", () => {
    const input = {
        command: "codex",
        extraArgs: ["--skip-git-repo-check"],
        prompt: "Fix the issue",
        cwd: process.cwd(),
        timeoutMs: 5000
    };
    const resolved = (0, codex_cli_runner_1.resolveSpawnCommand)(input, "win32");
    (0, test_1.expect)(resolved.displayCommand).toBe((0, codex_cli_runner_1.buildCommand)(input));
    (0, test_1.expect)(resolved.displayCommand).toContain("codex");
    (0, test_1.expect)(resolved.displayCommand).toContain("Fix the issue");
});
(0, test_1.test)("runCodexCli spawns cmd.exe for codex.cmd on win32", async () => {
    (0, codex_cli_runner_1.__setPlatformForTesting)("win32");
    let capturedCommand;
    let capturedArgs;
    let capturedStdio;
    (0, codex_cli_runner_1.__setSpawnForTesting)(((cmd, args, opts) => {
        capturedCommand = cmd;
        capturedArgs = args;
        capturedStdio = opts.stdio;
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        setTimeout(() => child.emit("close", 0, null), 10);
        return child;
    }));
    try {
        const input = {
            command: "C:\\npm\\codex.cmd",
            extraArgs: [],
            prompt: "win32 test",
            cwd: process.cwd(),
            timeoutMs: 5000
        };
        await (0, codex_cli_runner_1.runCodexCli)(input);
        (0, test_1.expect)(capturedCommand).toBe("cmd.exe");
        (0, test_1.expect)(capturedArgs?.[0]).toBe("/d");
        (0, test_1.expect)(capturedArgs?.[1]).toBe("/s");
        (0, test_1.expect)(capturedArgs?.[2]).toBe("/c");
        (0, test_1.expect)(capturedArgs?.[3]).toContain("codex.cmd");
        (0, test_1.expect)(capturedStdio).toEqual(["ignore", "pipe", "pipe"]);
    }
    finally {
        (0, codex_cli_runner_1.__setPlatformForTesting)(undefined);
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("runCodexCli spawns command directly on non-win32", async () => {
    (0, codex_cli_runner_1.__setPlatformForTesting)("linux");
    let capturedCommand;
    let capturedStdio;
    (0, codex_cli_runner_1.__setSpawnForTesting)(((cmd, _args, opts) => {
        capturedCommand = cmd;
        capturedStdio = opts.stdio;
        const child = new node_events_1.EventEmitter();
        child.stdout = new node_events_1.EventEmitter();
        child.stderr = new node_events_1.EventEmitter();
        setTimeout(() => child.emit("close", 0, null), 10);
        return child;
    }));
    try {
        const input = {
            command: "codex",
            extraArgs: [],
            prompt: "linux test",
            cwd: process.cwd(),
            timeoutMs: 5000
        };
        await (0, codex_cli_runner_1.runCodexCli)(input);
        (0, test_1.expect)(capturedCommand).toBe("codex");
        (0, test_1.expect)(capturedStdio).toEqual(["ignore", "pipe", "pipe"]);
    }
    finally {
        (0, codex_cli_runner_1.__setPlatformForTesting)(undefined);
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
    }
});
(0, test_1.test)("runCodexCli heartbeat still works after spawn resolution change", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (msg, ...rest) => {
        logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
    };
    try {
        (0, codex_cli_runner_1.__setSpawnForTesting)(((cmd, args, opts) => {
            const child = new node_events_1.EventEmitter();
            child.stdout = new node_events_1.EventEmitter();
            child.stderr = new node_events_1.EventEmitter();
            setTimeout(() => child.emit("close", 0, null), 120);
            return child;
        }));
        const input = {
            command: "codex",
            extraArgs: [],
            prompt: "Task",
            cwd: process.cwd(),
            timeoutMs: 5000,
            heartbeatMs: 50,
            attempt: 1,
            handoffDir: process.cwd(),
            showAgentLog: false
        };
        await (0, codex_cli_runner_1.runCodexCli)(input);
        (0, test_1.expect)(logs.some((l) => l.includes("Codex still running"))).toBe(true);
    }
    finally {
        console.log = orig;
    }
});
(0, test_1.test)("runCodexCli showAgentLog includes spawnCommand on win32", async () => {
    (0, codex_cli_runner_1.__setPlatformForTesting)("win32");
    const logs = [];
    const orig = console.log;
    console.log = (msg, ...rest) => {
        logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
    };
    try {
        (0, codex_cli_runner_1.__setSpawnForTesting)(((cmd, args, opts) => {
            const child = new node_events_1.EventEmitter();
            child.stdout = new node_events_1.EventEmitter();
            child.stderr = new node_events_1.EventEmitter();
            setTimeout(() => child.emit("close", 0, null), 10);
            return child;
        }));
        const input = {
            command: "C:\\npm\\codex.cmd",
            extraArgs: [],
            prompt: "test",
            cwd: process.cwd(),
            timeoutMs: 5000,
            showAgentLog: true
        };
        await (0, codex_cli_runner_1.runCodexCli)(input);
        (0, test_1.expect)(logs.some((l) => l.includes("displayCommand:"))).toBe(true);
        (0, test_1.expect)(logs.some((l) => l.includes("spawnCommand:"))).toBe(true);
        (0, test_1.expect)(logs.some((l) => l.includes("cmd.exe"))).toBe(true);
    }
    finally {
        (0, codex_cli_runner_1.__setPlatformForTesting)(undefined);
        (0, codex_cli_runner_1.__setSpawnForTesting)(undefined);
        console.log = orig;
    }
});
(0, test_1.test)("runCodexCli emits heartbeat when no output", async () => {
    const logs = [];
    const orig = console.log;
    console.log = (msg, ...rest) => {
        logs.push([String(msg ?? ""), ...rest.map(String)].join(" "));
    };
    try {
        (0, codex_cli_runner_1.__setSpawnForTesting)(((command, args, options) => {
            const child = new node_events_1.EventEmitter();
            child.stdout = new node_events_1.EventEmitter();
            child.stderr = new node_events_1.EventEmitter();
            child.kill = () => { };
            // No output, close after a short delay.
            setTimeout(() => child.emit("close", 0, null), 120);
            return child;
        }));
        const input = {
            command: "codex",
            extraArgs: [],
            prompt: "Task",
            cwd: process.cwd(),
            timeoutMs: 5000,
            heartbeatMs: 50,
            attempt: 1,
            handoffDir: process.cwd(),
            showAgentLog: false
        };
        await (0, codex_cli_runner_1.runCodexCli)(input);
        (0, test_1.expect)(logs.some((l) => l.includes("Codex still running"))).toBe(true);
    }
    finally {
        console.log = orig;
    }
});
(0, test_1.test)("formatCodexTimeoutError includes suggestion to increase timeout", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 300000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(message).toContain("CODEX_AUTO_REPAIR_TIMEOUT_MS");
    (0, test_1.expect)(message).toContain("1800000");
});
(0, test_1.test)("formatCodexTimeoutError recommended timeout is never equal to current timeout", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 900000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(message).toContain("900000ms");
    (0, test_1.expect)(message).toContain("1800000ms");
    (0, test_1.expect)(message).not.toMatch(/recommended: 900000ms.*current: 900000ms/);
});
(0, test_1.test)("formatCodexTimeoutError recommends at least double or 1800000ms", () => {
    const input1 = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 300000
    };
    const msg1 = (0, codex_cli_runner_1.formatCodexTimeoutError)(input1, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(msg1).toContain("1800000ms");
    const input2 = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 900000
    };
    const msg2 = (0, codex_cli_runner_1.formatCodexTimeoutError)(input2, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(msg2).toContain("1800000ms");
});
(0, test_1.test)("formatCodexTimeoutError includes handoffDir and responsePath", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 300000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "C:\\artifacts\\handoff-123", "C:\\artifacts\\handoff-123\\agent-response.json");
    (0, test_1.expect)(message).toContain("C:\\artifacts\\handoff-123");
    (0, test_1.expect)(message).toContain("agent-response.json");
});
(0, test_1.test)("formatCodexTimeoutError includes manual command suggestion", () => {
    const input = {
        command: "codex",
        extraArgs: ["--skip-git-repo-check", "--sandbox", "workspace-write"],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 300000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(message).toContain("Run manually");
    (0, test_1.expect)(message).toContain("agent:validate");
});
(0, test_1.test)("formatCodexTimeoutError shows minutes in human-readable format", () => {
    const input = {
        command: "codex",
        extraArgs: [],
        prompt: "Task",
        cwd: process.cwd(),
        timeoutMs: 900000
    };
    const message = (0, codex_cli_runner_1.formatCodexTimeoutError)(input, "/tmp/handoff", "/tmp/handoff/response.json");
    (0, test_1.expect)(message).toContain("15.0 minutes");
});
