import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGeneratedJiraSuite, type JiraGenerationEvaluationInput } from "./jira-generation-evaluation";
import type { JiraIssueSource } from "../scenarios/scenario-types";

function fixture(submit: string, result: string): JiraGenerationEvaluationInput {
  return {
    issues: [{ key: "EVAL-1", summary: "Resultado observable", description: `AC1: Al presionar "${submit}" se muestra "${result}".`,
      acceptanceCriteria: null, labels: [], components: [], status: "Open", issueType: "Story" } as JiraIssueSource],
    scenarios: [{ sourceIssueKey: "EVAL-1", acceptanceCriteriaRefs: ["AC1.1"], title: "Resultado",
      steps: ['Abrir la aplicación configurada del proyecto', `Presionar "${submit}"`, `Validar que se muestre "${result}"`], expectedResult: result }],
    expectations: [{ issueKey: "EVAL-1", criterionId: "AC1.1", allStepPatterns: [`^Presionar "${submit}"`, `^Validar que se muestre "${result}"`] }],
  };
}

test("generation evaluation checks source evidence independently of declared refs, titles and result prose", () => {
  for (const [submit, result] of [["Procesar", "Confirmado"], ["Solicitar", "Registrado"]]) {
    const input = fixture(submit, result);
    assert.equal(evaluateGeneratedJiraSuite(input).evaluationPassed, true);
    const weak = { ...input, scenarios: input.scenarios.map(scenario => ({ ...scenario,
      steps: ['Abrir la aplicación configurada del proyecto', `Presionar "${submit}"`] })) };
    assert.equal(evaluateGeneratedJiraSuite(weak).evaluationPassed, false, "ref and prose cannot substitute the fixture's required assertion");
    const wrong = { ...input, scenarios: input.scenarios.map(scenario => ({ ...scenario, acceptanceCriteriaRefs: ["AC99.1"] })) };
    assert.equal(evaluateGeneratedJiraSuite(wrong).evaluationPassed, false);
    assert.equal(evaluateGeneratedJiraSuite({ ...input, expectations: [] }).evaluationPassed, false,
      "a suite without independent expectations cannot claim evaluation success");
  }
});

test("evaluation keeps rejection checks distinct from positive outcomes and never publishes runtime values", () => {
  const input = fixture("Enviar", "Rechazado");
  input.expectations![0].forbiddenStepPatterns = ['^Validar que se muestre "Confirmado"'];
  assert.equal(evaluateGeneratedJiraSuite(input).evaluationPassed, true);
  input.scenarios[0].steps = [...input.scenarios[0].steps as string[], 'Validar que se muestre "Confirmado"'];
  input.scenarios[0].runtimeValues = { password: "synthetic-not-for-report" };
  const report = evaluateGeneratedJiraSuite(input);
  assert.equal(report.evaluationPassed, false);
  assert.equal(report.semanticCertification, "not_performed");
  assert.equal(JSON.stringify(report).includes("synthetic-not-for-report"), false);
});

test("every source criterion needs its own passing independent expectation", () => {
  const first = fixture("Procesar", "Confirmado");
  const second = fixture("Solicitar", "Registrado");
  second.issues[0].key = "EVAL-2";
  second.scenarios[0].sourceIssueKey = "EVAL-2";
  second.expectations![0].issueKey = "EVAL-2";
  const suite = { issues: [...first.issues, ...second.issues], scenarios: [...first.scenarios, ...second.scenarios],
    expectations: first.expectations };
  assert.equal(evaluateGeneratedJiraSuite(suite).evaluationPassed, false);
  assert.deepEqual(evaluateGeneratedJiraSuite(suite).independentlyUncheckedCriteria, [{ issueKey: "EVAL-2", criterionId: "AC1.1" }]);
  assert.equal(evaluateGeneratedJiraSuite({ ...suite, expectations: [...first.expectations!, ...second.expectations!] }).evaluationPassed, true);
});
