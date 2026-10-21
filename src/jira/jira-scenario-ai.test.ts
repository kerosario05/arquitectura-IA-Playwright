import test from "node:test";
import assert from "node:assert/strict";
import { jiraScenarioAiConfig, withJiraJsonRecovery } from "./jira-scenario-ai";

test("Jira model and effort overrides preserve the shared configuration", () => {
 const base = {enabled:true, providerName:"codex",baseUrl:"",apiKey:"",timeoutMs:1000,requireJson:true,requireJsonSchema:false, provider:"codex_cli" as const, model:"original", extraArgs:[]};
 const result = jiraScenarioAiConfig(base,{AI_JIRA_SCENARIO_MODEL:"gpt-5.6-terra",AI_JIRA_SCENARIO_REASONING_EFFORT:"low"});
 assert.equal(result.model,"gpt-5.6-terra");
 assert.deepEqual(result.extraArgs,["-c","model_reasoning_effort=low"]);
 assert.equal(base.model,"original"); assert.deepEqual(base.extraArgs,[]);
 assert.throws(()=>jiraScenarioAiConfig(base,{AI_JIRA_SCENARIO_REASONING_EFFORT:"unknown"}),/INVALID/);
});

import { AiProviderError, type AiProvider } from "../ai/ai-provider.types";

test("malformed Jira file gets one syntax-only repair and retains identities", async () => {
 let calls=0;
 const provider: AiProvider={providerType:"fake",providerName:"fake",model:"fixture",async completeJson(request){
 calls++; if(calls===1) throw new AiProviderError("ai_provider_output_missing","invalid",{exitCode:0,tempDir:"fixture",outputPath:"fixture/scenario-generation-result.json"});
 assert.match(request.messages[0].content,/syntax only/); assert.doesNotMatch(request.messages[1].content,/original story/);
 return {parsedJson:{scenarios:[{sourceIssueKey:"HU-1",title:"Case",steps:["Action"]}]},rawText:"",model:"fixture",providerName:"fake",durationMs:0}; }};
 const wrapped=withJiraJsonRecovery(provider,async()=>'{"scenarios":[{"sourceIssueKey":"HU-1","title":"Case","steps":["Action\n]}]}' as never);
 const result=await wrapped.completeJson({purpose:"scenario_generation",messages:[{role:"user",content:"original story"}]});
 assert.equal((result.parsedJson?.scenarios as unknown[]).length,1);assert.equal(calls,2);
});
test("missing file or second provider failure never loops", async () => {
 let calls=0;const failure=new AiProviderError("ai_provider_output_missing","missing",{exitCode:0,tempDir:"fixture",outputPath:"fixture/scenario-generation-result.json"});
 const provider:AiProvider={providerType:"fake",providerName:"fake",model:"fixture",async completeJson(){calls++;throw failure;}};
 await assert.rejects(withJiraJsonRecovery(provider,async()=>{throw new Error("missing");}).completeJson({purpose:"scenario_generation",messages:[]}),error=>error===failure);
 assert.equal(calls,1);
 await assert.rejects(withJiraJsonRecovery(provider,async()=>'{"sourceIssueKey":"HU-1","title":"Case",' as never).completeJson({purpose:"scenario_generation",messages:[]}),error=>error===failure);
 assert.equal(calls,3);
});

test("syntax recovery reports invalid JSON when repair changes business steps", async () => {
 let calls=0;const failure=new AiProviderError("ai_provider_output_missing","invalid",{exitCode:0,tempDir:"fixture",outputPath:"fixture/scenario-generation-result.json"});
 const provider:AiProvider={providerType:"fake",providerName:"fake",model:"fixture",async completeJson(){if(++calls===1)throw failure;return {parsedJson:{scenarios:[{sourceIssueKey:"HU-1",title:"Case",steps:["Changed"]}]},rawText:"",model:"fixture",providerName:"fake",durationMs:0};}};
 await assert.rejects(withJiraJsonRecovery(provider,async()=>'{"scenarios":[{"sourceIssueKey":"HU-1","title":"Case","steps":["Original\n]}]}' as never).completeJson({purpose:"scenario_generation",messages:[]}),error=>error instanceof AiProviderError && error.code === "ai_provider_invalid_json" && error.diagnostics?.syntaxRecovery === "scenario_content_changed");
 assert.equal(calls,2);
});
