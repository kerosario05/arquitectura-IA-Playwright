"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_system_prompt_1 = require("../src/ai/repair/repair-system-prompt");
(0, test_1.test)("system prompt respeta limites de seguridad", () => {
    const prompt = (0, repair_system_prompt_1.buildRepairSystemPrompt)();
    (0, test_1.expect)(prompt).toContain("JSON only");
    (0, test_1.expect)(prompt).toContain("Never control browser");
    (0, test_1.expect)(prompt).toContain("Never invent selectors");
    (0, test_1.expect)(prompt).toContain("Never request or expose secrets");
    (0, test_1.expect)(prompt).toContain("payments, transfers");
});
