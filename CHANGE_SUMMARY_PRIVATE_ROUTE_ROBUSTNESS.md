# Private Route Configuration - Multi-Project Robustness (v2)

## Objective
Make `buildPrivateRouteProfile()` tolerant of different property names in `privateRoutes` configuration with intelligent deduplication, fallback defaults, and missing action control warnings.

## Changes Made

### File: `src/scenarios/scenario-preview.service.ts`

#### 1. Added Normalization Helper (lines 172-183)

```typescript
function normalizeForComparison(text?: string): string
```
- Removes accents, case-insensitive comparison
- Normalizes whitespace for accurate deduplication
- Used to prevent navigation path duplication when module equals first path segment

#### 2. Extended `PrivateRouteConfig` Type (lines 130-143)
Added alternative property names for navigation, actions, and assertions:

```typescript
type PrivateRouteConfig = {
  module?: string;
  path?: string[] | string;      // Primary navigation property
  route?: string[] | string;     // Alternative: 'route'
  steps?: string[] | string;     // Alternative: 'steps'
  actionControls?: string[];     // Primary action property
  actions?: string[];            // Alternative: 'actions'
  allowedActions?: string[];     // Alternative: 'allowedActions'
  controls?: string[];           // Alternative: 'controls'
  assertionTerms?: string[];     // Primary assertion property
  assertions?: string[];         // Alternative: 'assertions'
  validationTerms?: string[];    // Alternative: 'validationTerms'
  signals?: string[];
};
```

#### 3. Helper Functions (lines 145-170)

**`extractNavigationPath()`** - Tolerant navigation extraction:
- Priority: `path` → `route` → `steps`
- Handles both arrays and single strings
- Returns empty array if not found

**`extractActionControls()`** - Tolerant action extraction:
- Priority: `actionControls` → `actions` → `allowedActions` → `controls`
- Only these values go to `allowedExecutableClicks`
- Handles both arrays and single strings

**`extractAssertionTerms()`** - Tolerant assertion extraction:
- Priority: `assertionTerms` → `assertions` → `validationTerms`
- These are validation-only, NOT executable clicks
- Handles both arrays and single strings

#### 4. Updated `buildPrivateRouteProfile()` (lines 185-271)

**Key Changes:**

**A. Accepts appConfig parameter** (line 191)
```typescript
function buildPrivateRouteProfile(
  appSlug: string,
  privateRoutes: PrivateRouteConfig[] | undefined,
  appConfig?: any,  // NEW: For fallback defaults
  issue?: { summary?: string; description?: string }
)
```

**B. Applies fallback defaults** (lines 204-212)
```typescript
// Apply fallbacks from app.config if empty
if (actionControls.length === 0 && appConfig?.privateActionControls) {
  const fallback = appConfig.privateActionControls as string[] | string | undefined;
  actionControls = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
}
if (assertionTerms.length === 0 && appConfig?.privateAssertionTerms) {
  const fallback = appConfig.privateAssertionTerms as string[] | string | undefined;
  assertionTerms = Array.isArray(fallback) ? fallback : (fallback ? [fallback] : []);
}
```

**C. Deduplicates navigation path** (lines 214-226)
```typescript
// Build navigation path without duplicating module
let navigationSegments: string[] = [];
if (selectedRoute.module) {
  navigationSegments.push(selectedRoute.module);
}
// Avoid duplicating module if it's the first path segment (after normalization)
const normalizedModule = normalizeForComparison(selectedRoute.module);
for (const segment of pathSegments) {
  const normalizedSegment = normalizeForComparison(segment);
  if (normalizedSegment && normalizedSegment !== normalizedModule) {
    navigationSegments.push(segment);
  }
}
```

**Example:**
- Input: `module="Transacciones"`, `path=["Transacciones", "Historial"]`
- Output: `navigationSegments=["Transacciones", "Historial"]` (not `["Transacciones", "Transacciones", "Historial"]`)
- Works correctly with accents/case: `module="Transacciones"` == `path="transacciones"` (normalized)

**D. Only actionControls → visibleControls** (line 244)
```typescript
visibleControls: actionControls,  // Only actionControls as executable; assertions are validation-only
```

**E. Enhanced logging with warning** (lines 254-268)

Normal case (actionControls > 0):
```
[private-route] resolved=true route="Transacciones → Historial" actionControls=2 assertionTerms=2
[private-route-profile] built navigationPath=2 actionControls=2 assertionTerms=2
```

Warning case (actionControls = 0, even with fallback applied):
```
[private-route] resolved=true route="Transacciones → Historial" actionControls=0 assertionTerms=2
[private-route-profile] WARNING missing_action_controls route="Transacciones → Historial"
```

#### 5. Updated Call Site (line 303)
Passes `appConfig` to `buildPrivateRouteProfile()`:
```typescript
const { profile: privateProfile, resolved } = buildPrivateRouteProfile(
  targetAppSlug,
  privateRoutes,
  appConfig,  // NEW: For fallback defaults
  { summary: jiraSummary, description: jiraDescription }
);
```

## Validation Rules

