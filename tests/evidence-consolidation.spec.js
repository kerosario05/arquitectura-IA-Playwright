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
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs"));
const evidence_docx_generator_1 = require("../src/evidence/evidence-docx-generator");
test_1.test.describe("Evidence Consolidation", () => {
    (0, test_1.test)("rejects .json files as screenshotPath", () => {
        const step = {
            index: 1,
            stepText: "Test step",
            status: "passed",
            timestamp: new Date().toISOString(),
            screenshotPath: "/path/to/snapshot.json",
        };
        // Should be rejected - .json is not a valid screenshot
        const ext = path.extname(step.screenshotPath).toLowerCase();
        (0, test_1.expect)(ext).toBe(".json");
        (0, test_1.expect)([".png", ".jpg", ".jpeg"].includes(ext)).toBe(false);
    });
    (0, test_1.test)("accepts .png files as screenshotPath", () => {
        const step = {
            index: 1,
            stepText: "Test step",
            status: "passed",
            timestamp: new Date().toISOString(),
            screenshotPath: "/path/to/screenshot.png",
        };
        const ext = path.extname(step.screenshotPath).toLowerCase();
        (0, test_1.expect)(ext).toBe(".png");
        (0, test_1.expect)([".png", ".jpg", ".jpeg"].includes(ext)).toBe(true);
    });
    (0, test_1.test)("separates screenshotPath and snapshotPath", () => {
        const step = {
            index: 1,
            stepText: "Test step",
            status: "passed",
            timestamp: new Date().toISOString(),
            screenshotPath: "/path/to/screenshot.png",
            snapshotPath: "/path/to/snapshot.json",
        };
        (0, test_1.expect)(step.screenshotPath).toBeDefined();
        (0, test_1.expect)(step.snapshotPath).toBeDefined();
        (0, test_1.expect)(path.extname(step.screenshotPath).toLowerCase()).toBe(".png");
        (0, test_1.expect)(path.extname(step.snapshotPath).toLowerCase()).toBe(".json");
    });
    (0, test_1.test)("EvidenceRunRecord aggregates multiple scenarios", () => {
        const scenario1 = {
            scenarioId: "PREVIEW-001",
            scenarioTitle: "Test Scenario 1",
            requirement: "Automatización - Testing",
            analyst: "Test Analyst",
            date: "1 de enero de 2025",
            status: "Exitoso",
            appSlug: "test-app",
            sectionSlug: "test-section",
            steps: [
                {
                    index: 1,
                    stepText: "Step 1",
                    status: "passed",
                    timestamp: new Date().toISOString(),
                    screenshotPath: "/path/to/screenshot1.png",
                },
            ],
        };
        const scenario2 = {
            ...scenario1,
            scenarioId: "PREVIEW-002",
            scenarioTitle: "Test Scenario 2",
            status: "Fallido",
            steps: [
                {
                    index: 1,
                    stepText: "Step 1",
                    status: "failed",
                    timestamp: new Date().toISOString(),
                    screenshotPath: "/path/to/screenshot2.png",
                },
            ],
        };
        const runRecord = {
            runId: "test-run-123",
            appSlug: "test-app",
            sectionSlug: "test-section",
            analyst: "Test Analyst",
            date: "1 de enero de 2025",
            scenarios: [scenario1, scenario2],
            totalScenarios: 2,
            passedScenarios: 1,
            failedScenarios: 1,
            partialScenarios: 0,
        };
        (0, test_1.expect)(runRecord.scenarios.length).toBe(2);
        (0, test_1.expect)(runRecord.totalScenarios).toBe(2);
        (0, test_1.expect)(runRecord.passedScenarios).toBe(1);
        (0, test_1.expect)(runRecord.failedScenarios).toBe(1);
    });
    (0, test_1.test)("snapshot count does not include screenshotPath", () => {
        const steps = [
            {
                index: 1,
                stepText: "Step 1",
                status: "passed",
                timestamp: new Date().toISOString(),
                screenshotPath: "/path/to/screenshot1.png",
            },
            {
                index: 2,
                stepText: "Step 2",
                status: "passed",
                timestamp: new Date().toISOString(),
                snapshotPath: "/path/to/snapshot1.json",
            },
            {
                index: 3,
                stepText: "Step 3",
                status: "passed",
                timestamp: new Date().toISOString(),
                screenshotPath: "/path/to/screenshot2.png",
                snapshotPath: "/path/to/snapshot2.json",
            },
        ];
        const screenshotCount = steps.filter((s) => {
            if (!s.screenshotPath)
                return false;
            const ext = path.extname(s.screenshotPath).toLowerCase();
            return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
        }).length;
        const snapshotCount = steps.filter((s) => s.snapshotPath).length;
        (0, test_1.expect)(screenshotCount).toBe(2); // Only real images
        (0, test_1.expect)(snapshotCount).toBe(2); // JSON snapshots
    });
    (0, test_1.test)("generateConsolidatedEvidenceDocx with real image", async () => {
        const tmpDir = path.join(process.cwd(), ".artifacts", "tmp", "docx-test");
        await fs.promises.mkdir(tmpDir, { recursive: true });
        try {
            // Create a minimal 1x1 PNG image (valid PNG structure)
            const pngData = Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 dimensions
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, // rest of IHDR
                0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, // IDAT chunk
                0x08, 0x99, 0x63, 0xf8, 0x0f, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x18, 0xdd, 0x8d,
                0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, // IEND chunk
                0xae, 0x42, 0x60, 0x82
            ]);
            const testImagePath = path.join(tmpDir, "test-image.png");
            await fs.promises.writeFile(testImagePath, pngData);
            // Create a scenario with the test image
            const scenario = {
                scenarioId: "DOCX-TEST-001",
                scenarioTitle: "DOCX Generation Test",
                requirement: "Automatización - Testing",
                analyst: "Test Analyst",
                date: "1 de enero de 2025",
                status: "Exitoso",
                appSlug: "test-app",
                sectionSlug: "test-section",
                steps: [
                    {
                        index: 1,
                        stepText: "Test step with screenshot",
                        status: "passed",
                        timestamp: new Date().toISOString(),
                        screenshotPath: testImagePath,
                    },
                ],
            };
            // Generate consolidated DOCX
            const templatePath = path.join(process.cwd(), "templates", "evidence", "execution-evidence-template.docx");
            const outputPath = path.join(tmpDir, "test-evidence.docx");
            const result = await (0, evidence_docx_generator_1.generateConsolidatedEvidenceDocx)([scenario], templatePath, outputPath);
            // Verify generation succeeded
            (0, test_1.expect)(result.success).toBe(true);
            (0, test_1.expect)(result.outputPath).toBe(outputPath);
            // Verify DOCX was created
            (0, test_1.expect)(fs.existsSync(outputPath)).toBe(true);
            // Verify DOCX structure
            const docxBuf = await fs.promises.readFile(outputPath);
            // Check ZIP signature
            (0, test_1.expect)(docxBuf[0]).toBe(0x50); // P
            (0, test_1.expect)(docxBuf[1]).toBe(0x4b); // K
            // Check for required files in ZIP
            const zipContent = docxBuf.toString();
            (0, test_1.expect)(zipContent).toContain("word/document.xml");
            (0, test_1.expect)(zipContent).toContain("word/_rels/document.xml.rels");
            (0, test_1.expect)(zipContent).toContain("word/media/");
            // Verify placeholder was replaced (should not contain placeholder)
            (0, test_1.expect)(zipContent).not.toContain("{{ESCENARIOS_EVIDENCIA}}");
            console.log(`[test] DOCX generated successfully: ${outputPath}`);
        }
        finally {
            // Cleanup
            try {
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
    (0, test_1.test)("validateDocx with JSZip - comprehensive validation", async () => {
        const JSZip = (await Promise.resolve().then(() => __importStar(require("jszip")))).default;
        const tmpDir = path.join(process.cwd(), ".artifacts", "tmp", "docx-validation-test");
        await fs.promises.mkdir(tmpDir, { recursive: true });
        try {
            // Create two test images
            const pngData = Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
                0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
                0x08, 0x99, 0x63, 0xf8, 0x0f, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x18, 0xdd, 0x8d,
                0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
                0xae, 0x42, 0x60, 0x82
            ]);
            const image1Path = path.join(tmpDir, "test-image-1.png");
            const image2Path = path.join(tmpDir, "test-image-2.png");
            await fs.promises.writeFile(image1Path, pngData);
            await fs.promises.writeFile(image2Path, pngData);
            // Create two scenarios
            const scenarios = [
                {
                    scenarioId: "VALIDATION-TEST-001",
                    scenarioTitle: "First Test Scenario",
                    requirement: "Automatización - Testing",
                    analyst: "Test Analyst",
                    date: "1 de enero de 2025",
                    status: "Exitoso",
                    appSlug: "test-app",
                    sectionSlug: "test-section",
                    steps: [
                        {
                            index: 1,
                            stepText: "First step with screenshot",
                            status: "passed",
                            timestamp: new Date().toISOString(),
                            screenshotPath: image1Path,
                        },
                    ],
                },
                {
                    scenarioId: "VALIDATION-TEST-002",
                    scenarioTitle: "Second Test Scenario",
                    requirement: "Automatización - Testing",
                    analyst: "Test Analyst",
                    date: "1 de enero de 2025",
                    status: "Exitoso",
                    appSlug: "test-app",
                    sectionSlug: "test-section",
                    steps: [
                        {
                            index: 1,
                            stepText: "Second step with screenshot",
                            status: "passed",
                            timestamp: new Date().toISOString(),
                            screenshotPath: image2Path,
                        },
                    ],
                },
            ];
            // Generate DOCX
            const templatePath = path.join(process.cwd(), "templates", "evidence", "execution-evidence-template.docx");
            const outputPath = path.join(tmpDir, "validation-test.docx");
            const result = await (0, evidence_docx_generator_1.generateConsolidatedEvidenceDocx)(scenarios, templatePath, outputPath);
            (0, test_1.expect)(result.success).toBe(true);
            // Load DOCX with JSZip for comprehensive validation
            const docxBuf = await fs.promises.readFile(outputPath);
            const zip = await JSZip.loadAsync(docxBuf);
            // Verify required files exist
            (0, test_1.expect)(zip.file("word/document.xml")).toBeTruthy();
            (0, test_1.expect)(zip.file("word/_rels/document.xml.rels")).toBeTruthy();
            (0, test_1.expect)(zip.file("[Content_Types].xml")).toBeTruthy();
            (0, test_1.expect)(zip.file("_rels/.rels")).toBeTruthy();
            // Extract and validate document.xml
            const documentXml = await zip.file("word/document.xml").async("string");
            (0, test_1.expect)(documentXml).toContain("<?xml");
            (0, test_1.expect)(documentXml).toContain("<w:document");
            (0, test_1.expect)(documentXml).not.toContain("{{ESCENARIOS_EVIDENCIA}}");
            (0, test_1.expect)(documentXml).toContain("First Test Scenario");
            (0, test_1.expect)(documentXml).toContain("Second Test Scenario");
            (0, test_1.expect)(documentXml).toContain('r:embed="rId');
            // Extract and validate rels
            const relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
            (0, test_1.expect)(relsXml).toContain("<?xml");
            (0, test_1.expect)(relsXml).toContain("<Relationships");
            (0, test_1.expect)(relsXml).toContain('Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"');
            // Verify media files exist
            const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith("word/media/"));
            (0, test_1.expect)(mediaFiles.length).toBeGreaterThanOrEqual(2);
            // Extract all rId values from rels
            const rIdMatches = relsXml.matchAll(/Id="(rId\d+)"/g);
            const rIdsInRels = new Set();
            for (const match of rIdMatches) {
                rIdsInRels.add(match[1]);
            }
            // Extract all r:embed values from document.xml
            const embedMatches = documentXml.matchAll(/r:embed="(rId\d+)"/g);
            const embedsInDoc = new Set();
            for (const match of embedMatches) {
                embedsInDoc.add(match[1]);
            }
            // Verify all embeds exist in rels (critical cross-reference check)
            for (const embedRId of embedsInDoc) {
                (0, test_1.expect)(rIdsInRels.has(embedRId)).toBe(true);
            }
            // Validate content types
            const contentTypesXml = await zip.file("[Content_Types].xml").async("string");
            (0, test_1.expect)(contentTypesXml).toContain('ContentType="image/png"');
            console.log(`[test] DOCX validation passed: ${outputPath}`);
            console.log(`[test] Found ${mediaFiles.length} media files`);
            console.log(`[test] Found ${rIdsInRels.size} relationships`);
            console.log(`[test] Found ${embedsInDoc.size} embeds in document`);
            // Verify global fields are not empty
            // Test should fail if "Requerimiento:" appears without a value
            const requerimientoMatch = documentXml.match(/Requerimiento:\s*([^\r\n<]*)/);
            if (requerimientoMatch) {
                const requerimientoValue = requerimientoMatch[1].trim();
                (0, test_1.expect)(requerimientoValue.length).toBeGreaterThan(0);
                console.log(`[test] Requerimiento value: "${requerimientoValue}"`);
            }
            // Test should fail if "Analista:" appears without a value
            const analistaMatch = documentXml.match(/Analista:\s*([^\r\n<]*)/);
            if (analistaMatch) {
                const analistaValue = analistaMatch[1].trim();
                (0, test_1.expect)(analistaValue.length).toBeGreaterThan(0);
                (0, test_1.expect)(analistaValue).toContain("Automatización");
                console.log(`[test] Analista value: "${analistaValue}"`);
            }
            // Verify scenario titles are present
            (0, test_1.expect)(documentXml).toContain("First Test Scenario");
            (0, test_1.expect)(documentXml).toContain("Second Test Scenario");
            // CRITICAL: Verify "Pasos ejecutados" section does NOT appear (user requirement)
            (0, test_1.expect)(documentXml).not.toContain("Pasos ejecutados:");
            (0, test_1.expect)(documentXml).not.toContain("Paso 0:");
            (0, test_1.expect)(documentXml).not.toContain("Paso 1:");
        }
        finally {
            // Cleanup
            try {
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
    (0, test_1.test)("scenario with failed and passed steps is Parcial", () => {
        const steps = [
            {
                index: 1,
                stepText: "Initial attempt (failed)",
                status: "failed",
                timestamp: new Date().toISOString(),
                errorMessage: "Failed to locate element",
            },
            {
                index: 2,
                stepText: "Retry attempt (passed)",
                status: "passed",
                timestamp: new Date().toISOString(),
            },
        ];
        // Dynamically import and call deriveScenarioStatus
        const { deriveScenarioStatus } = require("../src/evidence/evidence-types");
        const status = deriveScenarioStatus(steps);
        // Should be Parcial because it recovered from failure
        (0, test_1.expect)(status).toBe("Parcial / Con observaciones");
    });
    (0, test_1.test)("scenario with only failed steps is Fallido", () => {
        const steps = [
            {
                index: 1,
                stepText: "Failed step",
                status: "failed",
                timestamp: new Date().toISOString(),
                errorMessage: "Failed",
            },
        ];
        const { deriveScenarioStatus } = require("../src/evidence/evidence-types");
        const status = deriveScenarioStatus(steps);
        (0, test_1.expect)(status).toBe("Fallido");
    });
    (0, test_1.test)("filters validation steps and inserts multiple images per scenario", async () => {
        const tmpDir = path.join(process.cwd(), ".artifacts", "tmp", "docx-validation-filter-test");
        await fs.promises.mkdir(tmpDir, { recursive: true });
        try {
            // Create test images
            const pngData = Buffer.from([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
                0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde,
                0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54,
                0x08, 0x99, 0x63, 0xf8, 0x0f, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x18, 0xdd, 0x8d,
                0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
                0xae, 0x42, 0x60, 0x82
            ]);
            const image1Path = path.join(tmpDir, "step1.png");
            const image2Path = path.join(tmpDir, "step2.png");
            const image3Path = path.join(tmpDir, "step3.png");
            await fs.promises.writeFile(image1Path, pngData);
            await fs.promises.writeFile(image2Path, pngData);
            await fs.promises.writeFile(image3Path, pngData);
            // Create scenario with mixed steps (functional + validation)
            const scenario = {
                scenarioId: "FILTER-TEST-001",
                scenarioTitle: "Validation Filter Test",
                requirement: "Automatización - Testing",
                analyst: "Test Analyst",
                date: "1 de enero de 2025",
                status: "Exitoso",
                appSlug: "test-app",
                sectionSlug: "test-section",
                sectionName: "Detalle KIOSKO",
                steps: [
                    {
                        index: 1,
                        stepText: "Click on login button",
                        status: "passed",
                        timestamp: new Date().toISOString(),
                        screenshotPath: image1Path,
                    },
                    {
                        index: 2,
                        stepText: "Validar que se muestre el formulario",
                        status: "passed",
                        timestamp: new Date().toISOString(),
                        screenshotPath: image2Path, // Should be filtered out
                    },
                    {
                        index: 3,
                        stepText: "Fill username and password",
                        status: "passed",
                        timestamp: new Date().toISOString(),
                        screenshotPath: image3Path,
                    },
                ],
            };
            // Generate DOCX
            const templatePath = path.join(process.cwd(), "templates", "evidence", "execution-evidence-template.docx");
            const outputPath = path.join(tmpDir, "filter-test.docx");
            const result = await (0, evidence_docx_generator_1.generateConsolidatedEvidenceDocx)([scenario], templatePath, outputPath);
            (0, test_1.expect)(result.success).toBe(true);
            // Verify DOCX with JSZip
            const JSZip = (await Promise.resolve().then(() => __importStar(require("jszip")))).default;
            const docxBuf = await fs.promises.readFile(outputPath);
            const zip = await JSZip.loadAsync(docxBuf);
            const documentXml = await zip.file("word/document.xml").async("string");
            // Main validation: verify only 2 images embedded (validation step filtered out)
            const mediaFiles = Object.keys(zip.files).filter(name => name.startsWith("word/media/"));
            (0, test_1.expect)(mediaFiles.length).toBe(2); // Only step1 and step3 images
            // Verify relationship count matches
            const relsXml = await zip.file("word/_rels/document.xml.rels").async("string");
            const imageRels = (relsXml.match(/Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/image"/g) || []).length;
            (0, test_1.expect)(imageRels).toBe(2);
            console.log(`[test] Validation filter test passed: ${mediaFiles.length} images (2 expected)`);
        }
        finally {
            // Cleanup
            try {
                await fs.promises.rm(tmpDir, { recursive: true, force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
    });
});
