import test from "node:test";
import assert from "node:assert/strict";
import { deriveJiraInputRequirements } from "./jira-input-requirements";
import { collectMissingJiraRequiredInputs } from "./jira-required-input-validation";
import { discoverJiraScenario } from "./jira-semantic-executor";
import { jiraRuntimeValues, jiraScenarioRuntimeValues, resolveJiraConfiguredInputValues } from "./jira-runtime-values";
import { extractStructuredOptionFlows } from "../scenarios/scenario-preview.service";

test("a story heading does not become a clickable option while real option outcomes remain", () => {
  assert.deepEqual(extractStructuredOptionFlows('HU: Transferir fondos\nEl cliente selecciona una cuenta y completa el monto.'), []);
  assert.deepEqual(extractStructuredOptionFlows('Al seleccionar una opción:\nConsultar: Se muestra el detalle'), [{ optionLabel: 'Consultar', expectedResult: 'Se muestra el detalle', source: 'hu' }]);
});
test("natural-language same-value steps bind to the nearest compatible earlier field; others stay distinct", () => {
  const steps = [
    'Ingresar "Ana" en "Nombre"', 'Ingresar "Atlas" en "Alias"', 'Ingresar "123" en "Número de cuenta"', 'Seleccionar "Banco Uno" en "Entidad bancaria"',
    'Ingresar el mismo nombre en "Nombre"', 'Ingresar el mismo alias en "Alias"', 'Ingresar el mismo número de cuenta en "Número de cuenta"', 'Seleccionar la misma entidad bancaria en "Entidad bancaria"',
  ];
  const keys = deriveJiraInputRequirements(steps).map(item => item.key);
  assert.deepEqual(keys.slice(4), keys.slice(0, 4));
  assert.equal(new Set(keys.slice(0, 4)).size, 4);
  // Incompatible label ("cliente" is a qualifier) and ordinary repeats without "mismo" stay distinct.
  const distinct = deriveJiraInputRequirements(['Ingresar "Ana" en "Nombre"', 'Ingresar el mismo nombre en "Nombre del cliente"', 'Ingresar "Ana" en "Nombre"']).map(item => item.key);
  assert.equal(new Set(distinct).size, 3);
  // Nearest earlier compatible step wins; operation must match.
  const nearest = deriveJiraInputRequirements(['Ingresar "A" en "Alias"', 'Ingresar "B" en "Alias"', 'Ingresar el mismo alias en "Alias"']).map(item => item.key);
  assert.equal(nearest[2], nearest[1]);
  const otherOp = deriveJiraInputRequirements(['Seleccionar "A" en "Alias"', 'Ingresar el mismo alias en "Alias"']).map(item => item.key);
  assert.notEqual(otherOp[0], otherOp[1]);
});

test("a fixed literal before the trailing field does not become the field label", () => {
  const [item] = deriveJiraInputRequirements(['Ingresar el alias duplicado "Atlas" en "Alias"']);
  assert.equal(item.label, "Alias");
});

