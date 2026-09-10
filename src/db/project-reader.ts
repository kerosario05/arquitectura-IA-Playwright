import { getConnection } from "./sql-connection";
import type { Connection } from "odbc";

export type ProjectRow = {
  id: string;
  slug: string;
  name: string;
  projectType: number;
  status: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WebConfig = {
  baseUrl: string;
  loginMode: number;
  username: string | null;
  passwordSecretRef: string | null;
  testDataJson: string | null;
  testDataAliasesJson: string | null;
  missingInputBehavior: number;
  extraLoginFieldsJson: string | null;
  ignoreHTTPSErrors?: boolean;
};

export type MobileConfig = {
  apkPath: string;
  packageName: string;
  mainActivity: string;
  appName: string;
  platform: string;
  framework: string | null;
  metadataSource: number;
  metadataResolvedAt: Date | null;
};

export type OtpConfig = {
  enabled: boolean;
  strategy: string;
  defaultChannel: string | null;
  allowedChannelsJson: string | null;
  enabledEnvironmentsJson: string | null;
  externalConnectionRef: string | null;
};

export type JiraConfig = {
  sharedConnectionId: string;
  projectKey: string;
  acceptanceCriteriaField: string | null;
  defaultJql: string | null;
  dryRun: boolean;
};

export type TestRailConfig = {
  sharedConnectionId: string;
  projectIdTr: string;
  suiteId: string | null;
  sectionId: string | null;
  sessionId: string | null;
  requiredCaseFieldsJson: string | null;
};

export type ProjectConfiguration = {
  id: string;
  slug: string;
  name: string;
  projectType: 1 | 2;
  status: 0 | 1 | 2;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  web: WebConfig | null;
  mobile: MobileConfig | null;
  otp: OtpConfig | null;
  jira: JiraConfig | null;
  testrail: TestRailConfig | null;
  knowledge: { schemaVersion: number; knowledgeJson: string; createdAt: Date; updatedAt: Date } | null;
};

function toBool(v: boolean | number | string | null | undefined): boolean {
  return v === true || v === 1 || v === "1";
}

export async function readProjectConfigurationOnConnection(
  conn: Connection,
  project: ProjectRow
): Promise<ProjectConfiguration> {
  const base: ProjectConfiguration = {
    id: project.id,
    slug: project.slug,
    name: project.name,
    projectType: project.projectType as 1 | 2,
    status: project.status as 0 | 1 | 2,
    enabled: toBool(project.enabled),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    web: null,
    mobile: null,
    otp: null,
    jira: null,
    testrail: null,
    knowledge: null,
  };

  const web = await conn.query<Omit<WebConfig, "ignoreHTTPSErrors"> & {
    ignoreHTTPSErrors: boolean | number | string | null | undefined;
  }>(
    `SELECT baseUrl, loginMode, username, passwordSecretRef, missingInputBehavior,
            ignoreHTTPSErrors, testDataJson, testDataAliasesJson, extraLoginFieldsJson
     FROM dbo.WebProjectConfiguration WHERE projectId = ?`,
    [project.id]
  );
  if (web.length > 0) {
    base.web = { ...web[0], ignoreHTTPSErrors: toBool(web[0].ignoreHTTPSErrors) };
  }

  const mobile = await conn.query<MobileConfig>(
    `SELECT apkPath, packageName, mainActivity, appName, platform, framework, metadataSource, metadataResolvedAt
     FROM dbo.MobileProjectConfiguration WHERE projectId = ?`,
    [project.id]
  );
  if (mobile.length > 0) base.mobile = mobile[0];

  const otp = await conn.query<Omit<OtpConfig, "enabled"> & { enabled: boolean | number }>(
    `SELECT enabled, strategy, defaultChannel, allowedChannelsJson, enabledEnvironmentsJson, externalConnectionRef
     FROM dbo.ProjectOtpConfiguration WHERE projectId = ?`,
    [project.id]
  );
  if (otp.length > 0) base.otp = { ...otp[0], enabled: toBool(otp[0].enabled) };

  const jira = await conn.query<Omit<JiraConfig, "dryRun"> & { dryRun: boolean | number }>(
    `SELECT sharedConnectionId, projectKey, acceptanceCriteriaField, defaultJql, dryRun
     FROM dbo.ProjectJiraConfiguration WHERE projectId = ?`,
    [project.id]
  );
  if (jira.length > 0) base.jira = { ...jira[0], dryRun: toBool(jira[0].dryRun) };

  const testrail = await conn.query<TestRailConfig>(
    `SELECT sharedConnectionId, projectIdTr, suiteId, sectionId, sessionId, requiredCaseFieldsJson
     FROM dbo.ProjectTestRailConfiguration WHERE projectId = ?`,
    [project.id]
  );
  if (testrail.length > 0) base.testrail = testrail[0];

  const knowledge = await conn.query<{ schemaVersion: number; knowledgeJson: string; createdAt: Date; updatedAt: Date }>(
    `SELECT schemaVersion, createdAt, updatedAt, knowledgeJson FROM dbo.ProjectKnowledge WHERE projectId = ?`,
    [project.id]
  );
  if (knowledge.length > 0) base.knowledge = knowledge[0];

  return base;
}

export async function getProjectConfigurationBySlug(
  slug: string
): Promise<ProjectConfiguration | null> {
  const conn = await getConnection();
  const projects = await conn.query<ProjectRow>(
    `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE slug = ?`,
    [slug]
  );
  if (projects.length === 0) return null;
  return readProjectConfigurationOnConnection(conn, projects[0]);
}

export async function getProjectConfigurationById(
  id: string
): Promise<ProjectConfiguration | null> {
  const conn = await getConnection();
  const projects = await conn.query<ProjectRow>(
    `SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE id = ?`,
    [id]
  );
  if (projects.length === 0) return null;
  return readProjectConfigurationOnConnection(conn, projects[0]);
}

export type ProjectReadinessResult = { status: "READY" | "INVALID"; reasons: string[] };

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function evaluateProjectReadiness(cfg: ProjectConfiguration): ProjectReadinessResult {
  const reasons: string[] = [];

  if (cfg.projectType === 1) {
    if (!cfg.web) {
      reasons.push("missing WebProjectConfiguration");
    } else {
      if (!cfg.web.baseUrl?.trim()) reasons.push("baseUrl is empty");
      else if (!isValidUrl(cfg.web.baseUrl)) reasons.push("baseUrl is not a valid URL");
      if (![1, 2, 3].includes(cfg.web.loginMode)) reasons.push("loginMode is invalid");
      if (cfg.web.loginMode === 1) {
        if (!cfg.web.username?.trim()) reasons.push("loginMode=password requires username");
        if (!cfg.web.passwordSecretRef?.trim()) {
          reasons.push("loginMode=password requires passwordSecretRef");
        }
      }
    }
  } else if (cfg.projectType === 2) {
    if (!cfg.mobile) {
      reasons.push("missing MobileProjectConfiguration");
    } else {
      if (!cfg.mobile.apkPath?.trim()) reasons.push("apkPath is empty");
      if (!cfg.mobile.packageName?.trim()) reasons.push("packageName is empty");
      if (!cfg.mobile.mainActivity?.trim()) reasons.push("mainActivity is empty");
      if (!cfg.mobile.appName?.trim()) reasons.push("appName is empty");
      if (cfg.mobile.platform !== "android") reasons.push("platform must be android");
    }
  } else {
    reasons.push("projectType is invalid");
  }

  return { status: reasons.length === 0 ? "READY" : "INVALID", reasons };
}
