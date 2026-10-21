import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import path from 'node:path';
import {certifyJiraDurableTarget,createJiraPlaywrightPort,discoverJiraScenario,resolveJiraSelectionField,selectJiraObservedOption} from './jira-semantic-executor';
import {compileJiraSpec} from './jira-spec-compiler';

test('Jira certifies the observed control with nested text across distinct local profiles',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  for(const text of ['Business mode','Service mode']) {
   const page=await browser.newPage();
   await page.setContent(`<button><span>${text}</span></button><button>Other mode</button><p id="state"></p>`);
   const observed=page.getByRole('button',{name:text,exact:true});
   const target=await certifyJiraDurableTarget(page,observed);
   assert.deepEqual(target,{strategy:'role',role:'button',name:text,exact:true});
   assert.equal(await page.getByRole('button',{name:target.name,exact:true}).count(),1);
   await page.evaluate(()=>document.querySelector('button')!.addEventListener('click',()=>{document.body.dataset.clicked='yes';document.getElementById('state')!.textContent='Ready';}));
   const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
   const transported=await port.act({index:2,action:'click',description:`Presionar "${text}"`},text);
   assert.deepEqual(transported,target);
   assert.equal(await page.locator('body').getAttribute('data-clicked'),'yes');
   const discovered=await discoverJiraScenario({scenarioId:'HU-1:jira:1',sourceIssueKey:'HU-1',title:'Choose mode',steps:[`Presionar "${text}"`,'Validar que se muestre "Ready"'],expectedResult:'Ready'},{...port,async navigate(){}});
   assert.deepEqual(discovered.plan.steps[1].target,target);
   assert.deepEqual(compileJiraSpec({plan:discovered.plan,sourceScenario:discovered.sourceScenario,appSlug:'fixture',sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-durable/case.spec.ts')}).unsupported,[]);
   await page.close();
  }
 } finally {await browser.close();}
});

test('duplicate visible text is certified by observed position while stable ID keeps authority',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<button><span data-source="observed">Same mode</span></button><button><span>Same mode</span></button>');
  const observed=page.locator('button').filter({has:page.locator('[data-source="observed"]')});
  assert.equal(await observed.count(),1);
  const positional=await certifyJiraDurableTarget(page,observed);
  assert.equal(positional.strategy,'xpath');
  const resolved=page.locator(`xpath=${positional.value}`);
  assert.equal(await resolved.count(),1);
  assert.equal(await resolved.evaluate((element,other)=>element===other,await observed.elementHandle()),true);
  await page.setContent('<button id="mode"><span>Same mode</span></button><button>Same mode</button>');
  assert.deepEqual(await certifyJiraDurableTarget(page,page.locator('#mode')),{strategy:'css',value:'[id="mode"]'});
 } finally {await browser.close();}
});

test('Jira certifies an exact visible custom navigation owner by its observed tag and text',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<aside><div style="cursor:pointer" onclick="document.body.dataset.clicked=\'yes\'"><span>Transferencias</span></div></aside><div style="display:none">Transferencias</div>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const target=await port.act({index:1,action:'click',description:'Presionar "Transferencias"'},'Transferencias');
  assert.equal(target.strategy,'css');
  assert.match(target.value ?? '',/:visible:text-is/);
  assert.equal(await page.locator('body').getAttribute('data-clicked'),'yes');
 } finally {await browser.close();}
});

test('navigation-item assertion after a click requires destination content, not the sidebar entry',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  // click -> loading (300ms) -> loading clears but old Resumen stays (300ms more) -> destination heading
  await page.setContent('<aside><button id="go">Beneficiarios</button></aside><main id="m"><h1>Resumen</h1></main><script>go.onclick=()=>{m.innerHTML="<p>Cargando información segura...</p>";setTimeout(()=>{m.innerHTML="<h1>Resumen</h1>";document.body.dataset.cleared="yes";setTimeout(()=>{m.innerHTML="<h1>Beneficiarios</h1>";document.body.dataset.ready="yes"},300)},300)}</script>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:2,action:'click',description:'Presionar "Beneficiarios"'},'Beneficiarios');
  const result=await port.assert('Beneficiarios',false);
  assert.equal(await page.locator('body').getAttribute('data-ready'),'yes');
  assert.equal(result.observedText,'Beneficiarios');
  assert.equal(await page.locator('aside button').innerText(),'Beneficiarios');
  assert.equal(await page.locator('main h1').innerText(),'Beneficiarios');
 } finally {await browser.close();}
});

