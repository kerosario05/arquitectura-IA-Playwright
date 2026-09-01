import { execFileSync } from "child_process";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";

export interface ApkInspectorResult {
  apkPath: string;
  packageName: string;
  mainActivity: string;
  versionName?: string;
  versionCode?: string;
  minSdk?: string;
  targetSdk?: string;
  inspectionSource: "apkanalyzer" | "aapt2" | "aapt";
}

export class ApkInspectorError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ApkInspectorError";
  }
}

function tryBin(bin: string, probeArgs: string[] = ["version"]): string | null {
  try {
    execFileSync(bin, probeArgs, { timeout: 5000, stdio: "pipe" });
    return bin;
  } catch {
    return null;
  }
}

function resolveFromSdk(subDirs: string[], bins: string[], probeArgs?: string[]): string | null {
  const sdkRoot = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdkRoot) return null;
  for (const sub of subDirs) {
    const base = path.join(sdkRoot, sub);
    try {
      const entries = readdirSync(base);
      // For cmdline-tools we need to walk one level deeper (latest, 11.0, etc)
      const candidates: string[] = [];
      for (const e of entries) {
        const full = path.join(base, e);
        try {
          if (statSync(full).isDirectory()) {
            // Check bin directly inside sub
            for (const bin of bins) {
              const p = path.join(full, bin);
              if (existsSync(p)) candidates.push(p);
            }
            // cmdline-tools/<ver>/bin
            const binDir = path.join(full, "bin");
            if (existsSync(binDir)) {
              for (const bin of bins) {
                const p = path.join(binDir, bin);
                if (existsSync(p)) candidates.push(p);
              }
            }
          }
        } catch { /* ignore */ }
      }
      // Also try direct sub/bin
      for (const bin of bins) {
        const direct = path.join(base, "bin", bin);
        if (existsSync(direct)) candidates.push(direct);
        const direct2 = path.join(base, bin);
        if (existsSync(direct2)) candidates.push(direct2);
      }
      for (const c of candidates) {
        // For apkanalyzer probe we need different args; probe without args fails but binary exists
        // Just check exists; for aapt we verify version
        if (probeArgs) {
          const ok = tryBin(c, probeArgs);
          if (ok) return ok;
        } else {
          // existence is enough for apkanalyzer (probe may need no args)
          if (existsSync(c)) return c;
        }
      }
    } catch { /* unreadable */ }
  }
  // Direct build-tools versioned lookup for aapt/aapt2
  try {
    const btDir = path.join(sdkRoot, "build-tools");
    const versions = readdirSync(btDir)
      .filter((v: string) => /^\d+\.\d+\.\d+$/.test(v))
      .sort()
      .reverse();
    for (const ver of versions) {
      for (const bin of bins) {
        const p = path.join(btDir, ver, bin);
        if (existsSync(p)) {
          if (probeArgs) {
            const ok = tryBin(p, probeArgs);
            if (ok) return ok;
          } else if (existsSync(p)) return p;
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

function resolveApkanalyzer(): string | null {
  for (const name of ["apkanalyzer", "apkanalyzer.bat"]) {
    const r = tryBin(name, ["help"]);
    if (r) return r;
    // Windows where .bat needs shell? try direct exec without probe
    try {
      execFileSync(name, [], { timeout: 3000, stdio: "pipe" });
      return name;
    } catch { /* ignore */ }
  }
  const found = resolveFromSdk(["cmdline-tools"], ["apkanalyzer", "apkanalyzer.bat"]);
  if (found) return found;
  return null;
}

function resolveAapt2(): string | null {
  for (const name of ["aapt2", "aapt2.exe"]) {
    const r = tryBin(name);
    if (r) return r;
  }
  const sdk = resolveFromSdk(["build-tools"], ["aapt2", "aapt2.exe"], ["version"]);
  if (sdk) return sdk;
  return null;
}

function resolveAapt(): string | null {
  for (const name of ["aapt", "aapt.exe"]) {
    const r = tryBin(name);
    if (r) return r;
  }
  const sdk = resolveFromSdk(["build-tools"], ["aapt", "aapt.exe"], ["version"]);
  if (sdk) return sdk;
  return null;
}

function validateApk(apkPath: string): void {
  if (!apkPath || typeof apkPath !== "string")
    throw new ApkInspectorError("invalid_apk_path", "apkPath must be a non-empty string");
  if (!apkPath.toLowerCase().endsWith(".apk"))
    throw new ApkInspectorError("invalid_apk_path", `APK path must end with .apk: ${apkPath}`);
  if (!existsSync(apkPath))
    throw new ApkInspectorError("apk_not_found", `APK file not found: ${apkPath}`);
  if (!statSync(apkPath).isFile())
    throw new ApkInspectorError("invalid_apk_path", `APK path is not a file: ${apkPath}`);
}

function safeExec(bin: string, args: string[], timeout = 15000): string | null {
  try {
    const out = execFileSync(bin, args, {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return typeof out === "string" ? out : String(out);
  } catch {
    return null;
  }
}

function extractOptional(stdout: string, pattern: RegExp): string | undefined {
  const m = stdout.match(pattern);
  return m?.[1]?.trim() || undefined;
}

function parseAaptDump(stdout: string): Partial<ApkInspectorResult> {
  const packageName = extractOptional(stdout, /package:\s+name='([^']+)'/);
  const versionName = extractOptional(stdout, /package:[^\n]*versionName='([^']+)'/);
  const versionCode = extractOptional(stdout, /package:[^\n]*versionCode='([^']+)'/);
  const minSdk = extractOptional(stdout, /sdkVersion:'([^']+)'/) || extractOptional(stdout, /uses-sdk.*minSdkVersion='([^']+)'/);
  const targetSdk = extractOptional(stdout, /targetSdkVersion:'([^']+)'/);
  const mainActivity = extractOptional(stdout, /launchable-activity:\s+name='([^']+)'/);
  return { packageName, versionName, versionCode, minSdk, targetSdk, mainActivity };
}

function parseApkanalyzerManifestPrint(xml: string): Partial<ApkInspectorResult> {
  const pkg = extractOptional(xml, /package="([^"]+)"/);
  const verName = extractOptional(xml, /android:versionName="([^"]+)"/);
  const verCode = extractOptional(xml, /android:versionCode="([^"]+)"/);
  const minSdk = extractOptional(xml, /android:minSdkVersion="([^"]+)"/);
  const targetSdk = extractOptional(xml, /android:targetSdkVersion="([^"]+)"/);
  // Launchable activity: find activity with MAIN + LAUNCHER
  let mainAct: string | undefined;
  // Split by <activity
  const activityBlocks = xml.split(/<activity\b/);
  for (let i = 1; i < activityBlocks.length; i++) {
    const block = "<activity " + activityBlocks[i];
    const endIdx = block.indexOf("</activity>");
    const slice = endIdx >= 0 ? block.slice(0, endIdx) : block.slice(0, 4000);
    if (slice.includes("android.intent.action.MAIN") && slice.includes("android.intent.category.LAUNCHER")) {
      const name = extractOptional(slice, /android:name="([^"]+)"/);
      if (name) { mainAct = name; break; }
    }
  }
  // Fallback: first activity with LAUNCHER if not found with both
  if (!mainAct) {
    for (let i = 1; i < activityBlocks.length; i++) {
      const block = "<activity " + activityBlocks[i];
      if (block.includes("android.intent.category.LAUNCHER")) {
        const name = extractOptional(block, /android:name="([^"]+)"/);
        if (name) { mainAct = name; break; }
      }
    }
  }
  return { packageName: pkg, versionName: verName, versionCode: verCode, minSdk, targetSdk, mainActivity: mainAct };
}

