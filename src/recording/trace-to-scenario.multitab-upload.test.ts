import assert from "node:assert/strict";
import test from "node:test";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

function fixture(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "recording-multitab-fixture",
    projectSlug: "fixture-project",
    appSlug: "fixture-app",
    platform: "web",
    baseUrl: "https://portal-a.example/",
    startedAt: new Date(0).toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "https://portal-a.example/" } as any],
  } as unknown as SessionTrace;
}

test("recorded direct navigation is rendered as a URL step and retains new-tab lineage", () => {
  const events: RecordedEvent[] = [
    { seq: 1, t: 1, kind: "navigate", screenKey: "inicio", url: "https://portal-a.example/", pageKey: "tab-1", directUserNavigation: true },
    { seq: 2, t: 2, kind: "navigate", screenKey: "inicio", url: "https://approvals.example/queue", pageKey: "tab-2", opensNewPage: true, directUserNavigation: true },
    { seq: 3, t: 3, kind: "tab_switch", screenKey: "inicio", url: "https://portal-a.example/solicitudes?token=private", pageKey: "tab-1" },
  ];

  const scenario = buildHappyPathScenario(fixture(events), events);
  const navigationSteps = scenario.testRailSteps.filter((step) => step.recordingActionType === "navigation");
  assert.deepEqual(navigationSteps.map((step) => step.content), [
    'Navegar al link "https://portal-a.example/"',
    'Abrir una pestaña nueva y navegar al link "https://approvals.example/queue"',
  ]);
  assert.deepEqual(navigationSteps.map((step) => step.expected), ["", ""]);
  assert.equal(navigationSteps[1].pageKey, "tab-2");
  assert.equal(navigationSteps[1].opensNewPage, true);
  assert.equal(scenario.webSteps.find((step) => step.pageKey === "tab-2")?.navigationUrl, "https://approvals.example/queue");
  const switchStep = scenario.testRailSteps.find((step) => step.recordingActionType === "tab_switch");
  assert.equal(switchStep?.content, 'Cambiar a la pestaña "https://portal-a.example/solicitudes"');
  assert.equal(switchStep?.pageKey, "tab-1");
  assert.equal(scenario.webSteps.find((step) => step.recordingActionType === "tab_switch")?.pageKey, "tab-1");
});

test("login and approval interactions on the second web app remain ordered through return to the first app", () => {
  const events: RecordedEvent[] = [
    { seq: 1, t: 1, kind: "navigate", screenKey: "inicio", url: "https://portal-a.example/solicitudes", pageKey: "tab-1", directUserNavigation: true },
    { seq: 2, t: 2, kind: "navigate", screenKey: "inicio", url: "https://approvals.example/login", pageKey: "tab-2", opensNewPage: true, directUserNavigation: true },
    { seq: 3, t: 3, kind: "fill", screenKey: "login", url: "https://approvals.example/login", pageKey: "tab-2", target: { label: "Usuario", tagName: "input", locators: [{ strategy: "css", value: "#username", confidence: 0.99 }] } as any, value: "qa-operator" },
    { seq: 4, t: 4, kind: "fill", screenKey: "login", url: "https://approvals.example/login", pageKey: "tab-2", target: { label: "Contraseña", tagName: "input", inputType: "password", locators: [{ strategy: "css", value: "#password", confidence: 0.99 }] } as any, value: "synthetic-password" },
    { seq: 5, t: 5, kind: "tap", screenKey: "login", url: "https://approvals.example/login", pageKey: "tab-2", target: { label: "Iniciar sesión", role: "button", tagName: "button", locators: [{ strategy: "role", value: "button|Iniciar sesión", confidence: 0.99 }] } as any },
    { seq: 6, t: 6, kind: "tap", screenKey: "queue", url: "https://approvals.example/queue", pageKey: "tab-2", target: { label: "Aprobar", role: "button", tagName: "button", locators: [{ strategy: "role", value: "button|Aprobar", confidence: 0.99 }] } as any },
    { seq: 7, t: 7, kind: "tab_switch", screenKey: "solicitud", url: "https://portal-a.example/solicitudes/pendientes?session=private", pageKey: "tab-1" },
    { seq: 8, t: 8, kind: "tap", screenKey: "solicitud", url: "https://portal-a.example/solicitudes/pendientes", pageKey: "tab-1", target: { label: "Continuar", role: "button", tagName: "button", locators: [{ strategy: "role", value: "button|Continuar", confidence: 0.99 }] } as any },
  ];

  const scenario = buildHappyPathScenario(fixture(events), events);
  const steps = scenario.testRailSteps;
  const findStep = (pattern: RegExp) => steps.findIndex((step) => pattern.test(step.content));
  const usernameIndex = findStep(/Usuario/i);
  const passwordIndex = findStep(/Contraseñ|valor protegido/i);
  const loginIndex = findStep(/Iniciar sesión/i);
  const approveIndex = findStep(/Aprobar/i);
  const returnIndex = findStep(/Cambiar a la pestaña "https:\/\/portal-a\.example\/solicitudes\/pendientes"/i);
  const continueIndex = findStep(/Continuar/i);

  assert.ok(usernameIndex >= 0 && passwordIndex > usernameIndex && loginIndex > passwordIndex && approveIndex > loginIndex);
  assert.ok(returnIndex > approveIndex && continueIndex > returnIndex, "return to Web A must remain between approval and continuation");
  for (const index of [usernameIndex, passwordIndex, loginIndex, approveIndex]) assert.equal(steps[index].pageKey, "tab-2");
  assert.equal(steps[returnIndex].pageKey, "tab-1");
  assert.equal(steps[continueIndex].pageKey, "tab-1");
  assert.equal(steps[passwordIndex].sensitive, true, "the Web B password remains marked sensitive");
  assert.ok(scenario.webSteps.filter((step) => step.pageKey === "tab-2").length >= 4, "all Web B actions remain in the executable plan");
});

test("recorded file upload stays visible in the step list with page and durable asset lineage", () => {
  const upload: RecordedEvent = {
    seq: 3,
    t: 3,
    kind: "file_upload",
    screenKey: "upload-form",
    pageKey: "tab-2",
    url: "https://approvals.example/queue",
    target: {
      label: "Documentación",
      associatedField: "Documentación",
      tagName: "input",
      inputType: "file",
      locators: [{ strategy: "css", value: "#documents", confidence: 0.99 }],
    } as any,
    fileAssets: [{ fileRef: "project-file-ref", filename: "constancia.pdf", contentType: "application/pdf", size: 8, sha256: "a".repeat(64) }],
  };

  const scenario = buildHappyPathScenario(fixture([upload]), [upload]);
  const uploadStep = scenario.testRailSteps.find((step) => step.recordingActionType === "upload");
  assert.ok(uploadStep);
  assert.equal(uploadStep.content, 'Adjuntar "constancia.pdf" en "Documentación"');
  assert.equal(uploadStep.pageKey, "tab-2");
  assert.equal(uploadStep.fileAssets?.[0]?.fileRef, "project-file-ref");
  assert.ok(uploadStep.fileSetValueKey);
  assert.equal(scenario.webSteps.find((step) => step.recordingActionType === "upload")?.pageKey, "tab-2");
});
