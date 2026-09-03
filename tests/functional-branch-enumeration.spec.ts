import { describe, expect, it } from "vitest";
import { applyWebRuntimeReadiness, extractFunctionalBranchesFromHu, extractStructuredOptionFlows, resolveEffectiveIntent } from "../src/scenarios/scenario-preview.service";
import { buildCanonicalClaims, buildRequirementAccounting, buildRequirementManifest, extractRequirements } from "../src/scenarios/scenario-functional-quality";
import { buildCanonicalHuContext } from "../src/scenarios/canonical-hu-context";

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

describe("functional branch enumeration", () => {
  it("T1: 4 explicit options with same auth destination → 4 branches", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"],
      [],
      [],
    );
    expect(branches.length).toBeGreaterThanOrEqual(4);
    const branchIds = branches.map(b => b.branchId);
    const uniqueBranchIds = new Set(branchIds);
    expect(uniqueBranchIds.size).toBeGreaterThanOrEqual(4);
  });

  it("T2: text-only access evidence is fail-closed without collapsing branches", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos", "Explora nuestros productos"],
      [],
      [],
    );
    expect(branches.length).toBeGreaterThanOrEqual(5);
    expect(branches.every((branch) => branch.accessIntent === "unknown")).toBe(true);
  });

  it("T3: 2 members same destination → no dedup by destination", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance"],
      [],
      [],
    );
    const uniqueLabels = new Set(branches.map(b => b.sourceLabel));
    expect(uniqueLabels.size).toBe(2);
  });

  it("T4: accounting shows required=4 when only 1 scenario covers (with stepRequirementRefs)", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"],
      [],
      [],
    );
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
    const accounting = buildRequirementAccounting(scenarios as any, branches, HU_WITH_ENUMERATION);
    const branchReqs = accounting.requirements.filter(r => r.category === "branch");
    expect(branchReqs.length).toBeGreaterThanOrEqual(4);
    const covered = branchReqs.filter(r => r.status === "covered");
    expect(covered.length).toBe(1);
    const missing = branchReqs.filter(r => r.status === "incompleteRequirement");
    expect(missing.length).toBeGreaterThanOrEqual(3);
  });

  it("T5: accounting shows covered=4 when all 4 scenarios cover (with stepRequirementRefs)", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"],
      [],
      [],
    );
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
    const accounting = buildRequirementAccounting(scenarios as any, branches, HU_WITH_ENUMERATION);
    const branchReqs = accounting.requirements.filter(r => r.category === "branch");
    const covered = branchReqs.filter(r => r.status === "covered");
    expect(covered.length).toBeGreaterThanOrEqual(4);
  });

  it("T6: variable-size list works", () => {
    const branches2 = extractFunctionalBranchesFromHu(HU_WITH_ENUMERATION, ["A", "B"], [], []);
    const branches6 = extractFunctionalBranchesFromHu(HU_WITH_ENUMERATION, ["A", "B", "C", "D", "E", "F"], [], []);
    expect(new Set(branches2.map(b => b.branchId)).size).toBe(2);
    expect(new Set(branches6.map(b => b.branchId)).size).toBe(6);
  });

  it("T7: NFC/accents preserved in sourceLabel", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Canje de Puntos", "Consulta de balance"],
      [],
      [],
    );
    expect(branches.some(b => b.sourceLabel.includes("Canje"))).toBe(true);
    expect(branches.some(b => b.sourceLabel.includes("Consulta"))).toBe(true);
  });

  it("T8: no explicit list → no invented branches from visibleOptions", () => {
    const branches = extractFunctionalBranchesFromHu("Abrir la pantalla principal", [], [], []);
    expect(branches.length).toBe(0);
  });

  it("T9: same destination + different targetIdentity → no dedup", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Estados de cuenta", "Consulta de balance", "Cartas y certificaciones", "Canje de Puntos"],
      [],
      [],
    );
    const identities = branches.map(b => b.activation?.targetIdentity ?? "");
    const uniqueIdentities = new Set(identities);
    expect(uniqueIdentities.size).toBeGreaterThanOrEqual(4);
  });

  it("T10: no fixture literals in production logic (branchIdFromParts is generic)", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Alpha", "Beta", "Gamma"],
      [],
      [],
    );
    const ids = branches.map(b => b.branchId);
    expect(ids.some(id => id.includes("AA-88") || id.includes("Estados"))).toBe(false);
  });

  it("T11: text-only negative auth remains unknown", () => {
    const branches = extractFunctionalBranchesFromHu(
      HU_WITH_ENUMERATION,
      ["Explora nuestros productos"],
      [],
      [],
    );
    const explorBranch = branches.find(b => b.sourceLabel === "Explora nuestros productos");
    expect(explorBranch).toBeDefined();
    expect(explorBranch?.accessIntent).toBe("unknown");
  });

  it("structured final model intent replaces an early domain intent", () => {
    expect(resolveEffectiveIntent("balance_inquiry", "multi_branch_navigation")).toBe("multi_branch_navigation");
  });

  it("creates one semantic destination claim and keeps technical claims separate", () => {
    const destination = extractRequirements("El sistema debe redirigir al Portal.", []);
    const destinationClaims = buildCanonicalClaims(destination);
    expect(destination[0]?.facets).toEqual(["destination"]);
    expect(destinationClaims[0]).toMatchObject({ facet: "destination", claimType: "semantic_destination_assertion" });

    const technicalClaims = buildCanonicalClaims([{
      id: "route:1",
      requirementId: "route:1",
      sourceIssueKey: "",
      category: "action",
      sourceText: "runtime route",
      expectedBehavior: "runtime transition",
      facets: ["technical"],
    }]);
    expect(technicalClaims[0]).toMatchObject({ facet: "technical", claimType: "technical_route_step" });
  });

  it("keeps visibility claims when the same semantic text is also a destination", () => {
    const requirements = extractRequirements("El sistema debe redirigir al Portal y mostrar Portal.", []);
    const claims = buildCanonicalClaims(requirements);
    expect(requirements.some((requirement) => requirement.category === "destination")).toBe(true);
    expect(requirements.some((requirement) => requirement.category === "visibility")).toBe(true);
    expect(claims.filter((claim) => claim.facet === "visibility")).toHaveLength(1);
  });

  it("keeps visibility claims independent across branch identities", () => {
    const branches = ["A", "B", "C"].map((label, index) => ({
      branchId: `branch-${index}`,
      sourceLabel: "Portal",
      sourceRequirementId: `option:${index + 1}`,
      actionIntent: "select_option",
      expectedDestination: "Portal",
      accessIntent: "unknown" as const,
      evidenceSource: "user_story" as const,
    }));
    const claims = buildCanonicalClaims(extractRequirements("", branches));
    expect(claims.filter((claim) => claim.facet === "visibility")).toHaveLength(3);
  });

  it("extracts structured alternatives and expands shared outcomes", () => {
    const optionFlows = extractStructuredOptionFlows(STRUCTURED_MENU_HU);
    const visibleOptions = optionFlows.map((flow) => flow.optionLabel);
    expect(visibleOptions).toHaveLength(5);
    expect(optionFlows).toHaveLength(5);
    expect(optionFlows.slice(0, 4).map((flow) => flow.expectedResult)).toEqual([
      "resultado intermedio",
      "resultado intermedio",
      "resultado intermedio",
      "resultado intermedio",
    ]);
    expect(optionFlows[4]?.expectedResult).toBe("resultado final diferente");

    const branches = extractFunctionalBranchesFromHu(
      STRUCTURED_MENU_HU,
      visibleOptions,
      [],
      optionFlows,
    );
    expect(branches).toHaveLength(5);
    expect(new Set(branches.map((branch) => branch.branchId)).size).toBe(5);
    expect(branches.every((branch) => branch.accessIntent === "unknown")).toBe(true);
  });

  it("does not turn an informational list into selectable flows", () => {
    const optionFlows = extractStructuredOptionFlows(`Elementos informativos:\n- Tema A: descripción\n- Tema B: descripción`);
    expect(optionFlows).toHaveLength(0);
  });

  it("recognizes an introductory selection list with later shared outcome evidence", () => {
    const optionFlows = extractStructuredOptionFlows(REAL_SHAPE_SYNTHETIC_HU);
    expect(optionFlows).toHaveLength(3);
    expect(new Set(optionFlows.map((flow) => flow.optionLabel)).size).toBe(3);
    const branches = extractFunctionalBranchesFromHu(
      REAL_SHAPE_SYNTHETIC_HU,
      optionFlows.map((flow) => flow.optionLabel),
      [],
      optionFlows,
    );
    expect(branches).toHaveLength(3);
    expect(new Set(branches.map((branch) => branch.branchId)).size).toBe(3);
    expect(new Set(branches.map((branch) => branch.expectedDestination)).size).toBe(1);
  });

  it("keeps one canonical Jira-shaped HU representation through the local pipeline", () => {
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
    const context = buildCanonicalHuContext(issue);
    const optionFlows = extractStructuredOptionFlows(context.text);
    const branches = extractFunctionalBranchesFromHu(context.text, optionFlows.map((flow) => flow.optionLabel), [], optionFlows);
    const requirements = buildRequirementManifest(context.text, branches);

    expect(context.sourceFields).toEqual(["summary", "description", "acceptanceCriteria"]);
    expect(context.text).toContain("Alternativa A");
    expect(optionFlows).toHaveLength(4);
    expect(branches).toHaveLength(4);
    expect(resolveEffectiveIntent("balance_inquiry", "multi_branch_navigation")).toBe("multi_branch_navigation");
    expect(requirements.filter((requirement) => requirement.category === "branch")).toHaveLength(4);

    const validScenarios = branches.map((branch) => applyWebRuntimeReadiness({
      semanticValidity: "valid",
      mcpExecutable: true,
      functionalBranch: { branchId: branch.branchId },
      stepRequirementRefs: [{ stepIndex: 0, requirementId: branch.sourceRequirementId ?? branch.branchId }],
      stepAuthority: [],
    }));
    expect(validScenarios.every((scenario) => scenario.executionReadiness === "requires_route_discovery")).toBe(true);
  });

  it.each([
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
    const context = buildCanonicalHuContext({
      key: "GENERIC-SHAPE",
      summary: issue.summary as any,
      description: issue.description as any,
      acceptanceCriteria: issue.acceptanceCriteria as any,
      labels: [], components: [], status: "Open", issueType: "Story",
    });
    const flows = extractStructuredOptionFlows(context.text);
    const branches = extractFunctionalBranchesFromHu(context.text, flows.map((flow) => flow.optionLabel), [], flows);
    const requirements = buildRequirementManifest(context.text, branches);
    expect(context.normalizedLineCount).toBeGreaterThan(0);
    expect(flows.length).toBeGreaterThan(0);
    expect(branches.length).toBe(flows.length);
    expect(requirements.filter((requirement) => requirement.category === "branch").length).toBe(flows.length);
  });
});
