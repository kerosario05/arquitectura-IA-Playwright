import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "./principal";

const actor = new AsyncLocalStorage<{ analystName: string }>();

/** Server-owned identity scoped to one authenticated request and its asynchronous work. */
export function withReportAttribution<T>(principal: Principal, work: () => T): T {
  return actor.run({ analystName: principal.kind === "user" ? principal.fullName?.trim() || principal.username : "Automatización" }, work);
}

export function currentReportAnalyst(): string | undefined {
  return actor.getStore()?.analystName;
}

export function evidenceActorEnvironment(params: Record<string, unknown>): Record<string, string> {
  const analyst = typeof params.analystName === "string" ? params.analystName.trim() : currentReportAnalyst();
  return analyst ? { EVIDENCE_ANALYST_NAME: analyst } : {};
}
