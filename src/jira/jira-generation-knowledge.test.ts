import test from 'node:test';
import assert from 'node:assert/strict';
import { jiraGenerationKnowledge, resolveJiraGenerationKnowledge } from './jira-generation-knowledge';
import { buildJiraScenarioMessages, executableCoverageCandidates, journeyContext, jiraNavigationMissing, materializeJiraNavigation } from './jira-scenario-generator';
import type { JiraIssueSource } from '../scenarios/scenario-types';

test('a new project has no historical navigation; other engines/projects/revisions are excluded', () => {
  const issue: JiraIssueSource = {key:'HU-1',summary:'Transferencias',description:'Gestionar Transferencias',acceptanceCriteria:null,
    labels:[],components:[],status:'Open',issueType:'Story'};
  const route = {schemaVersion:1 as const,engine:'jira_semantic' as const,appSlug:'app-one',id:'fixture',profileRevision:'rev1',
    sourceIssueKey:'HU-0',scenarioId:'S1',jobId:'J1',validatedAt:'2026-10-11T12:00:00Z',startsFrom:'project_entry' as const,
    actions:[{action:'click' as const,field:'Transferencias'}],evidenceRefs:['step-2.png']};
  const now=Date.parse('2026-10-11T13:00:00Z');
  assert.deepEqual(jiraGenerationKnowledge('app-one',[issue],[],'rev1',now)[0].routes,[]);
  assert.equal(jiraGenerationKnowledge('app-one',[issue],[route],'rev1',now)[0].routes.length,1);
  for (const rejected of [{...route,appSlug:'app-two'},{...route,profileRevision:'rev0'},
    {...route,validatedAt:'2026-08-01T12:00:00Z'}, {...route,evidenceRefs:[]}, {...route,invalidatedAt:'2026-10-11T12:30:00Z'},
    {...route,engine:'recording_replay' as 'jira_semantic'}]) {
    assert.deepEqual(jiraGenerationKnowledge('app-one',[issue],[rejected],'rev1',now)[0].routes,[]);
  }
  const messages=buildJiraScenarioMessages([issue],'app-one',[route],'rev1');
  assert.ok(JSON.parse(messages[1].content).learnedNavigation);
});