test("natural inputs keep per-step identity and mask both independent security challenges", () => {
  const fields = deriveJiraInputRequirements(['Ingresar usuario en "Usuario"', 'Ingresar contraseña en "Contraseña"', 'Ingresar código en "SMS"', 'Seleccionar cuenta en "Cuenta de origen"', 'Ingresar código en "SMS"', 'Validar que se muestre "Comprobante"']);
  assert.equal(fields.length, 5);
  assert.deepEqual(fields.map(f => f.stepIndex), [1, 2, 3, 4, 5]);
  assert.equal(fields[1].controlType, 'password');
  assert.equal(fields[2].sensitive, true);
  assert.notEqual(fields[2].key, fields[4].key);
  assert.equal(fields[3].operation, 'select');
});
test("navigation choices and aggregate placeholders are not required runtime data, declared selects stay", () => {
  const steps = ['Seleccionar el perfil "Personal"', 'Ingresar datos requeridos de la solicitud', 'Seleccionar cuenta en "Cuenta de origen"', 'Seleccionar "Estado civil"', 'Seleccionar un valor válido en el campo "Tipo de documento"'];
  const fields = deriveJiraInputRequirements(steps, [
    { key: "perfil", label: "Personal", stepIndex: 1, operation: "select" },
    { key: "estado", label: "Estado civil", stepIndex: 4, operation: "select" },
    { key: "tipo_doc", label: "Tipo de documento", stepIndex: 5, operation: "select" },
  ]);
  assert.deepEqual(fields.map(f => f.label), ["Cuenta de origen", "Estado civil", "Tipo de documento"]);
  assert.deepEqual(fields.map(f => f.stepIndex), [3, 4, 5]);
});
test("an empty invalid/expired value stays missing at preflight", () => {
  const [invalid, expired] = deriveJiraInputRequirements(['Ingresar token no válido en "Token"', 'Ingresar token expirado en "Token"']);
  assert.deepEqual([invalid.dataCondition, expired.dataCondition], ["invalid", "expired"]);
  const missing = collectMissingJiraRequiredInputs([{ scenarioId: "S:1", title: "Neg", sourceIssueKey: "S", steps: [], expectedResult: "", inputRequirements: [invalid, expired] }], { "S:1": { [invalid.key]: "", [expired.key]: " " } });
  assert.deepEqual(missing.map(m => m.key), [invalid.key, expired.key]);
});
test("controller value travels from scoped scenario data to the Jira plan without a literal", async () => {
  const steps = ['Ingresar usuario en "Usuario"'];
  const fields = deriveJiraInputRequirements(steps, [{key:'login.user',label:'Usuario',stepIndex:1,operation:'fill'}]);
  const values = jiraRuntimeValues({ 'HU-1:01': { 'login.user':'synthetic-user' }, 'HU-1:02': {'login.user':'another-user'} }, 'HU-1:01','PREVIEW-001');
  let received: string | undefined;
  const result = await discoverJiraScenario({scenarioId:'HU-1:01',sourceIssueKey:'HU-1',title:'Ingresar usuario',steps,expectedResult:'',inputRequirements:fields}, {
    async navigate() {}, async act(_step,target,value) { assert.equal(target,'Usuario'); received=value; return {strategy:'css',value:'#synthetic-input'}; }, async assert() { return {}; }
  }, values);
  assert.equal(received,'synthetic-user');
  assert.equal(result.plan.steps[1].valueKey,'login.user');
  assert.doesNotMatch(JSON.stringify(result.plan),/synthetic-user|another-user/);
  assert.deepEqual(jiraRuntimeValues({ 'HU-1:02': { 'login.user':'another-user'} },'HU-1:01'),{});
});
test("declared privacy hints preserve sensitivity without forcing password display and keys remain unique", () => {
  const fields=deriveJiraInputRequirements(['Ingresar dato en "Secreto"','Ingresar código en "SMS"','Ingresar código en "SMS"'],[
    {stepIndex:1,operation:'fill',label:'Secreto',key:'jira_step_3',sensitive:true},
    {stepIndex:2,operation:'fill',label:'SMS',key:'shared',sensitive:false},
    {stepIndex:3,operation:'fill',label:'SMS',key:'shared',sensitive:false},
  ]);
  assert.equal(new Set(fields.map(field=>field.key)).size,3);
  assert.ok(fields.every(field=>field.sensitive && field.controlType==='text'));
});

