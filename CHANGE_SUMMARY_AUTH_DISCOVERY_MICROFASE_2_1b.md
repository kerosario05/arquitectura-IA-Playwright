# Auth Gated Module Route Learning - Microfase 2.1b

## Objective
Enable authentication discovery to navigate private/gated modules before reaching the login form. Handles apps where login form appears only after selecting a private module/section.

Example flow:
1. Navigate to baseUrl
2. Click "Iniciar" (bootstrap)
3. Select module: "Transacciones y servicios" (private entry) ← NEW
4. Then login form appears with identity/password fields

## Implementation Details

### File: `src/discovery/authenticated-private-discovery.ts`

#### 1. New Helper: `resolvePrivateEntryTarget()` (lines 35-75)

Multiproject-tolerant resolution of private module to enter:
```typescript
function resolvePrivateEntryTarget(
  appConfig: Record<string, unknown> | undefined,
  suggestedRoute?: string
): string | null
```

Priority chain:
1. `input.suggestedRoute` - From request parameter
2. `appConfig.privateRoutes[0].module` - Primary module name
3. `appConfig.privateRoutes[0].path[0]` - First path segment (fallback)
4. Returns null if none found (app might not have gated modules)

Examples:
- privateRoutes[0] = { module: "Transacciones y servicios" } → returns "Transacciones y servicios"
- privateRoutes[0].path = ["Transacciones y servicios", "Historial"] → returns "Transacciones y servicios"
- suggestedRoute = "Servicios Privados" → returns "Servicios Privados" (overrides config)

#### 2. New Helper: `executePrivateEntryStep()` (lines 77-167)

Safe execution of click to enter private module:
```typescript
async function executePrivateEntryStep(
  page: Page,
  target: string
): Promise<{
  success: boolean;
  postEntryUrl: string;
  diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"];
  visibleClickables: Array<any>;
}>
```

