"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const agent_skill_router_1 = require("../src/agent/agent-skill-router");
const agent_skill_loader_1 = require("../src/agent/agent-skill-loader");
(0, test_1.test)("selectSkill devuelve target-disambiguation para ambiguous_target", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "ambiguous_target", hasCandidates: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("target-disambiguation");
});
(0, test_1.test)("selectSkill devuelve navigation-recovery para target_not_found", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "target_not_found", hasCandidates: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("navigation-recovery");
});
(0, test_1.test)("selectSkill devuelve assertion-resolution para assertion_not_found", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "assertion_not_found", hasPendingAssertions: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("assertion-resolution");
});
(0, test_1.test)("selectSkill devuelve assertion-resolution para pendingAssertions", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "pendingAssertions", hasPendingAssertions: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("assertion-resolution");
});
(0, test_1.test)("selectSkill devuelve form-fill para field_not_found", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "field_not_found" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("form-fill");
});
(0, test_1.test)("selectSkill devuelve form-fill para missing_test_data", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "missing_test_data" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("form-fill");
});
(0, test_1.test)("selectSkill devuelve promotion-review para promotion_gate_blocked", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "promotion_gate_blocked" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("promotion-review");
});
(0, test_1.test)("selectSkill devuelve case-quality para repeated_targets", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "repeated_targets" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("case-quality");
});
(0, test_1.test)("selectSkill devuelve case-quality para vague_assertions", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "vague_assertions" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("case-quality");
});
(0, test_1.test)("selectSkill devuelve case-quality para poor_case_quality", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "poor_case_quality" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("case-quality");
});
(0, test_1.test)("selectSkill devuelve form-fill para ambiguous_field", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "ambiguous_field" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("form-fill");
});
(0, test_1.test)("selectSkill devuelve target-disambiguation con preferencia sobre navigation-recovery para locator_resolution_failed con candidatos", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "locator_resolution_failed", hasCandidates: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("target-disambiguation");
});
(0, test_1.test)("selectSkill devuelve navigation-recovery para locator_resolution_failed sin candidatos", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "locator_resolution_failed", hasCandidates: false });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("navigation-recovery");
});
(0, test_1.test)("selectSkill devuelve null para failedReason desconocido", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "unknown_reason" });
    (0, test_1.expect)(result).toBeNull();
});
(0, test_1.test)("selectSkill devuelve null sin failedReason", () => {
    const result = (0, agent_skill_router_1.selectSkill)({});
    (0, test_1.expect)(result).toBeNull();
});
(0, test_1.test)("selected-skill.md se escribe en handoff", async () => {
    const { writeSelectedSkillFiles } = await Promise.resolve().then(() => __importStar(require("../src/agent/agent-skill-loader")));
    const fs = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    const path = await Promise.resolve().then(() => __importStar(require("node:path")));
    const os = await Promise.resolve().then(() => __importStar(require("node:os")));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-test-"));
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("target-disambiguation");
    const { mdPath, jsonPath } = await writeSelectedSkillFiles(dir, "target-disambiguation", definition);
    const mdContent = await fs.readFile(mdPath, "utf-8");
    (0, test_1.expect)(mdContent).toContain("Selected Skill: target-disambiguation");
    (0, test_1.expect)(mdContent).toContain("Allowed Failure Reasons");
    (0, test_1.expect)(mdContent).toContain("Forbidden Actions");
    (0, test_1.expect)(mdContent).toContain("Validation Rules");
    const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
    (0, test_1.expect)(jsonContent.selectedSkill).toBe("target-disambiguation");
    (0, test_1.expect)(jsonContent.definition).toBeDefined();
});
(0, test_1.test)("selected-skill.json contiene el skillId correcto", async () => {
    const { writeSelectedSkillFiles } = await Promise.resolve().then(() => __importStar(require("../src/agent/agent-skill-loader")));
    const fs = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    const path = await Promise.resolve().then(() => __importStar(require("node:path")));
    const os = await Promise.resolve().then(() => __importStar(require("node:os")));
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-json-test-"));
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("form-fill");
    const { jsonPath } = await writeSelectedSkillFiles(dir, "form-fill", definition);
    const jsonContent = JSON.parse(await fs.readFile(jsonPath, "utf-8"));
    (0, test_1.expect)(jsonContent.selectedSkill).toBe("form-fill");
    (0, test_1.expect)(jsonContent.definition.allowedFailureReasons).toContain("missing_test_data");
});
(0, test_1.test)("isSkillAllowedInBatch permite skills validas", () => {
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("target-disambiguation")).toBe(true);
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("navigation-recovery")).toBe(true);
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("assertion-resolution")).toBe(true);
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("form-fill")).toBe(true);
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("promotion-review")).toBe(true);
    (0, test_1.expect)((0, agent_skill_router_1.isSkillAllowedInBatch)("case-quality")).toBe(true);
});
(0, test_1.test)("validateSkillResponseAgainstRules rechaza skillId incorrecto", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("target-disambiguation");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "assertion-resolution", proposedAction: { type: "click_candidate" }, confidence: 0.9, status: "proposal" }, ["el1", "el2"], definition);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors[0]).toContain("does not match selected skill");
});
(0, test_1.test)("validateSkillResponseAgainstRules rechaza candidateId inexistente", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("target-disambiguation");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "nonexistent" }, confidence: 0.9, status: "proposal" }, ["el1", "el2"], definition);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors[0]).toContain("does not exist in snapshotCandidates");
});
(0, test_1.test)("validateSkillResponseAgainstRules rechaza confidence baja sin needs_agent_review", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("target-disambiguation");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.3, status: "proposal" }, ["el1"], definition);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors[0]).toContain("confidence");
});
(0, test_1.test)("validateSkillResponseAgainstRules rechaza requiresRegistryChange en batch", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("navigation-recovery");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "navigation-recovery", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.9, status: "proposal", requiresCodeChange: false, requiresRegistryChange: true }, ["el1"], definition);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.errors[0]).toContain("registry changes");
});
(0, test_1.test)("validateSkillResponseAgainstRules acepta respuesta valida", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("target-disambiguation");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "target-disambiguation", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.85, status: "proposal" }, ["el1"], definition);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.errors).toHaveLength(0);
});
(0, test_1.test)("validateSkillResponseAgainstRules acepta needs_agent_review con confidence baja", () => {
    const definition = (0, agent_skill_loader_1.loadSkillDefinition)("navigation-recovery");
    const result = (0, agent_skill_router_1.validateSkillResponseAgainstRules)({ skillId: "navigation-recovery", proposedAction: { type: "click_candidate", candidateId: "el1" }, confidence: 0.4, status: "needs_agent_review" }, ["el1"], definition);
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("getFailedReasonForRouting mapea diagnostic hints", () => {
    (0, test_1.expect)((0, agent_skill_router_1.getFailedReasonForRouting)("repeated_targets en step 3")).toBe("repeated_targets");
    (0, test_1.expect)((0, agent_skill_router_1.getFailedReasonForRouting)("vague_assertions detected")).toBe("vague_assertions");
    (0, test_1.expect)((0, agent_skill_router_1.getFailedReasonForRouting)("poor_case_quality")).toBe("poor_case_quality");
    (0, test_1.expect)((0, agent_skill_router_1.getFailedReasonForRouting)("promotion_gate_blocked")).toBe("promotion_gate_blocked");
    (0, test_1.expect)((0, agent_skill_router_1.getFailedReasonForRouting)("missing_test_data for field")).toBe("missing_test_data");
});
(0, test_1.test)("getFailedReasonForRouting pasa failedReason direct cuando no hay hint", () => {
    const result = (0, agent_skill_router_1.getFailedReasonForRouting)("ambiguous_target");
    (0, test_1.expect)(result).toBe("ambiguous_target");
});
(0, test_1.test)("getFailedReasonForRouting devuelve undefined sin failedReason", () => {
    const result = (0, agent_skill_router_1.getFailedReasonForRouting)(undefined);
    (0, test_1.expect)(result).toBeUndefined();
});
(0, test_1.test)("selectSkill devuelve navigation-recovery para click_no_transition", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "click_no_transition", hasCandidates: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("navigation-recovery");
});
(0, test_1.test)("selectSkill devuelve assertion-resolution para needs_assertion_resolution", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "needs_assertion_resolution", hasPendingAssertions: true });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("assertion-resolution");
});
(0, test_1.test)("selectSkill devuelve form-fill para fill_target_not_found", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "fill_target_not_found" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("form-fill");
});
(0, test_1.test)("selectSkill devuelve form-fill para fill_target_not_editable", () => {
    const result = (0, agent_skill_router_1.selectSkill)({ failedReason: "fill_target_not_editable" });
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.skillId).toBe("form-fill");
});
(0, test_1.test)("no hardcodear apps, productos, URLs, case IDs en router", () => {
    const checkNoHardcoded = (obj, path = "") => {
        if (typeof obj === "string") {
            (0, test_1.expect)(obj.toLowerCase()).not.toMatch(/(kiosko|saucelabs?|sauce_demo)/);
            (0, test_1.expect)(obj).not.toMatch(/C\d{5}/);
            if (obj.startsWith("http")) {
                (0, test_1.expect)(obj).not.toMatch(/localhost|example\.com/);
            }
        }
        else if (Array.isArray(obj)) {
            obj.forEach((item, i) => checkNoHardcoded(item, `${path}[${i}]`));
        }
        else if (obj && typeof obj === "object") {
            for (const [key, value] of Object.entries(obj)) {
                checkNoHardcoded(value, `${path}.${key}`);
            }
        }
    };
    const skillResult = (0, agent_skill_router_1.selectSkill)({ failedReason: "ambiguous_target", hasCandidates: true });
    checkNoHardcoded(skillResult);
});
(0, test_1.test)("router asigna confidence mas alta con candidatos", () => {
    const withCandidates = (0, agent_skill_router_1.selectSkill)({ failedReason: "target_not_found", hasCandidates: true });
    const withoutCandidates = (0, agent_skill_router_1.selectSkill)({ failedReason: "target_not_found", hasCandidates: false });
    (0, test_1.expect)(withCandidates).not.toBeNull();
    (0, test_1.expect)(withoutCandidates).not.toBeNull();
    (0, test_1.expect)(withCandidates.confidence).toBeGreaterThan(withoutCandidates.confidence);
    (0, test_1.expect)(withoutCandidates.confidence).toBe(0.2);
    (0, test_1.expect)(withCandidates.confidence).toBe(0.7);
});
