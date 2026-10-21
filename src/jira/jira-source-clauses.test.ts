import test from 'node:test';
import assert from 'node:assert/strict';
import {jiraAcceptanceClauses} from './jira-source-clauses';
import type {JiraIssueSource} from '../scenarios/scenario-types';

const issue=(description:string):JiraIssueSource=>({key:'HU-X',summary:'s',description,acceptanceCriteria:null,labels:[],components:[],status:'Open',issueType:'Story'});

test('a name initial is not a sentence boundary (AA-107 AC2)',()=>{
 const clauses=jiraAcceptanceClauses(issue('AC2: Rol de Laura M. permite elegir Operador, Aprobador o Administrador. Límite de aprobación acepta un monto y actualiza el control Ajuste visual.'));
 assert.deepEqual(clauses.map(clause=>clause.id),['AC2.1','AC2.2']);
 assert.equal(clauses[0].text,'Rol de Laura M. permite elegir Operador, Aprobador o Administrador');
 assert.match(clauses[1].text,/^Límite de aprobación/);
});

test('a single-letter label followed by an uppercase sentence still splits',()=>{
 const clauses=jiraAcceptanceClauses(issue('AC3: El usuario elige la opción A. Luego el sistema muestra el resumen.'));
 assert.deepEqual(clauses.map(clause=>clause.text),['El usuario elige la opción A','Luego el sistema muestra el resumen']);
});

test('a trailing negative sentence stays its own clause (AA-111 AC7)',()=>{
 const clauses=jiraAcceptanceClauses(issue('AC7 — Limpiar filtros: pulsar Limpiar filtros para volver a criterios iniciales, dos resultados y la paginación 1–2 de 2 movimientos. El perfil Personal no muestra productos ni etiquetas empresariales.'));
 assert.deepEqual(clauses.map(clause=>clause.id),['AC7.1','AC7.2']);
 assert.equal(clauses[1].text,'El perfil Personal no muestra productos ni etiquetas empresariales');
});
