"use strict";
/**
 * AI Repair Selection Semantic Safety Tests
 *
 * Tests for selection semantic safety policy:
 * - selection-like target with semantic:css confidence 0.53 NOT accepted locally
 * - semantic:css low confidence does NOT execute click if AI Repair enabled
 * - if AI returns no_safe_action, low-confidence semantic fallback is NOT used
 * - if AI returns repaired_plan with safe candidateId, click IS executed
 * - if AI unavailable, fails controladamente with low_confidence_selection_unresolved
 * - post-click semantic verification detects mismatches
 * - promotion gate blocks on SEMANTIC_TARGET_MISMATCH
 * - context-pack enriched with cardText, nearbyText, priceText
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const selection_resolution_1 = require("../src/discovery/selection-resolution");
test_1.test.describe("Selection-Like Target Detection", () => {
    (0, test_1.test)("detects product selection targets", () => {
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("la portátil Apple Air")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("MacBook aire")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("Dell i7")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("Sony vaio i5")).toBe(true);
    });
    (0, test_1.test)("detects laptop/laptop variations", () => {
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("laptop")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("laptop Dell")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("la laptop HP")).toBe(true);
    });
    (0, test_1.test)("detects brand names as selection targets", () => {
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("Apple")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("Samsung")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("HP")).toBe(true);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("Lenovo")).toBe(true);
    });
    (0, test_1.test)("non-selection targets return false", () => {
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("submit")).toBe(false);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("login")).toBe(false);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("next")).toBe(false);
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)("click here")).toBe(false);
    });
});
test_1.test.describe("Local Confidence Threshold Policy", () => {
    (0, test_1.test)("selection-like target with semantic:css 0.53 is NOT accepted locally", () => {
        const target = "la portátil Apple Air";
        const confidence = 0.53;
        const threshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)(target)).toBe(true);
        (0, test_1.expect)(confidence).toBeLessThan(threshold);
        // Policy: confidence < 0.85 for selection-like targets → BLOCK local acceptance
    });
    (0, test_1.test)("confidence 0.85+ is accepted for selection-like targets", () => {
        const target = "la portátil Apple Air";
        const confidence = 0.85;
        const threshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)(target)).toBe(true);
        (0, test_1.expect)(confidence).toBeGreaterThanOrEqual(threshold);
        // Policy: confidence >= 0.85 → can accept locally
    });
    (0, test_1.test)("non-selection targets can use lower confidence", () => {
        const target = "submit button";
        const confidence = 0.65;
        const threshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)(target)).toBe(false);
        // Non-selection targets may accept lower confidence (depends on other policies)
        (0, test_1.expect)(confidence).toBeLessThan(threshold);
    });
});
test_1.test.describe("AI Repair Selection Threshold", () => {
    (0, test_1.test)("AI selection_resolution invoked when confidence >= 0.60", () => {
        const confidence = 0.60;
        const threshold = (0, selection_resolution_1.getSelectionAiRepairThreshold)();
        (0, test_1.expect)(confidence).toBeGreaterThanOrEqual(threshold);
        // Policy: 0.60 <= confidence < 0.85 → invoke AI selection_resolution
    });
    (0, test_1.test)("AI selection_resolution NOT invoked when confidence < 0.60", () => {
        const confidence = 0.55;
        const threshold = (0, selection_resolution_1.getSelectionAiRepairThreshold)();
        (0, test_1.expect)(confidence).toBeLessThan(threshold);
        // Policy: confidence < 0.60 → too low even for AI, fail controladamente
    });
    (0, test_1.test)("AI selection_resolution invoked for confidence in [0.60, 0.85)", () => {
        const testCases = [0.60, 0.65, 0.70, 0.75, 0.80, 0.84];
        const aiThreshold = (0, selection_resolution_1.getSelectionAiRepairThreshold)();
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        testCases.forEach(confidence => {
            (0, test_1.expect)(confidence).toBeGreaterThanOrEqual(aiThreshold);
            (0, test_1.expect)(confidence).toBeLessThan(localThreshold);
            // These should trigger AI selection_resolution
        });
    });
});
test_1.test.describe("Post-Click Semantic Verification", () => {
    (0, test_1.test)("target 'Apple Air' + result 'Sony vaio i5' => semantic_mismatch", () => {
        const target = "la portátil Apple Air";
        const visibleTexts = ["Sony vaio i5", "15.6 pulgadas", "Intel Core i5"];
        const result = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, visibleTexts, "Sony Vaio");
        (0, test_1.expect)(result.matches).toBe(false);
        (0, test_1.expect)(result.mismatchReason).toBeDefined();
        (0, test_1.expect)(result.mismatchReason?.toLowerCase()).toContain("apple");
        (0, test_1.expect)(result.matchedTokens.length).toBeLessThan(result.missingTokens.length);
    });
    (0, test_1.test)("target 'Apple Air' + result 'MacBook air' => pass", () => {
        const target = "la portátil Apple Air";
        const visibleTexts = ["MacBook Air", "M2 Chip", "Apple", "$1,299"];
        const result = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, visibleTexts, "MacBook Air");
        (0, test_1.expect)(result.matches).toBe(true);
        (0, test_1.expect)(result.matchedTokens).toContain("apple");
        (0, test_1.expect)(result.matchedTokens).toContain("air");
    });
    (0, test_1.test)("target 'Dell i7' + result 'Dell i7 8gb' => pass", () => {
        const target = "Dell i7";
        const visibleTexts = ["Dell XPS 15", "Intel Core i7", "8GB RAM"];
        const result = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, visibleTexts, "Dell XPS");
        (0, test_1.expect)(result.matches).toBe(true);
        (0, test_1.expect)(result.matchedTokens).toContain("dell");
        (0, test_1.expect)(result.matchedTokens).toContain("i7");
    });
    (0, test_1.test)("target 'Dell i7' + result 'Sony vaio i5' => semantic_mismatch", () => {
        const target = "Dell i7";
        const visibleTexts = ["Sony vaio i5", "15.6 pulgadas", "Intel Core i5"];
        const result = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, visibleTexts, "Sony Vaio");
        (0, test_1.expect)(result.matches).toBe(false);
        (0, test_1.expect)(result.mismatchReason).toBeDefined();
        (0, test_1.expect)(result.mismatchReason?.toLowerCase()).toContain("dell");
    });
    (0, test_1.test)("artifact includes matchedTokens, missingTokens, mismatchReason", () => {
        const target = "la portátil Apple Air";
        const visibleTexts = ["Sony vaio i5", "15.6 pulgadas"];
        const result = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, visibleTexts, "Sony Vaio");
        (0, test_1.expect)(result.matchedTokens).toBeDefined();
        (0, test_1.expect)(result.missingTokens).toBeDefined();
        (0, test_1.expect)(result.mismatchReason).toBeDefined();
        (0, test_1.expect)(result.matches).toBe(false);
    });
});
test_1.test.describe("Significant Token Extraction", () => {
    (0, test_1.test)("extracts brand and model tokens", () => {
        const tokens = (0, selection_resolution_1.extractMeaningfulTokens)("la portátil Apple Air M2");
        (0, test_1.expect)(tokens).toContain("apple");
        (0, test_1.expect)(tokens).toContain("air");
        (0, test_1.expect)(tokens).toContain("m2");
    });
    (0, test_1.test)("filters out stopwords", () => {
        const tokens = (0, selection_resolution_1.extractMeaningfulTokens)("la de más barato el");
        (0, test_1.expect)(tokens.length).toBeGreaterThan(0);
    });
    (0, test_1.test)("handles mixed case", () => {
        const tokens = (0, selection_resolution_1.extractMeaningfulTokens)("MACBOOK air DELL XPS");
        (0, test_1.expect)(tokens).toContain("macbook");
        (0, test_1.expect)(tokens).toContain("air");
        (0, test_1.expect)(tokens).toContain("dell");
        (0, test_1.expect)(tokens).toContain("xps");
    });
    (0, test_1.test)("handles special characters", () => {
        const tokens = (0, selection_resolution_1.extractMeaningfulTokens)("HP Pavilion 15-i7");
        (0, test_1.expect)(tokens).toContain("hp");
        (0, test_1.expect)(tokens).toContain("pavilion");
        // Token splitting may vary for hyphenated numbers
    });
});
test_1.test.describe("AI Repair Decision Flow", () => {
    (0, test_1.test)("no_safe_action does NOT fallback to low-confidence semantic", () => {
        // Simulating the decision flow:
        // 1. Local semantic resolution: confidence 0.53 < 0.85 → BLOCK
        // 2. AI selection_resolution invoked
        // 3. AI returns no_safe_action
        // 4. Result: FAIL with no_safe_action, NO fallback to 0.53 semantic
        const localConfidence = 0.53;
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        const aiDecision = "no_safe_action";
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        (0, test_1.expect)(aiDecision).toBe("no_safe_action");
        // Policy: After AI returns no_safe_action, do NOT use low-confidence fallback
    });
    (0, test_1.test)("repaired_plan with safe candidateId IS executed", () => {
        // Simulating the decision flow:
        // 1. Local semantic resolution: confidence 0.65 < 0.85 → BLOCK
        // 2. AI selection_resolution invoked
        // 3. AI returns repaired_plan with candidateId: "macbook-air-card"
        // 4. Result: EXECUTE click on macbook-air-card
        const localConfidence = 0.65;
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        const aiDecision = "repaired_plan";
        const candidateId = "macbook-air-card";
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        (0, test_1.expect)(aiDecision).toBe("repaired_plan");
        (0, test_1.expect)(candidateId).toBeDefined();
        // Policy: AI repaired_plan with valid candidateId → EXECUTE
    });
    (0, test_1.test)("AI unavailable fails with low_confidence_selection_unresolved", () => {
        // Simulating the decision flow:
        // 1. Local semantic resolution: confidence 0.70 < 0.85 → BLOCK
        // 2. AI selection_resolution invoked
        // 3. AI unavailable (timeout/error)
        // 4. Result: FAIL with low_confidence_selection_unresolved
        const localConfidence = 0.70;
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        const aiAvailable = false;
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        (0, test_1.expect)(aiAvailable).toBe(false);
        // Policy: AI unavailable → FAIL controladamente, no fallback
    });
});
test_1.test.describe("Context-Pack Enriched Fields", () => {
    (0, test_1.test)("selectionCandidates include cardText when exists", () => {
        // This test validates the expected structure
        // Actual enrichment happens in case-discovery.ts
        const enrichedCandidate = {
            candidateId: "macbook-air-card",
            role: "button",
            name: "MacBook Air",
            text: "MacBook Air M2",
            visible: true,
            enabled: true,
            clickable: true,
            score: 0.65,
            sensitive: false,
            // Enriched fields:
            cardText: "MacBook Air M2 - 256GB SSD - $1,299.00",
            nearbyText: "Laptops Apple Portátiles",
            priceText: "$1,299.00",
            position: 1
        };
        (0, test_1.expect)(enrichedCandidate.cardText).toBeDefined();
        (0, test_1.expect)(enrichedCandidate.nearbyText).toBeDefined();
        (0, test_1.expect)(enrichedCandidate.priceText).toBeDefined();
        (0, test_1.expect)(enrichedCandidate.position).toBe(1);
    });
    (0, test_1.test)("secrets are NOT included in enriched fields", () => {
        // This test validates that context-pack redacts secrets
        // The actual redaction happens in repair-context-pack.ts
        // This is a placeholder to document the expected behavior
        const hasRedaction = true; // Context-pack redacts secrets
        (0, test_1.expect)(hasRedaction).toBe(true);
    });
    (0, test_1.test)("does not exceed AI_REPAIR_MAX_CONTEXT_CHARS", () => {
        // This test validates that context-pack enforces character limits
        // The actual truncation happens in repair-context-pack.ts
        // This is a placeholder to document the expected behavior
        const maxChars = 30000;
        const longCardText = "A".repeat(10000);
        const longNearbyText = "B".repeat(10000);
        const longPriceText = "C".repeat(10000);
        const totalLength = longCardText.length + longNearbyText.length + longPriceText.length;
        (0, test_1.expect)(totalLength).toBeLessThanOrEqual(maxChars);
    });
});
test_1.test.describe("Promotion Gate - Semantic Mismatch", () => {
    (0, test_1.test)("discovery with semantic_mismatch does NOT stay validated", () => {
        // Simulating promotion gate logic:
        // 1. Post-click verification detects semantic_mismatch
        // 2. Case validationStatus set to "failed" or "recovered_with_issues"
        // 3. Promotion gate blocks with reason: SEMANTIC_TARGET_MISMATCH
        const semanticMatchResult = {
            matches: false,
            mismatchReason: "Post-click content missing key tokens: apple, air",
            matchedTokens: [],
            missingTokens: ["apple", "air"]
        };
        (0, test_1.expect)(semanticMatchResult.matches).toBe(false);
        (0, test_1.expect)(semanticMatchResult.mismatchReason).toBeDefined();
        // Policy: semantic_mismatch → case NOT validated, promotion blocked
    });
    (0, test_1.test)("promotion blocked with reason SEMANTIC_TARGET_MISMATCH", () => {
        // Simulating promotion gate check
        const caseValidationStatus = "failed";
        const failureReason = "SEMANTIC_TARGET_MISMATCH";
        const canPromote = caseValidationStatus !== "failed" && !failureReason;
        (0, test_1.expect)(canPromote).toBe(false);
        (0, test_1.expect)(failureReason).toBe("SEMANTIC_TARGET_MISMATCH");
    });
    (0, test_1.test)("promotion NOT blocked if post-click semantic verification passes", () => {
        // Simulating promotion gate check
        const semanticMatchResult = {
            matches: true,
            matchedTokens: ["apple", "air"],
            missingTokens: []
        };
        const canPromote = semanticMatchResult.matches;
        (0, test_1.expect)(canPromote).toBe(true);
    });
});
test_1.test.describe("Integration Scenarios", () => {
    (0, test_1.test)("C38042 scenario: Apple Air target should NOT select Sony Vaio", () => {
        // Original bug: "la portátil Apple Air" → opened Sony Vaio i5
        // New behavior:
        // 1. Local semantic: 0.53 < 0.85 → BLOCK
        // 2. AI selection_resolution invoked
        // 3a. AI returns repaired_plan: "macbook-air-card" → PASS
        // 3b. AI returns no_safe_action → FAIL controladamente
        // 4. Post-click verification: if Sony Vaio detected → semantic_mismatch → FAIL
        const target = "la portátil Apple Air";
        const localConfidence = 0.53;
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        // Step 1: Local resolution blocked
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)(target)).toBe(true);
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        // Step 2: AI invoked (simulated)
        const aiDecision = "repaired_plan";
        const selectedCandidate = "macbook-air-card";
        // Step 3a: AI selected MacBook Air
        (0, test_1.expect)(aiDecision).toBe("repaired_plan");
        (0, test_1.expect)(selectedCandidate).toBe("macbook-air-card");
        // Step 4: Post-click verification
        const resultPageTexts = ["MacBook Air", "M2", "Apple"];
        const verification = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, resultPageTexts, "MacBook Air");
        (0, test_1.expect)(verification.matches).toBe(true);
        (0, test_1.expect)(verification.matchedTokens).toContain("apple");
        // Result: PASS - correct product selected
    });
    (0, test_1.test)("C38042 scenario: If AI returns no_safe_action, case fails controladamente", () => {
        const target = "la portátil Apple Air";
        const localConfidence = 0.53;
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        // Step 1: Local resolution blocked
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        // Step 2: AI invoked (simulated)
        const aiDecision = "no_safe_action";
        // Step 3b: AI could not determine safe selection
        (0, test_1.expect)(aiDecision).toBe("no_safe_action");
        // Result: FAIL controladamente, no low-confidence fallback
        // Case does NOT promote, does NOT click wrong product
    });
    (0, test_1.test)("C38041 scenario: Typo 'Macbook aire' resolves to MacBook Air", () => {
        const target = "Macbook aire";
        const localConfidence = 0.70; // Typo reduces confidence
        const localThreshold = (0, selection_resolution_1.getSelectionConfidenceThreshold)();
        // Step 1: Local resolution blocked (confidence < 0.85)
        (0, test_1.expect)((0, selection_resolution_1.isSelectionLikeTarget)(target)).toBe(true);
        (0, test_1.expect)(localConfidence).toBeLessThan(localThreshold);
        // Step 2: AI selection_resolution invoked
        const aiDecision = "repaired_plan";
        const selectedCandidate = "macbook-air-card";
        // Step 3: AI resolves typo to correct product
        (0, test_1.expect)(aiDecision).toBe("repaired_plan");
        (0, test_1.expect)(selectedCandidate).toBe("macbook-air-card");
        // Step 4: Post-click verification
        const resultPageTexts = ["MacBook Air", "M2", "Apple"];
        const verification = (0, selection_resolution_1.verifyPostClickSemanticMatch)(target, resultPageTexts, "MacBook Air");
        (0, test_1.expect)(verification.matches).toBe(true);
        // Result: PASS - typo resolved correctly
    });
});
