import * as fs from "node:fs/promises";

export type JsonExtractionResult = {
  success: boolean;
  raw: string;
  parsed: Record<string, unknown>;
  strategy: string;
  attempts: string[];
};

export type JsonExtractionSource = {
  stdout: string;
  stderr: string;
  outputFilePath: string;
};

/**
 * Robust JSON extractor that tries multiple strategies to extract JSON from AI provider output.
 * Strategies (in order):
 * 1. output_file_json - Read from output file
 * 2. stdout_json - Parse stdout directly as JSON
 * 3. fenced_json - Extract from ```json ... ``` markdown fence
 * 4. fenced_generic - Extract from ``` ... ``` generic fence
 * 5. embedded_json - Find balanced JSON object {...} in text
 */
export async function extractJsonFromSources(
  source: JsonExtractionSource,
  purpose: string,
  logPrefix: string
): Promise<JsonExtractionResult> {
  const attempts: string[] = [];

  // Strategy 1: Try output file first (preferred for file-based providers)
  attempts.push("output_file_json");
  try {
    const fileContent = await fs.readFile(source.outputFilePath, "utf-8");
    const parsed = JSON.parse(fileContent);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      if (purpose === "scenario_generation") {
        console.log(`[${logPrefix}] parseStrategy=output_file_json success=true`);
      }
      return { success: true, raw: fileContent, parsed: parsed as Record<string, unknown>, strategy: "output_file_json", attempts };
    }
  } catch {
    // File doesn't exist or invalid JSON, try other sources
  }

  // Strategy 2: Try stdout as direct JSON
  attempts.push("stdout_json");
  const stdoutTrimmed = source.stdout?.trim() ?? "";
  if (stdoutTrimmed) {
    try {
      const parsed = JSON.parse(stdoutTrimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && !isCodexProtocolEvent(parsed as Record<string, unknown>)) {
        if (purpose === "scenario_generation") {
          console.log(`[${logPrefix}] parseStrategy=stdout_json success=true`);
        }
        return { success: true, raw: stdoutTrimmed, parsed: parsed as Record<string, unknown>, strategy: "stdout_json", attempts };
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Strategy 3: Try fenced JSON block ```json ... ```
  attempts.push("fenced_json");
  const fencedJsonMatch = stdoutTrimmed.match(/```json\s*([\s\S]*?)\s*```/);
  if (fencedJsonMatch) {
    try {
      const parsed = JSON.parse(fencedJsonMatch[1]);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        if (purpose === "scenario_generation") {
          console.log(`[${logPrefix}] parseStrategy=fenced_json success=true`);
        }
        return { success: true, raw: fencedJsonMatch[1], parsed: parsed as Record<string, unknown>, strategy: "fenced_json", attempts };
      }
    } catch {
      // Invalid JSON in fenced block
    }
  }

  // Strategy 4: Try generic fenced block ``` ... ```
  attempts.push("fenced_generic");
  const fencedGenericMatch = stdoutTrimmed.match(/```\s*([\s\S]*?)\s*```/);
  if (fencedGenericMatch) {
    try {
      const parsed = JSON.parse(fencedGenericMatch[1]);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        if (purpose === "scenario_generation") {
          console.log(`[${logPrefix}] parseStrategy=fenced_generic success=true`);
        }
        return { success: true, raw: fencedGenericMatch[1], parsed: parsed as Record<string, unknown>, strategy: "fenced_generic", attempts };
      }
    } catch {
      // Invalid JSON
    }
  }

  // Strategy 5: Try to find balanced JSON object in stdout
  attempts.push("embedded_json");
  const embeddedJson = extractBalancedJson(stdoutTrimmed);
  if (embeddedJson) {
    if (purpose === "scenario_generation") {
      console.log(`[${logPrefix}] parseStrategy=embedded_json success=true`);
    }
    return { success: true, raw: embeddedJson.raw, parsed: embeddedJson.parsed, strategy: "embedded_json", attempts };
  }

  // All strategies failed
  if (purpose === "scenario_generation") {
    console.log(`[${logPrefix}] parseStrategy=all_failed attempts=${attempts.join(",")}`);
  }

  return { success: false, raw: "", parsed: {}, strategy: "none", attempts };
}

function extractBalancedJson(text: string): { raw: string; parsed: Record<string, unknown> } | null {
  if (!text) return null;

  let searchFrom = 0;
  while (searchFrom < text.length) {
    // Find first opening brace
    const startIndex = text.indexOf("{", searchFrom);
    if (startIndex === -1) return null;

    // Find matching closing brace
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    let endIndex = -1;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) return null;

    // Found balanced JSON
    const jsonStr = text.substring(startIndex, endIndex + 1);
    searchFrom = endIndex + 1;
    try {
      const parsed = JSON.parse(jsonStr);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        if (isCodexProtocolEvent(parsed as Record<string, unknown>)) continue;
        return { raw: jsonStr, parsed: parsed as Record<string, unknown> };
      }
    } catch {
      // Invalid JSON, keep looking
    }
  }

  return null;
}

/**
 * Codex CLI emits JSONL protocol events to stdout (thread.started, turn.started,
 * error, turn.failed, ...). These are transport/status events, never the requested
 * structured result, and must not be selected as the output.
 */
function isCodexProtocolEvent(parsed: Record<string, unknown>): boolean {
  const type = parsed.type;
  if (typeof type !== "string") return false;
  return (
    type === "thread.started"
    || type === "thread.completed"
    || type === "turn.started"
    || type === "turn.completed"
    || type === "turn.failed"
    || type === "error"
    || type === "event"
    || type === "user_message"
    || type === "assistant_message"
  );
}

/**
 * Validates that parsed JSON has the expected scenario generation shape.
 */
export function validateScenarioShape(json: Record<string, unknown>): {
  valid: boolean;
  reason: string;
  detectedKeys: string[];
} {
  const keys = Object.keys(json);

  // Check for expected scenario generation shape
  const hasScenarios = "scenarios" in json;
  const hasStories = "stories" in json;
  const hasRejected = "rejected" in json;

  // Valid if it has scenarios or stories (some variations)
  if (hasScenarios || hasStories) {
    return { valid: true, reason: "", detectedKeys: keys };
  }

  // Also valid if it only has rejected (all blocked)
  if (hasRejected && keys.length <= 3) {
    return { valid: true, reason: "", detectedKeys: keys };
  }

  return {
    valid: false,
    reason: `Missing expected keys. Found: ${keys.join(", ")}. Expected: scenarios, rejected`,
    detectedKeys: keys
  };
}

/**
 * Validates that parsed JSON has the expected spec generation shape
 * (single-spec response or batch response).
 */
export function validateSpecOutputShape(json: Record<string, unknown>): {
  valid: boolean;
  reason: string;
  detectedKeys: string[];
} {
  const keys = Object.keys(json);

  const hasSpecContent = typeof json.specContent === "string" && json.specContent.trim().length > 0;
  const hasSpecsBatch = Array.isArray(json.specs) && json.specs.length > 0;

  if (hasSpecContent || hasSpecsBatch) {
    return { valid: true, reason: "", detectedKeys: keys };
  }

  return {
    valid: false,
    reason: `Missing expected keys. Found: ${keys.join(", ")}. Expected: specContent or specs`,
    detectedKeys: keys
  };
}
