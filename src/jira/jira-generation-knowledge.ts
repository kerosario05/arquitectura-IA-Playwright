import type { JiraLearnedRoute } from "./jira-knowledge-repository";
import type { JiraIssueSource } from "../scenarios/scenario-types";

export type JiraGenerationKnowledgeDiagnostics = {
  sourceIssueKey: string;
  candidatesScanned: number;
  eligibleRoutes: number;
  selectedRoutes: number;
  selectedActions: number;
  rejectedInvalidated: number;
  rejectedProfile: number;
  rejectedExpired: number;
};

/** Keep actions up to and including the n-th click (0-based among clicks with a field). */
function cutAfterClick(actions: JiraLearnedRoute["actions"], clickIndex: number) {
  let seen = -1;
  const end = actions.findIndex(action => action.action === "click" && !!action.field && ++seen === clickIndex);
  return end < 0 ? actions : actions.slice(0, end + 1);
}

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// ponytail: 7-char prefix stems tolerate plural/derivation (transferencia/transferencias/transferir); upgrade to a real stemmer if it over-matches.
const stem = (token: string) => token.replace(/s$/, "").slice(0, 7);
const MAX_EXACT_ISSUE_ROUTES = 16;

function learnedRouteSignature(route: JiraLearnedRoute): string {
  const actions = route.actions.map(action => [action.action, normalize(action.field ?? ""), action.targetKind ?? "",
    action.action === "press" && /^(?:Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(action.key ?? "") ? action.key : ""]);
  const observables = (route.observables ?? [])
    .map(observable => [normalize(observable.requirement), normalize(observable.target)])
    .sort((a, b) => a.join("\u0000").localeCompare(b.join("\u0000")));
  return JSON.stringify({ startsFrom: route.startsFrom, actions, observables });
}

/** True when every token of a (>=5 char) UI label appears, stem-wise, in the text. */
export function jiraLabelInText(label: string, text: string): boolean {
  const normalized = normalize(label);
  const textStems = new Set(normalize(text).split(" ").map(stem));
  return normalized.length >= 5 && normalized.split(" ").every(token => textStems.has(stem(token)));
}

export function resolveJiraGenerationKnowledge(appSlug: string, issues: JiraIssueSource[], learned: JiraLearnedRoute[] = [], profileRevision?: string, now = Date.now()) {
  const diagnostics: JiraGenerationKnowledgeDiagnostics[] = [];
  const knowledge = issues.map(issue => {
    const text = normalize([issue.summary, issue.description, issue.acceptanceCriteria ?? ""].join(" "));
    const scoped = learned.filter(route => route.engine === "jira_semantic" && route.schemaVersion === 1 && route.appSlug === appSlug);
    const revisionMatches = scoped.filter(route => !!profileRevision && route.profileRevision === profileRevision);
    const notInvalidated = revisionMatches.filter(route => !route.invalidatedAt);
    const recent = notInvalidated.filter(route => Number.isFinite(Date.parse(route.validatedAt))
      && now - Date.parse(route.validatedAt) >= 0 && now - Date.parse(route.validatedAt) <= 30 * 86400000);
    const structurallyValid = recent.filter(route => route.evidenceRefs.length > 0 && route.actions.length > 0 && route.actions.length <= 48);
    // Prefer history learned from this exact Jira story. For sibling stories, use
    // a route only when one of its observed click labels appears in the source.
    const exactIssue = structurallyValid.filter(route => route.sourceIssueKey === issue.key);
    // A click label shared by several routes (e.g. "Continuar") says nothing about
    // which flow the story describes, so it cannot select a sibling route alone.
    const clickLabels = (route: JiraLearnedRoute) => route.actions
      .filter(action => action.action === "click" && !!action.field).map(action => normalize(action.field!));
    // A label is ambiguous when it is reached through different click prefixes
    // ("Continuar" after two different flows). The same menu entry repeated at the
    // start of several sibling routes is one destination, not an ambiguity.
    const labelPrefixes = new Map<string, Set<string>>();
    for (const route of structurallyValid) clickLabels(route).forEach((label, index, labels) => {
      const prefixes = labelPrefixes.get(label) ?? new Set<string>();
      labelPrefixes.set(label, prefixes.add(labels.slice(0, index + 1).join(">")));
    });
    const labelInText = (label: string) => jiraLabelInText(label, text);
    // Index of the last click whose unambiguous label the story describes; -1 when none.
    const matchedClick = (route: JiraLearnedRoute) => {
      const labels = clickLabels(route);
      return labels.reduce((last, label, index) => labelPrefixes.get(label)?.size === 1 && labelInText(label) ? index : last, -1);
    };
    const relatedIssue = structurallyValid.filter(route => route.sourceIssueKey !== issue.key && matchedClick(route) >= 0);
    const eligible = exactIssue.length ? exactIssue : relatedIssue;
    const sourceText = normalize(text);
    const relevance = (route: JiraLearnedRoute) => (route.observables ?? []).reduce((score, observable) =>
      score + Number(jiraLabelInText(observable.target, sourceText)
        || jiraLabelInText(observable.requirement, sourceText)), 0);
    const ordered = [...eligible].sort((a, b) => {
      if (exactIssue.length) {
        // Outcomes already observed for this exact story are more useful to
        // generation than a newer navigation-only route. Keep all distinct
        // evidence journeys up to a bounded per-story budget.
        const byRelevantObservables = relevance(b) - relevance(a);
        if (byRelevantObservables) return byRelevantObservables;
        const byObservableCount = (b.observables?.length ?? 0) - (a.observables?.length ?? 0);
        if (byObservableCount) return byObservableCount;
      }
      return Date.parse(b.validatedAt) - Date.parse(a.validatedAt);
    });
    const seenJourneys = new Set<string>();
    const distinct = ordered.filter(route => {
      const signature = learnedRouteSignature(route);
      if (seenJourneys.has(signature)) return false;
      seenJourneys.add(signature);
      return true;
    });
    const selected = distinct
      .slice(0, exactIssue.length ? MAX_EXACT_ISSUE_ROUTES : 2)
      .map(route => ({
        // Preserve the observed interaction order, including fields between
        // repeated Continue clicks, but never transport values or data bindings.
        // A sibling route is cut after the click the story describes: later
        // clicks belong to another flow.
        actions: (exactIssue.length ? route.actions : cutAfterClick(route.actions, matchedClick(route)))
          .map(action => ({action:action.action,...(action.field?{field:action.field}:{}),...(action.targetKind?{targetKind:action.targetKind}:{}),...(action.action==='press'&&/^(?:Enter|Tab|Escape|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/.test(action.key??'')?{key:action.key}:{})})),
        startsFrom: route.startsFrom, sourceIssueKey: route.sourceIssueKey,
        ...(route.sourceIssueKey===issue.key && route.observables?.length ? {observables:route.observables} : {}),
        evidenceRefs: route.evidenceRefs, validatedAt: route.validatedAt }));
    diagnostics.push({ sourceIssueKey: issue.key, candidatesScanned: scoped.length,
      eligibleRoutes: eligible.length, selectedRoutes: selected.length,
      selectedActions: selected.reduce((sum, route) => sum + route.actions.length, 0),
      rejectedInvalidated: revisionMatches.filter(route => Boolean(route.invalidatedAt)).length,
      rejectedProfile: scoped.filter(route => !profileRevision || route.profileRevision !== profileRevision).length,
      rejectedExpired: notInvalidated.filter(route => !Number.isFinite(Date.parse(route.validatedAt))
        || now - Date.parse(route.validatedAt) < 0 || now - Date.parse(route.validatedAt) > 30 * 86400000).length });
    return { sourceIssueKey: issue.key, routes: selected };
  });
  return { knowledge, diagnostics };
}

export function jiraGenerationKnowledge(appSlug: string, issues: JiraIssueSource[], learned: JiraLearnedRoute[] = [], profileRevision?: string, now = Date.now()) {
  return resolveJiraGenerationKnowledge(appSlug, issues, learned, profileRevision, now).knowledge;
}
