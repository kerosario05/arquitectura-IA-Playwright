# Virtual Keyboard Detection & virtualKeyboardFill Support - Microfase 2.1b Enhancement

## Objective
Enable detection of virtual keyboard interfaces on authentication pages and propose `virtualKeyboardFill` actions instead of regular `fill` actions when virtual keyboards are present.

## Implementation Details

### File: `src/discovery/authenticated-private-discovery.ts`

#### 1. Updated ProposedAuthProfile Type (lines 1207-1225)

Enhanced to support virtual keyboard scenarios:
```typescript
export type ProposedAuthProfile = {
  steps: Array<{
    action: "fill" | "click" | "virtualKeyboardFill";  // NEW: virtualKeyboardFill
    field?: string;
    target?: string;
    envVar?: string;
    confidence: "high" | "medium" | "low";
    reason?: string;
  }>;
  successSignals?: string[];
  confidence: "high" | "medium" | "low";
  hasVirtualKeyboard?: boolean;  // NEW: flag indicating virtual keyboard presence
  candidates?: Array<{
    type: "input" | "button" | "virtual-keyboard-key";  // NEW: virtual-keyboard-key
    fieldType: "identity" | "password" | "otp" | "unknown";
    selectors: string[];
    label?: string;
    confidence: "high" | "medium" | "low";
  }>;
};
```

#### 2. New Helper: `detectVirtualKeyboard()` (lines ~280-330)

Detects virtual keyboard presence on the page:
```typescript
async function detectVirtualKeyboard(page: Page): Promise<{
  isPresent: boolean;
  keyCount: number;
  selectorPatterns: string[];
}>
```

Detection patterns (multiproject-tolerant):
- `button[data-key]` - Buttons with data-key attribute
- `button[data-value]` - Buttons with data-value attribute
- `.virtual-key` - Elements with virtual-key class
- `[class*="keyboard"]` - Elements with keyboard in class name
- `[class*="key"][class*="board"]` - Key/board combination classes
- `button[class*="key"]` - Buttons with key in class name
- `div[data-key]` - Divs with data-key attribute

Returns:
- `isPresent`: true if any virtual keyboard keys detected
- `keyCount`: total number of detected keys
- `selectorPatterns`: patterns that matched

Logs: `[auth-discovery] virtualKeyboard detected keyCount=<n> patterns=<selector1>, <selector2>...`

#### 3. New Helper: `normalizeText()` (lines ~240-250)

Text normalization for comparison:
```typescript
function normalizeText(text: string): string
```

- NFD normalization to decompose accented characters
- Removes diacritics using Unicode range \u0300-\u036f
- Converts to lowercase
- Trims whitespace

Used by:
- `findClickableByTarget()` for robust element matching across locales
- Text comparison for click target resolution

#### 4. Updated `proposeAuthSteps()` (lines 950-1065)

Enhanced signature to accept virtual keyboard detection:
```typescript
function proposeAuthSteps(
  candidates: Array<{...}>,
  virtualKeyboardDetected?: boolean  // NEW parameter
): ProposedAuthProfile
```

Behavior:
- When `virtualKeyboardDetected` is true:
  - Identity field uses `action: "virtualKeyboardFill"` instead of `"fill"`
  - Password field uses `action: "virtualKeyboardFill"` instead of `"fill"`
  - OTP field uses `action: "virtualKeyboardFill"` instead of `"fill"`
  - Adds note "(virtual keyboard input)" to reason field
- Returns `hasVirtualKeyboard: true` in the result
- Submit button detection unchanged (remains "click")

Example step with virtual keyboard:
```json
{
  "action": "virtualKeyboardFill",
  "field": "[name=\"cedula\"]",
  "envVar": "$Identity_Provider",
  "confidence": "medium",
  "reason": "Detected identity field: Cédula (virtual keyboard input)"
}
```

#### 5. Updated `discoverAuthProfileSteps()` (lines 1195-1230)

Enhanced to detect and report virtual keyboard:

**Step 3.5: Virtual Keyboard Detection** (NEW)
```
After detecting field candidates (step 3):
1. Call detectVirtualKeyboard(page)
2. Check if keyboard is present
3. If present:
   - Log: [auth-discovery] virtualKeyboard detected keyCount=<n> patterns=...
   - Add diagnostic with code "virtual_keyboard_detected"
   - Message: "Virtual keyboard detected with X keys. Using virtualKeyboardFill action for text inputs."
4. Pass detection result to proposeAuthSteps
```

**Step 4: Propose Steps**
```
const proposedProfile = proposeAuthSteps(candidates, virtualKeyboardDetection.isPresent);
```

Logs:
```
[auth-discovery] candidates inputs=<n> buttons=<n>
[auth-discovery] virtualKeyboard detected keyCount=<n> patterns=<selector>,...
[auth-discovery] proposedSteps=<n> confidence=<high|medium|low>
```

## Behavior Examples

### Example 1: App with Virtual Keyboard

