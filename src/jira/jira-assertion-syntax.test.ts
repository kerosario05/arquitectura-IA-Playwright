import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeJiraAssertionSyntax} from './jira-assertion-syntax';
import {parseStepIntent} from '../discovery/step-intent-parser';

test('scoped prose visibility exposes its complete subject to the shared parser across projects',()=>{
 for(const [context, subject] of [['la confirmación','total a debitar'],['la ficha','nombre completo'],['el expediente','estado de autorización']]) {
  const step=`Validar que ${context} muestre el ${subject}.`;
  const normalized=normalizeJiraAssertionSyntax(step);
  assert.equal(normalized,`Validar que ${context} muestre el "${subject}".`);
  assert.equal(parseStepIntent(normalized)[0]?.canonicalAssertion?.subject,subject);
  assert.equal(normalizeJiraAssertionSyntax(normalized),normalized);
 }
 for(const step of ['Validar que la ficha no muestre el nombre.','Validar que la ficha muestre el monto mayor que cero.','Validar que la ficha muestre el nombre y presionar Continuar.']) {
  assert.equal(normalizeJiraAssertionSyntax(step),step);
 }
});

test('unquoted visibility states preserve subject qualifiers and polarity',()=>{
 for(const subject of ['resumen de sus productos','expediente autorizado','pantalla de validación de identidad']) {
  for(const negative of ['', 'no ']) {
   const normalized=normalizeJiraAssertionSyntax(`Validar que el ${subject} ${negative}esté visible.`);
   const expected=negative ? subject : subject.replace(/^pantalla de /,'');
   assert.equal(normalized,`Validar que ${negative}se muestre "${expected}"`);
   assert.equal(parseStepIntent(normalized)[0]?.canonicalAssertion?.subject,expected);
  }
 }
});

test('atomic authored visibility variants retain exact target and polarity',()=>{
 assert.equal(normalizeJiraAssertionSyntax('Validar "pantalla de verificación de usuario".'),'Validar que se muestre "verificación de usuario"');
 assert.equal(normalizeJiraAssertionSyntax('Validar que se muestre "pantalla de verificación de usuario"'),'Validar que se muestre "verificación de usuario"');
 assert.equal(normalizeJiraAssertionSyntax('Verificar que se muestra “pantalla de validación de identidad”.'),'Validar que se muestre "validación de identidad"');
 assert.equal(normalizeJiraAssertionSyntax('Validar que se muestre "resumen de productos"'),'Validar que se muestre "resumen de productos"');
 assert.equal(normalizeJiraAssertionSyntax('Validar "pantalla de resumen de productos".'),'Validar que se muestre "resumen de productos"');
 for(const verb of ['muestra','muestran','muestre','muestren']) {
  for(const article of ['', 'el ', 'la ', 'los ', 'las ']) {
   for(const negative of ['', 'no ']) {
    assert.equal(normalizeJiraAssertionSyntax(`Verificar que ${negative}se ${verb} ${article}"Dato no disponible".`),`Validar que ${negative}se muestre "Dato no disponible"`);
   }
  }
 }
 assert.equal(normalizeJiraAssertionSyntax('Validar que se informa un “Error de envío”.'),'Validar que se muestre "Error de envío"');
 assert.equal(normalizeJiraAssertionSyntax('Validar que se muestre "ausencia de operación exitosa"'),'Validar que no se muestre "operación exitosa"');
 assert.equal(normalizeJiraAssertionSyntax('Verificar que se muestre "la ausencia de comprobante"'),'Validar que no se muestre "comprobante"');
 for(const suffix of ['no visible','no está visible','no esté visible','no presente','no está presente']) {
  assert.equal(normalizeJiraAssertionSyntax(`Validar "Receipt" ${suffix}.`),'Validar que no se muestre "Receipt"');
 }
 assert.equal(normalizeJiraAssertionSyntax('Validar que no esté visible "Solicitud recibida"'),'Validar que no se muestre "Solicitud recibida"');
});

test('field-pair / same-row wording normalizes to the executor matching-row form, keeping every label word',()=>{
 const cases:Array<[string,string]>=[
  ['Validar que el nombre y el alias ingresados aparezcan en una misma fila de "Destinatarios"','Validar que la fila coincidente con el nombre y el alias ingresados aparezcan en "Destinatarios"'],
  ['Validar que el nombre y el alias del beneficiario coincidente aparezcan juntos en una fila de "Destinatarios"','Validar que la fila coincidente con el nombre y el alias del beneficiario coincidente aparezcan en "Destinatarios"'],
  ['Validar que el nombre y el alias del beneficiario no coincidente aparezcan juntos en una fila de "Destinatarios".','Validar que la fila coincidente con el nombre y el alias del beneficiario no coincidente aparezcan en "Destinatarios"'],
 ];
 for(const [input,expected] of cases)assert.equal(normalizeJiraAssertionSyntax(input),expected);
 // Never weakened: one field only, quoted values or plain visibility stay untouched.
 for(const step of ['Validar que el nombre aparezca en una fila de "Destinatarios"','Validar que se muestre "Ana" y "Atlas" en una fila de "Destinatarios"','Validar que el nombre y el alias aparezcan en "Destinatarios"'])assert.equal(normalizeJiraAssertionSyntax(step),step);
});

test('quoted-label row wording normalizes to the matching-row form and stays row-bound',()=>{
 const step='Validar que la fila con el nombre ingresado en "Nombre del beneficiario" y el alias ingresado en "Alias" aparezca en "Destinatarios guardados"';
 assert.equal(normalizeJiraAssertionSyntax(step),step.replace('la fila con','la fila coincidente con'));
 // One quoted label only (no field pair) is left untouched.
 const single='Validar que la fila con el nombre ingresado aparezca en "Destinatarios guardados"';
 assert.equal(normalizeJiraAssertionSyntax(single),single.replace('fila con','fila coincidente con'));
});

test('nonvisibility, compound and unquoted requirements are not weakened',()=>{
 for(const step of ['Validar que no se permita continuar','Validar que no se informa "Error"','Validar que se muestra "Monto" mayor que cero','Validar que se muestra "Error" y no se muestra "Recibo"','Validar "Receipt" no visible y navegación bloqueada','Validar que se muestre el mensaje de error','Presionar "Continuar"']) {
  assert.equal(normalizeJiraAssertionSyntax(step),step);
 }
});
