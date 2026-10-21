import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverJiraScenario, type JiraDiscoveredExecutionContract, type JiraScenarioInput } from './jira-semantic-executor';
import { deriveJiraInputRequirements } from './jira-input-requirements';
import { buildJiraLearnedRoute, persistValidatedJiraDiscoveryRoute } from './jira-knowledge-learning';

test('Discovery-to-learning keeps structured field bindings without values or selectors', async () => {
  for(const appSlug of ['app-one','app-two']) {
    const steps=['Abrir la aplicación configurada del proyecto','Ingresar usuario en "Usuario"',
      'Ingresar contraseña en "Contraseña"','Presionar "Transferencias"','Validar que se muestre "Comprobante"'];
    const scenario: JiraScenarioInput={scenarioId:'S1',sourceIssueKey:'HU-1',title:'Transferencia',steps,
      expectedResult:'Comprobante',inputRequirements:deriveJiraInputRequirements(steps,undefined)};
    const discovery=await discoverJiraScenario(scenario,{async navigate(){},async act(){return {strategy:'css',value:'#synthetic-control'};},
      async assert(target){return {observedText:target};}},Object.fromEntries(scenario.inputRequirements!.map(f=>[f.key,'synthetic-secret'])));
    const route=buildJiraLearnedRoute({scenario,discovery,appSlug,profileRevision:'rev1',jobId:'J1',evidenceRefs:['step-4.png']});
    assert.ok(route);
    assert.equal(route.appSlug,appSlug);
    assert.equal(route.actions.filter(a=>a.action==='fill').length,2);
    assert.ok(route.actions.filter(a=>a.action==='fill').every(a=>!!a.dataRef));
    assert.doesNotMatch(JSON.stringify(route),/synthetic-secret|synthetic-control/);
    const learnedWithDiscoveryResolution=buildJiraLearnedRoute({scenario:{...scenario,
      unresolvedUiRequirements:[{stepIndex:4,requirement:'Discovery must resolve this target.'}]},
      discovery,appSlug,profileRevision:'rev1',jobId:'J1',evidenceRefs:['step-4.png']});
    assert.ok(learnedWithDiscoveryResolution, 'a validated executed plan can resolve draft UI requirements');
    assert.ok(learnedWithDiscoveryResolution.actions.some(action=>action.action==='click'&&action.field==='Transferencias'));
    const smsDiscovery = { ...discovery, plan: { ...discovery.plan, steps: discovery.plan.steps.map(step =>
      step.action === 'click' && step.description === 'Presionar "Transferencias"'
        ? { ...step, description: 'Solicitar el código por SMS' }
        : step) } };
    const smsLearned = buildJiraLearnedRoute({ scenario, discovery: smsDiscovery, appSlug,
      profileRevision: 'rev1', jobId: 'J1', evidenceRefs: ['step-4.png'] });
    assert.ok(smsLearned?.actions.some(action => action.action === 'click' && action.field === 'código por SMS'),
      'an executed semantic click whose verb is not recognized by the general parser should still be learnable');
    assert.equal(buildJiraLearnedRoute({scenario,discovery,appSlug,profileRevision:'rev1',jobId:'J1',evidenceRefs:[]}),undefined);
    assert.equal(buildJiraLearnedRoute({scenario,discovery:{...discovery,plan:{...discovery.plan,status:'invalid'}},
      appSlug,profileRevision:'rev1',jobId:'J1',evidenceRefs:['step-4.png']}),undefined);
  }
});

test('validated Discovery persists its route before spec promotion is required', async () => {
  const steps = ['Abrir la aplicación configurada del proyecto', 'Presionar "Transferencias"'];
  const scenario: JiraScenarioInput = { scenarioId: 'S-LEARN', sourceIssueKey: 'HU-LEARN', title: 'Navigate transfer', steps, expectedResult: 'Transfer navigation is available' };
  const discovery: JiraDiscoveredExecutionContract = {
    plan: { version: '1.0', source: 'discovery_generated', status: 'validated', scenario: { source: 'jira', title: scenario.title },
      requiredData: [], steps: [
        { index: 1, action: 'navigate', target: 'APP_BASE_URL', description: steps[0] },
        { index: 2, action: 'click', target: { strategy: 'css', value: '#observed-action' }, description: 'Presionar "Transferencias"' },
      ], createdAt: new Date(0).toISOString() },
    sourceScenario: {}, runtimeEntries: [],
  };
  const persisted: Array<{ appSlug: string; scenarioId: string }> = [];
  const result = await persistValidatedJiraDiscoveryRoute({ scenario, discovery, appSlug: 'app-one', profileRevision: 'rev1',
    jobId: 'J-LEARN', evidenceRefs: ['step-2.png'] }, async route => {
    persisted.push({ appSlug: route.appSlug, scenarioId: route.scenarioId });
  });
  assert.deepEqual(result, { status: 'persisted', actions: 2 });
  assert.deepEqual(persisted, [{ appSlug: 'app-one', scenarioId: 'S-LEARN' }]);
});
