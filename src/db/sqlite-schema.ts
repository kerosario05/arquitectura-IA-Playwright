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
`;