function resolveRelativeActivity(pkg: string | undefined, activity: string | undefined): string {
  if (!activity) return "";
  if (activity.startsWith(".")) return pkg ? pkg + activity : activity;
  if (!activity.includes(".")) return pkg ? pkg + "." + activity : activity;
  return activity;
}

export function inspectApk(apkPath: string): ApkInspectorResult {
  validateApk(apkPath);

  // Prefer apkanalyzer
  const apkanalyzer = resolveApkanalyzer();
  if (apkanalyzer) {
    // Try individual manifest queries (cheapest deterministic)
    const pkgOut = safeExec(apkanalyzer, ["manifest", "application-id", apkPath]);
    const pkg = pkgOut?.trim();
    if (pkg) {
      const verName = safeExec(apkanalyzer, ["manifest", "version-name", apkPath])?.trim() || undefined;
      const verCode = safeExec(apkanalyzer, ["manifest", "version-code", apkPath])?.trim() || undefined;
      const minSdkRaw = safeExec(apkanalyzer, ["manifest", "min-sdk", apkPath])?.trim();
      const targetSdkRaw = safeExec(apkanalyzer, ["manifest", "target-sdk", apkPath])?.trim();
      // mainActivity via manifest print
      let mainAct = "";
      const manifestXml = safeExec(apkanalyzer, ["manifest", "print", apkPath]);
      if (manifestXml) {
        const parsed = parseApkanalyzerManifestPrint(manifestXml);
        if (parsed.mainActivity) mainAct = resolveRelativeActivity(pkg, parsed.mainActivity);
      }
      return {
        apkPath,
        packageName: pkg,
        mainActivity: mainAct || "",
        versionName: verName || undefined,
        versionCode: verCode || undefined,
        minSdk: minSdkRaw || undefined,
        targetSdk: targetSdkRaw || undefined,
        inspectionSource: "apkanalyzer",
      };
    }
    // If application-id failed, try manifest print fallback
    const xml = safeExec(apkanalyzer, ["manifest", "print", apkPath]);
    if (xml) {
      const parsed = parseApkanalyzerManifestPrint(xml);
      if (parsed.packageName) {
        return {
          apkPath,
          packageName: parsed.packageName,
          mainActivity: resolveRelativeActivity(parsed.packageName, parsed.mainActivity) || "",
          versionName: parsed.versionName,
          versionCode: parsed.versionCode,
          minSdk: parsed.minSdk,
          targetSdk: parsed.targetSdk,
          inspectionSource: "apkanalyzer",
        };
      }
    }
  }

  // Fallback aapt2
  const aapt2 = resolveAapt2();
  if (aapt2) {
    const out = safeExec(aapt2, ["dump", "badging", apkPath]);
    if (out) {
      const parsed = parseAaptDump(out);
      if (parsed.packageName) {
        return {
          apkPath,
          packageName: parsed.packageName,
          mainActivity: parsed.mainActivity ? resolveRelativeActivity(parsed.packageName, parsed.mainActivity) : "",
          versionName: parsed.versionName,
          versionCode: parsed.versionCode,
          minSdk: parsed.minSdk,
          targetSdk: parsed.targetSdk,
          inspectionSource: "aapt2",
        };
      }
    }
  }

  // Fallback aapt
  const aapt = resolveAapt();
  if (aapt) {
    let stdout: string;
    try {
      stdout = execFileSync(aapt, ["dump", "badging", apkPath], {
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }) as unknown as string;
    } catch (err: any) {
      throw new ApkInspectorError("apk_inspection_failed", `aapt dump failed: ${err.status ?? "unknown"} — ${err.stderr || err.message}`);
    }
    const parsed = parseAaptDump(stdout);
    if (!parsed.packageName) throw new ApkInspectorError("apk_package_not_found", "packageName not found in aapt output");
    return {
      apkPath,
      packageName: parsed.packageName,
      mainActivity: parsed.mainActivity ? resolveRelativeActivity(parsed.packageName, parsed.mainActivity) : "",
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      minSdk: parsed.minSdk,
      targetSdk: parsed.targetSdk,
      inspectionSource: "aapt",
    };
  }

  throw new ApkInspectorError("aapt_not_found", "No Android SDK tool found (apkanalyzer, aapt2 or aapt) in PATH or ANDROID_HOME/ANDROID_SDK_ROOT");
}