Uses robust click resolver (`findClickableByTarget()`):
- Finds element by text, role, data attributes
- Tolerates click failure (warning, doesn't block)
- Waits for page load (networkidle → domcontentloaded)
- Captures visible candidates for diagnostics
- Logs: `[auth-discovery] privateEntryClick strategy=<strategy> success=true/false`

#### 3. New Helper: `detectAuthChoices()` (lines 169-217)

Detects authentication method options (multiidioma):
```typescript
async function detectAuthChoices(
  page: Page
): Promise<Array<{ text: string; confidence: "high" | "medium" | "low" }>>
```

Multiidioma patterns:
- **High confidence**: "cédula", "documento", "identificación"
- **Medium confidence**: "id", "customer", "cliente", "usuario"
- Finds clickable elements matching identity-related patterns
- Returns sorted by confidence for selection

#### 4. Updated `discoverAuthProfileSteps()` (lines 853-972)

Enhanced orchestrator with private entry support:
```typescript
async function discoverAuthProfileSteps(
  page: Page,
  appSlug: string,
  baseUrl: string,
  appConfig: Record<string, unknown> | undefined,
  suggestedRoute?: string  // NEW: from request
)
```

Flow:
1. **Bootstrap execution** - Reach entry point (e.g., after "Iniciar")
2. **Private entry resolution** - Determine module target from privateRoutes
3. **Private entry execution** - Click to enter private module
4. **Auth choice detection** - Find method selection options (if any)
5. **Field detection** - Scan for login inputs/buttons
6. **Step proposal** - Build auth steps

Logs added:
```
[auth-discovery] privateEntryTargetResolved="<target>"
[auth-discovery] privateEntryClick strategy=<strategy> success=true/false
[auth-discovery] postPrivateEntryUrl=<url>
[auth-discovery] authChoices candidates=<n> selected="<target>"
[auth-discovery] candidates inputs=<n> buttons=<n>
[auth-discovery] proposedSteps=<n> confidence=<high|medium|low>
```

## Behavior Examples

### Example 1: App with Gated Private Module
**App config:**
```json
{
  "baseUrl": "https://app.example.com",
  "routeProfile": {
    "entrySteps": [
      { "action": "click", "target": "Iniciar" }
    ]
  },
  "privateRoutes": [
    {
      "module": "Transacciones y servicios",
      "path": ["Transacciones y servicios", "Historial"]
    }
  ]
}
```

**POST /api/discovery/private { appSlug: "kiosko", dryRun: false }**

Flow & Logs:
```
[auth-discovery] started appSlug=kiosko
[auth-discovery] bootstrapStepsResolved=1
[auth-discovery] bootstrapStep action=click target="Iniciar" success=true
[auth-discovery] postBootstrapUrl=https://app.example.com/home

[auth-discovery] privateEntryTargetResolved="Transacciones y servicios"
[auth-discovery] privateEntryClick strategy=getByRole(button) success=true
[auth-discovery] postPrivateEntryUrl=https://app.example.com/auth?module=txn

[auth-discovery] authChoices candidates=0 (no method selection needed)
[auth-discovery] candidates inputs=2 buttons=1
[auth-discovery] proposedSteps=3 confidence=high
```

Response:
```json
{
  "ok": false,
  "reasonCode": "auth_profile_steps_discovery_required",
  "proposedAuthProfile": {
    "steps": [
      { "action": "fill", "field": "[name=\"cedula\"]", "envVar": "$Identity_Provider", "confidence": "medium" },
      { "action": "fill", "field": "[name=\"password\"]", "envVar": "$APP_PASSWORD", "confidence": "medium" },
      { "action": "click", "target": "Entrar", "confidence": "high" }
    ],
    "confidence": "high"
  },
  "diagnostics": [
    {
      "level": "info",
      "code": "private_entry_step_executed",
      "message": "Private entry step executed: click \"Transacciones y servicios\" (strategy: getByRole(button))"
    },
    {
      "level": "info",
      "code": "auth_discovery_proposed",
      "message": "Proposed 3 auth steps with high confidence from detected fields."
    }
  ]
}
```

### Example 2: Private Entry Target Not Found
**Logs:**
```
[auth-discovery] privateEntryTargetResolved="Transacciones y servicios"
[auth-discovery] privateEntryClick strategy=none target="Transacciones y servicios" success=false notFound candidates=3
[auth-discovery] candidates inputs=0 buttons=3
[auth-discovery] proposedSteps=0 confidence=low
```

Response:
```json
{
  "ok": false,
  "reasonCode": "auth_profile_steps_not_discoverable",
  "proposedAuthProfile": {
    "steps": [],
    "confidence": "low"
  },
  "diagnostics": [
    {
      "level": "warning",
      "code": "private_entry_target_not_found",
      "message": "Private entry target not found: target=\"Transacciones y servicios\" (3 visible candidates: Información de productos, Servicios, Cuenta)"
    },
    {
      "level": "warning",
      "code": "no_candidates_found",
      "message": "No input fields or buttons detected... Could not enter private module \"Transacciones y servicios\"..."
    }
  ]
}
```

### Example 3: Authentication Method Selection
**App with method selection options:**

Logs:
```
[auth-discovery] postPrivateEntryUrl=https://app.example.com/auth?module=txn
[auth-discovery] authChoices candidates=3 selected="Con cédula"
[auth-discovery] candidates inputs=0 buttons=3
```

Could propose additional step to click auth method before entering credentials.

## Multiproject & Generic

✅ No hardcoding of "Transacciones y servicios", module names, labels
✅ privateRoutes configuration-driven
✅ Supports alternative property names (module, path segments)
✅ Multiidioma auth choice detection (Spanish/English patterns)
✅ Tolerant to missing private entry (continues with login detection)
✅ Reuses robust click resolver (8 strategies, accent-tolerant)
✅ No modification of app.config (persisted=false)

## Safety & Constraints

✅ Only executes click actions (no fills before authentication)
✅ Tolerates failed private entry (warning, continues)
✅ Tolerates missing auth choice detection
✅ Captures visible candidates for debugging failed discovery
✅ Clear diagnostics for each step

## Limitations (Phase 2.1b)

- Single private module entry only (not multi-level navigation)
- Auth choice detection basic (one option selection)
- No dynamic module selection based on HU intent
- No persistence of discovered paths to app.config

## Next Steps (Microfase 3)

- Execute proposed steps to verify they work
- Detect landing page after successful authentication
- Explore private routes/controls from authenticated session
- Persist successful auth paths to app.config.json

## Validation

✅ Bootstrap + Private entry + Field detection flow
✅ resolvePrivateEntryTarget handles all config sources
✅ executePrivateEntryStep uses robust click resolver
✅ detectAuthChoices multiidioma patterns
✅ Improved diagnostics for each step
✅ No hardcoding or project-specific logic
✅ Multiproject support (any appSlug, any module names)
✅ No changes to evidence, TestRail, public generation
