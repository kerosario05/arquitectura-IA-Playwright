import type { JiraIssueSource } from '../scenarios/scenario-types';
import { jiraAcceptanceClauses } from './jira-source-clauses';

export type JiraCoverageWork = { issue: JiraIssueSource; clauses: Array<{ id: string; text: string }> };
export const JIRA_COVERAGE_BATCH_SIZE = 4;

/** Bound provider work by source obligations, never by an arbitrary scenario count. */
export function planJiraCoverageWork(work: JiraCoverageWork[], size = JIRA_COVERAGE_BATCH_SIZE): JiraCoverageWork[] {
  if (!Number.isInteger(size) || size < 1) throw new Error('JIRA_COVERAGE_BATCH_SIZE_INVALID');
  return work.flatMap(({ issue, clauses }) => {
    const batches: JiraCoverageWork[] = [];
    for (let index = 0; index < clauses.length; index += size) batches.push({ issue, clauses: clauses.slice(index, index + size) });
    return batches;
  });
}

export function jiraStoryCoverageWork(issues: JiraIssueSource[]): JiraCoverageWork[] {
  return issues.map(issue => ({ issue, clauses: jiraAcceptanceClauses(issue) }));
}

/** A branch ref belongs to its assigned clause; a bare AC cannot claim all clauses. */
export function jiraCoverageRefMatches(ref: string, clauseId: string): boolean {
  return ref === clauseId || ref.startsWith(`${clauseId}.`);
}

export const JIRA_SCOPED_GENERATION_POLICY = 'This request is one bounded part of a story coverage plan. Generate self-contained scenarios for the assigned acceptance clauses in generationScope, with all preceding setup/authentication/navigation needed to reach their outcomes. Split independently testable roles, data alternatives, rejection paths and state transitions into distinct cases when the source requires them. Combine compatible assertions on the same path. A complete journey does not replace these complementary cases. Do not generate extra cases solely to reach a count. Reference only the assigned clauses actually verified, not clauses merely used as setup. Keep unknown UI targets explicitly unresolved for Discovery; never invent controls or successful observations. Return only this batch; other batches cover the remaining clauses.';
