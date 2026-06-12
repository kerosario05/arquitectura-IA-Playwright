# Bug Fix: Deterministic Steps Format and AllowedExecutableClicks Classification

## Summary

Fixed two critical bugs in QA Lab scenario generation:
1. **`step.match is not a function`** - Deterministic generator was returning object steps instead of strings
2. **Incorrect classification** - "Beneficios" and similar content terms were being included in allowedExecutableClicks

## Problems

### Problem 1: step.match is not a function

**Error:**
```
[scenarios:preview] failed error=step.match is not a function
```

**Root Cause:**
The deterministic generator (`tryDeterministicGeneration`) was creating steps as objects:
```javascript
steps.push({
  description: `Clic en "${entryStep.target}".`,
  action: entryStep.action || "click",
  target: entryStep.target || "",
});
```

But downstream code expected steps to be strings and called `.match()` on them:
```javascript
const clickMatch = step.match(/Clic en "([^"]+)"/i);
```

### Problem 2: Incorrect AllowedExecutableClicks Classification

**Logs:**
```
allowedClicks=4 assertionTerms=0 visibleButNotExecutable=17
allowedClicks sample: Beneficios, Información de productos, Iniciar, información_de_productos
```

**Issue:** "Beneficios" should be in `visibleButNotExecutableTerms` or `assertionOnlyTerms`, not in `allowedExecutableClicks`.

## Solutions

### Solution 1: Step Format Normalization

**New File:** `src/scenarios/step-formatter.ts`

Created utility functions to handle step format conversion:

```typescript
// Format individual steps
function formatExecutableStep(step: StepObject | string, index: number): string

// Convert array of mixed steps to strings
function ensureStepStrings(steps: (StepObject | string)[]): string[]

// Normalize scenario steps
function normalizeScenarioSteps<T extends { steps: any[] }>(scenario: T): T
```

**Formats supported:**
- `click` → `"1. Clic en \"Target\"."`
- `assert_visible` → `"2. Validar que se muestre \"Target\"."`
- `assert_button_visible` → `"3. Validar que el botón \"Target\" esté visible."`
- `select_ordinal` → `"4. Seleccionar el primer {term} visible del listado."`

**Modified:** `src/scenarios/codex-scenario-generator.ts`
- Added defensive normalization after deterministic generation
- Added defensive normalization after AI response parsing
- Converts object steps to strings before creating scenarios

```typescript
// Convert object steps to string steps
const stringSteps = ensureStepStrings(steps);

const scenario = {
  // ...
  steps: stringSteps, // Use converted string steps
};
```

### Solution 2: Strict AllowedExecutableClicks Classification

**Modified:** `src/scenarios/route-profile-derived-context.ts`

Added source tracking and stricter classification:

```typescript
export type DerivedExecutionContext = {
  // ... existing fields
  clickSources?: Map<string, string>; // NEW: tracks source of each click
};
```

**Updated `deriveAllowedExecutableClicks` to:**
1. Track source for each allowed click (entry, entryStep, intermediate, targetPath, executableRouteStep)
2. Add support for `targetPaths` in route profile
3. Never automatically include visibleControls unless backed

**Allowed sources (in order of precedence):**
1. `routeProfile.entry` - Entry targets
2. `additionalEntryTargets` - From entrySteps
3. `routeProfile.intermediates` - Navigation intermediates
4. `routeProfile.targetPaths` - Explicit path definitions
5. `routeResolutions.executableRouteSteps` - Validated route steps

**NOT included:**
- `visibleControls` without backing
- `domainTerms` without backing
- Content terms from HU text

**Enhanced logging:**
```
[route-profile-derived] allowedClicks sources: entry=2 intermediate=3 targetPath=2
[route-profile-derived] allowedClicks examples: "Iniciar"(entry), "Cuentas"(intermediate), "Productos"(targetPath)
```

## Tests

**New:** `tests/deterministic-steps-bug-fix.spec.ts` - 12 tests passed

### Deterministic Steps Format:
1. ✅ Converts object steps to string steps
2. ✅ formatExecutableStep handles different action types
3. ✅ Preserves string steps with correct numbering
4. ✅ Handles mixed formats (objects + strings)
5. ✅ Does not throw `step.match is not a function`

### AllowedExecutableClicks Classification:
6. ✅ visibleControl without backing NOT in allowedExecutableClicks
7. ✅ Content term in visibleControls rejected as click
8. ✅ Content term as validation is allowed
9. ✅ targetPath steps ARE in allowedExecutableClicks
10. ✅ Intermediate steps ARE in allowedExecutableClicks
11. ✅ executableRouteSteps ARE in allowedExecutableClicks
12. ✅ Multiproject solution without hardcoded targets

### Existing Tests:
- ✅ `enforcement-content-clicks.spec.ts` - 7 passed
- ✅ `route-profile-derived-context.spec.ts` - 8 passed
- ✅ `scenario-route-compliance-validator.spec.ts` - 12 passed

## Example Transformation

### Before (Bug):
```javascript
// Deterministic generator
steps.push({
  action: "click",
  target: "Iniciar",
  description: 'Clic en "Iniciar".'
});

scenario.steps = steps; // Object array

// Downstream code
const clickMatch = step.match(/Clic en/); // ❌ step.match is not a function
```

### After (Fixed):
```javascript
// Deterministic generator
steps.push({
  action: "click",
  target: "Iniciar",
  description: 'Clic en "Iniciar".'
});

const stringSteps = ensureStepStrings(steps); // Convert to strings
scenario.steps = stringSteps; // String array: ['1. Clic en "Iniciar".']

// Downstream code
const clickMatch = step.match(/Clic en/); // ✅ Works!
```

## Classification Example

### Before (Incorrect):
```
allowedExecutableClicks: ["Beneficios", "Información de productos", "Iniciar"]
visibleButNotExecutableTerms: []
```

### After (Correct):
```
allowedExecutableClicks: ["Iniciar", "Información de productos"]
allowedClicks sources: entry=1 intermediate=1
allowedClicks examples: "Iniciar"(entry), "Información de productos"(intermediate)

visibleButNotExecutableTerms: ["Beneficios", "Requisitos", ...]
```

## Acceptance Criteria

✅ QA Lab deterministic preview does not fail with `step.match is not a function`
✅ Preview completes without calling AI when deterministic can generate
✅ Final steps are in string MCP-ready format
✅ "Beneficios" not in allowedExecutableClicks without explicit backing
✅ "Clic en Beneficios" is rejected with `content_term_used_as_click`
✅ "Validar que se muestre Beneficios" is allowed
✅ Solution is multiproject - no hardcoded terms
✅ Source tracking shows where each click comes from
✅ targetPaths support added for explicit path definitions
✅ Defensive normalization prevents future format bugs

## Commands

```bash
npm run typecheck                                           # ✅ 0 errors
npm run test:framework -- deterministic-steps-bug-fix.spec.ts  # ✅ 12 passed
npm run test:framework -- enforcement-content-clicks.spec.ts  # ✅ 7 passed
npm run test:framework -- route-profile-derived-context.spec.ts  # ✅ 8 passed
npm run test:framework -- scenario-route-compliance-validator.spec.ts  # ✅ 12 passed
```

## Impact

- **Stability**: Fixed crash in deterministic generation flow
- **Correctness**: Content terms no longer incorrectly classified as executable clicks
- **Diagnostics**: Source tracking shows exactly where each allowed click comes from
- **Defensive**: Normalization prevents future format mismatches
- **Multiproject**: Solution works across all apps without hardcoding
