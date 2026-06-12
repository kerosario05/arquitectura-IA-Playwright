# Intermediate Step Resolution and Repair

## Summary

Implemented automatic resolution and insertion of missing intermediate navigation steps to ensure MCP scenarios have coherent, navigable paths before publication or execution.

## Problem

QA Lab generated scenarios with navigation gaps:

```
1. Clic en "Iniciar".
2. Clic en "Información de productos".
3. Clic en "Cuentas de Efectivo".
4. Validar que se muestre "Pesos".
```

But the real navigation requires:
`Información de productos → Cuentas → Cuentas de Efectivo`

The correct scenario should be:

```
1. Clic en "Iniciar".
2. Clic en "Información de productos".
3. Clic en "Cuentas".
4. Clic en "Cuentas de Efectivo".
5. Validar que se muestre "Pesos".
```

## Solution

### 1. Extended Route Profile Types

**Modified: `src/scenarios/scenario-types.ts`**

Added support for declaring intermediate steps per target:

```typescript
export type McpRouteProfile = {
  // ... existing fields
  targetPaths?: Record<string, TargetPathDefinition>;
};

export type TargetPathDefinition = {
  target: string;
  requiredIntermediates: string[];
  confidence?: "high" | "medium" | "low";
  source?: string;
};

export type ExecutablePathResolution = {
  canResolve: boolean;
  pathSteps: EntryStepConfig[];
  insertedSteps: EntryStepConfig[];
  confidence: "high" | "medium" | "low" | "none";
  reasonCode: string;
  diagnostics: Array<{ level, message, context }>;
};
```

### 2. Path Resolver

**New: `src/scenarios/scenario-path-resolver.ts`**

Multi-project path resolution with multiple strategies:

```typescript
resolveExecutablePath(
  target: string,
  currentContext: string[],
  routeProfile: McpRouteProfile,
  derivedContext: DerivedExecutionContext,
  routeResolution?: ScenarioRouteResolution
): ExecutablePathResolution
```

**Resolution Strategies:**
1. **Explicit targetPaths** - Defined in route profile (highest confidence)
2. **Route Resolution** - From executableRouteSteps (high confidence)
3. **Intermediates Map** - Inferred from intermediates groups (medium confidence)
4. **Entry Point** - No intermediates needed (high confidence)

### 3. Intermediate Repair Logic

**New: `src/scenarios/scenario-intermediate-repair.ts`**

Detects and inserts missing intermediate steps:

```typescript
repairMissingIntermediates(
  scenario: McpScenario,
  routeProfile: McpRouteProfile,
  derivedContext: DerivedExecutionContext,
  routeResolution?: ScenarioRouteResolution,
  confidenceThreshold: "high" | "medium" | "low" = "medium"
): IntermediateRepairResult
```

**Repair Logic:**
- Tracks navigation context through each step
- Resolves path for each click target
- Inserts missing intermediates if confidence meets threshold
- Rejects scenario if path cannot be resolved
- Re-numbers all steps after insertion

### 4. Integration in Scenario Preview Service

**Modified: `src/scenarios/scenario-preview.service.ts`**

Added intermediate repair after entry step insertion:

```typescript
// After entry steps insertion
if (resolvedRouteProfile) {
  const derivedContext = buildDerivedExecutionContext(...);
  
  rawScenarios = rawScenarios.map((sc) => {
    const repairResult = repairMissingIntermediates(
      sc,
      resolvedRouteProfile,
      derivedContext,
      routeResolution,
      "medium"
    );
    
    if (repairResult.repaired) {
      return { ...sc, steps: repairResult.repairedSteps };
    } else if (repairResult.reasonCode !== "no_repair_needed") {
      // Mark as rejected
      rejected.push(...);
      return null;
    }
    
    return sc;
  });
}
```

### 5. Compliance Validator Enhancement

**Modified: `src/scenarios/scenario-route-compliance-validator.ts`**

Added navigation coherence validation:

```typescript
export type ComplianceReasonCode =
  | "unbacked_click_target"
  | "assertion_term_used_as_click"
  | "content_term_used_as_click"
  | "sensitive_click_not_allowed"
  | "missing_intermediate_step"  // NEW
  | "navigation_incoherent"        // NEW
  | "valid";
```

Validates that scenarios don't have navigation gaps.