test("visual masking is based on the password label, not broad privacy hints, in the shared Jira schema", () => {
  const labels = [
    { label: "RNC", step: 'Ingresar RNC en "RNC"', operation: "fill" },
    { label: "Usuario", step: 'Ingresar usuario en "Usuario"', operation: "fill" },
    { label: "Contraseña", step: 'Ingresar contraseña en "Contraseña"', operation: "fill" },
    { label: "Código de acceso", step: 'Ingresar código en "Código de acceso"', operation: "fill" },
    { label: "Token de transferencia", step: 'Ingresar token en "Token de transferencia"', operation: "fill" },
    { label: "Cuenta de origen", step: 'Seleccionar cuenta en "Cuenta de origen"', operation: "select" },
    { label: "Monto", step: 'Ingresar monto en "Monto"', operation: "fill" },
  ] as const;
  const requirements = deriveJiraInputRequirements(
    labels.map(({ step }) => step),
    labels.map(({ label, operation }, index) => ({
      key: `field.${index + 1}`, label, stepIndex: index + 1, operation,
      sensitive: true, controlType: "password",
    })),
  );

  assert.deepEqual(requirements.map((field) => field.controlType), [
    "text", "text", "password", "text", "text", "select", "number",
  ]);
  assert.ok(requirements.every((field) => field.sensitive), "privacy metadata remains independent of the displayed input type");
});
test("Jira can observe an error label containing no without weakening a negative assertion", async () => {
  const browser={async navigate(){},async act(){return {strategy:'css' as const,value:'#fixture'};},async assert(target:string){return {observedText:target};}};
  const input={scenarioId:'HU-2',sourceIssueKey:'HU-2',title:'Error visible',steps:['Validar que se informe "código no válido"'],expectedResult:''};
  const result=await discoverJiraScenario(input,browser,{});
  assert.equal(result.plan.steps[1].action,'assertVisible');
  await assert.rejects(discoverJiraScenario({...input,steps:['Validar que no se muestre "Comprobante"']},browser,{}),/ABSENCE_REQUIRES_OBSERVED_CONTEXT/);
});

test("negative data applies only to the specified field, across arbitrary labels", () => {
  for (const label of ["Token de transferencia", "Verification code"]) {
    const fields = deriveJiraInputRequirements(['Ingresar código válido en "Acceso"', `Ingresar un dato no válido en "${label}"`]);
    assert.equal(fields[0].dataCondition, "valid");
    assert.equal(fields[1].dataCondition, "invalid");
    assert.equal(deriveJiraInputRequirements(['Ingresar dato en "Campo"'])[0].dataCondition, undefined);
  }
});

test("invalid data condition is detected whether it appears before or after the quoted field label",()=>{
  const [before]=deriveJiraInputRequirements(['Ingresar código no válido en "Código de autorización"']);
  const [after]=deriveJiraInputRequirements(['Completar "Código de autorización" con un código inválido del proyecto']);
  assert.equal(before.dataCondition,'invalid');
  assert.equal(after.dataCondition,'invalid');
});

test("semantic SMS-code wording resolves a named editable code input and uses the app's OTP source",()=>{
  const steps=['Introducir un código SMS válido del proyecto'];
  const [requirement]=deriveJiraInputRequirements(steps);
  assert.equal(requirement.label,'Código SMS');
  assert.equal(requirement.dataCondition,'valid');
  const values=resolveJiraConfiguredInputValues({overrides:{},scenarioId:'HU-1:01',requirements:[requirement],environment:{OTP_SECRET:'synthetic-otp'}});
  assert.equal(values[requirement.key],'synthetic-otp');
});

