# Auth Choice Execution - Microfase 2.1b Enhancement

## Objective
Execute authentication method choice selection (e.g., "Cédula de identidad") before attempting to detect credential input fields. This enables discovery of apps with multi-step auth flows where the login form only appears after selecting the authentication method.

## Implementation Details

### File: `src/discovery/authenticated-private-discovery.ts`

#### 1. New Helper: `executeAuthChoiceStep()` (lines ~180-290)

Executes click on selected authentication method option:
```typescript
async function executeAuthChoiceStep(
  page: Page,
  choiceText: string
): Promise<{
  success: boolean;
  postChoiceUrl: string;
  snapshot?: Awaited<ReturnType<typeof capturePageSnapshot>>;
  diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"];
}>
```

Behavior:
1. Captures pre-click state (URL, body text)
2. Uses robust click resolver to find auth choice option
3. Clicks the option (with 5s timeout)
4. Waits for navigation (networkidle → domcontentloaded)
5. Detects real state change (URL, new elements, text change, inputs appear)
6. Captures post-click snapshot
7. Returns success flag, new URL, snapshot, and diagnostics

Logs:
- Success: `[auth-discovery] authChoiceClick target="<text>" strategy=<strategy> success=true stateChanged=<bool>`
- Failure: `[auth-discovery] authChoiceClick target="<text>" strategy=<strategy> success=false clickError=<error>`
- Not found: `[auth-discovery] authChoiceClick target="<text>" strategy=none success=false notFound candidates=<n>`

Diagnostics:
- `auth_choice_step_executed`: Logged on success with strategy and state change reason
- `auth_choice_click_failed`: Logged on click error
- `auth_choice_target_not_found`: Logged when target not found, includes visible candidates sample

#### 2. Enhanced `discoverAuthProfileSteps()` (lines 1287-1380)

Updated Step 2 to execute auth choice click:

**Step 2: Detect and Execute Auth Choice (UPDATED)**
```
1. Call detectAuthChoices(page)
2. If found:
   a. Select highest confidence option (prefer "high" > "medium" > "low")
   b. Log: [auth-discovery] authChoices candidates=<n> selected="<text>" confidence=<level>
   c. Add diagnostic: "Detected N auth choice options, selected: X (confidence: Y)"
   d. If confidence is HIGH or MEDIUM:
      - Execute click using executeAuthChoiceStep()
      - Capture post-auth-choice snapshot
      - Add execution diagnostics
      - Log: [auth-discovery] postAuthChoiceUrl=<url>
      - Log: [auth-discovery] postAuthChoiceSnapshot url=<url> inputs=<n> textboxes=<n> buttons=<n> vkKeys=<n>
   e. If confidence is LOW:
      - Log: [auth-discovery] authChoiceClick skipped: confidence=low (below threshold)
      - Add diagnostic: "Auth choice not executed due to low confidence"
```

**Step 3: Re-detect Field Candidates (UPDATED)**
```
After auth choice execution (or if no choices found):
1. Call detectAuthFieldCandidates(page) - re-detect after click
2. Count inputs and buttons
3. If no candidates found:
   - Add diagnostic with context (private entry status, auth choice attempted)
   - Include post-auth-choice snapshot detail in diagnostics if available
   - Return empty proposal with LOW confidence
4. Otherwise continue to virtual keyboard detection
```

#### 3. Enhanced `proposeAuthSteps()` (lines 1186-1211)

Added special case for virtual keyboard without standard inputs:

**Special Case: Virtual Keyboard Input Only**
```
If:
- steps.length === 0 (no identity/password/OTP detected)
- virtualKeyboardDetected === true (keyboard is present)
- candidates.length > 0 (at least some candidates on page)

Then:
- Propose one step:
  {
    action: "virtualKeyboardFill",
    field: "activeCredentialField",
    envVar: "$Identity_Provider",
    confidence: "medium",
    reason: "Virtual keyboard detected but no standard input fields. Proposing virtual keyboard fill for active credential field."
  }
- Set confidence to "medium"
```

This handles the case where credential entry is entirely virtual-keyboard-based.

### Execution Flow

