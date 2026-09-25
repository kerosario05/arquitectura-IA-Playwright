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
exports.RunEvidenceRecorder = void 0;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const evidence_types_1 = require("./evidence-types");
const evidence_paths_1 = require("./evidence-paths");
const evidence_docx_generator_1 = require("./evidence-docx-generator");
class RunEvidenceRecorder {
    config;
    context;
    paths;
    scenarios = [];
    constructor(context, config) {
        this.config = { ...(0, evidence_types_1.loadEvidenceConfig)(), ...config };
        this.context = context;
        this.paths = (0, evidence_paths_1.buildEvidenceRunPaths)(context);
    }
    get enabled() {
        return this.config.enabled;
    }
    async start() {
        if (!this.config.enabled)
            return;
        // Ensure run directories exist
        await fs.promises.mkdir(this.paths.runDir, { recursive: true });
        await fs.promises.mkdir(this.paths.scenariosDir, { recursive: true });
        console.log(`[evidence:run] started runId=${this.context.runId} appSlug=${this.context.appSlug} sectionSlug=${this.context.sectionSlug}`);
    }
    /**
     * Load a scenario's evidence.json and add it to the run aggregate.
     */
    async addScenarioFromFile(scenarioEvidenceJsonPath) {
        if (!this.config.enabled)
            return;
        try {
            const content = await fs.promises.readFile(scenarioEvidenceJsonPath, "utf8");
            const scenarioRecord = this.normalizeScenarioForConsolidation(JSON.parse(content));
            this.scenarios.push(scenarioRecord);
            console.log(`[evidence:run] added scenario scenarioId=${scenarioRecord.scenarioId} status=${scenarioRecord.status}`);
        }
        catch (err) {
            console.log(`[evidence:run] failed to load scenario evidence: ${err.message}`);
            if (this.config.failOnError)
                throw err;
        }
    }
    /**
     * Add a scenario record directly (without loading from file).
     */
    addScenario(scenarioRecord) {
        if (!this.config.enabled)
            return;
        this.scenarios.push(this.normalizeScenarioForConsolidation(scenarioRecord));
        console.log(`[evidence:run] added scenario scenarioId=${scenarioRecord.scenarioId} status=${scenarioRecord.status}`);
    }
    normalizeScenarioForConsolidation(scenarioRecord) {
        const normalized = {
            ...scenarioRecord,
            requirement: scenarioRecord.requirement?.trim() || `Automatización - ${this.context.sectionName || this.context.sectionSlug}`,
            analyst: scenarioRecord.analyst?.trim() || this.context.analystName || this.config.analystName || "Automatización",
        };
        const genericDetailTargets = new Set([
            "nombre del producto",
            "descripción general",
            "descripcion general",
            "beneficios",
            "requisitos",
            "tasas",
            "condiciones relevantes",
            "información legal o notas aclaratorias",
            "informacion legal o notas aclaratorias",
        ]);
        const detailTarget = normalized.detailEvidence?.target?.trim().toLowerCase();
        if (normalized.detailEvidence?.required && detailTarget && genericDetailTargets.has(detailTarget)) {
            console.log(`[evidence-docx] reclassifying generic detailEvidence as contextual scenarioId=${normalized.scenarioId} target=${normalized.detailEvidence.target}`);
            normalized.detailEvidence = {
                ...normalized.detailEvidence,
                required: false,
                captured: false,
                reason: "generic_descriptor_not_detail_target",
            };
        }
        else if (normalized.detailEvidence?.required && !normalized.detailEvidence?.captured) {
            console.log(`[evidence-docx] scenario has invalid detailEvidence required=true captured=false target=${normalized.detailEvidence.target || "unknown"}`);
            if (normalized.status === "Exitoso") {
                normalized.status = "Fallido";
            }
        }
        return normalized;
    }
    /**
     * Override the status of a scenario that was already added.
     * Used to apply final discovery status from case_finished events.
     */
    overrideScenarioStatus(scenarioId, finalStatus, source = "case_finished") {
        if (!this.config.enabled)
            return;
        const scenario = this.scenarios.find(s => s.scenarioId === scenarioId);
        if (!scenario) {
            console.log(`[evidence:run] status override skipped scenarioId=${scenarioId} reason="not_found"`);
            return;
        }
        const previousStatus = scenario.status;
        // Map discovery status to evidence status
        const evidenceStatus = finalStatus === "passed" ? "Exitoso" :
            finalStatus === "failed" ? "Fallido" :
                finalStatus === "skipped" ? "Parcial / Con observaciones" :
                    "Parcial / Con observaciones";
        if (previousStatus !== evidenceStatus) {
            scenario.status = evidenceStatus;
            console.log(`[evidence:run] status override scenarioId=${scenarioId} from="${previousStatus}" to="${evidenceStatus}" source=${source}`);
        }
        else {
            console.log(`[evidence:run] status unchanged scenarioId=${scenarioId} status="${evidenceStatus}" source=${source}`);
        }
    }
    /**
     * Finalize the run: generate evidence-run.json and consolidated evidencia.docx.
     */
    async finish() {
        if (!this.config.enabled) {
            return this.buildRunRecord();
        }
        console.log(`[evidence:run] aggregating scenarios=${this.scenarios.length}`);
        const record = this.buildRunRecord();
        // Save evidence-run.json
        try {
            await fs.promises.writeFile(this.paths.evidenceJsonPath, JSON.stringify(record, null, 2), "utf8");
            console.log(`[evidence:run] saved evidence-run.json path=${this.paths.evidenceJsonPath}`);
        }
        catch (err) {
            const msg = `Failed to save evidence-run.json: ${err.message}`;
            if (this.config.failOnError)
                throw new Error(msg);
            console.log(`[evidence:run] ${msg}`);
        }
        // Generate consolidated DOCX
        if (this.config.docxEnabled && this.scenarios.length > 0) {
            try {
                const templatePath = this.context.templatePath ?? this.config.templatePath;
                const resolvedTemplate = path.resolve(templatePath);
                const result = await (0, evidence_docx_generator_1.generateConsolidatedEvidenceDocx)(this.scenarios, resolvedTemplate, this.paths.docxPath);
                if (result.success) {
                    console.log(`[evidence:run] generated evidencia.docx path=${result.outputPath} scenarios=${this.scenarios.length}`);
                    // Validate DOCX
                    if (await this.validateDocx(this.paths.docxPath)) {
                        console.log(`[evidence:docx] validation passed path=${this.paths.docxPath}`);
                    }
                }
                else {
                    console.log(`[evidence:run] consolidated docx generation failed: ${result.error}`);
                }
            }
            catch (err) {
                const msg = `consolidated docx generation error: ${err.message}`;
                if (this.config.failOnError)
                    throw new Error(msg);
                console.log(`[evidence:run] ${msg}`);
            }
        }
        return record;
    }
    buildRunRecord() {
        const passedScenarios = this.scenarios.filter(s => s.status === "Exitoso").length;
        const failedScenarios = this.scenarios.filter(s => s.status === "Fallido").length;
        const partialScenarios = this.scenarios.filter(s => s.status === "Parcial / Con observaciones").length;
        const date = new Date().toLocaleDateString("es-ES", {
            year: "numeric",
            month: "long",
            day: "numeric",
        });
        return {
            runId: this.context.runId,
            appSlug: this.context.appSlug,
            sectionSlug: this.context.sectionSlug,
            sectionName: this.context.sectionName,
            analyst: this.context.analystName?.trim() || this.config.analystName?.trim() || "Automatización",
            date,
            scenarios: this.scenarios,
            totalScenarios: this.scenarios.length,
            passedScenarios,
            failedScenarios,
            partialScenarios,
            docxPath: this.config.docxEnabled ? this.paths.docxPath : undefined,
            evidenceJsonPath: this.paths.evidenceJsonPath,
        };
    }
    /**
     * Validate that the DOCX is a valid ZIP file with expected structure.
     * Uses JSZip for proper validation and XML parsing checks.
     */
    async validateDocx(docxPath) {
        try {
            const JSZip = (await Promise.resolve().then(() => __importStar(require("jszip")))).default;
            const buf = await fs.promises.readFile(docxPath);
            // Load as ZIP using JSZip
            let zip;
            try {
                zip = await JSZip.loadAsync(buf);
            }
            catch (err) {
                console.log(`[evidence:docx] validation failed: not a valid ZIP file: ${err.message}`);
                return false;
            }
            // Check for required files
            const documentXmlFile = zip.file("word/document.xml");
            if (!documentXmlFile) {
                console.log(`[evidence:docx] validation failed: missing word/document.xml`);
                return false;
            }
            const contentTypesFile = zip.file("[Content_Types].xml");
            if (!contentTypesFile) {
                console.log(`[evidence:docx] validation failed: missing [Content_Types].xml`);
                return false;
            }
            const relsFile = zip.file("_rels/.rels");
            if (!relsFile) {
                console.log(`[evidence:docx] validation failed: missing _rels/.rels`);
                return false;
            }
            // Extract and validate document.xml
            const documentXml = await documentXmlFile.async("string");
            // Verify XML is parseable (basic check)
            if (!documentXml.includes("<?xml") || !documentXml.includes("<w:document")) {
                console.log(`[evidence:docx] validation failed: document.xml does not appear to be valid XML`);
                return false;
            }
            // Check placeholder was replaced
            if (documentXml.includes("{{ESCENARIOS_EVIDENCIA}}")) {
                console.log(`[evidence:docx] validation failed: placeholder {{ESCENARIOS_EVIDENCIA}} not replaced`);
                return false;
            }
            // Check for images if scenarios have screenshots
            const hasScreenshots = this.scenarios.some((s) => s.steps.some((step) => {
                if (!step.screenshotPath)
                    return false;
                const ext = require("node:path").extname(step.screenshotPath).toLowerCase();
                return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
            }));
            if (hasScreenshots) {
                // Check for word/_rels/document.xml.rels
                const documentRelsFile = zip.file("word/_rels/document.xml.rels");
                if (!documentRelsFile) {
                    console.log(`[evidence:docx] validation failed: scenarios have screenshots but no word/_rels/document.xml.rels found`);
                    return false;
                }
                const relsXml = await documentRelsFile.async("string");
                // Verify rels XML is parseable
                if (!relsXml.includes("<?xml") || !relsXml.includes("<Relationships")) {
                    console.log(`[evidence:docx] validation failed: document.xml.rels does not appear to be valid XML`);
                    return false;
                }
                // Check for image relationships
                if (!relsXml.includes('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"')) {
                    console.log(`[evidence:docx] validation failed: no image relationships found in document.xml.rels`);
                    return false;
                }
                // Extract all rId values from relationships
                const rIdMatches = relsXml.matchAll(/Id="(rId\d+)"/g);
                const rIdsInRels = new Set();
                for (const match of rIdMatches) {
                    rIdsInRels.add(match[1]);
                }
                // Verify that document.xml has r:embed references
                if (!documentXml.includes('r:embed=')) {
                    console.log(`[evidence:docx] validation failed: no r:embed image references found in document.xml`);
                    return false;
                }
                // Extract all r:embed values from document.xml
                const embedMatches = documentXml.matchAll(/r:embed="(rId\d+)"/g);
                const embedsInDoc = new Set();
                for (const match of embedMatches) {
                    embedsInDoc.add(match[1]);
                }
                // Verify all embeds exist in rels
                for (const embedRId of embedsInDoc) {
                    if (!rIdsInRels.has(embedRId)) {
                        console.log(`[evidence:docx] validation failed: document.xml references ${embedRId} but it's not defined in rels`);
                        return false;
                    }
                }
                // Check that media files exist
                const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith("word/media/"));
                if (mediaFiles.length === 0) {
                    console.log(`[evidence:docx] validation failed: scenarios have screenshots but no word/media/ files found`);
                    return false;
                }
                // Verify content types for images
                const contentTypesXml = await contentTypesFile.async("string");
                const hasImageContentType = contentTypesXml.includes('ContentType="image/png"') ||
                    contentTypesXml.includes('ContentType="image/jpeg"');
                if (!hasImageContentType) {
                    console.log(`[evidence:docx] validation failed: no image content types found in [Content_Types].xml`);
                    return false;
                }
            }
            return true;
        }
        catch (err) {
            console.log(`[evidence:docx] validation error: ${err.message}`);
            return false;
        }
    }
}
exports.RunEvidenceRecorder = RunEvidenceRecorder;
