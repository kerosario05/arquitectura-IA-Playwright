# Enforcement Fix: Content Clicks Prevention

## Summary

Fixed the enforcement system to prevent AI-generated scenarios with invented clicks like "Clic en Beneficios" from being accepted by QA Lab compliance validator.

## Changes Made

### 1. Route Profile Derived Context (`route-profile-derived-context.ts`)

**Problem**: `visibleControls` were automatically included in `allowedExecutableClicks`, inflating the list with content terms.

**Solution**:
- ✅ Removed automatic inclusion of `visibleControls` in `allowedExecutableClicks`
- ✅ Added new category: `visibleButNotExecutableTerms`
- ✅ `allowedExecutableClicks` now ONLY includes:
  - `routeProfile.entry` (entry steps)
  - `additionalEntryTargets` (from newEntrySteps)
  - `routeProfile.intermediates` (explicit navigation)
  - `executableRouteSteps` (validated route steps)
- ✅ `visibleControls` without backing go to `visibleButNotExecutableTerms`
- ✅ `domainTerms` without backing go to `visibleButNotExecutableTerms`
- ✅ Enhanced logging with samples of each category

### 2. Compliance Validator (`scenario-route-compliance-validator.ts`)

**Problem**: Content terms were not being rejected as clicks.

**Solution**:
- ✅ Added new reason code: `content_term_used_as_click`
- ✅ Enhanced validation logic with 3-tier check:
  1. Check if target is in `visibleButNotExecutableTerms` → reject as `content_term_used_as_click`
  2. Check if target is in `assertionOnlyTerms` → reject as `assertion_term_used_as_click`
  3. Check if target is not in `allowedExecutableClicks` → reject as `unbacked_click_target`
- ✅ Validations of content terms are still allowed

### 3. Prompt Context

**Enhancement**: Updated formatted context to include:
```
### VISIBLE_BUT_NOT_EXECUTABLE
These are visible controls/terms that can be VALIDATED but NOT clicked:
- "Beneficios"
- "Requisitos"
...

### CRITICAL RULES
1. NEVER generate "Clic en <target>" if <target> is NOT in ALLOWED_EXECUTABLE_CLICKS
2. NEVER generate "Clic en <term>" if <term> is in ASSERTION_ONLY_TERMS
3. NEVER generate "Clic en <term>" if <term> is in VISIBLE_BUT_NOT_EXECUTABLE
...
```

## Tests

### New Tests (`enforcement-content-clicks.spec.ts`) - 7 passed

1. ✅ visibleControl without backing is NOT in allowedExecutableClicks
2. ✅ visibleControl backed by executableRouteSteps IS in allowedExecutableClicks
3. ✅ content term click is rejected with content_term_used_as_click
4. ✅ content term validation is allowed
5. ✅ domainTerms without backing are NOT in allowedExecutableClicks
6. ✅ intermediate targets ARE in allowedExecutableClicks
7. ✅ assertion-only terms identified by pattern

### Updated Tests

- ✅ `scenario-route-compliance-validator.spec.ts` - 12 passed
- ✅ `route-profile-derived-context.spec.ts` - 8 passed

## Acceptance Criteria

### ✅ Click Enforcement
- ✅ "Clic en Iniciar" - **ALLOWED** (entry step)
- ✅ "Clic en Información de productos" - **ALLOWED** (if backed by executableRouteSteps)
- ✅ "Clic en Beneficios" - **REJECTED** (content term, reasonCode: `content_term_used_as_click`)

### ✅ Validation Enforcement
- ✅ "Validar que se muestre Beneficios" - **ALLOWED** (validation of content)
- ✅ "Validar que se muestre Requisitos" - **ALLOWED** (validation of content)

### ✅ Metrics
- ✅ `allowedClicks` no longer inflated with visibleControls
- ✅ `assertionTerms` properly populated (non-zero when HU has content)
- ✅ `visibleButNotExecutableTerms` tracks content terms separately

### ✅ QA Lab Behavior
- ✅ Scenarios with invented clicks will be rejected by compliance validator
- ✅ Invalid scenarios will appear in `rejected` array with `reasonCode`
- ✅ QA Lab will NOT show scenarios with unbacked clicks as selectable

### ✅ Multiproject
- ✅ No hardcoded app names
- ✅ No hardcoded content terms ("Beneficios", "Requisitos", etc.)
- ✅ Generic ASSERTION_ONLY_INDICATORS patterns
- ✅ Works for any appSlug/proyecto

### ✅ Backward Compatibility
- ✅ Normalization of accents/mojibake preserved
- ✅ Entry step validation still works
- ✅ Alias matching still works
- ✅ Sensitive action validation still works

## Validation Commands

```bash
npm run typecheck                                           # ✅ 0 errors
npm run test:framework -- enforcement-content-clicks.spec.ts  # ✅ 7 passed
npm run test:framework -- scenario-route-compliance-validator.spec.ts  # ✅ 12 passed
npm run test:framework -- route-profile-derived-context.spec.ts  # ✅ 8 passed
```

## Example Output

### Before (Incorrect)
```
[route-profile-derived] allowedClicks=21 assertionTerms=0
[scenario-compliance] validScenarios=8 invalidScenarios=0
```
**Problem**: "Beneficios" was in allowedClicks (inflated from visibleControls)

### After (Correct)
```
[route-profile-derived] allowedClicks=4 assertionTerms=3 visibleButNotExecutable=17
[route-profile-derived] allowedClicks sample: Iniciar, Inicio, Información de productos
[route-profile-derived] visibleButNotExecutable sample: Beneficios, Requisitos, Condiciones...
[scenario-compliance] validScenarios=5 invalidScenarios=3
[scenario-compliance] rejected: TEST-1 reasonCode=content_term_used_as_click target="Beneficios"
```
**Result**: "Beneficios" is in visibleButNotExecutable and clicks are rejected

## Impact

- **Enforcement**: QA Lab now correctly rejects scenarios with invented clicks
- **Clarity**: Separate categories make it clear what can be clicked vs validated
- **Accuracy**: `allowedClicks` count accurately reflects executable targets
- **Diagnostics**: Clear reason codes help understand why scenarios are rejected
- **Multiproject**: Solution works across all apps without hardcoded logic