test('Jira selection fields bind to their own nearby observed selector across generic labels',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><h2>Cuenta Origen</h2><button type="button" aria-label="Seleccionar cuenta de origen">Seleccione una Cuenta</button></section><section><h2>Cuenta Destino</h2><button type="button" aria-label="Seleccionar cuenta de destino">Seleccione una Cuenta</button></section>');
  const origin=await resolveJiraSelectionField(page,'cuenta de origen');
  const destination=await resolveJiraSelectionField(page,'cuenta de destino');
  assert.ok(origin && destination);
  assert.equal(await origin.getAttribute('aria-label'),'Seleccionar cuenta de origen');
  assert.equal(await destination.getAttribute('aria-label'),'Seleccionar cuenta de destino');
 } finally {await browser.close();}
});

test('Jira identifies a custom clickable select trigger from its nearby label and observed placeholder',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><h2>Cuenta Origen</h2><div tabindex="0" style="cursor:pointer" onclick="this.dataset.opened=\'yes\'">Seleccione una Cuenta</div></section>');
  const field=await resolveJiraSelectionField(page,'cuenta de origen');
  assert.ok(field);
  assert.match(await field.innerText(),/Seleccione una Cuenta/);
 } finally {await browser.close();}
});

test('Jira associates a visually adjacent account selector when its label is in a sibling container',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.setContent('<main style="width:800px"><div style="height:32px"><h2><span>Cuenta Origen</span></h2></div><div style="height:80px"><div role="button" tabindex="0" style="height:60px;cursor:pointer">Seleccione una Cuenta</div></div><div style="height:32px;margin-top:25px"><h2><span>Cuenta Destino</span></h2></div><div style="height:80px"><div role="button" tabindex="0" style="height:60px;cursor:pointer">Seleccione una Cuenta</div></div></main>');
  const origin=await resolveJiraSelectionField(page,'cuenta de origen');
  const destination=await resolveJiraSelectionField(page,'cuenta de destino');
  assert.ok(origin && destination);
  assert.notEqual((await origin.boundingBox())?.y,(await destination.boundingBox())?.y);
  assert.equal(await origin.innerText(),'Seleccione una Cuenta');
  assert.equal(await destination.innerText(),'Seleccione una Cuenta');
  const durableOrigin=await certifyJiraDurableTarget(page,origin);
  const durableDestination=await certifyJiraDurableTarget(page,destination);
  assert.equal(durableOrigin.strategy,'xpath');
  assert.equal(durableDestination.strategy,'xpath');
  assert.match(durableOrigin.value ?? '',/Cuenta Origen/);
  assert.match(durableDestination.value ?? '',/Cuenta Destino/);
  assert.equal(await page.locator(`xpath=${durableOrigin.value}`).evaluate((el,other)=>el===other,await origin.elementHandle()),true);
  assert.equal(await page.locator(`xpath=${durableDestination.value}`).evaluate((el,other)=>el===other,await destination.elementHandle()),true);
 } finally {await browser.close();}
});

test('Jira certifies a duplicate observed selector by its verified DOM position',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div role="button" tabindex="0">Seleccione una Cuenta</div><div role="button" tabindex="0">Seleccione una Cuenta</div></main>');
  const second=page.getByRole('button').nth(1);
  const target=await certifyJiraDurableTarget(page,second);
  assert.equal(target.strategy,'xpath');
  const resolved=page.locator(`xpath=${target.value}`);
  assert.equal(await resolved.count(),1);
  assert.equal(await resolved.evaluate((element,other)=>element===other,await second.elementHandle()),true);
 } finally {await browser.close();}
});

