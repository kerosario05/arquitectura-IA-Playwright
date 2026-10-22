-- QA review history of test-plan-<HU>.md files (module "Planificación de pruebas").
-- Append-only, no foreign keys. Idempotent.
IF OBJECT_ID(N'dbo.TestPlanReview', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TestPlanReview
    (
        id bigint IDENTITY(1,1) NOT NULL,
        projectSlug nvarchar(128) NOT NULL,
        branch nvarchar(250) NOT NULL,
        issueKey nvarchar(64) NOT NULL,
        filePath nvarchar(1000) NOT NULL,
        outcome nvarchar(16) NOT NULL,
        headSha nvarchar(64) NOT NULL,
        blobSha nvarchar(64) NOT NULL,
        commitSha nvarchar(64) NULL,
        scenarioCount int NOT NULL CONSTRAINT DF_TestPlanReview_scenarioCount DEFAULT 0,
        editedCount int NOT NULL CONSTRAINT DF_TestPlanReview_editedCount DEFAULT 0,
        addedCount int NOT NULL CONSTRAINT DF_TestPlanReview_addedCount DEFAULT 0,
        removedCount int NOT NULL CONSTRAINT DF_TestPlanReview_removedCount DEFAULT 0,
        note nvarchar(2000) NULL,
        userId nvarchar(64) NULL,
        userName nvarchar(254) NULL,
        reviewedAt datetime2 NOT NULL CONSTRAINT DF_TestPlanReview_reviewedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TestPlanReview PRIMARY KEY (id)
    );

    CREATE INDEX IX_TestPlanReview_file ON dbo.TestPlanReview (projectSlug, filePath, reviewedAt);
    CREATE INDEX IX_TestPlanReview_time ON dbo.TestPlanReview (reviewedAt);
END;
