import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { approvePageObjectCandidates, parseArgs } from "../src/cli/page-objects-approve";
import { ensurePageObjectRegistry, savePageObjectRegistry, registerPageObjectCandidate, registerMethodCandidate } from "../src/automations/page-object-registry";
import { loadPageObjectRegistry } from "../src/automations/page-object-registry";
import { autoApproveSafePageObjects } from "../src/automations/page-object-approval";
import { getTestTempDir, ensureTestTempDir, cleanTestTempDir } from "./helpers/test-temp-dir";

const tmpDir = getTestTempDir("test-page-object-approve");

test.beforeAll(async () => {
  await ensureTestTempDir("test-page-object-approve");
});

test.afterAll(async () => {
  await cleanTestTempDir("test-page-object-approve").catch(() => {});
});

test("CLI parsea --only", () => {
  const args = parseArgs(["--only", "HomePage"]);
  expect(args.only).toBe("HomePage");
});

test("CLI parsea --all", () => {
  const args = parseArgs(["--all"]);
  expect(args.all).toBe(true);
});

test("CLI parsea --overwrite-active", () => {
  const args = parseArgs(["--overwrite-active"]);
  expect(args.overwriteActive).toBe(true);
});

test("CLI parsea --dry-run", () => {
  const args = parseArgs(["--dry-run"]);
  expect(args.dryRun).toBe(true);
});

test("CLI parsea --app", () => {
  const args = parseArgs(["--app", "myapp"]);
  expect(args.app).toBe("myapp");
});

test("CLI parsea flags combinados", () => {
  const args = parseArgs(["--app", "production", "--only", "HomePage", "--dry-run", "--overwrite-active"]);
  expect(args.app).toBe("production");
  expect(args.only).toBe("HomePage");
  expect(args.dryRun).toBe(true);
  expect(args.overwriteActive).toBe(true);
});

test("CLI rechaza unknown argument", () => {
  expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument");
});

test("CLI --only missing value throws", () => {
  expect(() => parseArgs(["--only"])).toThrow("Missing value");
});

test("approve --only HomePage copia candidate a active .page.ts", async () => {
  const appSlug = "test-approve-only";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class HomePage {}", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.approved).toBe(1);
  expect(result.errors).toHaveLength(0);

  const activeFile = path.join(pagesDir, "home.page.ts");
  await expect(fs.access(activeFile)).resolves.toBeUndefined();

  const activeContent = await fs.readFile(activeFile, "utf-8");
  expect(activeContent).toBe("export class HomePage {}");
});

test("actualiza status active y available=true", async () => {
  const appSlug = "test-approve-status";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "category.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class CategoryPage {}", "utf-8");

  await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "CategoryPage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  const updatedRegistry = await loadPageObjectRegistry({ appSlug } as any, tmpDir);
  const categoryPO = updatedRegistry.pageObjects.find((po) => po.className === "CategoryPage");

  expect(categoryPO).toBeDefined();
  expect(categoryPO?.status).toBe("active");
  expect(categoryPO?.methods[0].status).toBe("active");
  expect(categoryPO?.methods[0].available).toBe(true);
  expect(categoryPO?.filePath).toContain("category.page.ts");

  const approvalMeta = (categoryPO as any).approvalMetadata;
  expect(approvalMeta).toBeDefined();
  expect(approvalMeta.approvedBy).toBe("page-objects:approve");
  expect(approvalMeta.approvedAt).toBeDefined();
  expect(approvalMeta.approvedFrom).toContain("category.page.candidate.ts");
});

test("dry-run no escribe ni actualiza registry", async () => {
  const appSlug = "test-approve-dryrun";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class HomePage {}", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: false,
    dryRun: true
  });

  expect(result.approved).toBe(0);
  expect(result.skipped).toBe(1);

  const activeFile = path.join(pagesDir, "home.page.ts");
  await expect(fs.access(activeFile)).rejects.toThrow();

  const updatedRegistry = await loadPageObjectRegistry({ appSlug } as any, tmpDir);
  const homePO = updatedRegistry.pageObjects.find((po) => po.className === "HomePage");
  expect(homePO?.status).toBe("candidate");
});

test("sin --only/--all falla", async () => {
  const appSlug = "test-approve-no-selector";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: undefined,
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors[0]).toContain("--only");
  expect(result.errors[0]).toContain("--all");
});

test("target existente sin --overwrite-active falla", async () => {
  const appSlug = "test-approve-existing";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class HomePage {}", "utf-8");

  const activeFile = path.join(pagesDir, "home.page.ts");
  await fs.writeFile(activeFile, "export class HomePage { existing }", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors[0]).toContain("--overwrite-active");
});

test("--overwrite-active permite reemplazar", async () => {
  const appSlug = "test-approve-overwrite";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class HomePage { approved }", "utf-8");

  const activeFile = path.join(pagesDir, "home.page.ts");
  await fs.writeFile(activeFile, "export class HomePage { old }", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: true,
    dryRun: false
  });

  expect(result.approved).toBe(1);
  expect(result.errors).toHaveLength(0);

  const activeContent = await fs.readFile(activeFile, "utf-8");
  expect(activeContent).toBe("export class HomePage { approved }");
});

