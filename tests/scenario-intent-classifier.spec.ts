import test from "node:test";
import assert from "node:assert/strict";
import { classifyScenarioIntent, hasPrivateIntentConfiguration } from "../src/scenarios/scenario-intent-classifier";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";

function makeIssue(overrides: Partial<JiraIssueSource>): JiraIssueSource {
  return {
    key: overrides.key ?? "HU-1",
    summary: overrides.summary ?? "",
    description: overrides.description ?? "",
    acceptanceCriteria: overrides.acceptanceCriteria ?? null,
    labels: overrides.labels ?? [],
    components: overrides.components ?? [],
    status: overrides.status ?? "To Do",
    issueType: overrides.issueType ?? "Historia",
  };
}

test("clasifica private/authenticated_transaction para consulta de balance de depósitos a plazo", () => {
  const issue = makeIssue({
    key: "HU-PRIV-1",
    summary: "Consultar balance de mis depósitos a plazo",
    description: "Como cliente autenticado quiero consultar balance de mis depósitos a plazo para validar el monto invertido.",
  });
  const appConfig = {
    authProfile: { mode: "protected_navigation" },
    privateRoutes: [
      {
        module: "Transacciones y servicios",
        path: ["Transacciones y servicios", "Consulta de balance", "Depósitos a plazos"],
        signals: ["consulta de balance", "depósitos a plazo", "monto invertido"],
      },
    ],
    intentRules: {
      private: {
        signals: ["consulta de balance", "mis depósitos a plazo"],
      },
    },
  };

  const result = classifyScenarioIntent({
    issue,
    appSlug: "banking-app",
    appConfig,
    routeProfile: null,
  });

  assert.equal(result.intent, "private/authenticated_transaction");
  assert.equal(result.requiresAuth, true);
  assert.equal(result.suggestedRoute, "Transacciones y servicios > Consulta de balance > Depósitos a plazos");
  assert.equal(result.source, "mixed");
});

test("clasifica public/product_information para HU informativa pública", () => {
  const issue = makeIssue({
    key: "HU-PUB-1",
    summary: "Ver información, beneficios y requisitos de depósitos a plazo",
    description: "Como visitante quiero ver información de productos, beneficios y requisitos de depósitos a plazo.",
  });
  const appConfig = {
    publicRoutes: [
      {
        module: "Información de productos",
        path: ["Información de productos"],
        signals: ["información de productos", "beneficios", "requisitos"],
      },
    ],
  };

  const result = classifyScenarioIntent({
    issue,
    appSlug: "generic-public-app",
    appConfig,
    routeProfile: null,
  });

  assert.equal(result.intent, "public/product_information");
  assert.equal(result.requiresAuth, false);
});

test("detecta configuración privada faltante", () => {
  assert.equal(hasPrivateIntentConfiguration(null), false);
  assert.equal(hasPrivateIntentConfiguration({ authProfile: { mode: "x" } }), false);
  assert.equal(hasPrivateIntentConfiguration({ privateRoutes: [{ path: ["A"] }] }), false);
  assert.equal(
    hasPrivateIntentConfiguration({
      authProfile: { mode: "protected_navigation" },
      privateRoutes: [{ path: ["A", "B"] }],
    }),
    true,
  );
});
