import * as fs from "node:fs";
import * as path from "node:path";

export type MobileLogLevel = "error" | "warn" | "info" | "debug" | "trace";

export type AppiumTraceChunk = {
  stream: "stdout" | "stderr";
  text: string;
  bytes: number;
};

type MobileJobLoggerOptions = {
  runId: string;
  appendLog: (line: string) => void;
};

const LEVEL_ORDER: Record<MobileLogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const ANSI_RE = /\u001b\[[0-9;]*m/g;
const BASE64_RE = /[A-Za-z0-9+/]{180,}={0,2}/g;
const SECRET_RE = /([A-Za-z0-9_]*(?:password|token|secret|apikey|authorization|otp)[A-Za-z0-9_]*)\s*[:=]\s*([^\s]+)/gi;
const XML_RE = /<\?xml|<hierarchy|<\/hierarchy>|<node\b/i;

function resolveTraceMaxBytes(): number {
  const raw = Number(process.env.MOBILE_APP_TRACE_MAX_BYTES);
  if (!Number.isFinite(raw) || raw <= 0) return 2 * 1024 * 1024;
  return Math.max(1024, Math.min(20 * 1024 * 1024, Math.trunc(raw)));
}

export function resolveMobileLogLevel(raw = process.env.MOBILE_LOG_LEVEL): MobileLogLevel {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "error" || normalized === "warn" || normalized === "info" || normalized === "debug" || normalized === "trace") {
    return normalized;
  }
  return "info";
}

function redactLine(input: string): string {
  return input
    .replace(ANSI_RE, "")
    .replace(SECRET_RE, "$1=[redacted]")
    .replace(BASE64_RE, "[redacted_base64]")
    .trim();
}

function compactSessionCoordinatorLine(line: string): string | null {
  if (!line.startsWith("[session-coordinator]")) return line;
  const status = line.match(/\bstatus=([a-z_]+)/i)?.[1];
  if (!status) return null;
  if (status === "started") {
    const deviceId = line.match(/\bdeviceId=([^\s]+)/)?.[1] ?? "unknown";
    const systemPort = line.match(/\bsystemPort=([^\s]+)/)?.[1] ?? "unknown";
    return `[mobile:session] create started deviceId=${deviceId} systemPort=${systemPort}`;
  }
  if (status === "resolved") {
    const attempt = line.match(/\battempt=([^\s]+)/)?.[1] ?? "1";
    const sessionId = line.match(/\bsessionId=([^\s]+)/)?.[1] ?? "unknown";
    return `[mobile:session] create completed attempt=${attempt} sessionId=${sessionId.slice(0, 8)}`;
  }
  if (status === "timed_out_unknown") {
    return "[mobile:session] create timed_out_unknown";
  }
  if (status === "cleanup_pending") return "[mobile:session] cleanup started";
  if (status === "cleanup_confirmed") return "[mobile:session] cleanup completed";
  if (status === "cleanup_failed") return "[mobile:session] cleanup failed";
  if (status === "released") return "[mobile:session] lock released";
  return null;
}

function shouldSuppressVisibleByLevel(line: string, level: MobileLogLevel): boolean {
  if (line.startsWith("[appium] event=process_output")) return true;
  if (XML_RE.test(line)) return true;
  if (line.includes("event=readiness_attempts") && level === "info") return true;
  if (line.includes("event=process_alive_at_timeout") && level === "info") return true;
  if (line.includes("event=port_listening_at_timeout") && level === "info") return true;
  if (line.includes("[mobile:knowledge]") && level === "info") return true;
  if (line.includes("[mobile:evidence]") && level === "info") return true;
  if (line.includes("evidence dir=") && level === "info") return true;
  if (line.includes("creating appium session") && level === "info") return true;
  return false;
}

function isCriticalInfraLine(line: string): boolean {
  const lower = line.toLowerCase();
  return (
    lower.includes("mobile_session_state_unknown") ||
    lower.includes("mobile_automation_channel_lost") ||
    lower.includes("mobile_text_encoding_invalid") ||
    lower.includes("socket hang up") ||
    lower.includes("instrumentation process is not running") ||
    lower.includes("device offline") ||
    lower.includes("device disconnected") ||
    lower.includes("cleanup failed")
  );
}

function extractAppiumProcessErrorPreview(line: string): string | null {
  if (!line.startsWith("[appium] event=process_output")) return null;
  const preview = line.match(/\bpreview="([^"]*)"/)?.[1] ?? "";
  const stream = line.match(/\bstream=([a-z]+)/)?.[1] ?? "stdout";
  const normalized = preview.toLowerCase();
  if (
    normalized.includes("socket hang up")
    || normalized.includes("instrumentation process is not running")
    || normalized.includes("uiautomator2 server is not running")
    || normalized.includes("device offline")
    || normalized.includes("device disconnected")
    || normalized.includes("failed to proxy command")
  ) {
    return `[mobile:infra] appium stream_error stream=${stream} message="${preview}"`;
  }
  return null;
}

