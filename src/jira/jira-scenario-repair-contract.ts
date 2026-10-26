// Repair is a delta over an existing draft. Immutable identity/outcome/coverage
// fields are retained by the caller; an empty list means no faithful correction.
export const JIRA_SCENARIO_REPAIR_SCHEMA_NAME = 'jira_scenario_repair';
export const jiraScenarioRepairOutputSchema = {
  type: 'object', additionalProperties: false, required: ['scenarios'],
  properties: {scenarios: {type: 'array', minItems: 0, items: {
    type: 'object', additionalProperties: false,
    required: ['candidateId', 'sourceIssueKey', 'title', 'steps', 'inputRequirements', 'unresolvedUiRequirements'],
    properties: {
      candidateId: {type:'string'}, sourceIssueKey: {type:'string'}, title: {type:'string'},
      steps: {type:'array', items:{type:'string'}},
      inputRequirements: {type:'array', items:{type:'object', additionalProperties:false,
        required:['key','label','stepIndex','operation','dataCondition','required','editable','sensitive','controlType','source'], properties:{
          key:{type:'string'}, label:{type:'string'}, stepIndex:{type:'integer',minimum:1},
          operation:{type:'string',enum:['fill','select']},
          required:{type:'boolean'}, editable:{type:'boolean'}, sensitive:{type:'boolean'},
          controlType:{type:'string',enum:['text','password','select','number']},source:{type:'string',enum:['jira_step']},
          dataCondition:{type:['string','null'],enum:['valid','invalid','expired',null]},
        }}},
      unresolvedUiRequirements: {type:'array',items:{type:'object',additionalProperties:false,
        required:['stepIndex','requirement'],properties:{stepIndex:{type:'integer',minimum:1},requirement:{type:'string'}}}},
    },
  }}},
};