test('Jira custom select chooses a unique observed option and verifies the selected value',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><h2>Cuenta Origen</h2><button type="button" id="origin" onclick="document.getElementById(\'options\').hidden=false">Seleccione una Cuenta</button><div id="options" role="listbox" hidden><div role="option" onclick="document.getElementById(\'origin\').innerText=\'Cuenta Corriente 10001\';this.setAttribute(\'aria-selected\',\'true\');document.getElementById(\'options\').hidden=true">Cuenta Corriente 10001</div></div></section>');
  const field=await resolveJiraSelectionField(page,'cuenta de origen');
  assert.ok(field);
  await selectJiraObservedOption(page,field,'Cuenta Corriente');
  assert.match(await field.innerText(),/Cuenta Corriente/);
 } finally {await browser.close();}
});

test('Jira option matching ignores configured Spanish prepositions consistently',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><h2>Cuenta Destino</h2><button type="button" id="destination" onclick="document.getElementById(\'options\').hidden=false">Seleccione una Cuenta</button><div id="options" role="listbox" hidden><div role="option" onclick="document.getElementById(\'destination\').innerText=\'Cuenta de Ahorro de prueba\';this.setAttribute(\'aria-selected\',\'true\');document.getElementById(\'options\').hidden=true">Cuenta de Ahorro de prueba</div></div></section>');
  const field=await resolveJiraSelectionField(page,'cuenta de destino');
  assert.ok(field);
  await selectJiraObservedOption(page,field,'Cuenta ahorro');
  assert.match(await field.innerText(),/Cuenta de Ahorro/);
 } finally {await browser.close();}
});

test('Jira custom account selection matches Spanish singular and plural only when the semantic option is unique',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><label>Cuenta de destino</label><button type="button" id="destination" onclick="document.getElementById(\'options\').hidden=false">Seleccione una Cuenta</button><div id="options" role="listbox" hidden><div role="option" onclick="document.getElementById(\'destination\').innerText=\'Cuenta Ahorro 2131200003368 US$1,970.71\';document.getElementById(\'options\').hidden=true">Cuenta Ahorro / 2131200003368 / US$1,970.71</div></div></main>');
  const field=page.locator('#destination');
  await selectJiraObservedOption(page,field,'Cuenta de Ahorros');
  assert.match(await field.innerText(),/Cuenta Ahorro/);
 } finally {await browser.close();}
});

test('Jira account selection matches a singular request to an observed vowel-ending plural label',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><button type="button" id="origin" onclick="document.getElementById(\'options\').hidden=false">Seleccione una Cuenta</button><div id="options" role="listbox" hidden><div role="option" onclick="document.getElementById(\'origin\').innerText=\'Cuenta Corrientes / qa-option\';document.getElementById(\'options\').hidden=true">Cuenta Corrientes / qa-option</div></div></main>');
  const field=page.locator('#origin');
  await selectJiraObservedOption(page,field,'Cuenta Corriente');
  assert.match(await field.innerText(),/Cuenta Corrientes/);
 } finally {await browser.close();}
});

test('Jira fills a unique editable input associated with a sibling label and certifies the relation',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div><span>Monto</span></div><div><input type="number"></div></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const durable=await port.act({index:1,action:'fill',description:'Ingresar monto'},'Monto','10');
  assert.equal(await page.locator('input').inputValue(),'10');
  assert.equal(durable.strategy,'xpath');
  assert.match(durable.value ?? '',/Monto/);
  assert.equal(await page.locator(`xpath=${durable.value}`).count(),1);
 } finally {await browser.close();}
});

test('Jira confirms the observed debit account for a semantic transfer assertion',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<section><h2>Cuenta Origen</h2><button type="button" id="origin" onclick="document.getElementById(\'options\').hidden=false">Seleccione una Cuenta</button><div id="options" role="listbox" hidden><div role="option" onclick="document.getElementById(\'origin\').innerText=\'Cuenta Corriente\';document.getElementById(\'options\').hidden=true">Cuenta Corriente</div></div></section>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'select',description:'Seleccionar cuenta origen'},'cuenta de origen','Cuenta Corriente');
  const assertion=await port.assert('cuenta que debitará',false);
  assert.match(assertion.observedText ?? '',/Cuenta Corriente/);
 } finally {await browser.close();}
});

