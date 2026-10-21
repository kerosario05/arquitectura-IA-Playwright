import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKnowledgeFile } from './project-materializer';
import type { ProjectConfiguration } from './project-reader';

test('project materialization preserves Jira routes alongside existing app knowledge items', () => {
  const createdAt=new Date('2026-10-01T00:00:00.000Z');
  const jiraRoute={schemaVersion:1,engine:'jira_semantic',appSlug:'app-one',id:'route-1',
    profileRevision:'revision',sourceIssueKey:'HU-1',scenarioId:'HU-1:1',jobId:'job-1',
    validatedAt:'2026-10-02T00:00:00.000Z',startsFrom:'project_entry',
    actions:[{action:'click',field:'Transferencias'}],evidenceRefs:['step-2.png']};
  const cfg={slug:'app-one',createdAt,updatedAt:createdAt,knowledge:{schemaVersion:1,
    knowledgeJson:JSON.stringify({version:1,items:[{id:'legacy-item'}],jiraRoutes:[jiraRoute]}),
    createdAt,updatedAt:createdAt}} as ProjectConfiguration;
  const output=buildKnowledgeFile(cfg);
  assert.deepEqual(output.items,[{id:'legacy-item'}]);
  assert.deepEqual(output.jiraRoutes,[jiraRoute]);
});
