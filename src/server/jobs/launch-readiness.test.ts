import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { buildDiscoveryBatchParamsFromLaunch, classifyLaunchScenarioAuthority, classifyRouteDiscoveryEligibility, partitionLaunchScenarios } from "./launch-orchestrator";
import { extractLaunchScenariosFromPayload } from "../routes/runs";
import {isScenarioEligibleForEngine,resolveExecutionEngine} from '../../jira/execution-origin';
import {deriveJiraInputRequirements} from '../../jira/jira-input-requirements';
import type {JiraScenarioInput} from '../../jira/jira-semantic-executor';

test('edited Jira input keys survive route normalization and the execution job handoff',()=>{
 const scenarioId='HU-7:jira:1:edited-abcdef';
 const steps=['Ingresar un dato válido en "Referencia"','Seleccionar una opción en "Producto"'];
 const inputRequirements=deriveJiraInputRequirements(steps).map((field,index)=>({...field,key:`jira_edit_revision_${index+1}`}));
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const scenarios=extractLaunchScenariosFromPayload({selectedScenarios:[{scenarioId,sourceIssueKey:'HU-7',title:'Edición',steps,preconditions:[],expectedResult:'Resultado',inputRequirements,validation:{valid:true}}]});
  assert.deepEqual((scenarios[0] as unknown as JiraScenarioInput).inputRequirements,inputRequirements);
  const dataOverrides={[scenarioId]:{jira_edit_revision_1:'synthetic-reference',jira_edit_revision_2:'synthetic-product'}};
  const handoff=buildDiscoveryBatchParamsFromLaunch({launch:{appSlug,selectedScenarios:scenarios,dataOverrides,executionEngine:'jira_semantic',scenarioOrigin:{kind:'jira_generated',jiraKey:'HU-7'}},executionCaseIds:[],publishedCases:[],launchId:'fixture-launch'});
  const [execution]=JSON.parse(JSON.stringify(handoff.jiraSemanticScenarios)) as JiraScenarioInput[];
  const derived=deriveJiraInputRequirements(execution.steps,execution.inputRequirements);
  assert.deepEqual(derived.map(field=>field.key),inputRequirements.map(field=>field.key));
  assert.ok(derived.every(field=>Boolean((handoff.dataOverrides as typeof dataOverrides)[scenarioId][field.key as keyof typeof dataOverrides[typeof scenarioId]])));
 }
});

test('Jira generation findings survive normalization without blocking scenario review or launch',()=>{
 const [scenario]=extractLaunchScenariosFromPayload({selectedScenarios:[{
  scenarioId:'HU-8:jira:1',sourceIssueKey:'HU-8',title:'Filtrar solicitudes',steps:['Validar que las solicitudes correspondan al estado seleccionado'],
  preconditions:[],expectedResult:'',validation:{valid:false,errors:['JIRA_FILTER_TEST_DATA_UNSPECIFIED']},
 }]});
 assert.deepEqual(scenario.validation,{valid:false,errors:['JIRA_FILTER_TEST_DATA_UNSPECIFIED']});
 assert.equal(isScenarioEligibleForEngine('jira_semantic',scenario),true);
 assert.equal(isScenarioEligibleForEngine('recording_replay',{...scenario,mcpExecutable:true,validation:{valid:true,errors:['SOME_OTHER_WARNING']}}),true);
 assert.equal(isScenarioEligibleForEngine('jira_semantic',{...scenario,validation:{valid:false,errors:['JIRA_ASSERTION_CAPABILITY_UNSUPPORTED']}}),true);
 const partition=partitionLaunchScenarios([{...scenario,launchClassification:'adaptive',mcpExecutable:false}], 'jira_semantic');
 assert.equal(partition.standard.length,1);
 assert.equal(partition.nonAutomatable.length,0);
});

test('explicit Jira provenance admits valid pending scenarios for publication without adaptive or runtime certification',()=>{
 for(const appSlug of ['fixture-shop','fixture-service']) {
  const scenarios=extractLaunchScenariosFromPayload({selectedScenarios:[{scenarioId:'HU-7:jira:1',sourceIssueKey:'HU-7',title:'Pending',steps:['Validar "Result"'],preconditions:[],expectedResult:'Result',validation:{valid:true},mcpExecutable:false,executionReadiness:'requires_discovery'}]});
  const engine=resolveExecutionEngine({executionEngine:'jira_semantic',scenarioOrigin:{kind:'jira_generated',jiraKey:'HU-7'},jiraKey:'HU-7',scenarios});
  const partition=partitionLaunchScenarios(scenarios,engine);
  assert.equal(partition.standard.length,1,appSlug);
  assert.equal(partition.adaptiveFunctional.length,0);
  assert.equal(partition.routeDiscovery.length,0);
  assert.equal(partition.standard[0].mcpExecutable,false);
  assert.equal(partitionLaunchScenarios(scenarios).adaptiveFunctional.length,1);
  assert.equal(partitionLaunchScenarios([{...scenarios[0],validation:{valid:false}}],engine).standard.length,1);
  assert.equal(partitionLaunchScenarios([{...scenarios[0],validation:undefined}],engine).standard.length,1);
  assert.throws(()=>resolveExecutionEngine({executionEngine:'jira_semantic',scenarioOrigin:{kind:'jira_generated',jiraKey:'OTHER-1'},scenarios}),/PROVENANCE_MISMATCH/);
  const recorded=extractLaunchScenariosFromPayload({selectedScenarios:[{...scenarios[0],recordingId:'fixture-recording'}]});
  assert.throws(()=>resolveExecutionEngine({executionEngine:'jira_semantic',scenarioOrigin:{kind:'jira_generated',jiraKey:'HU-7'},scenarios:recorded}),/RECORDING_CANNOT_USE_JIRA_ENGINE/);
 }
});