test('Jira waits for confirmation after continuing before accepting the selected accounts',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main id="content"><label>Cuenta de origen<select aria-label="Cuenta de origen"><option>Cuenta Corriente</option></select></label><label>Cuenta de destino<select aria-label="Cuenta de destino"><option>Cuenta de Ahorro</option></select></label><button onclick="setTimeout(()=>document.getElementById(\'content\').innerHTML=\'<h2>Confirmación</h2><p>Cuenta Corriente</p><p>Cuenta de Ahorro</p>\',250)">Continuar</button></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'select',description:'Seleccionar cuenta de origen'},'Cuenta de origen','Cuenta Corriente');
  await port.act({index:2,action:'select',description:'Seleccionar cuenta de destino'},'Cuenta de destino','Cuenta de Ahorro');
  await port.act({index:3,action:'click',description:'Continuar transferencia'},'Continuar');
  const assertion=await port.assert('cuentas seleccionadas',false);
  assert.match(assertion.observedText ?? '',/Cuenta Corriente/);
  assert.match(assertion.observedText ?? '',/Cuenta de Ahorro/);
 } finally {await browser.close();}
});

test('Jira recognizes visible confirmation text when the application does not expose it as a heading',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main id="content"><label>Cuenta de origen<select aria-label="Cuenta de origen"><option>Cuenta Corriente</option></select></label><label>Cuenta de destino<select aria-label="Cuenta de destino"><option>Cuenta de Ahorro</option></select></label><button onclick="setTimeout(()=>document.getElementById(\'content\').innerHTML=\'<div class=screen-title>Confirmación</div><p>Cuenta Corriente</p><p>Cuenta de Ahorro</p>\',250)">Continuar</button></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'select',description:'Seleccionar cuenta de origen'},'Cuenta de origen','Cuenta Corriente');
  await port.act({index:2,action:'select',description:'Seleccionar cuenta de destino'},'Cuenta de destino','Cuenta de Ahorro');
  await port.act({index:3,action:'click',description:'Continuar transferencia'},'Continuar');
  const assertion=await port.assert('cuentas seleccionadas',false);
  assert.match(assertion.observedText ?? '',/Cuenta Corriente/);
  assert.match(assertion.observedText ?? '',/Cuenta de Ahorro/);
 } finally {await browser.close();}
});

test('Jira verifies both selected accounts on the successful transfer receipt',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><label>Cuenta de origen<select aria-label="Cuenta de origen"><option>Cuenta Corriente</option></select></label><label>Cuenta de destino<select aria-label="Cuenta de destino"><option>Cuenta de Ahorro</option></select></label></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'select',description:'Seleccionar cuenta de origen'},'Cuenta de origen','Cuenta Corriente');
  await port.act({index:2,action:'select',description:'Seleccionar cuenta de destino'},'Cuenta de destino','Cuenta de Ahorro');
  await page.locator('main').evaluate(element=>{element.innerHTML='<h1>Comprobante</h1><p>Transacción Exitosa</p><p>Cuenta Origen</p><p>Cuenta Corriente</p><p>Cuenta Destino</p><p>Cuenta Ahorro</p>';});
  const assertion=await port.assert('cuentas involucradas',false);
  assert.match(assertion.observedText ?? '',/Cuenta Corriente/);
  assert.match(assertion.observedText ?? '',/Cuenta Ahorro/);
 } finally {await browser.close();}
});

test('Jira verifies visible date and time values even when they are not labeled with words',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><h1>Comprobante</h1><p>Transacción Exitosa</p><p>13/10/2026 12:04:13 AM</p></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const assertion=await port.assert('fecha y hora',false);
  assert.match(assertion.observedText ?? '',/13\/10\/2026 12:04:13 AM/);
 } finally {await browser.close();}
});

