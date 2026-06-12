# AI-Supported Scenario Generation Flow

## Summary

Modified QA Lab scenario generation to always involve AI by default, using deterministic seeds as context rather than replacement. The deterministic engine provides navigation structure and route validation, while AI generates comprehensive, clear scenarios.

## Problems Solved

### Before
- Deterministic engine was skipping AI completely: `"all issues generated deterministically, skipping AI"`
- AI was treated as fallback, not primary generator
- Lost opportunity for AI to create multiple scenarios, edge cases, and clear descriptions
- Scenarios were basic stubs without rich context

### After
- AI always participates in scenario generation (default mode: `ai_supported_by_deterministic`)
- Deterministic seeds provide navigation structure and safety rails
- AI expands on seeds, adds edge cases, refines descriptions
- Route profile and compliance validator ensure navigation is backed
- Multiple generation modes for flexibility

## Generation Modes

### 1. `ai_supported_by_deterministic` (DEFAULT)
- Deterministic engine generates seed scenarios
- Seeds are passed to AI as context in system prompt
- AI uses seeds as starting points, refines and expands
- Compliance validator ensures only backed navigation passes
- **Activated by:** default (no env needed)
- **Log signature:** `aiCalled=true` + `deterministicSeedsGenerated=N`

### 2. `ai_only`
- AI generates scenarios without deterministic seeds
- Useful for comparison or when seeds aren't available
- Still uses route profile and compliance validation
- **Activated by:** `SCENARIO_GENERATION_MODE=ai_only`

### 3. `deterministic_only`
- Skip AI, use only deterministic seeds (DEBUG ONLY)
- Requires explicit env variable
- Only for debugging or emergency fallback
- **Activated by:** `SCENARIO_GENERATION_MODE=deterministic_only`
- **Log signature:** `deterministic_only enabled by env`

### 4. `fallback_deterministic_on_ai_failure`
- Try AI first
- On timeout, fall back to deterministic seeds with diagnostic
- Prevents empty results when AI fails
- **Activated by:** `SCENARIO_GENERATION_MODE=fallback_deterministic_on_ai_failure`
- **Log signature:** `fallbackUsed=true` + `skipAIReason=ai_timeout`

## Architecture

### Flow Diagram

```
┌─────────────────┐
│ Jira Issues     │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Route Resolver  │ → Validates routes against routeProfile
│ (Pre-AI)        │   Builds executableRouteSteps (only backed targets)
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Deterministic   │ → Generates seed scenarios for simple modes
│ Seeds Generator │   (action_button_validation, etc.)
└────────┬────────┘
         │
         v
    ┌────┴────┐
    │ Mode?   │
    └────┬────┘
         │
    ┌────┴────────────────────────────┐
    │                                  │
    v                                  v
deterministic_only              ai_supported/ai_only/fallback
    │                                  │
    │                                  v
    │                          ┌──────────────┐
    │                          │ AI Generator │ → Uses seeds as context
    │                          │              │   Expands, refines, adds cases
    │                          └──────┬───────┘
    │                                  │
    └──────────┬───────────────────────┘
               │
               v
       ┌───────────────┐
       │ Normalize     │ → ensureStepStrings()
       │ Steps         │   normalizeScenarioSteps()
       └───────┬───────┘
               │
               v
       ┌───────────────┐
       │ Repair        │ → repairMissingIntermediates()
       │ Intermediates │   Inserts missing nav steps
       └───────┬───────┘
               │
               v
       ┌───────────────┐
       │ Compliance    │ → validateScenarioCompliance()
       │ Validator     │   Rejects unbacked clicks
       └───────┬───────┘
               │
               v
       ┌───────────────┐
       │ Final State   │ → valid / rejected / blocked
       │ Mapping       │   (exactly one state per scenario)
       └───────┬───────┘
               │
               v
       ┌───────────────┐
       │ Preview       │ → Shows only valid scenarios
       │ Response      │   Includes generationDiagnostics
       └───────────────┘
```