```
discoverAuthProfileSteps():
  ↓
Step 1: Execute bootstrap steps (existing)
  ↓
Step 2: Detect & Execute Auth Choice (NEW)
  │
  ├─ detectAuthChoices() → find options
  │
  ├─ if options.confidence >= "medium":
  │   ├─ executeAuthChoiceStep() → click + wait + snapshot
  │   └─ capture: url, inputs, textboxes, buttons, vkeys
  │
  └─ if options.confidence < "medium":
      └─ skip execution (log reason)
  ↓
Step 3: Re-detect Field Candidates (UPDATED)
  │
  ├─ detectAuthFieldCandidates(page) [after auth choice click]
  ├─ if none found: return snapshot + diagnostics
  │
  └─ if found: continue
  ↓
Step 3.5: Detect Virtual Keyboard
  │
  └─ detectVirtualKeyboard(page)
  ↓
Step 4: Propose Auth Steps (UPDATED)
  │
  ├─ if standard inputs found:
  │   └─ propose fill/virtualKeyboardFill actions
  │
  └─ if virtual keyboard only:
      └─ propose virtualKeyboardFill for activeCredentialField
  ↓
Return proposed profile
```

## Behavior Examples

### Example 1: App with Auth Choice Selection

**Initial page:**
```html
<div class="auth-methods">
  <button class="auth-btn">Cédula de identidad dominicana</button>
  <button class="auth-btn">Licencia de conducir</button>
</div>
```

**After clicking "Cédula de identidad dominicana":**
```html
<input type="text" placeholder="Cédula" name="cedula">
<input type="password" placeholder="Contraseña" name="password">
<button type="submit">Entrar</button>
```

**Discovery flow:**
```
[auth-discovery] started appSlug=kiosko
[auth-discovery] bootstrapStepsResolved=0
[auth-discovery] authChoices candidates=2 selected="Cédula de identidad dominicana" confidence=high
[auth-discovery] authChoiceClick target="Cédula de identidad dominicana" strategy=getByRole(button) success=true stateChanged=true
[auth-discovery] postAuthChoiceUrl=https://app.example.com/auth?method=cedula
[auth-discovery] postAuthChoiceSnapshot url=https://app.example.com/auth?method=cedula inputs=2 textboxes=0 buttons=1 vkKeys=0
[auth-discovery] candidates inputs=2 buttons=1
[auth-discovery] proposedSteps=3 confidence=high
```

**Response:**
```json
{
  "proposedAuthProfile": {
    "steps": [
      {
        "action": "fill",
        "field": "[name=\"cedula\"]",
        "envVar": "$Identity_Provider",
        "confidence": "medium",
        "reason": "Detected identity field: Cédula"
      },
      {
        "action": "fill",
        "field": "[name=\"password\"]",
        "envVar": "$APP_PASSWORD",
        "confidence": "medium",
        "reason": "Detected password field: Contraseña"
      },
      {
        "action": "click",
        "target": "Entrar",
        "confidence": "high",
        "reason": "Detected submit button: Entrar"
      }
    ],
    "confidence": "high",
    "hasVirtualKeyboard": false
  },
  "diagnostics": [
    {
      "level": "info",
      "code": "auth_choice_detected",
      "message": "Detected 2 auth choice options, selected: \"Cédula de identidad dominicana\" (confidence: high)"
    },
    {
      "level": "info",
      "code": "auth_choice_step_executed",
      "message": "Auth choice step executed: click \"Cédula de identidad dominicana\" (strategy: getByRole(button), state: url_changed)"
    },
    {
      "level": "info",
      "code": "post_auth_choice_snapshot",
      "message": "Post-auth-choice snapshot: URL=https://app.example.com/auth?method=cedula, inputs=2, textboxes=0, buttons=1, virtual keyboard keys=0"
    },
    {
      "level": "info",
      "code": "auth_discovery_proposed",
      "message": "Proposed 3 auth steps with high confidence from detected fields."
    }
  ]
}
```

### Example 2: Virtual Keyboard After Auth Choice

**After clicking auth choice, page shows:**
```html
<div class="virtual-keyboard">
  <button data-key="1">1</button>
  <button data-key="2">2</button>
  ...
</div>
```

**Discovery flow:**
```
[auth-discovery] authChoiceClick target="Identificación numérica" strategy=getByText(regex) success=true stateChanged=true
[auth-discovery] postAuthChoiceSnapshot url=https://app.example.com/auth?method=numeric inputs=0 textboxes=0 buttons=12 vkKeys=12
[auth-discovery] candidates inputs=0 buttons=12
[auth-discovery] virtualKeyboard detected keyCount=12 patterns=button[data-key], button[class*="key"]
[auth-discovery] proposedSteps=1 confidence=medium
```

