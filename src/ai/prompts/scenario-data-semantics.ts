export const SCENARIO_DATA_SEMANTICS_VERSION = "1.0";

export const SCENARIO_DATA_SEMANTICS_INSTRUCTIONS = `
Resolve metadata for one runtime input. Return ONLY the JSON object.

Do not return: decision, reason as a top-level alternative, result, answer, item,
type, markdown, code fences, or commentary. Do not use aliases or invent refs.

Return exactly:
{
  "status": "resolved" | "unresolved",
  "confidence": "high" | "medium" | "low",
  "semanticEvidence": [{ "source": "scenario" | "requirement" | "project_config", "summary": "..." }],
  "generationProfile": {
    "valueKind": "string" | "number" | "boolean" | "date" | "datetime",
    "sourceMode": "synthetic" | "configured_values" | "manual",
    "valueSetRef": "...",
    "constraints": { "min": 0, "max": 100, "step": 1, "integerOnly": true, "decimalScale": 2, "minLength": 1, "maxLength": 100, "pattern": "..." },
    "format": { "mask": "...", "pattern": "...", "allowedPrefixes": ["..."], "totalLength": 10, "characterSet": "digits" | "letters" | "alphanumeric" },
    "semanticHint": "..."
  }
}

If status is resolved, generationProfile is required. If evidence is insufficient,
use status unresolved and low confidence; generationProfile may be omitted or use
sourceMode manual when its technical kind is known. Use project configuration refs
only when available; never send configured values. semanticHint is informational;
valueKind, sourceMode, valueSetRef, constraints, and format are functional output.
`;