## Tests

**New: `tests/scenario-intermediate-repair.spec.ts`** - 9 tests passed

1. ✅ Inserts required intermediate before target final
2. ✅ No insertion if intermediate already present
3. ✅ Rejects if missing intermediate and no reliable path
4. ✅ Does not insert assertionOnlyTerm as intermediate
5. ✅ Does not insert sensitiveAction as intermediate
6. ✅ Supports normalized labels and mojibake
7. ✅ Multi-project works without hardcoded targets
8. ✅ Validates navigation coherence detects missing intermediates
9. ✅ Path resolution from executableRouteSteps includes all intermediates

**Existing Tests:**
- ✅ `scenario-route-compliance-validator.spec.ts` - 12 passed
- ✅ `route-profile-derived-context.spec.ts` - 8 passed
- ✅ `enforcement-content-clicks.spec.ts` - 7 passed

## Example Usage

### Route Profile Configuration

```json
{
  "routeProfile": {
    "name": "kiosko-profile",
    "entry": [
      { "businessLabel": "inicio", "visibleLabel": "Iniciar" }
    ],
    "intermediates": {
      "productos": [
        "Información de productos",
        "Cuentas",
        "Cuentas de Efectivo"
      ]
    },
    "targetPaths": {
      "Cuentas de Efectivo": {
        "target": "Cuentas de Efectivo",
        "requiredIntermediates": [
          "Información de productos",
          "Cuentas"
        ],
        "confidence": "high",
        "source": "manual"
      }
    }
  }
}
```

### Before Repair

```json
{
  "steps": [
    "1. Clic en \"Iniciar\".",
    "2. Clic en \"Información de productos\".",
    "3. Clic en \"Cuentas de Efectivo\".",
    "4. Validar que se muestre \"Pesos\"."
  ]
}
```

### After Repair

```json
{
  "steps": [
    "1. Clic en \"Iniciar\".",
    "2. Clic en \"Información de productos\".",
    "3. Clic en \"Cuentas\".",
    "4. Clic en \"Cuentas de Efectivo\".",
    "5. Validar que se muestre \"Pesos\"."
  ]
}
```

### Logs

```
[intermediate-repair] appSlug=test-app issue=TEST-1 scenario="Test scenario" repaired=true insertedCount=1 reasonCode=missing_intermediate_step_repaired
[intermediate-repair] inserted: Cuentas
```

## Multiproject Compliance

✅ **No hardcoded targets** - Works with any app/route profile
✅ **No hardcoded paths** - All paths come from route profile metadata
✅ **Generic rules** - All logic is app-agnostic
✅ **Metadata-driven** - Uses routeProfile, intermediates, targetPaths, aliases
✅ **Normalization support** - Handles accents, mojibake, encoding variations

## Acceptance Criteria

✅ If target requires intermediate, scenario includes intermediate
✅ MCP doesn't validate children before opening parent
✅ Evidence shows real, coherent navigation path
✅ No invented steps from HU text
✅ Solution works for any appSlug/proyecto
✅ Entry + intermediates + target = complete path
✅ Confidence threshold determines insertion (high/medium/low)
✅ Unresolvable paths are rejected with diagnostics
✅ assertionOnlyTerms not used as intermediates
✅ sensitiveActions not used as intermediates
✅ Normalized matching works for intermediates
✅ AI prompt receives complete executableRouteSteps

## Commands

```bash
npm run typecheck                                           # ✅ 0 errors
npm run test:framework -- scenario-intermediate-repair.spec.ts  # ✅ 9 passed
npm run test:framework -- scenario-route-compliance-validator.spec.ts  # ✅ 12 passed
npm run test:framework -- route-profile-derived-context.spec.ts  # ✅ 8 passed
npm run test:framework -- enforcement-content-clicks.spec.ts  # ✅ 7 passed
```

## Impact

- **Navigation Coherence**: Scenarios now have complete, navigable paths
- **Auto-Repair**: Missing intermediates are inserted automatically
- **Clear Diagnostics**: Unresolvable paths are rejected with actionable messages
- **Multi-Strategy Resolution**: Explicit paths, route resolutions, intermediates, entry points
- **Confidence-Based**: Only insert intermediates with sufficient confidence
- **Multiproject**: Generic solution works across all apps without hardcoding