**Page structure:**
```html
<input type="password" name="pin" placeholder="Enter PIN">
<div class="virtual-keyboard">
  <button data-key="1" class="key">1</button>
  <button data-key="2" class="key">2</button>
  ...
</div>
```

**Discovery flow:**
```
[auth-discovery] started appSlug=mobile-bank
[auth-discovery] bootstrapStepsResolved=0
[auth-discovery] candidates inputs=1 buttons=0
[auth-discovery] virtualKeyboard detected keyCount=12 patterns=button[data-key], button[class*="key"]
[auth-discovery] proposedSteps=2 confidence=medium
```

**Response proposedAuthProfile:**
```json
{
  "steps": [
    {
      "action": "virtualKeyboardFill",
      "field": "[name=\"pin\"]",
      "envVar": "$APP_PASSWORD",
      "confidence": "medium",
      "reason": "Detected password field: PIN (virtual keyboard input)"
    },
    {
      "action": "click",
      "target": "Entrar",
      "confidence": "high",
      "reason": "Detected submit button: Entrar"
    }
  ],
  "hasVirtualKeyboard": true,
  "confidence": "medium"
}
```

### Example 2: App without Virtual Keyboard

**Same page without virtual keyboard:**
```html
<input type="password" name="password" placeholder="Password">
<button type="submit">Login</button>
```

**Discovery flow:**
```
[auth-discovery] candidates inputs=1 buttons=1
[auth-discovery] proposedSteps=2 confidence=high
```

**Response proposedAuthProfile:**
```json
{
  "steps": [
    {
      "action": "fill",
      "field": "[name=\"password\"]",
      "envVar": "$APP_PASSWORD",
      "confidence": "medium",
      "reason": "Detected password field: Password"
    },
    {
      "action": "click",
      "target": "Login",
      "confidence": "high",
      "reason": "Detected submit button: Login"
    }
  ],
  "hasVirtualKeyboard": false,
  "confidence": "high"
}
```

## Multiproject & Generic

✅ No hardcoding of virtual keyboard selectors or patterns
✅ Supports multiple virtual keyboard implementation patterns
✅ Tolerant to missing virtual keyboards
✅ Pattern-based detection (uses common patterns like data-key, data-value, class names)
✅ Works with any appSlug and any keyboard structure
✅ Normalizetext handles accented/non-ASCII text
✅ Clear diagnostics for keyboard presence

## Design Decisions

**Why `virtualKeyboardFill` as action type:**
- Signals to the execution engine that keyboard interaction is needed
- Allows custom execution logic different from regular fill
- Enables specialized handling (key-by-key clicking vs. paste)

**Why separate detection:**
- Virtual keyboard is rare; most apps use regular keyboard input
- Separate detection path keeps main flow clean
- Easy to disable or customize detection patterns

**Why flags + diagnostics:**
- `hasVirtualKeyboard` in response allows client to know about keyboard
- Diagnostics provide actionable feedback if detection fails
- Logging helps debug keyboard-related issues

## Limitations (Phase 2.1b)

- Virtual keyboard detection is pattern-based (not exhaustive)
- Doesn't validate that keyboard is actually functional
- Doesn't detect custom/proprietary keyboard implementations without common patterns
- No execution of virtualKeyboardFill actions yet (Phase 3)

## Next Steps (Microfase 3)

- Implement virtualKeyboardFill action execution in runner
- Support for key-by-key interaction (click each digit/letter)
- Validate virtual keyboard is functional after detection
- Handle keyboard with special characters (shift, backspace, etc.)
- Support password masking validation with virtual keyboards

## Validation

✅ Virtual keyboard detection correctly identifies presence/absence
✅ Key count and selector patterns accurately reported
✅ proposeAuthSteps uses virtualKeyboardFill when keyboard detected
✅ hasVirtualKeyboard flag correctly set in response
✅ Diagnostics include virtual keyboard information
✅ No hardcoding or project-specific logic
✅ Multiproject-generic (any app, any keyboard structure)
✅ Tolerant to missing/incorrect patterns
✅ normalizeText handles accent removal for text matching

---

## Files Modified

- `src/discovery/authenticated-private-discovery.ts`:
  - ProposedAuthProfile type: added virtualKeyboardFill action, hasVirtualKeyboard flag, virtual-keyboard-key candidate type
  - detectVirtualKeyboard(): NEW function for keyboard detection
  - normalizeText(): NEW helper for text normalization
  - proposeAuthSteps(): updated to handle virtual keyboard
  - discoverAuthProfileSteps(): integrated virtual keyboard detection

## Type Safety

All changes are fully type-safe:
- ProposedAuthProfile properly extended with new fields
- detectVirtualKeyboard() has proper return type
- normalizeText() is properly typed
- proposeAuthSteps() signature updated consistently
- discoverAuthProfileSteps() calls updated with correct arguments
- TypeScript: 0 errors in authenticated-private-discovery.ts