describe("launch readiness authority", () => {
  test("keeps explicit false and route discovery adaptive", () => {
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: false, executionReadiness: "requires_route_discovery" }), "adaptive");
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: true, executionReadiness: "standard" }), "standard");
  });

  test("does not elevate missing authority or publication metadata", () => {
    assert.equal(classifyLaunchScenarioAuthority({ mcpExecutable: undefined, executionReadiness: undefined }), "adaptive");
    const [scenario] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "A", title: "adaptive", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", publicationClassification: "documentation", nonAutomatable: true }] });
    assert.equal(scenario.mcpExecutable, false);
    assert.equal(scenario.executionReadiness, "requires_route_discovery");
    assert.equal(scenario.publicationClassification, "documentation");
  });

  test("replay fixture remains 2 standard and 2 adaptive", () => {
    const fixture = [
      { mcpExecutable: true, executionReadiness: "standard" },
      { mcpExecutable: true, executionReadiness: "standard" },
      { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
      { mcpExecutable: false, executionReadiness: "requires_route_discovery" },
    ];
    const classifications = fixture.map(classifyLaunchScenarioAuthority);
    assert.equal(classifications.filter((value) => value === "standard").length, 2);
    assert.equal(classifications.filter((value) => value === "adaptive").length, 2);
  });

  test("separates route discovery from functional adaptive execution", () => {
    const routePending = {
      scenarioId: "S3",
      title: "route pending",
      steps: ["click entry"],
      expectedResult: "screen",
      preconditions: [],
      mcpExecutable: false,
      executionReadiness: "requires_route_discovery",
      semanticValidity: "valid",
      functionalBranch: { branchId: "BR-1" },
    };
    assert.deepEqual(classifyRouteDiscoveryEligibility(routePending), { allowed: true, reasonCode: "requires_route_discovery" });
    const groups = partitionLaunchScenarios([
      { ...routePending, scenarioId: "S1", mcpExecutable: true, executionReadiness: "standard" },
      { ...routePending, scenarioId: "S2", mcpExecutable: true, executionReadiness: "standard" },
      routePending,
      { ...routePending, scenarioId: "S4", functionalBranch: undefined },
    ]);
    assert.equal(groups.standard.length, 2);
    assert.equal(groups.routeDiscovery.length, 1);
    assert.equal(groups.adaptiveFunctional.length, 1);
    assert.equal(groups.routeDiscovery[0].mcpExecutable, false);
    assert.equal(groups.standard.length + groups.routeDiscovery.length, 3);
  });

  test("rejects discovery without structured lineage or with non-automatable authority", () => {
    const base = { executionReadiness: "requires_route_discovery", semanticValidity: "valid" } as const;
    assert.equal(classifyRouteDiscoveryEligibility(base).reasonCode, "missing_structured_lineage");
    assert.equal(classifyRouteDiscoveryEligibility({ ...base, functionalBranch: { branchId: "BR-1" }, nonAutomatable: true }).reasonCode, "non_automatable");
    assert.equal(classifyRouteDiscoveryEligibility({ ...base, functionalBranch: { branchId: "BR-1" }, validation: { valid: false } }).reasonCode, "semantic_scenario_invalid");
  });

  test("preserves direct and metadata lineage through backend normalization", () => {
    const [direct] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "S3", title: "direct", steps: [], preconditions: [], expectedResult: "", mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-1", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-1" }] }] });
    const [metadata] = extractLaunchScenariosFromPayload({ selectedScenarios: [{ scenarioId: "S4", title: "metadata", steps: [], preconditions: [], expectedResult: "", metadata: { mcpExecutable: false, executionReadiness: "requires_route_discovery", semanticValidity: "valid", branchId: "BR-2", stepRequirementRefs: [{ stepIndex: 0, requirementId: "REQ-2" }] } }] });
    assert.equal(direct.mcpExecutable, false);
    assert.equal(direct.executionReadiness, "requires_route_discovery");
    assert.equal(direct.branchId, "BR-1");
    assert.equal(direct.stepRequirementRefs?.length, 1);
    assert.equal(metadata.branchId, "BR-2");
    assert.equal(metadata.stepRequirementRefs?.length, 1);
    assert.equal(classifyRouteDiscoveryEligibility(direct).allowed, true);
    assert.equal(classifyRouteDiscoveryEligibility(metadata).allowed, true);
  });
});
