IF OBJECT_ID(N'dbo.TestDesignDraft', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TestDesignDraft
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_TestDesignDraft_id DEFAULT NEWID(),
        title nvarchar(250) NULL,
        projectSlug nvarchar(128) NULL,
        jiraProjectKey nvarchar(64) NOT NULL,
        testRailProjectId int NULL,
        testRailSuiteId int NULL,
        testRailSectionId int NULL,
        instructions nvarchar(max) NULL,
        status nvarchar(32) NOT NULL CONSTRAINT DF_TestDesignDraft_status DEFAULT N'draft',
        -- Users.id as text: the API-key service principal has no Users row.
        createdBy nvarchar(64) NULL,
        createdByName nvarchar(254) NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_TestDesignDraft_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_TestDesignDraft_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TestDesignDraft PRIMARY KEY (id)
    );

    CREATE INDEX IX_TestDesignDraft_createdBy ON dbo.TestDesignDraft (createdBy, updatedAt);
    CREATE INDEX IX_TestDesignDraft_jiraProject ON dbo.TestDesignDraft (jiraProjectKey, updatedAt);
END;

IF OBJECT_ID(N'dbo.TestDesignDraftStory', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TestDesignDraftStory
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_TestDesignDraftStory_id DEFAULT NEWID(),
        draftId uniqueidentifier NOT NULL,
        issueKey nvarchar(64) NOT NULL,
        issueSummary nvarchar(1000) NOT NULL CONSTRAINT DF_TestDesignDraftStory_issueSummary DEFAULT N'',
        position int NOT NULL CONSTRAINT DF_TestDesignDraftStory_position DEFAULT 0,
        generationStatus nvarchar(32) NOT NULL CONSTRAINT DF_TestDesignDraftStory_generationStatus DEFAULT N'pending',
        generationError nvarchar(max) NULL,
        scenariosJson nvarchar(max) NOT NULL CONSTRAINT DF_TestDesignDraftStory_scenariosJson DEFAULT N'[]',
        jiraSubtaskKey nvarchar(64) NULL,
        jiraPublishedAt datetime2 NULL,
        testRailPublishedAt datetime2 NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_TestDesignDraftStory_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_TestDesignDraftStory_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_TestDesignDraftStory PRIMARY KEY (id),
        CONSTRAINT UQ_TestDesignDraftStory_issue UNIQUE (draftId, issueKey),
        CONSTRAINT FK_TestDesignDraftStory_Draft
            FOREIGN KEY (draftId) REFERENCES dbo.TestDesignDraft (id) ON DELETE CASCADE
    );
END;