function canEmit(level: MobileLogLevel, threshold: MobileLogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[threshold];
}

export type MobileJobLogger = {
  readonly level: MobileLogLevel;
  log: (line: string, threshold?: MobileLogLevel) => void;
  traceAppiumChunk: (chunk: AppiumTraceChunk) => void;
  flush: () => void;
  stats: () => { visibleEvents: number; suppressedAppiumOutput: number; suppressedDuplicates: number };
};

export function createMobileJobLogger(options: MobileJobLoggerOptions): MobileJobLogger {
  const level = resolveMobileLogLevel();
  const traceMaxBytes = resolveTraceMaxBytes();
  const traceDir = path.join(process.cwd(), ".artifacts", "mobile-diagnostics", options.runId);
  const tracePath = path.join(traceDir, "appium-trace.log");

  let visibleEvents = 0;
  let suppressedAppiumOutput = 0;
  let suppressedDuplicates = 0;
  let diagnosticsEmitted = false;
  let traceBytes = 0;
  let traceTruncated = false;
  const seenErrors = new Set<string>();

  const ensureTraceFile = (): void => {
    if (traceTruncated) return;
    if (!fs.existsSync(traceDir)) fs.mkdirSync(traceDir, { recursive: true });
  };

  const appendTrace = (line: string): void => {
    if (traceTruncated) return;
    const payload = `${line}\n`;
    const bytes = Buffer.byteLength(payload, "utf8");
    if (traceBytes + bytes > traceMaxBytes) {
      traceTruncated = true;
      const marker = `[trace] truncated maxBytes=${traceMaxBytes}\n`;
      fs.appendFileSync(tracePath, marker, "utf8");
      traceBytes += Buffer.byteLength(marker, "utf8");
      return;
    }
    fs.appendFileSync(tracePath, payload, "utf8");
    traceBytes += bytes;
  };

  const maybeEmit = (line: string): void => {
    const processErrorPreview = extractAppiumProcessErrorPreview(line);
    if (processErrorPreview) {
      const dedupeKey = `${options.runId}|${processErrorPreview.replace(/\d+/g, "#")}`;
      if (seenErrors.has(dedupeKey)) {
        suppressedDuplicates++;
        suppressedAppiumOutput++;
        return;
      }
      seenErrors.add(dedupeKey);
      options.appendLog(redactLine(processErrorPreview));
      visibleEvents++;
      suppressedAppiumOutput++;
      return;
    }
    if (shouldSuppressVisibleByLevel(line, level)) {
      if (line.startsWith("[appium] event=process_output")) suppressedAppiumOutput++;
      return;
    }
    const compactSession = compactSessionCoordinatorLine(line);
    if (compactSession === null) return;
    const nextLine = compactSession ?? line;
    const sanitized = redactLine(nextLine);
    if (!sanitized) return;

    if (isCriticalInfraLine(sanitized)) {
      const dedupeKey = `${options.runId}|${sanitized.replace(/\d+/g, "#")}`;
      if (seenErrors.has(dedupeKey)) {
        suppressedDuplicates++;
        return;
      }
      seenErrors.add(dedupeKey);
    }
    options.appendLog(sanitized);
    visibleEvents++;
  };

  return {
    level,
    log: (line: string, threshold: MobileLogLevel = "info") => {
      if (!canEmit(level, threshold)) return;
      maybeEmit(line);
    },
    traceAppiumChunk: (chunk: AppiumTraceChunk) => {
      if (!chunk.text) return;
      ensureTraceFile();
      const compact = redactLine(chunk.text);
      const traceLine = `[${new Date().toISOString()}] stream=${chunk.stream} bytes=${chunk.bytes} text=${compact}`;
      appendTrace(traceLine);
    },
    flush: () => {
      if (diagnosticsEmitted) return;
      diagnosticsEmitted = true;
      if (traceBytes > 0 || suppressedAppiumOutput > 0) {
        options.appendLog(
          `[mobile:diagnostics] appiumTraceAvailable=${traceBytes > 0} path=${tracePath} sizeBytes=${traceBytes} truncated=${traceTruncated} suppressedAppiumOutput=${suppressedAppiumOutput} suppressedDuplicates=${suppressedDuplicates}`,
        );
      }
    },
    stats: () => ({ visibleEvents, suppressedAppiumOutput, suppressedDuplicates }),
  };
}
