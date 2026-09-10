---
name: scenario-data-semantics
description: Resolve structured scenario input context into a conservative GenerationProfile before synthetic data generation; use for semantic enrichment of RuntimeInputRequirement metadata.
---

# Scenario Data Semantics

Resolve semantic generation metadata for one structured scenario requirement.
This skill proposes a `GenerationProfile`; it never generates values, chooses
roles, changes `scenarioDataPolicy`, executes tools, or persists data.

## Input

Accept a JSON object with:

```json
{
  "requirement": {
    "key": "optional",
    "label": "optional",
    "controlType": "optional",
    "fieldCapability": {},
    "inputRole": "optional",
    "valuePolicy": "optional",
    "scenarioDataPolicy": "optional"
  },
  "scenarioContext": {
    "title": "optional",
    "preconditions": "optional",
    "steps": [],
    "expected": "optional"
  },
  "projectGenerationConfig": {
    "availablePools": [],
    "availableDictionaries": [],
    "phoneProfiles": [],
    "namedGenerationProfiles": []
  }
}
```

Use labels, keys, and scenario language only as semantic evidence for reasoning.
Never turn them into production rules, regexes, key-prefix rules, or hardcoded
application behavior. Prefer explicit requirement metadata and project config
over ambiguous prose.

## Output

Return JSON only, with no markdown or additional text:

```json
{
  "status": "resolved",
  "confidence": "high",
  "semanticEvidence": [
    { "source": "requirement", "summary": "brief evidence summary" }
  ],
  "generationProfile": {
    "semanticType": "email",
    "generationMode": "synthetic"
  }
}
```

The only valid evidence sources are `scenario`, `requirement`, and
`project_config`. Summaries must explain evidence, not contain generated data.
When confidence is `low`, return `status=unresolved`, `confidence=low`, and
the conservative profile:

```json
{
  "semanticType": "unknown",
  "generationMode": "manual"
}
```

## Semantic Resolution

- Money, salary, income, or monetary amount -> `money`.
- Phone or mobile number -> `phone`.
- Email or electronic mail -> `email`.
- Identification or document number -> `document_identifier`.
- Job title, role, or position -> `job_title`.
- Person name -> `person_name`.
- Count or quantity -> `quantity`.
- Percentage or rate -> `percentage`.
- Date -> `date`.
- Date and time -> `datetime`.
- Unclear text -> `unknown` with `manual` mode and low confidence.

These are semantic interpretations performed by the skill, not TypeScript
heuristics. Do not infer semantic type from capability alone.

## Generation Modes

- `email` may use `synthetic`; do not emit an email value or domain value.
- `document_identifier` uses `configured_pool` only when a compatible existing
  `poolRef` is present in project config; otherwise use `manual`.
- `job_title` uses `configured_dictionary` only with an existing dictionary
  reference; otherwise use `manual`.
- `phone` may use `synthetic` only when a configured phone profile supplies the
  required metadata. Never invent national prefixes.
- `money` may use `synthetic` only with sufficient explicit/configured numeric
  metadata. Never invent business ranges.
- Other ambiguous or unsupported cases use `manual` or `unknown` conservatively.

Never invent `poolRef`, `dictionaryRef`, ranges, prefixes, masks, values, or
profile names. Never return concrete identifiers, phone numbers, emails, or
pool contents.

## Safety

Preserve the incoming role and policies as context only. Do not decide
`supporting` versus `scenario`, `trusted_required`, or any runtime policy.
Do not execute SQL, call APIs, create files, or invoke another skill.