test("Jira fills valid auth and identifier inputs from each configured app profile without borrowing invalid data", () => {
  const requirements = deriveJiraInputRequirements([
    'Ingresar usuario en "Usuario"',
    'Ingresar contraseña en "Contraseña"',
    'Ingresar RNC en "RNC"',
    'Ingresar contraseña no válida en "Contraseña"',
    'Ingresar código de acceso válido en "Código de acceso"',
    'Ingresar código de acceso no válido en "Código de acceso"',
    'Ingresar token en "Token de seguridad"',
    'Seleccionar cuenta en "Cuenta de origen"',
  ], [
    { key: "usuario", label: "Usuario", stepIndex: 1, operation: "fill" },
    { key: "contrasena", label: "Contraseña", stepIndex: 2, operation: "fill" },
    { key: "rnc", label: "RNC", stepIndex: 3, operation: "fill" },
    { key: "contrasena_invalida", label: "Contraseña", stepIndex: 4, operation: "fill" },
    { key: "codigo_acceso_sms", label: "Código de acceso", stepIndex: 5, operation: "fill" },
    { key: "codigo_acceso_sms_invalido", label: "Código de acceso", stepIndex: 6, operation: "fill" },
    { key: "token_transferencia", label: "Token de seguridad", stepIndex: 7, operation: "fill" },
    { key: "cuenta_origen", label: "Cuenta de origen", stepIndex: 8, operation: "select" },
  ]);

  for (const profile of [
    { username: "profile-a-user", password: "profile-a-password" },
    { username: "profile-b-user", password: "profile-b-password" },
  ]) {
    const values = resolveJiraConfiguredInputValues({
      overrides: {}, scenarioId: "HU-1:01", requirements,
      profileUsername: profile.username, profilePassword: profile.password,
      environment: { Identity_Provider: "configured-company-id", OTP_SECRET: "configured-one-time-code" },
    });
    assert.equal(values.usuario, profile.username);
    assert.equal(values.contrasena, profile.password);
    assert.equal(values.rnc, "configured-company-id");
    assert.equal(values.contrasena_invalida, undefined, "a negative password requirement cannot inherit the valid profile password");
    assert.equal(values.codigo_acceso_sms, "configured-one-time-code");
    assert.equal(values.codigo_acceso_sms_invalido, undefined, "a negative access-code requirement cannot inherit the valid OTP");
    assert.equal(values.token_transferencia, undefined, "the access-code source cannot be reused as a transaction token");
    assert.equal(values.cuenta_origen, undefined, "unconfigured business data must remain required");
  }
});

test("Jira runtime keeps configured defaults out of negative fields but preserves an explicit scenario value", () => {
  const requirements = [
    { key: "codigo_acceso", label: "Código de acceso", dataCondition: "valid" as const },
    { key: "codigo_acceso_invalido", label: "Código de acceso", dataCondition: "invalid" as const },
    { key: "token_invalido", label: "Token de seguridad", dataCondition: "invalid" as const },
  ];
  const configuredValues = {
    codigo_acceso: "configured-valid-code",
    codigo_acceso_invalido: "configured-valid-code",
    token_invalido: "configured-valid-token",
    unrelated: "not-a-scenario-input",
  };
  const resolved = resolveJiraConfiguredInputValues({
    overrides: {}, scenarioId: "HU-1:03", requirements,
    testData: configuredValues, environment: {},
  });
  assert.deepEqual(jiraScenarioRuntimeValues(resolved, configuredValues, requirements), {
    codigo_acceso: "configured-valid-code",
  });

  const withExplicitNegative = resolveJiraConfiguredInputValues({
    overrides: { "HU-1:03": { codigo_acceso_invalido: "scenario-invalid-code" } },
    scenarioId: "HU-1:03", requirements,
    testData: configuredValues, environment: {},
  });
  assert.deepEqual(jiraScenarioRuntimeValues(withExplicitNegative, configuredValues, requirements), {
    codigo_acceso: "configured-valid-code",
    codigo_acceso_invalido: "scenario-invalid-code",
  });
});

test("Jira scenario overrides take priority and remain isolated to their scenario", () => {
  const requirements = [{ key: "usuario", label: "Usuario" }];
  const values = resolveJiraConfiguredInputValues({
    overrides: { "HU-1:02": { usuario: "other-scenario-user" }, "HU-1:01": { usuario: "selected-user" } },
    scenarioId: "HU-1:01", requirements,
    profileUsername: "configured-user",
    environment: {},
  });
  assert.equal(values.usuario, "selected-user");
  const isolated = resolveJiraConfiguredInputValues({
    overrides: { "HU-1:02": { usuario: "other-scenario-user" } },
    scenarioId: "HU-1:01", requirements,
    environment: {},
  });
  assert.equal(isolated.usuario, undefined);
});
test("configured application setup accepts final punctuation without manufacturing a route", async () => {
  for (const suffix of ["", ".", "!"]) {
    let navigations = 0;
    await discoverJiraScenario({scenarioId:"HU-1",sourceIssueKey:"HU-1",title:"Setup",steps:["Abrir la aplicación configurada del proyecto"+suffix],expectedResult:""}, {
      async navigate() {navigations++;}, async act() {return {strategy:"css",value:"#fixture"};}, async assert() {return {};}
    }, {});
    assert.equal(navigations, 1);
  }
});

