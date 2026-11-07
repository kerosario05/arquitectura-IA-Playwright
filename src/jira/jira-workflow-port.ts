import type { Page } from "@playwright/test";
import type { JiraBrowserPort } from "./jira-semantic-executor";
import type { JiraWorkflowSession } from "./jira-workflow-runtime";

/** Routes existing Jira actions to the active application without changing their resolver. */
export function bindJiraWorkflowPort(session: JiraWorkflowSession, primary: JiraBrowserPort,
  create: (page: Page, baseUrl: string) => JiraBrowserPort): JiraBrowserPort {
  const ports = new Map<Page, JiraBrowserPort>([[session.page, primary]]);
  return new Proxy(primary, {
    get(_target, property) {
      if (property === "executeWorkflow") return session.execute.bind(session);
      let port = ports.get(session.page);
      if (!port) { port = create(session.page, session.baseUrl); ports.set(session.page, port); }
      const value = Reflect.get(port, property);
      return typeof value === "function" ? value.bind(port) : value;
    },
  });
}
