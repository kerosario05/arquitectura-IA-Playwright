import assert from "node:assert";
import { createInputRequirementsHandlers } from "./projects";

function test(label: string, fn: () => void | Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS  ${label}`))
    .catch((err) => {
      console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

function makeRes() {
  let statusCode = 200;
  let body: unknown;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
  return res;
}

function makeService() {
  const calls: Array<{ op: string; projectSlug: string; caseId: number; requirements?: unknown }> = [];
  return {
    calls,
    getByProjectAndCase: async (projectSlug: string, caseId: number) => {
      calls.push({ op: "get", projectSlug, caseId });
      if (projectSlug === "missing") throw new Error(`project not found: ${projectSlug}`);
      return [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }];
    },
    replaceForProjectAndCase: async (projectSlug: string, caseId: number, requirements: unknown) => {
      calls.push({ op: "replace", projectSlug, caseId, requirements });
    },
  };
}

describe("projects input-requirements handlers", () => {
  test("A: GET valid calls service with slug+caseId and responds with inputRequirements", async () => {
    const svc = makeService();
    const { getInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    let nextErr: unknown;
    await getInputRequirements({ params: { projectSlug: "app-a", caseId: "4171" } }, res, (e: unknown) => {
      nextErr = e;
    });
    assert.strictEqual(nextErr, undefined);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(svc.calls[0], { op: "get", projectSlug: "app-a", caseId: 4171 });
    assert.deepStrictEqual(res.body, {
      projectSlug: "app-a",
      caseId: 4171,
       inputRequirements: [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }],
    });
  });

  test("B: PUT valid calls replace and responds with the persisted state", async () => {
    const svc = makeService();
    const { putInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    let nextErr: unknown;
    await putInputRequirements(
      { params: { projectSlug: "app-a", caseId: "4171" }, body: { inputRequirements: [{ key: "auth.username" }] } },
      res,
      (e: unknown) => {
        nextErr = e;
      },
    );
    assert.strictEqual(nextErr, undefined);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(svc.calls[0], {
      op: "replace",
      projectSlug: "app-a",
      caseId: 4171,
      requirements: [{ key: "auth.username" }],
    });
    assert.deepStrictEqual(res.body, {
      projectSlug: "app-a",
      caseId: 4171,
       inputRequirements: [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }],
    });
  });

  test("C: invalid caseId returns 400 and does not call the service", async () => {
    const svc = makeService();
    const { getInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    await getInputRequirements({ params: { projectSlug: "app-a", caseId: "not-a-number" } }, res, () => {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(svc.calls.length, 0);
  });

  test("D: PUT without an inputRequirements array returns 400 and does not call the service", async () => {
    const svc = makeService();
    const { putInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    await putInputRequirements(
      { params: { projectSlug: "app-a", caseId: "4171" }, body: {} },
      res,
      () => {},
    );
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(svc.calls.length, 0);
  });

  test("unknown project maps to 404 via the router error pattern", async () => {
    const svc = makeService();
    const { getInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    await getInputRequirements({ params: { projectSlug: "missing", caseId: "4171" } }, res, () => {});
    assert.strictEqual(res.statusCode, 404);
  });

  test("PUT maps invalid namedProfileRef to 400 without exposing config", async () => {
    const svc = makeService();
    svc.replaceForProjectAndCase = async () => {
      const error = new Error("internal profile details") as Error & { code: string };
      error.code = "named_profile_reference_not_configured";
      throw error;
    };
    const { putInputRequirements } = createInputRequirementsHandlers(svc as any);
    const res = makeRes();
    let nextErr: unknown;
    await putInputRequirements(
      { params: { projectSlug: "app-a", caseId: "4171" }, body: { inputRequirements: [{ key: "auth.username", namedProfileRef: "missing" }] } },
      res,
      (e: unknown) => { nextErr = e; },
    );
    assert.strictEqual(nextErr, undefined);
    assert.strictEqual(res.statusCode, 400);
    assert.deepStrictEqual(res.body, { ok: false, error: "named_profile_reference_not_configured", message: "named profile reference is not configured for this project" });
  });
});