test('Jira verifies an operation reference label together with its displayed value',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><h1>Comprobante</h1><p>Referencia</p><p>000123456789</p></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const assertion=await port.assert('referencia de la operación',false);
  assert.match(assertion.observedText ?? '',/Referencia/);
  assert.match(assertion.observedText ?? '',/000123456789/);
 } finally {await browser.close();}
});

test('Jira treats "identificable" as an assertion intent and accepts the observed account heading',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><h1>Transferencias a Mis Cuentas</h1><h2>Cuenta Origen</h2><button>Seleccione una Cuenta</button><h2>Cuenta Destino</h2><button>Seleccione una Cuenta</button></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const origin=await port.assert('cuenta de origen identificable',false);
  const destination=await port.assert('cuenta de destino identificable',false);
  assert.equal(origin.observedText,'Cuenta Origen');
  assert.equal(destination.observedText,'Cuenta Destino');
 } finally {await browser.close();}
});

test('Jira resolves transfer confirmation prose to its observed confirmation heading',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main style="cursor:pointer"><h1>Transferencias a Mis Cuentas</h1><h2>Confirmación</h2></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const assertion=await port.assert('confirmación de transferencia',false);
  assert.equal(assertion.observedText,'Confirmación');
 } finally {await browser.close();}
});

test('Jira maps a semantic request for a verification channel to its unique observed action label',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><button type="button" onclick="document.body.dataset.requested=\'yes\'">SMS</button></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'click',description:'Solicitar el código por SMS'},'Solicitar el código por SMS');
  assert.equal(await page.locator('body').getAttribute('data-requested'),'yes');
 } finally {await browser.close();}
});

test('Jira resolves a verification channel inside one observed custom clickable control',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div style="cursor:pointer" onclick="document.body.dataset.requested=\'yes\'"><span>SMS</span></div></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'click',description:'Solicitar el código por SMS'},'Solicitar el código por SMS');
  assert.equal(await page.locator('body').getAttribute('data-requested'),'yes');
 } finally {await browser.close();}
});

test('Jira action waits for an observed target while a transient loading layer intercepts clicks',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  page.setDefaultTimeout(50);
  await page.setContent('<main><button onclick="document.body.dataset.clicked=\'yes\'">Transferencias</button><div id="loading" style="position:fixed;inset:0;background:#ddd;z-index:10"></div><script>setTimeout(()=>document.getElementById("loading").remove(),300)</script></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act({index:1,action:'click',description:'Presionar "Transferencias"'},'Transferencias');
  assert.equal(await page.locator('body').getAttribute('data-clicked'),'yes');
 } finally {await browser.close();}
});

test('Jira screen assertion resolves the observed heading without the prose prefix',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main onclick="document.body.dataset.clicked=\'yes\'"><h1>Verificación de Usuario</h1><p>Seleccione SMS para recibir el código.</p></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const observed=await port.assert('pantalla de verificación de usuario',false);
  assert.equal(observed.observedText,'Verificación de Usuario');
  const contract=await discoverJiraScenario({scenarioId:'HU-2:jira:1',sourceIssueKey:'HU-2',title:'Observe access verification',steps:['Validar que se muestre "pantalla de verificación de usuario"'],expectedResult:'Verificación de Usuario'}, {...port,async navigate(){}});
  assert.equal(contract.plan.steps[1].target && typeof contract.plan.steps[1].target==='object' ? contract.plan.steps[1].target.value : '', 'verificación de usuario');
  assert.deepEqual(compileJiraSpec({plan:contract.plan,sourceScenario:contract.sourceScenario,appSlug:'fixture',sectionSlug:'jira',automationId:'fixture',specPath:path.resolve('.artifacts/tmp/jira-screen-assertion/case.spec.ts')}).unsupported,[]);
 } finally {await browser.close();}
});

