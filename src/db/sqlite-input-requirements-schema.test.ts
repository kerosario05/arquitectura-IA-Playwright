import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {SQLITE_SCHEMA} from "./sqlite-schema";
import {ensureSchemaCompatibility,translateSql} from "./sqlite-connection";
test("SQLite requirements schema persists distinct projects and is idempotent",()=>{
 const db=new DatabaseSync(":memory:");
 try {
 db.exec(SQLITE_SCHEMA);
 for(const id of ['project-a','project-b']) db.prepare("INSERT INTO Projects(id,slug,name,projectType) VALUES (?,?,?,1)").run(id,id,id);
 db.prepare(translateSql("INSERT INTO dbo.ProjectCaseInputRequirement (projectId,caseId,[key],required,sensitive,namedProfileRef) VALUES (?,?,?,?,?,?)")).run('project-a',1,'user',1,0,'profile-a');
 db.prepare(translateSql("INSERT INTO dbo.ProjectCaseInputRequirement (projectId,caseId,[key],required,sensitive) VALUES (?,?,?,?,?)")).run('project-b',1,'user',1,0);
 db.exec(SQLITE_SCHEMA);ensureSchemaCompatibility(db);ensureSchemaCompatibility(db);
 assert.equal(db.prepare("SELECT COUNT(*) AS total FROM ProjectCaseInputRequirement").get()?.total,2);
 assert.equal(db.prepare("SELECT namedProfileRef FROM ProjectCaseInputRequirement WHERE projectId=?").get('project-a')?.namedProfileRef,'profile-a');
 assert.throws(()=>db.prepare("INSERT INTO ProjectCaseInputRequirement(projectId,caseId,[key],required,sensitive) VALUES ('missing',1,'x',1,0)").run(),/FOREIGN KEY/);
 }finally{db.close();}
});
test("older SQLite requirement table gains optional column without losing rows",()=>{
 const db=new DatabaseSync(":memory:");try{
 db.exec(SQLITE_SCHEMA.replace('  namedProfileRef TEXT,',''));
 db.prepare("INSERT INTO Projects(id,slug,name,projectType) VALUES ('old','old','old',1)").run();
 db.exec("INSERT INTO ProjectCaseInputRequirement(projectId,caseId,[key],required,sensitive) VALUES ('old',1,'existing',1,0)");
 ensureSchemaCompatibility(db);ensureSchemaCompatibility(db);
 assert.equal(db.prepare("SELECT [key],namedProfileRef FROM ProjectCaseInputRequirement").get()?.key,'existing');
 assert.equal(db.prepare("SELECT namedProfileRef FROM ProjectCaseInputRequirement").get()?.namedProfileRef,null);
 }finally{db.close();}
});

test("runtime values schema is created idempotently and scoped to a project, case, and input key",()=>{
 const db=new DatabaseSync(":memory:");try{
 db.exec(SQLITE_SCHEMA);
 db.prepare("INSERT INTO Projects(id,slug,name,projectType) VALUES ('project-a','project-a','project-a',1)").run();
 db.prepare("INSERT INTO ProjectCaseRuntimeValue(projectId,caseId,[key],valueType,[value],source,verified,confirmed) VALUES (?,?,?,?,?,?,?,?)")
   .run('project-a',53821,'usuario','string','fixture-value','confirmed_case_runtime',1,1);
 db.exec(SQLITE_SCHEMA);
 assert.deepEqual({...db.prepare("SELECT projectId,caseId,[key],valueType,[value],source,verified,confirmed FROM ProjectCaseRuntimeValue")
   .get()}, { projectId:'project-a',caseId:53821,key:'usuario',valueType:'string',value:'fixture-value',source:'confirmed_case_runtime',verified:1,confirmed:1 });
 assert.throws(()=>db.prepare("INSERT INTO ProjectCaseRuntimeValue(projectId,caseId,[key],valueType,[value],source) VALUES ('missing',1,'x','string','v','confirmed_case_runtime')").run(),/FOREIGN KEY/);
 }finally{db.close();}
});

test("Test Design publication lineage is durable, versioned, and keyed by TestRail case id",()=>{
 const db=new DatabaseSync(":memory:");try{
 db.exec(SQLITE_SCHEMA);
 const insert=translateSql("INSERT INTO dbo.TestDesignPublishedCaseLink (testRailCaseId,testRailProjectId,testRailSuiteId,testRailSectionId,projectSlug,jiraProjectKey,issueKey,draftId,storyId,designScenarioId,jiraScenarioId,contentVersion,scenarioJson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
 insert && db.prepare(insert).run(701,15,2,3,"payments","PAY","PAY-7","draft-1","story-1","design-1","PAY-7:jira:4","a".repeat(64),"{}");
 const link=db.prepare("SELECT testRailProjectId,issueKey,designScenarioId,jiraScenarioId,contentVersion,scenarioJson FROM TestDesignPublishedCaseLink WHERE testRailCaseId=701").get() as any;
 assert.deepEqual({...link},{testRailProjectId:15,issueKey:"PAY-7",designScenarioId:"design-1",jiraScenarioId:"PAY-7:jira:4",contentVersion:"a".repeat(64),scenarioJson:"{}"});
 assert.throws(()=>db.prepare(insert).run(701,15,2,3,"payments","PAY","PAY-8","draft-2","story-2","design-2",null,"b".repeat(64),"{}"),/UNIQUE/);
 }finally{db.close();}
});
