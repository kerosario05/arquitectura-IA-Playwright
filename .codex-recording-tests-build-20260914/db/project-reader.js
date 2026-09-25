"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readProjectConfigurationOnConnection = readProjectConfigurationOnConnection;
exports.getProjectConfigurationBySlug = getProjectConfigurationBySlug;
exports.getProjectConfigurationById = getProjectConfigurationById;
exports.evaluateProjectReadiness = evaluateProjectReadiness;
const sql_connection_1 = require("./sql-connection");
function toBool(v) {
    return v === true || v === 1 || v === "1";
}
async function readProjectConfigurationOnConnection(conn, project) {
    const base = {
        id: project.id,
        slug: project.slug,
        name: project.name,
        projectType: project.projectType,
        status: project.status,
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
    const web = await conn.query(`SELECT baseUrl, loginMode, username, passwordSecretRef, missingInputBehavior,
            ignoreHTTPSErrors, testDataJson, testDataAliasesJson, extraLoginFieldsJson
     FROM dbo.WebProjectConfiguration WHERE projectId = ?`, [project.id]);
    if (web.length > 0) {
        base.web = { ...web[0], ignoreHTTPSErrors: toBool(web[0].ignoreHTTPSErrors) };
    }
    const mobile = await conn.query(`SELECT apkPath, packageName, mainActivity, appName, platform, framework, metadataSource, metadataResolvedAt
     FROM dbo.MobileProjectConfiguration WHERE projectId = ?`, [project.id]);
    if (mobile.length > 0)
        base.mobile = mobile[0];
    const otp = await conn.query(`SELECT enabled, strategy, defaultChannel, allowedChannelsJson, enabledEnvironmentsJson, externalConnectionRef
     FROM dbo.ProjectOtpConfiguration WHERE projectId = ?`, [project.id]);
    if (otp.length > 0)
        base.otp = { ...otp[0], enabled: toBool(otp[0].enabled) };
    const jira = await conn.query(`SELECT sharedConnectionId, projectKey, acceptanceCriteriaField, defaultJql, dryRun
     FROM dbo.ProjectJiraConfiguration WHERE projectId = ?`, [project.id]);
    if (jira.length > 0)
        base.jira = { ...jira[0], dryRun: toBool(jira[0].dryRun) };
    const testrail = await conn.query(`SELECT sharedConnectionId, projectIdTr, suiteId, sectionId, sessionId, requiredCaseFieldsJson
     FROM dbo.ProjectTestRailConfiguration WHERE projectId = ?`, [project.id]);
    if (testrail.length > 0)
        base.testrail = testrail[0];
    const knowledge = await conn.query(`SELECT schemaVersion, createdAt, updatedAt, knowledgeJson FROM dbo.ProjectKnowledge WHERE projectId = ?`, [project.id]);
    if (knowledge.length > 0)
        base.knowledge = knowledge[0];
    return base;
}
async function getProjectConfigurationBySlug(slug) {
    const conn = await (0, sql_connection_1.getConnection)();
    const projects = await conn.query(`SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE slug = ?`, [slug]);
    if (projects.length === 0)
        return null;
    return readProjectConfigurationOnConnection(conn, projects[0]);
}
async function getProjectConfigurationById(id) {
    const conn = await (0, sql_connection_1.getConnection)();
    const projects = await conn.query(`SELECT id, slug, name, projectType, status, enabled, createdAt, updatedAt
     FROM dbo.Projects WHERE id = ?`, [id]);
    if (projects.length === 0)
        return null;
    return readProjectConfigurationOnConnection(conn, projects[0]);
}
function isValidUrl(value) {
    try {
        const u = new URL(value);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
}
function evaluateProjectReadiness(cfg) {
    const reasons = [];
    if (cfg.projectType === 1) {
        if (!cfg.web) {
            reasons.push("missing WebProjectConfiguration");
        }
        else {
            if (!cfg.web.baseUrl?.trim())
                reasons.push("baseUrl is empty");
            else if (!isValidUrl(cfg.web.baseUrl))
                reasons.push("baseUrl is not a valid URL");
            if (![1, 2, 3].includes(cfg.web.loginMode))
                reasons.push("loginMode is invalid");
            if (cfg.web.loginMode === 1) {
                if (!cfg.web.username?.trim())
                    reasons.push("loginMode=password requires username");
                if (!cfg.web.passwordSecretRef?.trim()) {
                    reasons.push("loginMode=password requires passwordSecretRef");
                }
            }
        }
    }
    else if (cfg.projectType === 2) {
        if (!cfg.mobile) {
            reasons.push("missing MobileProjectConfiguration");
        }
        else {
            if (!cfg.mobile.apkPath?.trim())
                reasons.push("apkPath is empty");
            if (!cfg.mobile.packageName?.trim())
                reasons.push("packageName is empty");
            if (!cfg.mobile.mainActivity?.trim())
                reasons.push("mainActivity is empty");
            if (!cfg.mobile.appName?.trim())
                reasons.push("appName is empty");
            if (cfg.mobile.platform !== "android")
                reasons.push("platform must be android");
        }
    }
    else {
        reasons.push("projectType is invalid");
    }
    return { status: reasons.length === 0 ? "READY" : "INVALID", reasons };
}
