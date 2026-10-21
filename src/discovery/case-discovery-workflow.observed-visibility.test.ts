import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPromotionSourceScenario } from './case-discovery-workflow';
import { evaluatePromotionGate } from '../automations/promotion-gate';
import type { TestScenario } from '../types/testrail.types';
import type { CaseDiscoveryResult } from '../types/discovery.types';
import type { ExecutionPlan } from '../types/execution-plan.types';

function fixture(literal: string, observedAction = `El sistema muestra "${literal}"`, status = 'found') {
  const expected = `Se muestra "${literal}"`;
  const scenario = { source: 'testrail', externalId: 'fixture', caseId: 0, title: 'Fixture',
    steps: [{ index: 1, action: 'Presionar Iniciar', dataHints: [] }, { index: 2, action: observedAction, dataHints: [] }],
    raw: { custom_expected: expected } } as unknown as TestScenario;
  const plan = { version: '1.0', source: 'discovery_generated', status: 'validated', createdAt: new Date().toISOString(),
    scenario: { source: 'manual', externalId: 'fixture', title: 'Fixture' }, requiredData: [],
    steps: [{ index: 1, action: 'click', description: 'Iniciar', target: { strategy: 'text', value: 'Iniciar' } },
      { index: 2, action: 'assertVisible', description: observedAction, target: { strategy: 'text', value: literal } }] } as ExecutionPlan;
  const result = { version: '1.0', caseId: 0, caseTitle: 'Fixture', status: 'discovered_passed', discoveredAt: new Date().toISOString(),
    steps: [{ index: 2, action: 'assert', targetText: observedAction, status }], discoveredObjects: [], candidatePlan: plan } as unknown as CaseDiscoveryResult;
  return { scenario, result, plan, expected };
}

test('recorded observed visibility remains backed through narrative normalization and the promotion gate', () => {
  for (const literal of ['Ledger overview', 'Detalle de pedidos']) {
    const { scenario, result, plan, expected } = fixture(literal);
    const source = buildPromotionSourceScenario(scenario, result, { url: "https://fixture.invalid/done", capturedAt: new Date().toISOString(), elements: [] } as any);
    const oracle = source.observableOracles?.find((entry) => entry.requirement === expected);
    assert.equal(oracle?.type, 'literal_visible_text');
    assert.equal(oracle?.backed, true);
    assert.equal(oracle?.target, literal);
    assert.equal(oracle?.stepIndex, 2);
    const gate = evaluatePromotionGate({ discoveryResult: result, candidatePlan: plan, observableOracles: source.observableOracles });
    assert.equal(gate.allowed, true, gate.reasons.join('; '));
  }
});

test('a failed, absent, negative or different observed literal cannot back positive visibility', () => {
  for (const [action, status] of [
    ['El sistema muestra "Ledger overview"', 'not_found'],
    ['El sistema no muestra "Ledger overview"', 'found'],
    ['El sistema muestra "Other result"', 'found'],
  ]) {
    const { scenario, result, plan, expected } = fixture('Ledger overview', action, status);
    const source = buildPromotionSourceScenario(scenario, result, { url: "https://fixture.invalid/done", capturedAt: new Date().toISOString(), elements: [] } as any);
    assert.equal(source.observableOracles?.find((entry) => entry.requirement === expected)?.backed, false);
    assert.equal(evaluatePromotionGate({ discoveryResult: result, candidatePlan: plan, observableOracles: source.observableOracles }).allowed, false);
  }
});