test("source candidate missing falla con mensaje claro", async () => {
  const appSlug = "test-approve-missing";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.errors.length).toBeGreaterThan(0);
  expect(result.errors[0]).toContain("not found");
  expect(result.errors[0]).toContain("home.page.candidate.ts");
});

test("no aprueba sensitive=true automaticamente", async () => {
  const appSlug = "test-approve-sensitive";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "LoginForm",
    className: "LoginPage",
    screenSignature: `screen:${appSlug}-login`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: []
  });

  const loginPO = registry.pageObjects.find((po) => po.className === "LoginPage");
  if (loginPO) {
    registerMethodCandidate(registry, loginPO.id, {
      name: "fillUsername",
      intent: "fill_form_field",
      sensitive: true,
      sourceActionId: "test-1"
    });
    registerMethodCandidate(registry, loginPO.id, {
      name: "fillPassword",
      intent: "fill_form_field",
      sensitive: true,
      sourceActionId: "test-2"
    });
  }

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "login.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class LoginPage {}", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "LoginPage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.approved).toBe(1);
  expect(result.warnings.length).toBeGreaterThan(0);
  expect(result.warnings[0]).toContain("sensitive");

  const updatedLoginRegistry = await loadPageObjectRegistry({ appSlug } as any, tmpDir);
  const approvedLoginPO = updatedLoginRegistry.pageObjects.find((po) => po.className === "LoginPage");
  expect(approvedLoginPO?.methods[0].sensitive).toBe(true);
  expect(approvedLoginPO?.methods[0].available).toBe(true);
});

test("--all aprueba todos los candidates", async () => {
  const appSlug = "test-approve-all";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  registerPageObjectCandidate(registry, {
    name: "Category",
    className: "CategoryPage",
    screenSignature: `screen:${appSlug}-category`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "selectCategory", intent: "select_category" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });

  await fs.writeFile(path.join(pagesDir, "home.page.candidate.ts"), "export class HomePage {}", "utf-8");
  await fs.writeFile(path.join(pagesDir, "category.page.candidate.ts"), "export class CategoryPage {}", "utf-8");

  const result = await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: undefined,
    approveAll: true,
    overwriteActive: false,
    dryRun: false
  });

  expect(result.approved).toBe(2);
  expect(result.errors).toHaveLength(0);

  await expect(fs.access(path.join(pagesDir, "home.page.ts"))).resolves.toBeUndefined();
  await expect(fs.access(path.join(pagesDir, "category.page.ts"))).resolves.toBeUndefined();
});

test("candidate file no se borra tras aprobacion", async () => {
  const appSlug = "test-approve-keep-candidate";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "HomePage",
    className: "HomePage",
    screenSignature: `screen:${appSlug}-home`,
    confidence: 0.5,
    sourcePlanId: "test-plan-1",
    methods: [{ name: "start", intent: "start_session" }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "home.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class HomePage {}", "utf-8");

  await approvePageObjectCandidates(appSlug, tmpDir, {
    onlyClassName: "HomePage",
    approveAll: false,
    overwriteActive: false,
    dryRun: false
  });

  await expect(fs.access(candidateFile)).resolves.toBeUndefined();
});

test("auto-approve blocks LoginPage candidate when source contains OTP or literal credentials", async () => {
  const appSlug = "test-approve-login-source-block";
  const registry = await ensurePageObjectRegistry({ appSlug } as any, tmpDir);

  registerPageObjectCandidate(registry, {
    name: "LoginPage",
    className: "LoginPage",
    screenSignature: `screen:${appSlug}-login`,
    confidence: 0.9,
    sourcePlanId: "test-plan-login",
    methods: [{ name: "fillUsername", intent: "fill_username", parameters: ["value"] }]
  });

  await savePageObjectRegistry(registry, { appSlug } as any, tmpDir);

  const pagesDir = path.join(tmpDir, "automations", "apps", appSlug, "pages");
  await fs.mkdir(pagesDir, { recursive: true });
  const candidateFile = path.join(pagesDir, "login.page.candidate.ts");
  await fs.writeFile(candidateFile, "export class LoginPage { async fillUsername(value: string) { const otp = '123456'; await this.page.fill('#user', 'admin'); } }", "utf-8");

  const result = await autoApproveSafePageObjects(appSlug, tmpDir, {
    approveAll: true,
    overwriteActive: true,
    dryRun: false,
    confidenceThreshold: 0.5,
    blockSensitive: true
  });

  expect(result.approved).toBe(0);
  expect(result.blockedAutoApprovals.some((entry) => entry.includes("LoginPage"))).toBe(true);

  const activeFile = path.join(pagesDir, "login.page.ts");
  await expect(fs.access(activeFile)).rejects.toThrow();
});