test('Jira screen descriptor accepts a shorter observed heading without project-specific label aliases',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><h1>Resumen</h1></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const result=await discoverJiraScenario({scenarioId:'HU-3:jira:1',sourceIssueKey:'HU-3',title:'Observe account overview',
   steps:['Validar que se muestre "pantalla de resumen de productos"'],expectedResult:''},{...port,async navigate(){}});
  assert.equal(result.sourceScenario.observableOracles?.[0]?.target,'Resumen');
 } finally {await browser.close();}
});

test('Jira screen assertion normalizes visible non-heading text from the DOM',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div onclick="document.body.dataset.clicked=\'yes\'"><div class="screen-title">Verificación de Usuario</div></div></main>');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  const observed=await port.assert('pantalla de verificación de usuario',false);
  assert.equal(observed.observedText,'Verificación de Usuario');
 } finally {await browser.close();}
});

test('Jira screen descriptor matches its visible title even when the page has surrounding copy',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div class="screen-title">Verificación de Usuario</div><p>Seleccione SMS para recibir el código de seguridad y continuar.</p></main>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('pantalla de verificación de usuario',false);
  assert.match(observed.observedText??'',/Verificación de Usuario/);
  await page.setContent('<main><h1>Transferencia procesada</h1><p>El usuario recibió un mensaje de verificación del portal.</p></main>');
  await assert.rejects(()=>createJiraPlaywrightPort(page,'https://fixture.invalid').assert('pantalla de verificación de usuario',false),/JIRA_ASSERTION_NOT_SATISFIED/);
 } finally {await browser.close();}
});

test('Jira visible-text assertion accepts repeated exact labels in the content area',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div class="section-title">Monto</div><label><span>Monto</span><input aria-label="Monto" value="10.00"></label></main>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('monto',false);
  assert.equal(observed.observedText,'Monto');
 } finally {await browser.close();}
});

test('Jira visible-text assertion accepts a descriptive label that starts with the requested concept',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div class="section-title">Monto de la transferencia</div></main>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('monto',false);
  assert.equal(observed.observedText,'Monto de la transferencia');
 } finally {await browser.close();}
});

test('Jira visible-text assertion normalizes a plural concept to the singular UI label',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><div>Impuesto 0.20%</div></main>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('impuestos',false);
  assert.equal(observed.observedText,'Impuesto 0.20%');
 } finally {await browser.close();}
});

test('Jira screen assertion recognizes an observed validation action as the corresponding validation screen',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<main><h1>Token de Seguridad</h1><h2>Validación</h2><div class="section-title">Validar Identidad</div></main>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('pantalla de validación de identidad',false);
  assert.equal(observed.observedText,'Validar Identidad');
 } finally {await browser.close();}
});

test('Jira screen assertion accepts composite success evidence in a non-navigation action wrapper',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  await page.setContent('<div role="button" tabindex="0"><div>Comprobante</div><div>Transacción Exitosa</div></div>');
  const observed=await createJiraPlaywrightPort(page,'https://fixture.invalid').assert('comprobante de transacción exitosa',false);
  assert.match(observed.observedText ?? '',/Comprobante/);
 } finally {await browser.close();}
});

test('Jira selection step checks the unique labelled checkbox and fails closed when ambiguous or unlabelled',async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();
  const step={index:1,action:'select' as const,description:'Seleccionar "Aprobar pagos"'};
  await page.setContent('<label><input type="checkbox"> Aprobar pagos</label><label><input type="checkbox"> Otro permiso</label><input type="checkbox">');
  const port=createJiraPlaywrightPort(page,'https://fixture.invalid');
  await port.act(step,'Aprobar pagos','Aprobar pagos');
  assert.deepEqual(await page.locator('input').evaluateAll(els=>els.map(el=>(el as HTMLInputElement).checked)),[true,false,false]);
  await page.setContent('<label><input type="checkbox"> Aprobar pagos</label><label><input type="checkbox"> Aprobar pagos</label>');
  await assert.rejects(()=>port.act(step,'Aprobar pagos','Aprobar pagos'));
  assert.deepEqual(await page.locator('input').evaluateAll(els=>els.map(el=>(el as HTMLInputElement).checked)),[false,false]);
 } finally {await browser.close();}
});