### 1. Property Name Tolerance
✅ All property names from `PrivateRouteConfig` are checked in priority order
✅ Multiple naming conventions supported without hardcoding
✅ Single strings and arrays handled uniformly

### 2. No Path Duplication
✅ Module normalized and compared against first path segment
✅ Handles accents/case correctly
✅ Result: `["Transacciones", "Historial"]` not `["Transacciones", "Transacciones", "Historial"]`

### 3. Fallback Defaults
✅ If privateRoute has no actionControls, uses `app.config.privateActionControls`
✅ If privateRoute has no assertionTerms, uses `app.config.privateAssertionTerms`
✅ Type-tolerant: handles arrays, strings, or undefined

### 4. Missing Action Controls Warning
✅ If actionControls = 0 (even after fallback), emits WARNING log
✅ Format: `[private-route-profile] WARNING missing_action_controls route="..."`
✅ Allows inspection without breaking; helps diagnose configuration issues

### 5. Action Handling
✅ Only `actionControls`/`actions`/`allowedActions`/`controls` → executable clicks
✅ Examples: `["Volver", "Finalizar sesión", "Modificar"]`
✅ Check: Will NOT raise `unbacked_click_target` in compliance validation

### 6. Assertion Handling
✅ `assertionTerms`/`assertions`/`validationTerms` → validation-only
✅ Examples: `["Detalles", "Requisitos", "Beneficios"]`
✅ NOT executable, only used in "Validar que se muestre..." patterns

### 7. Public Flow Preservation
✅ No changes to public HU flow
✅ No changes to scenario-intent-classifier
✅ No hardcoding of KIOSKO products or business-specific routes
✅ Configuration-driven only

## Expected Behavior

### Scenario 1: Alternative property names with deduplication
```json
{
  "privateRoutes": [
    {
      "module": "Transacciones y servicios",
      "route": ["Transacciones y servicios", "Historial"],
      "actions": ["Volver"],
      "assertions": ["Detalles"]
    }
  ]
}
```

**Result:**
- Path deduplication: first segment matches module (normalized)
- `[private-route] resolved=true route="Transacciones y servicios → Historial" actionControls=1 assertionTerms=1`
- Logs show `navigationPath=2` (module + 1 unique segment)
- "Volver" is executable

### Scenario 2: Fallback defaults from app.config
```json
{
  "privateActionControls": ["Volver"],
  "privateAssertionTerms": ["Detalles", "Requisitos"],
  "privateRoutes": [
    {
      "module": "Servicios",
      "path": ["Gestión"]
      // No actions or assertions defined
    }
  ]
}
```

**Result:**
- `actionControls` fallback to `["Volver"]`
- `assertionTerms` fallback to `["Detalles", "Requisitos"]`
- `[private-route] resolved=true route="Servicios → Gestión" actionControls=1 assertionTerms=2`
- Works same as if they were explicitly defined

### Scenario 3: Missing action controls (warning)
```json
{
  "privateRoutes": [
    {
      "module": "Servicios",
      "path": ["Gestión"],
      "assertions": ["Estado"]
      // No actionControls, no app.config fallback
    }
  ]
}
```

**Result:**
- `[private-route] resolved=true route="Servicios → Gestión" actionControls=0 assertionTerms=1`
- `[private-route-profile] WARNING missing_action_controls route="Servicios → Gestión"`
- Warns developer but doesn't fail; scenario generation continues

## Test Coverage

### Manual Verification
1. Set up app.config with `privateRoutes` containing:
   - Alternative navigation property names (path/route/steps)
   - Alternative action property names (actionControls/actions/allowedActions/controls)
   - Alternative assertion property names (assertionTerms/assertions/validationTerms)
   - Duplicate module in path (e.g., module="Transacciones", path=["Transacciones", "Historial"])
2. Add `privateActionControls`/`privateAssertionTerms` as defaults
3. Run scenario preview for private HU
4. Check logs:
   - ✅ No path duplication in `[private-route]` route string
   - ✅ Correct counts in `[private-route-profile]`
   - ✅ Warning emitted if actionControls = 0
   - ✅ Fallback defaults applied correctly
5. Verify generated scenarios pass compliance validation
6. Confirm actions (from actionControls) are not marked as `unbacked_click_target`

## Architecture Notes

- **Non-invasive:** Only touches private routing, no changes to public flow
- **Backward compatible:** Existing `PrivateRouteConfig` with original property names still work
- **Multiproject:** No hardcoding, all configuration-driven via app.config.json
- **Distinction:** Clear separation of executable (actionControls) vs. validation-only (assertionTerms)
- **Deduplication:** Normalized comparison prevents path redundancy across different text encodings
- **Fallback Strategy:** App-level defaults support consistent action/assertion handling across multiple private routes
- **Route-profile-derived-context:** Step 6 correctly includes visibleControls in allowedExecutableClicks for private profiles

## Related Files
- `src/scenarios/route-profile-derived-context.ts` - Step 6 includes visibleControls for private profiles
- `src/scenarios/scenario-route-compliance-validator.ts` - Validates clicks against allowedExecutableClicks
- `src/scenarios/scenario-intent-classifier.ts` - Classifies as "private/authenticated_transaction"

