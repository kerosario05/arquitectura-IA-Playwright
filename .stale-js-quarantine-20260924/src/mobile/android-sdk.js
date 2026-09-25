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
exports.resolveAndroidSdk = resolveAndroidSdk;
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const env_1 = require("../config/env");
function trimAndUnquote(input) {
    if (!input)
        return undefined;
    const trimmed = input.trim();
    if (!trimmed)
        return undefined;
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function containsUnexpandedExpression(input) {
    return /\$env:[A-Za-z_][A-Za-z0-9_]*/i.test(input) ||
        /%[A-Za-z_][A-Za-z0-9_]*%/.test(input) ||
        /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/.test(input);
}
function resolveSdkHomeCandidate(rawCandidate, env) {
    const candidate = trimAndUnquote(rawCandidate);
    if (!candidate)
        return {};
    if (containsUnexpandedExpression(candidate)) {
        return {
            rejectedReason: `contains unexpanded environment expression: ${candidate}`,
        };
    }
    return { resolvedPath: path.resolve(candidate) };
}
function resolveAndroidSdk(options = {}) {
    const env = options.env ?? process.env;
    const existsSync = options.existsSync ?? fs.existsSync;
    const configuredSdkHome = options.configuredSdkHome ?? env_1.config.integrations.android?.sdkHome;
    const candidateInputs = [
        { source: "ANDROID_HOME", value: env.ANDROID_HOME },
        { source: "ANDROID_SDK_ROOT", value: env.ANDROID_SDK_ROOT },
        { source: "config.integrations.android.sdkHome", value: configuredSdkHome },
        { source: "LOCALAPPDATA\\Android\\Sdk", value: trimAndUnquote(env.LOCALAPPDATA) ? path.join(trimAndUnquote(env.LOCALAPPDATA), "Android", "Sdk") : undefined },
    ];
    const rejectedCandidates = [];
    let sdkHome;
    for (const candidate of candidateInputs) {
        const resolved = resolveSdkHomeCandidate(candidate.value, env);
        if (resolved.rejectedReason) {
            rejectedCandidates.push(`${candidate.source}: ${resolved.rejectedReason}`);
            continue;
        }
        if (!resolved.resolvedPath) {
            continue;
        }
        if (!existsSync(resolved.resolvedPath)) {
            rejectedCandidates.push(`${candidate.source}: path does not exist (${resolved.resolvedPath})`);
            continue;
        }
        sdkHome = resolved.resolvedPath;
        break;
    }
    if (!sdkHome) {
        const details = rejectedCandidates.length > 0
            ? ` Rejected candidates: ${rejectedCandidates.join(" | ")}`
            : "";
        throw new Error("Unable to resolve Android SDK home. Set ANDROID_HOME or ANDROID_SDK_ROOT to an existing absolute path (or ensure LOCALAPPDATA\\Android\\Sdk exists on Windows)." + details);
    }
    const platform = (options.platform ?? process.platform) === "win32" ? "win32" : "posix";
    const adbPath = platform === "win32"
        ? path.join(sdkHome, "platform-tools", "adb.exe")
        : path.join(sdkHome, "platform-tools", "adb");
    const emulatorPath = platform === "win32"
        ? path.join(sdkHome, "emulator", "emulator.exe")
        : path.join(sdkHome, "emulator", "emulator");
    if (!existsSync(adbPath)) {
        throw new Error(`Android SDK resolved (${sdkHome}) but adb binary is missing at: ${adbPath}`);
    }
    if (!existsSync(emulatorPath)) {
        throw new Error(`Android SDK resolved (${sdkHome}) but emulator binary is missing at: ${emulatorPath}`);
    }
    return { sdkHome, adbPath, emulatorPath };
}
