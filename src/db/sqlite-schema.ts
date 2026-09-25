/**
 * SQLite schema for the project registry (QA_LAB equivalent).
 *
 * Conventions kept deliberately close to the original SQL Server schema so the
 * existing queries in src/db and src/server/routes/projects.ts run unchanged:
 *  - `id` columns are UUID TEXT with a DB-side default (INSERT ... RETURNING id).
 *  - `COLLATE NOCASE` reproduces SQL Server's case-insensitive comparison for
 *    uniqueidentifier / slug lookups (the API returns uppercase ids in places).
 *  - Timestamps are ISO-8601 UTC strings written by `strftime`.
 *  - Booleans are stored as INTEGER 0/1 (readers already normalize via toBool).
 */

/** SQLite expression producing a v4 UUID as lowercase text. */
export const UUID_DEFAULT_EXPR =
  "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||" +
  "substr(lower(hex(randomblob(2))),2)||'-'||" +
  "substr('89ab',abs(random())%4+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||" +
  "lower(hex(randomblob(6)))";

/** SQLite expression producing the current UTC timestamp in ISO-8601. */
export const UTC_NOW_EXPR = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const SQLITE_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS Projects (
  id           TEXT    PRIMARY KEY COLLATE NOCASE DEFAULT (${UUID_DEFAULT_EXPR}),
  slug         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name         TEXT    NOT NULL,
  projectType  INTEGER NOT NULL,                  -- 1 = web, 2 = mobile
  status       INTEGER NOT NULL DEFAULT 0,        -- 0 = draft, 1 = ready, 2 = invalid
  enabled      INTEGER NOT NULL DEFAULT 1,
  createdAt    TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt    TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS SharedConnection (
  id                  TEXT    PRIMARY KEY COLLATE NOCASE DEFAULT (${UUID_DEFAULT_EXPR}),
  connectionType      INTEGER NOT NULL,           -- 1 = Jira, 2 = TestRail
  name                TEXT    NOT NULL COLLATE NOCASE,
  baseUrl             TEXT    NOT NULL,
  credentialSecretRef TEXT    NOT NULL,
  email               TEXT,
  createdAt           TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt           TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  UNIQUE (connectionType, name)
);

CREATE TABLE IF NOT EXISTS WebProjectConfiguration (
  projectId            TEXT    PRIMARY KEY COLLATE NOCASE
                               REFERENCES Projects(id) ON DELETE CASCADE,
  baseUrl              TEXT    NOT NULL,
  loginMode            INTEGER NOT NULL,          -- 1 = password, 2 = no_login, 3 = manual
  username             TEXT,
  passwordSecretRef    TEXT,
  missingInputBehavior INTEGER NOT NULL DEFAULT 1,-- 1 fail, 2 prompt, 3 skip, 4 auto_generate
  testDataJson         TEXT,
  testDataAliasesJson  TEXT,
  extraLoginFieldsJson TEXT,
  createdAt            TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt            TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS MobileProjectConfiguration (
  projectId          TEXT    PRIMARY KEY COLLATE NOCASE
                             REFERENCES Projects(id) ON DELETE CASCADE,
  apkPath            TEXT    NOT NULL,
  packageName        TEXT    NOT NULL,
  mainActivity       TEXT    NOT NULL,
  appName            TEXT    NOT NULL,
  platform           TEXT    NOT NULL DEFAULT 'android',
  framework          TEXT,
  metadataSource     INTEGER NOT NULL DEFAULT 1,
  metadataResolvedAt TEXT,
  createdAt          TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt          TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS ProjectOtpConfiguration (
  projectId               TEXT    PRIMARY KEY COLLATE NOCASE
                                  REFERENCES Projects(id) ON DELETE CASCADE,
  enabled                 INTEGER NOT NULL DEFAULT 0,
  strategy                TEXT    NOT NULL DEFAULT 'none',
  defaultChannel          TEXT,
  allowedChannelsJson     TEXT,
  enabledEnvironmentsJson TEXT,
  externalConnectionRef   TEXT,
  createdAt               TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt               TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS ProjectJiraConfiguration (
  projectId               TEXT    PRIMARY KEY COLLATE NOCASE
                                  REFERENCES Projects(id) ON DELETE CASCADE,
  sharedConnectionId      TEXT    COLLATE NOCASE REFERENCES SharedConnection(id),
  projectKey              TEXT    NOT NULL,
  acceptanceCriteriaField TEXT,
  defaultJql              TEXT,
  dryRun                  INTEGER NOT NULL DEFAULT 0,
  createdAt               TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt               TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS ProjectTestRailConfiguration (
  projectId              TEXT    PRIMARY KEY COLLATE NOCASE
                                 REFERENCES Projects(id) ON DELETE CASCADE,
  sharedConnectionId     TEXT    COLLATE NOCASE REFERENCES SharedConnection(id),
  projectIdTr            TEXT    NOT NULL,
  suiteId                TEXT,
  sectionId              TEXT,
  sessionId              TEXT,
  requiredCaseFieldsJson TEXT,
  createdAt              TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt              TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS ProjectKnowledge (
  projectId     TEXT    PRIMARY KEY COLLATE NOCASE
                        REFERENCES Projects(id) ON DELETE CASCADE,
  schemaVersion INTEGER NOT NULL DEFAULT 1,
  knowledgeJson TEXT,
  createdAt     TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt     TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS ProjectConfigurationHistory (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  projectId  TEXT    NOT NULL COLLATE NOCASE
                     REFERENCES Projects(id) ON DELETE CASCADE,
  changeType INTEGER NOT NULL,                    -- 1 = created, 2 = updated
  section    TEXT    NOT NULL,
  beforeJson TEXT,
  afterJson  TEXT,
  createdAt  TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE INDEX IF NOT EXISTS IX_ProjectConfigurationHistory_projectId
  ON ProjectConfigurationHistory (projectId, createdAt);

-- ---------------------------------------------------------------------------
-- Identity: users, roles, permissions, per-project scope and sessions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Users (
  id                 TEXT    PRIMARY KEY COLLATE NOCASE DEFAULT (${UUID_DEFAULT_EXPR}),
  username           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  email              TEXT    COLLATE NOCASE,
  fullName           TEXT    NOT NULL,
  passwordHash       TEXT    NOT NULL,
  mustChangePassword INTEGER NOT NULL DEFAULT 1,
  enabled            INTEGER NOT NULL DEFAULT 1,
  allProjects        INTEGER NOT NULL DEFAULT 0,  -- 1 = skip UserProjectAccess checks
  failedLoginCount   INTEGER NOT NULL DEFAULT 0,
  lockedUntil        TEXT,
  lastLoginAt        TEXT,
  passwordUpdatedAt  TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  createdBy          TEXT    COLLATE NOCASE,
  createdAt          TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt          TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS Roles (
  id          TEXT    PRIMARY KEY COLLATE NOCASE DEFAULT (${UUID_DEFAULT_EXPR}),
  slug        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT    NOT NULL,
  description TEXT,
  isSystem    INTEGER NOT NULL DEFAULT 0,        -- 1 = seeded, cannot be deleted
  createdAt   TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  updatedAt   TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE TABLE IF NOT EXISTS RolePermissions (
  roleId        TEXT NOT NULL COLLATE NOCASE
                     REFERENCES Roles(id) ON DELETE CASCADE,
  permissionKey TEXT NOT NULL COLLATE NOCASE,    -- key from src/auth/permissions.ts
  PRIMARY KEY (roleId, permissionKey)
);

CREATE TABLE IF NOT EXISTS UserRoles (
  userId     TEXT NOT NULL COLLATE NOCASE REFERENCES Users(id) ON DELETE CASCADE,
  roleId     TEXT NOT NULL COLLATE NOCASE REFERENCES Roles(id) ON DELETE CASCADE,
  assignedAt TEXT NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  PRIMARY KEY (userId, roleId)
);

CREATE TABLE IF NOT EXISTS UserProjectAccess (
  userId      TEXT    NOT NULL COLLATE NOCASE REFERENCES Users(id) ON DELETE CASCADE,
  projectId   TEXT    NOT NULL COLLATE NOCASE REFERENCES Projects(id) ON DELETE CASCADE,
  accessLevel INTEGER NOT NULL DEFAULT 1,        -- 1 = read, 2 = write
  grantedAt   TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  PRIMARY KEY (userId, projectId)
);

CREATE TABLE IF NOT EXISTS UserSessions (
  id         TEXT PRIMARY KEY COLLATE NOCASE DEFAULT (${UUID_DEFAULT_EXPR}),
  userId     TEXT NOT NULL COLLATE NOCASE REFERENCES Users(id) ON DELETE CASCADE,
  tokenHash  TEXT NOT NULL UNIQUE,               -- SHA-256 of the opaque bearer token
  scope      TEXT NOT NULL DEFAULT 'full',       -- 'full' | 'password_change_only'
  issuedAt   TEXT NOT NULL DEFAULT (${UTC_NOW_EXPR}),
  expiresAt  TEXT NOT NULL,
  revokedAt  TEXT,
  lastSeenAt TEXT,
  userAgent  TEXT,
  ipAddress  TEXT
);

CREATE INDEX IF NOT EXISTS IX_UserSessions_userId ON UserSessions (userId, expiresAt);

-- No foreign keys: the trail must outlive the rows it describes.
CREATE TABLE IF NOT EXISTS UserAuditLog (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actorUserId  TEXT COLLATE NOCASE,
  targetUserId TEXT COLLATE NOCASE,
  action       TEXT NOT NULL,
  detailsJson  TEXT,
  createdAt    TEXT NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE INDEX IF NOT EXISTS IX_UserAuditLog_target ON UserAuditLog (targetUserId, createdAt);

-- ---------------------------------------------------------------------------
-- Jobs: execution runs survive a restart instead of dying with the process.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS Jobs (
  id               TEXT    PRIMARY KEY COLLATE NOCASE,
  type             TEXT    NOT NULL,
  status           TEXT    NOT NULL,
  paramsJson       TEXT,
  issueKey         TEXT,
  checklistUrl     TEXT,
  defectCount      INTEGER,
  createdAt        TEXT    NOT NULL,
  startedAt        TEXT,
  completedAt      TEXT,
  durationMs       INTEGER,
  exitCode         INTEGER,
  summaryJson      TEXT,
  currentCase      TEXT,
  currentCaseId    TEXT,
  currentCaseTitle TEXT,
  errorMessage     TEXT,
  updatedAt        TEXT    NOT NULL DEFAULT (${UTC_NOW_EXPR})
);

CREATE INDEX IF NOT EXISTS IX_Jobs_createdAt ON Jobs (createdAt);

-- One row per log line: append-only, batched by the store so a chatty run does
-- not turn into thousands of individual writes.
CREATE TABLE IF NOT EXISTS JobLogs (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT    NOT NULL COLLATE NOCASE REFERENCES Jobs(id) ON DELETE CASCADE,
  seq   INTEGER NOT NULL,
  line  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS IX_JobLogs_job ON JobLogs (jobId, seq);
`;
