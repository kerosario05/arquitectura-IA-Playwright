IF OBJECT_ID(N'dbo.TestDesignEvent', N'U') IS NULL
BEGIN
    -- Append-only usage history for the dashboard. No foreign keys: the history
    -- must outlive archived or deleted drafts.
    CREATE TABLE dbo.TestDesignEvent
    (
        id bigint IDENTITY(1,1) NOT NULL,
        eventType nvarchar(64) NOT NULL,
        draftId nvarchar(64) NULL,
        storyId nvarchar(64) NULL,
        projectSlug nvarchar(128) NULL,
        issueKey nvarchar(64) NULL,
        userId nvarchar(64) NULL,
        userName nvarchar(254) NULL,
        occurredAt datetime2 NOT NULL CONSTRAINT DF_TestDesignEvent_occurredAt DEFAULT SYSUTCDATETIME(),
        detailsJson nvarchar(max) NULL,
        CONSTRAINT PK_TestDesignEvent PRIMARY KEY (id)
    );

    CREATE INDEX IX_TestDesignEvent_time ON dbo.TestDesignEvent (occurredAt, eventType);
    CREATE INDEX IX_TestDesignEvent_project ON dbo.TestDesignEvent (projectSlug, occurredAt);
END;
