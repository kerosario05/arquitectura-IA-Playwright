import type { JiraIssueSource } from "../scenarios/scenario-types";

// Cycle-free home for Jira source-clause parsing, shared by jira-scenario-generator and jira-generation-contract.
function normalized(text: string) {return text.normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().trim().replace(/^(?:el|la|los|las|un|una|the)\s+/,"").trim();}

export function jiraAcceptanceClauses(issue: JiraIssueSource): Array<{ id: string; text: string }> {
  const sources=[issue.description,issue.acceptanceCriteria].map(value=>(value ?? "").trim()).filter((value,index,all)=>!!value && all.indexOf(value)===index);
  const text = sources.join("\n");
  const markers = [...text.matchAll(/(?:^|\n|\.\s+)(AC\d+)(?:\s*[—–:-]\s*|\s+)/gi)];
  // Many projects keep acceptance criteria as numbered lists, bullets or plain
  // prose rather than AC headings. Use that explicit field as the source; do
  // not turn the entire story/development notes into invented obligations.
  if (!markers.length && issue.acceptanceCriteria?.trim()) {
    const criteria = issue.acceptanceCriteria.trim().replace(/\r\n/g,'\n');
    const numbered = [...criteria.matchAll(/(?:^|\n)\s*(\d+)[.)]\s+([^]+?)(?=\n\s*\d+[.)]\s+|$)/g)];
    if (numbered.length) return numbered.map(match => ({ id:`AC${match[1]}.1`, text:match[2].trim() }));
    const bullets = criteria.split(/\n\s*[-*•]\s+/).map(line=>line.replace(/^[-*•]\s+/,'').trim()).filter(Boolean);
    if (bullets.length > 1) return bullets.map((body,index)=>({id:`AC${index+1}.1`,text:body}));
    return criteria.split(/\n+|\.\s+/).map(body=>body.trim()).filter(Boolean).map((body,index)=>({id:`AC1.${index+1}`,text:body}));
  }
  const clauses: Array<{id:string;text:string}> = [];
  for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
    const marker = markers[markerIndex];
    const bodyStart = (marker.index ?? 0) + marker[0].length;
    const bodyEnd = markers[markerIndex + 1]?.index ?? text.length;
    // Only text in the formal AC block is an acceptance obligation. Jira stories
    // often append a detailed walkthrough, stress notes, or test-data notes after
    // the last AC; without a section boundary those paragraphs get misnumbered as
    // AC13.6, AC13.7, etc. and make otherwise covered scenarios unlaunchable.
    const rawBody = text.slice(bodyStart, bodyEnd)
      .split(/\n\s*(?:Consideraciones(?: para desarrollo)?|Recorrido(?: positivo| detallado)?|Criterio(?: de estrés)?|Datos de prueba|Datos ficticios|Restricciones de prueba)\b[^\n]*/i, 1)[0]
      .trim();
    if (!rawBody) continue;
    const lines = rawBody.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
    // Jira commonly stores an AC heading on one line and its criterion on the next.
    // Keep an inline sentence as the criterion; discard only an unpunctuated heading
    // when a separate body follows it.
    const firstLine = lines[0] ?? "";
    const firstIsHeading = lines.length > 1 && !/[.!?;:]$/.test(firstLine);
    const selectedLines=firstIsHeading ? lines.slice(1) : lines;
    // Some Jira projects put a short AC heading and its criterion on one line,
    // separated by a colon (for example, "AC1 Personal: ...").
    if(!firstIsHeading && selectedLines.length){
      selectedLines[0]=selectedLines[0].replace(/^[^:]{1,100}:\s*/,"");
    }
    const body = selectedLines.join(" ");
    // A lone capital before the dot is a name initial ("Laura M. permite..."), not a sentence end,
    // unless an uppercase word follows ("opción A. Luego ...").
    const atoms = body.split(/(?<!\b\p{Lu})(?:\.\s+|\.$)|(?<=\b\p{Lu})\.\s+(?=\p{Lu})/u).map(clause=>clause.trim()).filter(Boolean);
    atoms.forEach((clause,index)=>clauses.push({id:`${marker[1].toUpperCase()}.${index+1}`,text:clause}));
  }
  const seen = new Set<string>();
  return clauses.filter(clause=>{if(seen.has(clause.id))return false;seen.add(clause.id);return true;});
}

/**
 * Ordered "o"-separated alternatives of one clause that name a fixed literal ("... o el alias Atlas").
 * Branch N is the Nth alternative; its full ref is `<clauseId>.<N>` (AC4.1.2). Only the text before
 * the first comma/semicolon lists alternatives; the outcome after it is not scanned.
 */
export function literalAlternativeBranches(clauseText:string):Array<{branch:number;field:string;literal:string}>{
 const text=clauseText.split(/[,;]/)[0];
 return [...text.matchAll(/\s(?:o|or)\s+(?:el|la|los|las|the)\s+(\p{Ll}+)\s+(?:["“]([^"”]+)["”]|(\p{Lu}[\p{L}\d]*))/gu)].map(match=>({
  branch:2+[...text.slice(0,match.index).matchAll(/\s(?:o|or)\s/g)].length,
  field:normalized(match[1]),literal:normalized(match[2]??match[3]),
 }));
}
