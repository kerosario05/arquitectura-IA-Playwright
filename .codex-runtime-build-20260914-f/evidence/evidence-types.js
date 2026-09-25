"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_EVIDENCE_CONFIG = void 0;
exports.loadEvidenceConfig = loadEvidenceConfig;
exports.mapStatusToSpanish = mapStatusToSpanish;
exports.deriveScenarioStatus = deriveScenarioStatus;
exports.DEFAULT_EVIDENCE_CONFIG = {
    enabled: true,
    docxEnabled: true,
    perScenarioDocx: false,
    templatePath: "templates/evidence/execution-evidence-template.docx",
    outputRoot: ".artifacts/evidence",
    screenshotMode: "after_step",
    fullPage: true,
    failOnError: false,
    analystName: "",
    preserveTemplateLayout: true,
};
function loadEvidenceConfig(env = process.env) {
    return {
        enabled: env.EVIDENCE_ENABLED !== "false",
        docxEnabled: env.EVIDENCE_DOCX_ENABLED !== "false",
        perScenarioDocx: env.EVIDENCE_PER_SCENARIO_DOCX === "true",
        templatePath: env.EVIDENCE_TEMPLATE_PATH ?? exports.DEFAULT_EVIDENCE_CONFIG.templatePath,
        outputRoot: env.EVIDENCE_OUTPUT_DIR ?? exports.DEFAULT_EVIDENCE_CONFIG.outputRoot,
        screenshotMode: env.EVIDENCE_SCREENSHOT_MODE ?? "after_step",
        fullPage: env.EVIDENCE_FULL_PAGE !== "false",
        failOnError: env.EVIDENCE_FAIL_ON_ERROR === "true",
        analystName: env.EVIDENCE_ANALYST_NAME ?? "",
        preserveTemplateLayout: env.EVIDENCE_PRESERVE_TEMPLATE_LAYOUT !== "false",
    };
}
function mapStatusToSpanish(status) {
    switch (status) {
        case "passed": return "Exitoso";
        case "failed": return "Fallido";
        case "skipped": return "No ejecutado";
    }
}
function deriveScenarioStatus(steps) {
    if (steps.length === 0)
        return "No ejecutado";
    const hasFailed = steps.some(s => s.status === "failed");
    const hasSkipped = steps.some(s => s.status === "skipped");
    const hasPassed = steps.some(s => s.status === "passed");
    // If has failed steps but also passed steps, it's partial (recovered from failure)
    if (hasFailed && hasPassed)
        return "Parcial / Con observaciones";
    // If has failed steps and no passed steps, it's failed
    if (hasFailed)
        return "Fallido";
    // If has skipped and passed, it's partial
    if (hasSkipped && hasPassed)
        return "Parcial / Con observaciones";
    // If all passed, it's successful
    if (hasPassed)
        return "Exitoso";
    return "No ejecutado";
}