### Key Components

**1. Route Resolver (`scenario-route-resolver.ts`)**
- Validates routes BEFORE AI generation
- Ensures targets in `executableRouteSteps` are backed by:
  - `routeProfile.entry`
  - `routeProfile.intermediates`
  - `routeProfile.targetPaths`
  - `routeProfile.aliases`
- Filters out content terms (Beneficios, Requisitos, etc.)
- Returns `canGenerate: true` only if route is backed

**2. Deterministic Seeds Generator (`codex-scenario-generator.ts`)**
- Creates base scenarios for simple modes (e.g., `action_button_validation`)
- Returns `DeterministicSeedScenario[]` (not final scenarios)
- Seeds include: title, steps, mode, confidence, notes
- Seeds are context, not final output

**3. AI Prompt Builder (`mcp-scenario-prompt-builder.ts`)**
- Includes deterministic seeds in system prompt
- Seeds shown as "starting points" for AI to expand
- Includes route profile, allowed clicks, forbidden terms
- Compact mode for cost control

**4. Compliance Validator (`scenario-route-compliance-validator.ts`)**
- Validates every scenario against `derivedContext`
- Rejects clicks on unbacked targets: `unbacked_click_target`
- Rejects clicks on content terms: `content_term_used_as_click`
- Allows validations on any visibleControls
- Ensures navigation coherence

**5. Generation Diagnostics**
- Tracks: `generationMode`, `aiCalled`, `aiGenerated`, `finalValid`, `finalRejected`, `finalBlocked`
- Prevents orphan scenarios: `generated > 0` but `valid=rejected=blocked=0`
- Included in `McpGenerationResponse.generationDiagnostics`

## File Changes

### Modified Files

**`src/scenarios/scenario-types.ts`**
- Added `ScenarioGenerationMode` type (4 modes)
- Added `DeterministicSeedScenario` type
- Added `ScenarioGenerationDiagnostics` type
- Extended `McpGenerationResponse` with `generationDiagnostics?`

**`src/scenarios/codex-scenario-generator.ts`**
- Added `getScenarioGenerationMode()` function (reads env, defaults to `ai_supported_by_deterministic`)
- Changed `tryDeterministicGeneration()` to return `DeterministicSeedScenario[]` instead of final scenarios
- Removed old logic: `"all issues generated deterministically, skipping AI"`
- New flow:
  1. Get generation mode
  2. Try deterministic seeds (not final)
  3. If `deterministic_only` mode: convert seeds to scenarios, validate, return
  4. Else: always call AI with seeds as context
  5. On AI timeout + `fallback_deterministic_on_ai_failure` mode: return validated seeds
  6. Update `generationDiagnostics` with counts
- Added fallback logic for AI timeout
- Fixed route resolver call to pass `appSlug`

**`src/scenarios/mcp-scenario-prompt-builder.ts`**
- Added `deterministicSeeds?` parameter to `buildMcpScenarioMessages()`
- Added deterministic seeds section in system prompt
- Seeds shown as "base/seed scenarios generated deterministically"
- Instructs AI: "Use these as starting points or context, but feel free to expand, refine, or add alternative scenarios"

**`src/scenarios/route-backed-scenario-builder.ts`**
- Updated `buildExecutableSteps()` to accept `allowedNavigationTargets: string[]`
- Updated `extractListTarget()` to only match against backed targets (not all visibleControls)
- Updated `extractDetailFields()` to exclude navigation targets from validation terms
- All build functions filter targets through `allowedNavigationTargets`

**`src/scenarios/scenario-route-resolver.ts`**
- Added `appSlug` parameter
- Builds `derivedExecutionContext` to get backed navigation targets
- Passes `derivedContext.allowedExecutableClicks` to `buildExecutableSteps()`
- Added defensive validation: targets must be backed before entering `executableRouteSteps`

