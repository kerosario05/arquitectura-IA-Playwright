import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "./principal";

const actor = new AsyncLocalStorage<{ analystName: string; analystEmail?: string }>();

/** Server-owned identity scoped to one authenticated request and its asynchronous work. */
export function withReportAttribution<T>(principal: Principal, work: () => T): T {
  const isUser = principal.kind === "user";
  return actor.run({
    analystName: isUser ? principal.fullName?.trim() || principal.username : "Automatización",
    analystEmail: isUser ? principal.email : undefined,
  }, work);
}

export function currentReportAnalyst(): string | undefined {
  return actor.getStore()?.analystName;
}

/** Email of the signed-in QA Lab user (undefined for service callers or users without one). */
export function currentReportAnalystEmail(): string | undefined {
  return actor.getStore()?.analystEmail;
}

export function evidenceActorEnvironment(params: Record<string, unknown>): Record<string, string> {
  const analyst = typeof params.analystName === "string" ? params.analystName.trim() : currentReportAnalyst();
  return analyst ? { EVIDENCE_ANALYST_NAME: analyst } : {};
}
