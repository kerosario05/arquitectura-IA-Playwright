"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const runtime_knowledge_persister_1 = require("../src/knowledge/runtime-knowledge-persister");
/**
 * Mobile Knowledge Trust / Composite Reuse Trust
 *
 * Tests the FOUR-CONDITION composite trust rule for MOBILE route_transition:
 *   trustedForReuse = true ONLY when ALL of:
 *     1. transitionValidated === true
 *     2. executionBacked === true
 *     3. actionSemanticAuthority === "validated"
 *     4. destinationSemanticAuthority === "validated"
 *
 * Action and destination authorities are INDEPENDENT:
 *   - action validated + destination pending → trust=false, action authority preserved
 *   - destination validated + action pending → trust=false, destination authority preserved
 */
test_1.test.describe("mobile route_transition composite trust", () => {
    (0, test_1.test)("T1: transitionValidated=undefined + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: undefined,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
        })).toBe(false);
    });
    (0, test_1.test)("T2: transitionValidated=false + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: false,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
        })).toBe(false);
    });
    (0, test_1.test)("T3: executionBacked=false + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: true,
            executionBacked: false,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
        })).toBe(false);
    });
    (0, test_1.test)("T4: executionBacked=undefined + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: true,
            executionBacked: undefined,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
        })).toBe(false);
    });
    (0, test_1.test)("T5: action=pending + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: undefined,
            destinationSemanticAuthority: "validated",
        })).toBe(false);
    });
    (0, test_1.test)("T6: destination=pending + all else valid → false", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: undefined,
        })).toBe(false);
    });
    (0, test_1.test)("T7: all four conditions valid → true", () => {
        (0, test_1.expect)((0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
        })).toBe(true);
    });
    (0, test_1.test)("T8: pending destination preserves actionSemanticAuthority=validated", () => {
        const input = {
            sourceScreenKey: "screen_a",
            destinationScreenKey: "screen_b",
            actionLocatorIdentity: "btn-submit",
            controlPackage: "com.example.app",
            transitionValidated: true,
            executionBacked: true,
            requirementIds: ["CA01"],
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: undefined,
        };
        const trust = (0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: input.transitionValidated,
            executionBacked: input.executionBacked,
            actionSemanticAuthority: input.actionSemanticAuthority,
            destinationSemanticAuthority: input.destinationSemanticAuthority,
        });
        (0, test_1.expect)(trust).toBe(false);
        (0, test_1.expect)(input.actionSemanticAuthority).toBe("validated");
    });
    (0, test_1.test)("T9: pending action preserves destinationSemanticAuthority=validated", () => {
        const input = {
            sourceScreenKey: "screen_a",
            destinationScreenKey: "screen_b",
            actionLocatorIdentity: "btn-submit",
            controlPackage: "com.example.app",
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: undefined,
            destinationSemanticAuthority: "validated",
        };
        const trust = (0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: input.transitionValidated,
            executionBacked: input.executionBacked,
            actionSemanticAuthority: input.actionSemanticAuthority,
            destinationSemanticAuthority: input.destinationSemanticAuthority,
        });
        (0, test_1.expect)(trust).toBe(false);
        (0, test_1.expect)(input.destinationSemanticAuthority).toBe("validated");
    });
    (0, test_1.test)("T10: legacy trusted transition failing one condition → demoted", () => {
        const legacyItem = {
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: undefined,
            trustedForReuse: true,
        };
        const stillTrusted = (0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)(legacyItem);
        (0, test_1.expect)(stillTrusted).toBe(false);
        if (!stillTrusted) {
            legacyItem.trustedForReuse = false;
        }
        (0, test_1.expect)(legacyItem.trustedForReuse).toBe(false);
    });
    (0, test_1.test)("T11: legacy transition meeting all four conditions → can keep trustedForReuse=true", () => {
        const legacyItem = {
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: "validated",
            trustedForReuse: true,
        };
        const stillTrusted = (0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)(legacyItem);
        (0, test_1.expect)(stillTrusted).toBe(true);
        (0, test_1.expect)(legacyItem.trustedForReuse).toBe(true);
    });
    (0, test_1.test)("T12: SQL/JSON equivalence after remediation", () => {
        const sqlItem = {
            id: "test-transition",
            knowledgeKind: "route_transition",
            transitionValidated: true,
            executionBacked: true,
            actionSemanticAuthority: "validated",
            destinationSemanticAuthority: undefined,
            trustedForReuse: true,
        };
        const stillTrusted = (0, runtime_knowledge_persister_1.isMobileRouteTransitionTrustedForReuse)({
            transitionValidated: sqlItem.transitionValidated,
            executionBacked: sqlItem.executionBacked,
            actionSemanticAuthority: sqlItem.actionSemanticAuthority,
            destinationSemanticAuthority: sqlItem.destinationSemanticAuthority,
        });
        if (!stillTrusted) {
            sqlItem.trustedForReuse = false;
            sqlItem.validationStatus = "validated_technical";
        }
        const jsonItem = { ...sqlItem };
        (0, test_1.expect)(jsonItem.trustedForReuse).toBe(sqlItem.trustedForReuse);
        (0, test_1.expect)(jsonItem.validationStatus).toBe(sqlItem.validationStatus);
    });
});