**Response:**
```json
{
  "proposedAuthProfile": {
    "steps": [
      {
        "action": "virtualKeyboardFill",
        "field": "activeCredentialField",
        "envVar": "$Identity_Provider",
        "confidence": "medium",
        "reason": "Virtual keyboard detected but no standard input fields. Proposing virtual keyboard fill for active credential field."
      }
    ],
    "confidence": "medium",
    "hasVirtualKeyboard": true
  },
  "diagnostics": [
    {
      "level": "info",
      "code": "auth_choice_detected",
      "message": "Detected 1 auth choice option, selected: \"Identificación numérica\" (confidence: high)"
    },
    {
      "level": "info",
      "code": "auth_choice_step_executed",
      "message": "Auth choice step executed: click \"Identificación numérica\" (strategy: getByText(regex), state: url_changed)"
    },
    {
      "level": "info",
      "code": "post_auth_choice_snapshot",
      "message": "Post-auth-choice snapshot: URL=https://app.example.com/auth?method=numeric, inputs=0, textboxes=0, buttons=12, virtual keyboard keys=12"
    },
    {
      "level": "info",
      "code": "virtual_keyboard_detected",
      "message": "Virtual keyboard detected with 12 keys. Using virtualKeyboardFill action for text inputs."
    }
  ]
}
```

### Example 3: Auth Choice Not Found

**Discovery flow:**
```
[auth-discovery] authChoices candidates=1 selected="Login" confidence=low
[auth-discovery] authChoiceClick skipped: confidence=low (below threshold)
[auth-discovery] candidates inputs=2 buttons=1
[auth-discovery] proposedSteps=3 confidence=high
```

## Diagnostic Requirements

✅ **When auth choice executed successfully:**
- `auth_choice_detected` - logged when options found
- `auth_choice_step_executed` - logged with strategy and state change reason
- `post_auth_choice_snapshot` - logged with URL, input count, button count, vkey count

✅ **When auth choice click fails:**
- `auth_choice_click_failed` - logged with error message
- `post_auth_choice_snapshot_detail` - included in no-candidates-found response

✅ **When auth choice not executed:**
- `auth_choice_skipped_low_confidence` - logged when confidence < medium

✅ **When no candidates found after auth choice:**
- Response includes `post_auth_choice_snapshot_detail` with clickables count and body preview

## Design Decisions

**Why execute auth choice with confidence >= "medium":**
- Low confidence choices are risky and might lead to wrong path
- Medium/high confidence has strong signal for auth method

**Why capture post-auth-choice snapshot:**
- Essential for diagnostics when no fields appear
- Shows page state including virtual keyboard presence
- Helps debug failed auth method selections

**Why re-detect after auth choice:**
- Auth choice click changes the page entirely
- Previous candidates list is stale
- Fresh detection catches fields that appear after click

**Why special case for virtual keyboard only:**
- Apps with credential entry via virtual keyboard only (no standard inputs)
- Allows proposal even when no traditional input fields detected
- Enables support for biometric/token-based auth entry

## Limitations (Phase 2.1b)

- Only executes first auth choice (no sequential selection)
- Doesn't handle multi-step auth method selection
- No validation that clicked option is actually correct
- Virtual keyboard proposal is generic (no field focusing)

## Multiproject & Generic

✅ No hardcoding of auth choice texts
✅ Pattern-based text matching using detectAuthChoices
✅ Robust click resolver (8 strategies) for finding buttons
✅ Tolerant to missing/failed auth choices
✅ Works with any app, any auth method naming
✅ Supports multiple auth choice styles (buttons, links, radio buttons, etc.)
✅ Clear diagnostics for troubleshooting

## Acceptance Criteria

✅ After detecting auth choice, executes click on selected option
✅ Captures snapshot post-auth-choice (URL, input count, vkey count)
✅ Re-detects field candidates after click
✅ If virtual keyboard present but no standard inputs, proposes virtualKeyboardFill
✅ If no candidates after auth choice, returns snapshot + diagnostics (not empty candidates)
✅ Logs all steps: choice detected, click executed, post-choice state
✅ Confidence threshold (medium/high) respected for execution
✅ No hardcoding of auth method names or selectors
✅ Works for any appSlug
✅ TypeScript: 0 errors
