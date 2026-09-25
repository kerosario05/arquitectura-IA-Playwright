"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
const canonical_hu_context_1 = require("../src/scenarios/canonical-hu-context");
const HU_WITH_ENUMERATION = `
Al seleccionar cualquiera de las opciones del menú principal, el sistema debe:
- "Estados de cuenta": mostrar estados de cuenta del cliente (requiere autenticación)
- "Consulta de balance": mostrar balance consolidado (requiere autenticación)
- "Cartas y certificaciones": emitir carta o certificado (requiere autenticación)
- "Canje de Puntos": canjear puntos por beneficios (requiere autenticación)
- "Explora nuestros productos": redirigir al módulo de información de productos (sin autenticación)
`;
const STRUCTURED_MENU_HU = `
Al seleccionar una alternativa, el sistema muestra el resultado correspondiente:
- "Alternativa A", "Alternativa B", "Alternativa C", "Alternativa D": resultado intermedio
- "Alternativa E": resultado final diferente
`;
const REAL_SHAPE_SYNTHETIC_HU = `
1. Una persona inicia el flujo y debe escoger una entrada funcional.
2. Seleccione una opción:
- Opción Alfa
- Opción Beta
- Opción Gamma
1. Cuando se selecciona una entrada, se muestra el resultado correspondiente.
`;
(0, vitest_1.describe)("functional branch enumeration", () => {
    (0, vitest_1.it)("T1: 4 explicit options with same auth destination → 4 branches", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"], [], []);
        (0, vitest_1.expect)(branches.length).toBeGreaterThanOrEqual(4);
        const branchIds = branches.map(b => b.branchId);
        const uniqueBranchIds = new Set(branchIds);
        (0, vitest_1.expect)(uniqueBranchIds.size).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("T2: text-only access evidence is fail-closed without collapsing branches", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos", "Explora nuestros productos"], [], []);
        (0, vitest_1.expect)(branches.length).toBeGreaterThanOrEqual(5);
        (0, vitest_1.expect)(branches.every((branch) => branch.accessIntent === "unknown")).toBe(true);
    });
    (0, vitest_1.it)("T3: 2 members same destination → no dedup by destination", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance"], [], []);
        const uniqueLabels = new Set(branches.map(b => b.sourceLabel));
        (0, vitest_1.expect)(uniqueLabels.size).toBe(2);
    });
    (0, vitest_1.it)("T4: accounting shows required=4 when only 1 scenario covers (with stepRequirementRefs)", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"], [], []);
        const scenarios = [
            {
                scenarioId: "only-one",
                title: "Estados de cuenta",
                functionalBranch: branches[0] ? { branchId: branches[0].branchId } : undefined,
                validation: { valid: true },
                steps: ["Clic en Estados de cuenta"],
                mcpExecutable: true,
                executionReadiness: "standard",
                stepRequirementRefs: branches[0] ? [{ requirementId: branches[0].sourceRequirementId ?? `branch:${branches[0].branchId}`, stepIndex: 0 }] : [],
            },
        ];
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, HU_WITH_ENUMERATION);
        const branchReqs = accounting.requirements.filter(r => r.category === "branch");
        (0, vitest_1.expect)(branchReqs.length).toBeGreaterThanOrEqual(4);
        const covered = branchReqs.filter(r => r.status === "covered");
        (0, vitest_1.expect)(covered.length).toBe(1);
        const missing = branchReqs.filter(r => r.status === "incompleteRequirement");
        (0, vitest_1.expect)(missing.length).toBeGreaterThanOrEqual(3);
    });
    (0, vitest_1.it)("T5: accounting shows covered=4 when all 4 scenarios cover (with stepRequirementRefs)", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"], [], []);
        const scenarios = branches.slice(0, 4).map((b, i) => ({
            scenarioId: `scenario-${i}`,
            title: b.sourceLabel,
            functionalBranch: { branchId: b.branchId },
            validation: { valid: true },
            steps: [`Clic en ${b.sourceLabel}`],
            mcpExecutable: true,
            executionReadiness: "standard",
            stepRequirementRefs: [{ requirementId: b.sourceRequirementId ?? `branch:${b.branchId}`, stepIndex: 0 }],
        }));
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, HU_WITH_ENUMERATION);
        const branchReqs = accounting.requirements.filter(r => r.category === "branch");
        const covered = branchReqs.filter(r => r.status === "covered");
        (0, vitest_1.expect)(covered.length).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("T6: variable-size list works", () => {
        const branches2 = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["A", "B"], [], []);
        const branches6 = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["A", "B", "C", "D", "E", "F"], [], []);
        (0, vitest_1.expect)(new Set(branches2.map(b => b.branchId)).size).toBe(2);
        (0, vitest_1.expect)(new Set(branches6.map(b => b.branchId)).size).toBe(6);
    });
    (0, vitest_1.it)("T7: NFC/accents preserved in sourceLabel", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Canje de Puntos", "Consulta de balance"], [], []);
        (0, vitest_1.expect)(branches.some(b => b.sourceLabel.includes("Canje"))).toBe(true);
        (0, vitest_1.expect)(branches.some(b => b.sourceLabel.includes("Consulta"))).toBe(true);
    });
    (0, vitest_1.it)("T8: no explicit list → no invented branches from visibleOptions", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)("Abrir la pantalla principal", [], [], []);
        (0, vitest_1.expect)(branches.length).toBe(0);
    });
    (0, vitest_1.it)("T9: same destination + different targetIdentity → no dedup", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"], [], []);
        const identities = branches.map(b => b.activation?.targetIdentity ?? "");
        const uniqueIdentities = new Set(identities);
        (0, vitest_1.expect)(uniqueIdentities.size).toBeGreaterThanOrEqual(4);
    });
    (0, vitest_1.it)("T10: no fixture literals in production logic (branchIdFromParts is generic)", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Alpha", "Beta", "Gamma"], [], []);
        const ids = branches.map(b => b.branchId);
        (0, vitest_1.expect)(ids.some(id => id.includes("AA-88") || id.includes("Estados"))).toBe(false);
    });
    (0, vitest_1.it)("T11: text-only negative auth remains unknown", () => {
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(HU_WITH_ENUMERATION, ["Explora nuestros productos"], [], []);
        const explorBranch = branches.find(b => b.sourceLabel === "Explora nuestros productos");
        (0, vitest_1.expect)(explorBranch).toBeDefined();
        (0, vitest_1.expect)(explorBranch?.accessIntent).toBe("unknown");
    });
    (0, vitest_1.it)("structured final model intent replaces an early domain intent", () => {
        (0, vitest_1.expect)((0, scenario_preview_service_1.resolveEffectiveIntent)("balance_inquiry", "multi_branch_navigation")).toBe("multi_branch_navigation");
    });
    (0, vitest_1.it)("creates one semantic destination claim and keeps technical claims separate", () => {
        const destination = (0, scenario_functional_quality_1.extractRequirements)("El sistema debe redirigir al Portal.", []);
        const destinationClaims = (0, scenario_functional_quality_1.buildCanonicalClaims)(destination);
        (0, vitest_1.expect)(destination[0]?.facets).toEqual(["destination"]);
        (0, vitest_1.expect)(destinationClaims[0]).toMatchObject({ facet: "destination", claimType: "semantic_destination_assertion" });
        const technicalClaims = (0, scenario_functional_quality_1.buildCanonicalClaims)([{
                id: "route:1",
                requirementId: "route:1",
                sourceIssueKey: "",
                category: "action",
                sourceText: "runtime route",
                expectedBehavior: "runtime transition",
                facets: ["technical"],
            }]);
        (0, vitest_1.expect)(technicalClaims[0]).toMatchObject({ facet: "technical", claimType: "technical_route_step" });
    });
    (0, vitest_1.it)("keeps visibility claims when the same semantic text is also a destination", () => {
        const requirements = (0, scenario_functional_quality_1.extractRequirements)("El sistema debe redirigir al Portal y mostrar Portal.", []);
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)(requirements);
        (0, vitest_1.expect)(requirements.some((requirement) => requirement.category === "destination")).toBe(true);
        (0, vitest_1.expect)(requirements.some((requirement) => requirement.category === "visibility")).toBe(true);
        (0, vitest_1.expect)(claims.filter((claim) => claim.facet === "visibility")).toHaveLength(1);
    });
    (0, vitest_1.it)("keeps visibility claims independent across branch identities", () => {
        const branches = ["A", "B", "C"].map((label, index) => ({
            branchId: `branch-${index}`,
            sourceLabel: "Portal",
            sourceRequirementId: `option:${index + 1}`,
            actionIntent: "select_option",
            expectedDestination: "Portal",
            accessIntent: "unknown",
            evidenceSource: "user_story",
        }));
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)((0, scenario_functional_quality_1.extractRequirements)("", branches));
        (0, vitest_1.expect)(claims.filter((claim) => claim.facet === "visibility")).toHaveLength(3);
    });
    (0, vitest_1.it)("extracts structured alternatives and expands shared outcomes", () => {
        const optionFlows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(STRUCTURED_MENU_HU);
        const visibleOptions = optionFlows.map((flow) => flow.optionLabel);
        (0, vitest_1.expect)(visibleOptions).toHaveLength(5);
        (0, vitest_1.expect)(optionFlows).toHaveLength(5);
        (0, vitest_1.expect)(optionFlows.slice(0, 4).map((flow) => flow.expectedResult)).toEqual([
            "resultado intermedio",
            "resultado intermedio",
            "resultado intermedio",
            "resultado intermedio",
        ]);
        (0, vitest_1.expect)(optionFlows[4]?.expectedResult).toBe("resultado final diferente");
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(STRUCTURED_MENU_HU, visibleOptions, [], optionFlows);
        (0, vitest_1.expect)(branches).toHaveLength(5);
        (0, vitest_1.expect)(new Set(branches.map((branch) => branch.branchId)).size).toBe(5);
        (0, vitest_1.expect)(branches.every((branch) => branch.accessIntent === "unknown")).toBe(true);
    });
    (0, vitest_1.it)("does not turn an informational list into selectable flows", () => {
        const optionFlows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(`Elementos informativos:\n- Tema A: descripción\n- Tema B: descripción`);
        (0, vitest_1.expect)(optionFlows).toHaveLength(0);
    });
    (0, vitest_1.it)("recognizes an introductory selection list with later shared outcome evidence", () => {
        const optionFlows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(REAL_SHAPE_SYNTHETIC_HU);
        (0, vitest_1.expect)(optionFlows).toHaveLength(3);
        (0, vitest_1.expect)(new Set(optionFlows.map((flow) => flow.optionLabel)).size).toBe(3);
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(REAL_SHAPE_SYNTHETIC_HU, optionFlows.map((flow) => flow.optionLabel), [], optionFlows);
        (0, vitest_1.expect)(branches).toHaveLength(3);
        (0, vitest_1.expect)(new Set(branches.map((branch) => branch.branchId)).size).toBe(3);
        (0, vitest_1.expect)(new Set(branches.map((branch) => branch.expectedDestination)).size).toBe(1);
    });
    (0, vitest_1.it)("keeps one canonical Jira-shaped HU representation through the local pipeline", () => {
        const issue = {
            key: "GENERIC-STRUCTURED",
            summary: "Seleccionar una alternativa desde la pantalla",
            description: "Al seleccionar una alternativa, el sistema muestra el resultado correspondiente:\n- \"Alternativa A\", \"Alternativa B\", \"Alternativa C\": resultado intermedio\n- \"Alternativa D\": resultado final",
            acceptanceCriteria: "Cada alternativa seleccionada debe reflejar su resultado.",
            labels: [],
            components: [],
            status: "Open",
            issueType: "Story",
        };
        const context = (0, canonical_hu_context_1.buildCanonicalHuContext)(issue);
        const optionFlows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(context.text);
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(context.text, optionFlows.map((flow) => flow.optionLabel), [], optionFlows);
        const requirements = (0, scenario_functional_quality_1.buildRequirementManifest)(context.text, branches);
        (0, vitest_1.expect)(context.sourceFields).toEqual(["summary", "description", "acceptanceCriteria"]);
        (0, vitest_1.expect)(context.text).toContain("Alternativa A");
        (0, vitest_1.expect)(optionFlows).toHaveLength(4);
        (0, vitest_1.expect)(branches).toHaveLength(4);
        (0, vitest_1.expect)((0, scenario_preview_service_1.resolveEffectiveIntent)("balance_inquiry", "multi_branch_navigation")).toBe("multi_branch_navigation");
        (0, vitest_1.expect)(requirements.filter((requirement) => requirement.category === "branch")).toHaveLength(4);
        const validScenarios = branches.map((branch) => (0, scenario_preview_service_1.applyWebRuntimeReadiness)({
            semanticValidity: "valid",
            mcpExecutable: true,
            functionalBranch: { branchId: branch.branchId },
            stepRequirementRefs: [{ stepIndex: 0, requirementId: branch.sourceRequirementId ?? branch.branchId }],
            stepAuthority: [],
        }));
        (0, vitest_1.expect)(validScenarios.every((scenario) => scenario.executionReadiness === "requires_route_discovery")).toBe(true);
    });
    vitest_1.it.each([
        {
            name: "plain markdown",
            issue: {
                summary: "Seleccionar una alternativa",
                description: "Al seleccionar una alternativa:\n- Opcion Uno: Resultado compartido\n- Opcion Dos: Resultado compartido\n- Opcion Tres: Resultado final",
                acceptanceCriteria: "Cada resultado debe mostrarse.",
            },
        },
        {
            name: "array fields",
            issue: {
                summary: "Seleccionar una alternativa",
                description: ["Al seleccionar una alternativa:", "- Opcion Uno: Resultado compartido", "- Opcion Dos: Resultado final"],
                acceptanceCriteria: ["Cada resultado debe mostrarse."],
            },
        },
        {
            name: "ADF-like nested list",
            issue: {
                summary: { type: "paragraph", content: [{ type: "text", text: "Seleccionar una alternativa" }] },
                description: {
                    type: "doc",
                    content: [
                        { type: "paragraph", content: [{ type: "text", text: "Al seleccionar una alternativa:" }] },
                        { type: "bulletList", content: [
                                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Opcion Uno: Resultado compartido" }] }] },
                                { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Opcion Dos: Resultado final" }] }] },
                            ] },
                    ],
                },
                acceptanceCriteria: null,
            },
        },
    ])("normalizes Jira field shape: $name", ({ issue }) => {
        const context = (0, canonical_hu_context_1.buildCanonicalHuContext)({
            key: "GENERIC-SHAPE",
            summary: issue.summary,
            description: issue.description,
            acceptanceCriteria: issue.acceptanceCriteria,
            labels: [], components: [], status: "Open", issueType: "Story",
        });
        const flows = (0, scenario_preview_service_1.extractStructuredOptionFlows)(context.text);
        const branches = (0, scenario_preview_service_1.extractFunctionalBranchesFromHu)(context.text, flows.map((flow) => flow.optionLabel), [], flows);
        const requirements = (0, scenario_functional_quality_1.buildRequirementManifest)(context.text, branches);
        (0, vitest_1.expect)(context.normalizedLineCount).toBeGreaterThan(0);
        (0, vitest_1.expect)(flows.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(branches.length).toBe(flows.length);
        (0, vitest_1.expect)(requirements.filter((requirement) => requirement.category === "branch").length).toBe(flows.length);
    });
});