**`src/scenarios/route-profile-derived-context.ts`**
- Added `isTargetBacked()` helper function
- Added defensive filter when extracting from `executableRouteSteps`
- Logs warning if unbacked target found in executableRouteSteps
- Prevents content terms from contaminating `allowedExecutableClicks`

### New Files

**`tests/scenario-generation-modes.spec.ts`**
- Tests default mode is `ai_supported_by_deterministic`
- Tests `deterministic_only` requires explicit env
- Tests invalid mode falls back to default
- Tests `DeterministicSeedScenario` type structure
- Tests `ScenarioGenerationDiagnostics` tracks all states
- Tests state mapping ensures no orphan scenarios

## Environment Variables

```bash
# Scenario generation mode
# Default: ai_supported_by_deterministic
SCENARIO_GENERATION_MODE=ai_supported_by_deterministic | ai_only | deterministic_only | fallback_deterministic_on_ai_failure

# Max scenarios per issue (cost control)
AI_SCENARIO_MAX_PER_ISSUE=3

# AI model for scenario generation
AI_SCENARIO_MODEL=gpt-4o-mini

# Timeout for AI scenario generation
AI_SCENARIO_TIMEOUT_MS=120000
```

## Log Signatures

### Default Mode (`ai_supported_by_deterministic`)
```
[scenarios:mode] using generation mode: ai_supported_by_deterministic
[scenarios:deterministic] generated 1 seed scenarios as context for AI
[scenarios:ai] calling AI for scenario generation mode=ai_supported_by_deterministic
[scenarios:ai] purpose=scenario_generation provider=openai model=gpt-4o-mini
[scenarios:prompt] added 1 deterministic seeds as context
[scenarios:ai] success aiGenerated=2 finalValid=2 finalRejected=0
```

### Deterministic Only Mode
```
[scenarios:mode] deterministic_only enabled by env. AI will be skipped.
[scenarios:mode] using generation mode: deterministic_only
[scenarios:deterministic] generated 1 seed scenarios as context for AI
[scenarios:deterministic_only] skipping AI generation by explicit env mode
[scenarios:deterministic_only] validated=1 invalid=0
```

### Fallback Mode (on AI timeout)
```
[scenarios:mode] using generation mode: fallback_deterministic_on_ai_failure
[scenarios:deterministic] generated 1 seed scenarios as context for AI
[scenarios:ai] calling AI for scenario generation mode=fallback_deterministic_on_ai_failure
[scenarios:timeout] provider=openai totalChars=15000 ...
[scenarios:fallback] AI timeout, using 1 deterministic seeds as fallback
[scenarios:fallback] validated=1 invalid=0
```

## Acceptance Criteria

✅ `npm run typecheck` = 0 errors
✅ All new tests pass (`scenario-generation-modes.spec.ts`)
✅ All existing tests pass (deterministic-steps-bug-fix, route-profile-derived-context, etc.)
✅ Default mode is `ai_supported_by_deterministic` (AI always called)
✅ Deterministic seeds used as context, not final output
✅ `deterministic_only` mode requires explicit env
✅ Log shows `aiCalled=true` in default mode
✅ No logs saying "skipping AI" unless `deterministic_only` mode
✅ Content terms filtered from `executableRouteSteps`
✅ Compliance validator rejects unbacked clicks
✅ State mapping: every scenario in exactly one state (valid/rejected/blocked)
✅ Multiproject solution (no hardcoded targets)
✅ Fallback logic for AI timeout
✅ Generation diagnostics included in response

## Impact

- **Scenario Quality**: AI generates richer, clearer scenarios with better descriptions
- **Coverage**: AI can create multiple scenarios per issue, exploring edge cases
- **Safety**: Route profile + compliance validator ensure navigation is backed
- **Flexibility**: Multiple generation modes for different needs
- **Observability**: Generation diagnostics show exactly what happened
- **Cost Control**: Default mini model, seed-based context reduces prompt size
- **Resilience**: Fallback mode prevents empty results on AI timeout
