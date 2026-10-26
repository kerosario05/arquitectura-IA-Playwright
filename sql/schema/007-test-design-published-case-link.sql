IF OBJECT_ID(N'dbo.TestDesignPublishedCaseLink', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TestDesignPublishedCaseLink
    (
        testRailCaseId int NOT NULL,
        testRailProjectId int NOT NULL,
        testRailSuiteId int NULL,
        testRailSectionId int NOT NULL,
        projectSlug nvarchar(128) NOT NULL,
        jiraProjectKey nvarchar(64) NOT NULL,
        issueKey nvarchar(64) NOT NULL,
        draftId uniqueidentifier NOT NULL,
        storyId uniqueidentifier NOT NULL,
        designScenarioId nvarchar(128) NOT NULL,
        jiraScenarioId nvarchar(128) NULL,
        contentVersion char(64) NOT NULL,
        scenarioJson nvarchar(max) NOT NULL,
        publishedAt datetime2 NOT NULL CONSTRAINT DF_TestDesignPublishedCaseLink_publishedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TestDesignPublishedCaseLink PRIMARY KEY (testRailCaseId)
    );
END;

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TestDesignPublishedCaseLink_project' AND object_id = OBJECT_ID(N'dbo.TestDesignPublishedCaseLink'))
    CREATE INDEX IX_TestDesignPublishedCaseLink_project ON dbo.TestDesignPublishedCaseLink (projectSlug, testRailProjectId, issueKey);