test("reuse pointer needs explicit same-value intent, an earlier compatible input step", () => {
  const first = 'Ingresar "Atlas" en "Alias de cuenta"';
  const save = 'Presionar "Guardar"';
  const same = 'Ingresar el mismo valor en "Alias"';
  const base = { key: "alias", label: "Alias de cuenta", stepIndex: 1, operation: "fill" };
  const ptr = (stepIndex: number, label: string, reusesValueOfStepIndex: number) => ({ ...base, label, stepIndex, reusesValueOfStepIndex });
  const keys = (steps: string[], declared: unknown[]) => deriveJiraInputRequirements(steps, declared).map(field => field.key);
  // Different wording + same-value intent + compatible field: reused.
  assert.deepEqual(keys([first, save, same], [base, ptr(3, "Alias", 1)]), ["alias", "alias"]);
  // No same-value intent: separate field.
  assert.notEqual(keys([first, save, 'Ingresar "Atlas" en "Alias"'], [base, ptr(3, "Alias", 1)])[1], "alias");
  // Mismatched field, non-input target, self and forward pointers: rejected.
  assert.notEqual(keys([first, save, 'Ingresar el mismo valor en "Monto"'], [base, ptr(3, "Monto", 1)])[1], "alias");
  assert.notEqual(keys([first, save, same], [base, ptr(3, "Alias", 2)])[1], "alias");
  assert.notEqual(keys([first, save, same], [base, ptr(3, "Alias", 3)])[1], "alias");
  assert.notEqual(keys([first, save, same], [base, ptr(3, "Alias", 5)])[1], "alias");
});

test("same-value binding keeps distinct fields sharing a generic noun separate", () => {
  const fill = (value: string, label: string) => `Ingresar ${value} en "${label}"`;
  const bound = (firstLabel: string, secondLabel: string) => {
    const fields = deriveJiraInputRequirements(
      [fill('"123"', firstLabel), fill("el mismo valor", secondLabel)],
      [{ key: "first", label: firstLabel, stepIndex: 1, operation: "fill" }, { key: "second", label: secondLabel, stepIndex: 2, operation: "fill", reusesValueOfStepIndex: 1 }]);
    return fields[0].key === fields[1].key;
  };
  assert.equal(bound("Alias de cuenta", "Alias"), true);
  assert.equal(bound("Número de cuenta", "Número de cliente"), false);
  assert.equal(bound("Cuenta de origen", "Cuenta de destino"), false);
  assert.equal(bound("Cuenta de origen", "Cuenta"), false);
});

test("'la cuenta ya registrada' reuses the account saved earlier; other repeats stay distinct", () => {
  const base = ['Ingresar un número de cuenta válido en "Número de cuenta"', 'Presionar "Guardar beneficiario".', 'Presionar "Añadir beneficiario".'];
  const keys = (last: string, steps = base) => deriveJiraInputRequirements([...steps, last]).map(item => item.key);
  const reused = keys('Ingresar la cuenta ya registrada en "Número de cuenta".');
  assert.equal(reused[1], reused[0]);
  assert.equal(keys('Ingresar la cuenta ya guardada en "Número de cuenta".')[1], reused[0]);
  // Ordinary repeat, wrong field, no intervening save, or "distinto" wording never bind.
  assert.notEqual(keys('Ingresar un número de cuenta válido en "Número de cuenta".')[1], reused[0]);
  assert.notEqual(keys('Ingresar la cuenta ya registrada en "Alias".')[1], reused[0]);
  assert.notEqual(keys('Ingresar un número de cuenta válido distinto al ya registrado en "Número de cuenta".')[1], reused[0]);
  assert.notEqual(keys('Ingresar la cuenta ya registrada en "Número de cuenta".', [base[0]])[1], reused[0]);
});
