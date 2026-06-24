# Auth Discovery Learning - Microfase 2.1 (Revised: Bootstrap Execution)

## Objective
Enable automatic discovery of auth steps from login pages when `authProfile` exists but `steps` are not configured. Multiproject-generic, no hardcoding of labels or selectors.

**Revision: Execute bootstrap steps to reach login screen before discovery learning.**

## Implementation Details

### File: `src/discovery/authenticated-private-discovery.ts`

#### 1. Extended `AuthenticatedPrivateDiscoveryResult` Type (lines 85-107)

Added optional `proposedAuthProfile` field:
```typescript
proposedAuthProfile?: ProposedAuthProfile;
```

#### 2. New Type: `ProposedAuthProfile` (lines 77-104)

Structure for proposed authentication steps:
```typescript
type ProposedAuthProfile = {
  steps: Array<{
    action: "fill" | "click";
    field?: string;        // Selector for input fields
    target?: string;       // Label for clickable elements
    envVar?: string;       // Environment variable reference (e.g., $APP_PASSWORD)
    confidence: "high" | "medium" | "low";
    reason?: string;       // Why this step was proposed
  }>;
  successSignals?: string[];
  confidence: "high" | "medium" | "low";
  candidates?: Array<{
    type: "input" | "button";
    fieldType: "identity" | "password" | "otp" | "unknown";
    selectors: string[];
    label?: string;
    confidence: "high" | "medium" | "low";
  }>;
};
```

#### 3. New Helper: `extractBootstrapSteps()` (lines 119-167)

Tolerant extraction of bootstrap/entry steps with multiple property name support:
- Priority chain:
  1. `authProfile.bootstrapSteps`
  2. `authProfile.preAuthSteps`
  3. `routeProfile.entrySteps`
  4. `appConfig.entrySteps` (top-level)
  5. `publicRoutes[*].entrySteps` (first route with entry steps)
- Returns empty array if none found
- Multiproject-generic, works with any naming convention

#### 4. New Helper: `executeBootstrapSteps()` (lines 169-260)

Safe execution of bootstrap steps to reach login screen:
- **Only executes `click` actions** (no fills to avoid hardcoding credentials)
- For each click step:
  - Finds element by text, data-testid, aria-label, or :has-text selector
  - Waits for visibility (5s timeout)
  - Clicks and waits for page load:
    - Tries `networkidle` (5s timeout)
    - Falls back to `domcontentloaded` (3s timeout)
    - Tolerates both timeouts, continues with discovery
  - Logs each step: `[auth-discovery] bootstrapStep action=click target="..." success=true/false`
- **Tolerates failures**: Returns warning diagnostics but doesn't block discovery
- Returns final URL after bootstrap execution

#### 5. New Helper: `detectAuthFieldCandidates()` (lines 262-327)

Generic DOM scanning (unchanged from previous revision):
- Detects all input fields: text, password, tel, number, email
- Detects clickable elements: buttons, links, submit inputs
- Extracts available selectors (id, name, data-testid, aria-label)
- Captures nearby labels and placeholders

#### 6. New Helper: `classifyFieldType()` (lines 329-355)

Generic field classification using regex patterns (unchanged from previous revision):
- **identity**: Pattern matching for document/ID fields
- **password**: Pattern matching for password fields
- **otp**: Pattern matching for verification codes
- **unknown**: Fallback

#### 7. New Helper: `proposeAuthSteps()` (lines 357-456)

Intelligent step proposal (unchanged from previous revision):
- Groups inputs by type
- Creates fill actions with env var references
- Detects submit button for click action
- Calculates confidence score

#### 8. New Helper: `discoverAuthProfileSteps()` (lines 463-551)

**Updated orchestrator for Microfase 2.1 with bootstrap:**
```typescript
async function discoverAuthProfileSteps(
  page: Page,
  appSlug: string,
  baseUrl: string,
  appConfig: Record<string, unknown> | undefined  // NEW: app config for bootstrap steps
): Promise<{ proposedProfile: ProposedAuthProfile; diagnostics: ... }>
```

Execution flow:
1. Extract bootstrap steps from app config (tolerant property names)
2. **Execute bootstrap steps if found** (NEW in revised version)
3. Detect auth field candidates on resulting page
4. Propose auth steps
5. Return proposed profile with diagnostics

Logs added:
```
[auth-discovery] started appSlug=<appSlug>
[auth-discovery] bootstrapStepsResolved=<n>                           # NEW
[auth-discovery] bootstrapStep action=click target="..." success=true  # NEW
[auth-discovery] postBootstrapUrl=<url>                               # NEW
[auth-discovery] candidates inputs=<n> buttons=<n>
[auth-discovery] proposedSteps=<n> confidence=<low|medium|high>
```

#### 9. Integrated into Phase 2 Flow (lines 750-800)

