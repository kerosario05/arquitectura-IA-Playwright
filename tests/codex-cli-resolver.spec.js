"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const codex_cli_resolver_1 = require("../src/agent/codex-cli-resolver");
(0, test_1.test)("uses CODEX_CLI_PATH when it exists", async () => {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-cli-resolver-"));
    const bin = node_path_1.default.join(dir, "codex.cmd");
    await promises_1.default.writeFile(bin, "@echo off\necho ok\n", "utf-8");
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({
        env: { ...process.env, CODEX_CLI_PATH: bin },
        platform: "win32",
        cwd: dir
    });
    (0, test_1.expect)(resolved.found).toBe(true);
    if (resolved.found) {
        (0, test_1.expect)(resolved.source).toBe("CODEX_CLI_PATH");
        (0, test_1.expect)(resolved.command).toContain("codex.cmd");
    }
});
(0, test_1.test)("returns codex_cli_path_invalid when CODEX_CLI_PATH is missing", async () => {
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({
        env: { ...process.env, CODEX_CLI_PATH: node_path_1.default.join(process.cwd(), ".missing", "codex.cmd") },
        platform: "win32",
        cwd: process.cwd()
    });
    (0, test_1.expect)(resolved.found).toBe(false);
    if (!resolved.found) {
        (0, test_1.expect)(resolved.reason).toBe("codex_cli_path_invalid");
    }
});
(0, test_1.test)("resolves from PATH on windows with codex.cmd", async () => {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-cli-resolver-path-"));
    const bin = node_path_1.default.join(dir, "codex.cmd");
    await promises_1.default.writeFile(bin, "@echo off\necho ok\n", "utf-8");
    const env = { ...process.env, PATH: dir };
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({ env, platform: "win32", cwd: dir });
    (0, test_1.expect)(resolved.found).toBe(true);
    if (resolved.found) {
        (0, test_1.expect)(resolved.source).toBe("PATH");
        (0, test_1.expect)(resolved.command).toContain("codex.cmd");
    }
});
(0, test_1.test)("resolves from npm prefix when PATH misses codex", async () => {
    const dir = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "codex-cli-resolver-npm-"));
    const prefix = node_path_1.default.join(dir, "npm-global");
    await promises_1.default.mkdir(prefix, { recursive: true });
    const bin = node_path_1.default.join(prefix, "codex.cmd");
    await promises_1.default.writeFile(bin, "@echo off\necho ok\n", "utf-8");
    (0, codex_cli_resolver_1.__setExecFileForTesting)(((command, args, _options, callback) => {
        if (args.join(" ") === "prefix -g") {
            callback?.(null, prefix, "");
            return {};
        }
        if (args.join(" ") === "bin -g") {
            callback?.(null, prefix, "");
            return {};
        }
        callback?.(null, "", "");
        return {};
    }));
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({
        env: { ...process.env, PATH: "" },
        platform: "win32",
        cwd: dir
    });
    (0, codex_cli_resolver_1.__setExecFileForTesting)(undefined);
    (0, test_1.expect)(resolved.found).toBe(true);
    if (resolved.found) {
        (0, test_1.expect)(["npm_global_prefix", "npm_bin"]).toContain(resolved.source);
        (0, test_1.expect)(resolved.command).toContain("codex.cmd");
    }
});
(0, test_1.test)("not found returns recommendation and no hardcoded user paths", async () => {
    (0, codex_cli_resolver_1.__setExecFileForTesting)(((command, args, _options, callback) => {
        callback?.(null, "", "");
        return {};
    }));
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({
        env: { ...process.env, PATH: "" },
        platform: "win32",
        cwd: process.cwd()
    });
    (0, codex_cli_resolver_1.__setExecFileForTesting)(undefined);
    (0, test_1.expect)(resolved.found).toBe(false);
    if (!resolved.found) {
        (0, test_1.expect)(resolved.reason).toBe("codex_cli_not_found");
        (0, test_1.expect)(resolved.recommendation).toContain("CODEX_CLI_PATH");
        (0, test_1.expect)(resolved.attempted.every((a) => !a.command.toLowerCase().includes("\\users\\") || a.exists)).toBe(true);
    }
});