test('knowledge preserves field positions between repeated submits without exposing prior data bindings',()=>{
 for(const appSlug of ['enterprise-fixture','personal-fixture']){
  const issue={key:'HU-42',summary:'Acceso',description:'Acceso',acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'};
  const actions=[{action:'fill' as const,field:'Password',dataRef:'old.secret',value:'synthetic-private-value'},
   {action:'click' as const,field:'Continue'},{action:'fill' as const,field:'Access code',dataRef:'old.invalidCode'},
   {action:'click' as const,field:'Continue'},{action:'press' as const,field:'Sensitive keypad',key:'7'}];
  const route={schemaVersion:1 as const,engine:'jira_semantic' as const,appSlug,id:'fixture',profileRevision:'rev',sourceIssueKey:issue.key,scenarioId:'S',jobId:'J',validatedAt:'2026-10-19T12:00:00Z',startsFrom:'project_entry' as const,actions,evidenceRefs:['observed.png']};
  const knowledge=jiraGenerationKnowledge(appSlug,[issue],[route],'rev',Date.parse('2026-10-19T13:00:00Z'));
  assert.deepEqual(knowledge[0].routes[0].actions,actions.map(({action,field})=>({action,field})));
  assert.doesNotMatch(JSON.stringify(knowledge),/old.secret|old.invalidCode|synthetic-private-value|dataRef|value/);
  assert.doesNotMatch(JSON.stringify(knowledge),/"key":"7"/);
 }
});

test('sibling routes matching only a shared ambiguous click label are excluded; uniquely identified routes are kept', () => {
  const base = {schemaVersion:1 as const,engine:'jira_semantic' as const,appSlug:'app-x',profileRevision:'rev1',
    jobId:'job',validatedAt:'2026-10-15T12:00:00.000Z',startsFrom:'project_entry' as const,evidenceRefs:['step-1.png']};
  const loan = {...base,id:'loan',sourceIssueKey:'HU-LOAN',scenarioId:'HU-LOAN:jira:1',actions:[
    {action:'click' as const,field:'Solicitar préstamo'},{action:'click' as const,field:'Continuar'}]};
  const other = {...base,id:'other',sourceIssueKey:'HU-OTHER',scenarioId:'HU-OTHER:jira:1',actions:[
    {action:'click' as const,field:'Pagar servicio'},{action:'click' as const,field:'Continuar'}]};
  const now = Date.parse('2026-10-15T13:00:00.000Z');
  const issue = (key: string, summary: string, description: string): JiraIssueSource => ({key,summary,description,acceptanceCriteria:null,
    labels:[],components:[],status:'Open',issueType:'Story'});
  const transfer = issue('HU-TRF','Transferencia entre cuentas','El usuario revisa y pulsa Continuar para autorizar.');
  assert.deepEqual(jiraGenerationKnowledge('app-x',[transfer],[loan,other],'rev1',now)[0].routes,[]);
  const loanStory = issue('HU-NEW','Préstamos','El usuario entra a Solicitar préstamo y pulsa Continuar.');
  const kept = jiraGenerationKnowledge('app-x',[loanStory],[loan,other],'rev1',now)[0].routes;
  assert.deepEqual(kept.map(route => route.sourceIssueKey),['HU-LOAN']);
  // Same-story route keeps priority over a uniquely identified sibling.
  const same = {...other,id:'same',sourceIssueKey:'HU-NEW',actions:[{action:'click' as const,field:'Mi ruta propia'}]};
  assert.deepEqual(jiraGenerationKnowledge('app-x',[loanStory],[loan,other,same],'rev1',now)[0].routes.map(route => route.sourceIssueKey),['HU-NEW']);
});

test('sibling transfer route is eligible despite morphological label variation and is cut before unrelated clicks; loan route stays excluded', () => {
  const base = {schemaVersion:1 as const,engine:'jira_semantic' as const,appSlug:'app-y',profileRevision:'rev1',
    jobId:'job',validatedAt:'2026-10-15T12:00:00.000Z',startsFrom:'project_entry' as const,evidenceRefs:['step-1.png']};
  const route = (id: string, key: string, labels: string[]) => ({...base,id,sourceIssueKey:key,scenarioId:`${key}:jira:1`,
    actions:labels.map(field => ({action:'click' as const,field}))});
  // Menu entry repeated at the start of several sibling routes is one destination, not an ambiguity.
  const routes = [route('t1','AA-96',['Transferencias','Continuar']), route('t2','AA-97',['Transferencias','Autorizar']),
    route('l1','AA-50',['Solicitar préstamo','Continuar'])];
  const story: JiraIssueSource = {key:'AA-104',summary:'Datos de la transferencia',description:'El usuario valida los datos de la transferencia.',
    acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'};
  const kept = jiraGenerationKnowledge('app-y',[story],routes,'rev1',Date.parse('2026-10-15T13:00:00.000Z'))[0].routes;
  assert.ok(kept.length >= 1 && kept.every(item => item.sourceIssueKey !== 'AA-50'));
  assert.ok(kept.every(item => item.actions.length === 1 && item.actions[0].field === 'Transferencias'));
  // Another project's identical-looking story gets nothing from this project's routes.
  assert.deepEqual(jiraGenerationKnowledge('app-z',[story],routes,'rev1',Date.parse('2026-10-15T13:00:00.000Z'))[0].routes,[]);
});

test('a protected-screen assertion right after opening the app is blocked unless the profile is no_login, gate observation, or navigation exists', () => {
  const open = 'Abrir la aplicación configurada del proyecto';
  const direct = [open, 'Validar que se muestre "Datos de la transferencia"'];
  assert.equal(jiraNavigationMissing({}, direct, 'password'), true);
  assert.equal(jiraNavigationMissing({}, direct, 'manual'), true);
  assert.equal(jiraNavigationMissing({}, direct, 'no_login'), false);
  assert.equal(jiraNavigationMissing({}, direct, undefined), false);
  assert.equal(jiraNavigationMissing({authIntent:'gate_observation'}, direct, 'password'), false);
  assert.equal(jiraNavigationMissing({}, [open, 'Presionar "Transferencias"', direct[1]], 'password'), false);
  assert.equal(jiraNavigationMissing({}, [open, 'Validar que se muestre la pantalla de autenticación'], 'password'), false);
});

test('after authenticating, only area navigation (not login/OTP/generic controls) reaches a functional screen; proven routes are materialized', () => {
  const open = 'Abrir la aplicación configurada del proyecto';
  const login = [open, 'Presionar "Empresarial"', 'Presionar "Iniciar sesión"', 'Presionar "Solicitar código SMS"',
    'Ingresar el código de acceso', 'Presionar "Iniciar sesión"'];
  const assertion = 'Validar que se muestre "Datos de la transferencia"';
  const story = 'Datos de la transferencia entre cuentas';
  for (const mode of ['password', 'manual']) {
    assert.equal(jiraNavigationMissing({}, [...login, assertion], mode, story), true);
    // Generic shared control is not a route to the area.
    assert.equal(jiraNavigationMissing({}, [...login, 'Presionar "Continuar"', assertion], mode, story), true);
    assert.equal(jiraNavigationMissing({}, [...login, 'Presionar "Transferencias"', assertion], mode, story), false);
  }
  assert.equal(jiraNavigationMissing({}, [...login, assertion], 'no_login', story), false);
  assert.equal(jiraNavigationMissing({authIntent:'gate_observation'}, [...login, assertion], 'password', story), false);

  const routeFor = (field: string) => [{actions:[{action:'click',field:'Empresarial'},{action:'click',field:'Iniciar sesión'},{action:'click',field:field},{action:'click',field:'Continuar'}]}];
  // Proven route for the same area: materialized after login, auth labels and generic controls excluded.
  const fixed = materializeJiraNavigation([...login, assertion], routeFor('Transferencias'), story);
  assert.deepEqual(fixed, [...login, 'Presionar "Transferencias"', assertion]);
  assert.equal(jiraNavigationMissing({}, fixed, 'password', story), false);
  // Another profile whose proven route is for a different area (or only generic) gives nothing: still blocked.
  for (const route of [routeFor('Solicitar préstamo'), [{actions:[{action:'click',field:'Continuar'}]}], []]) {
    const same = materializeJiraNavigation([...login, assertion], route, story);
    assert.deepEqual(same, [...login, assertion]);
    assert.equal(jiraNavigationMissing({}, same, 'password', story), true);
  }
});

test('journey context realigns inputRequirements to learned navigation; without observed navigation the candidate stays blocked', async () => {
  const issue: JiraIssueSource = {key:'AA-97',summary:'Datos de la transferencia entre cuentas',description:'Ingresar el monto.',acceptanceCriteria:null,
    labels:[],components:[],status:'Open',issueType:'Story'};
  const steps = ['Abrir la aplicación configurada del proyecto', 'Presionar "Empresarial"', 'Presionar "Iniciar sesión"', 'Presionar "Solicitar código SMS"',
    'Ingresar el código de acceso', 'Presionar "Iniciar sesión"', 'Ingresar el monto en "Monto"', 'Validar que se muestre "Datos de la transferencia"'];
  const montoIndex = steps.indexOf('Ingresar el monto en "Monto"') + 1;
  const declared = {key:'monto',label:'Monto',stepIndex:montoIndex,operation:'fill',required:true,editable:true,sensitive:false,controlType:'number',source:'jira_step'};
  const draft = () => ({sourceIssueKey:'AA-97',title:'Transferencia',steps:[...steps],inputRequirements:[{...declared}],unresolvedUiRequirements:[{stepIndex:montoIndex,requirement:'x'}]});
  const route = [{sourceIssueKey:'AA-97',routes:[{actions:[{action:'click',field:'Transferencias'}]}]}];

  const learned = draft();
  const eligible = await executableCoverageCandidates([learned], [issue], 'password', route);
  assert.equal(eligible.length, 1);
  const [ctx] = journeyContext(eligible) as Array<{steps: string[]; inputRequirements: Array<{stepIndex: number; label: string}>}>;
  assert.equal(ctx.steps.length, steps.length + 1);
  // Both fills (access code and amount) are rederived; only the amount sits after the inserted route step.
  const monto = ctx.inputRequirements.find(r => r.label === 'Monto');
  assert.ok(monto);
  assert.equal(monto.stepIndex, montoIndex + 1);
  assert.equal(ctx.steps[monto.stepIndex - 1], 'Ingresar el monto en "Monto"');
  const others = ctx.inputRequirements.filter(r => r !== monto);
  assert.equal(others.length, 1);
  assert.equal(ctx.steps[others[0].stepIndex - 1], 'Ingresar el código de acceso');
  assert.equal('unresolvedUiRequirements' in ctx, false);
  // The original draft is untouched.
  assert.equal(learned.inputRequirements[0].stepIndex, montoIndex);

  assert.equal((await executableCoverageCandidates([draft()], [issue], 'password', [])).length, 0);
});

test('transactional security token is not a login step; explicit login→SMS→route still requires the route', () => {
  const open = 'Abrir la aplicación configurada del proyecto';
  const story = 'Transferencias entre cuentas';
  const assertion = 'Validar que se muestre "Comprobante"';
  // Implicit profile auth: route after open, then transactional token, is navigable.
  assert.equal(jiraNavigationMissing({}, [open, 'Presionar "Transferencias"', 'Ingresar token en "Token de seguridad"', assertion], 'password', story), false);
  // Explicit login→SMS: route must follow the auth block; a token fill is not a route.
  const explicit = [open, 'Presionar "Iniciar sesión"', 'Ingresar token SMS en "Código SMS"'];
  assert.equal(jiraNavigationMissing({}, [...explicit, 'Ingresar token en "Token de seguridad"', assertion], 'password', story), true);
  assert.equal(jiraNavigationMissing({}, [...explicit, 'Presionar "Transferencias"', assertion], 'password', story), false);
  assert.equal(jiraNavigationMissing({}, [...explicit, 'Presionar "Continuar"', assertion], 'password', story), true);
});

test('generation prioritizes routes for the same Jira issue and exposes why other routes were skipped', () => {
  const issue: JiraIssueSource = {key:'AA-97',summary:'Transferencia entre cuentas',description:'Revisar la confirmación y autorizar.',acceptanceCriteria:null,
    labels:[],components:[],status:'Open',issueType:'Story'};
  const base = {schemaVersion:1 as const,engine:'jira_semantic' as const,appSlug:'fenix',profileRevision:'rev1',
    jobId:'job',validatedAt:'2026-10-15T12:00:00.000Z',startsFrom:'project_entry' as const,evidenceRefs:['step-1.png']};
  const sameIssue = {...base,id:'same',sourceIssueKey:'AA-97',scenarioId:'AA-97:jira:2',actions:[
    {action:'navigate' as const},{action:'click' as const,field:'continuar inicio de sesión'},
    {action:'fill' as const,field:'Contraseña',dataRef:'contrasena_invalida'},
    {action:'select' as const,field:'Cuenta de origen',dataRef:'cuenta_origen'}]};
  const sibling = {...base,id:'sibling',sourceIssueKey:'AA-96',scenarioId:'AA-96:jira:1',actions:[{action:'click' as const,field:'Transferencias'}]};
  const invalidated = {...base,id:'old',sourceIssueKey:'AA-97',scenarioId:'AA-97:jira:1',invalidatedAt:'2026-10-15T12:30:00.000Z',actions:[{action:'click' as const,field:'continuar autorización'}]};
  const resolved = resolveJiraGenerationKnowledge('fenix',[issue],[sameIssue,sibling,invalidated],'rev1',Date.parse('2026-10-15T13:00:00.000Z'));
  assert.equal(resolved.knowledge[0].routes.length,1);
  assert.equal(resolved.knowledge[0].routes[0].sourceIssueKey,'AA-97');
  assert.deepEqual(resolved.knowledge[0].routes[0].actions,[{action:'navigate'},{action:'click',field:'continuar inicio de sesión'},{action:'fill',field:'Contraseña'},{action:'select',field:'Cuenta de origen'}]);
  assert.equal(resolved.diagnostics[0].candidatesScanned,3);
  assert.equal(resolved.diagnostics[0].eligibleRoutes,1);
  assert.equal(resolved.diagnostics[0].rejectedInvalidated,1);
  const promptContext=JSON.parse(buildJiraScenarioMessages([issue],'fenix',[sameIssue,sibling,invalidated],'rev1')[1].content);
  assert.deepEqual(promptContext.learnedNavigation[0].routes[0].actions,[{action:'navigate'},{action:'click',field:'continuar inicio de sesión'},{action:'fill',field:'Contraseña'},{action:'select',field:'Cuenta de origen'}]);
  assert.doesNotMatch(JSON.stringify(promptContext.learnedNavigation),/contrasena_invalida|cuenta_origen/);
});