When `authStepsResolved=0`:
1. Calls `discoverAuthProfileSteps(page, appSlug, baseUrl, appConfig)` with app config
2. Bootstrap steps are executed before field detection
3. If discovery succeeds → returns proposed profile
4. If discovery fails → returns diagnostic message

## Behavior Examples

### Example 1: App with Bootstrap Entry Step
**App config:**
```json
{
  "baseUrl": "https://app.example.com/login",
  "authProfile": { /* no steps defined */ },
  "routeProfile": {
    "entrySteps": [
      {
        "action": "click",
        "target": "Iniciar Sesión"
      }
    ]
  }
}
```

**Discovery flow:**
1. Navigate to baseUrl → page has button "Iniciar Sesión"
2. Extract bootstrap steps from routeProfile.entrySteps
3. Execute: click "Iniciar Sesión"
4. Wait for page load, capture new URL
5. Detect inputs on login form
6. Propose steps for username/password/submit

**Logs:**
```
[auth-discovery] started appSlug=kiosko
[auth-discovery] bootstrapStepsResolved=1
[auth-discovery] bootstrapStep action=click target="Iniciar Sesión" success=true
[auth-discovery] postBootstrapUrl=https://app.example.com/login?step=auth
[auth-discovery] candidates inputs=2 buttons=1
[auth-discovery] proposedSteps=3 confidence=high
```

### Example 2: Direct Login Without Bootstrap
**App config:**
```json
{
  "baseUrl": "https://app.example.com/login",
  "authProfile": { /* no steps defined */ }
}
```

**Discovery flow:**
1. Navigate to baseUrl → page already shows login form
2. Extract bootstrap steps → empty
3. Skip bootstrap execution
4. Detect inputs on login form directly
5. Propose steps

**Logs:**
```
[auth-discovery] started appSlug=kiosko
[auth-discovery] bootstrapStepsResolved=0
[auth-discovery] candidates inputs=2 buttons=1
[auth-discovery] proposedSteps=3 confidence=high
```

### Example 3: Bootstrap Click Fails (Tolerant)
**Bootstrap element not visible or not found:**

**Discovery flow:**
1. Extract bootstrap steps
2. Try to execute click → fails with warning
3. **Continue anyway** (tolerant)
4. Detect inputs on current page (may be empty if bootstrap didn't work)
5. Return diagnostic warning + proposed profile

**Logs:**
```
[auth-discovery] started appSlug=kiosko
[auth-discovery] bootstrapStepsResolved=1
[auth-discovery] bootstrapStep action=click target="Iniciar" success=false
[auth-discovery] candidates inputs=0 buttons=1
[auth-discovery] proposedSteps=0 confidence=low
```

**Result:**
```json
{
  "reasonCode": "auth_profile_steps_not_discoverable",
  "diagnostics": [
    {
      "level": "warning",
      "code": "bootstrap_click_target_not_visible",
      "message": "Bootstrap click target not visible or not found: target=\"Iniciar\""
    },
    {
      "level": "warning",
      "code": "no_candidates_found",
      "message": "No input fields or buttons detected on login page..."
    }
  ]
}
```

## Bootstrap Properties Supported (Tolerant)

Authorization steps can be defined in multiple locations, with fallback priority:

1. **authProfile.bootstrapSteps** - Explicit bootstrap in auth profile
2. **authProfile.preAuthSteps** - Pre-auth steps in auth profile
3. **routeProfile.entrySteps** - Public route entry steps (already learned)
4. **appConfig.entrySteps** - Top-level entry steps
5. **publicRoutes[].entrySteps** - First public route with entry steps

This allows reusing already-learned entry steps for bootstrap without duplicating configuration.

## Safety & Constraints

✅ Only executes `click` actions in bootstrap (no fills)
✅ No hardcoding of "Iniciar", "Entrar", or other labels
✅ Tolerates missing or non-visible bootstrap elements
✅ Tolerates page load timeouts (networkidle/domcontentloaded)
✅ Continues discovery even if bootstrap fails (warning, not error)
✅ No modification of app.config (persisted=false)

## Multiproject & Generic

✅ No hardcoding of KIOSKO, entry points, or specific selectors
✅ Tolerant property names for bootstrap steps
✅ Pattern-based field classification (identity/password/otp)
✅ Generic env var references ($Identity_Provider, $APP_PASSWORD, $OTP_SECRET)
✅ Works with any appSlug and login page structure
✅ Reuses public entry steps if available

## Next Steps (Microfase 3+)

- Persist approved proposedAuthProfile to app.config.json
- Execute proposed steps to verify they work
- Detect success signals on landing page after authentication
- Explore private routes and controls from authenticated session

## Validation

✅ Bootstrap steps executed before discovery learning
✅ No hardcoding or project-specific logic
✅ Tolerant to missing/failed bootstrap steps
✅ Clear diagnostics for successful and failed discovery
✅ No modification of app.config
✅ No changes to evidence, TestRail, public generation, or routeProfile
