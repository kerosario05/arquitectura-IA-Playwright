IF OBJECT_ID(N'dbo.ProjectCaseRuntimeValue', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectCaseRuntimeValue
    (
        projectId uniqueidentifier NOT NULL,
        caseId int NOT NULL,
        [key] nvarchar(254) NOT NULL,
        semanticType nvarchar(128) NULL,
        fieldKind nvarchar(64) NULL,
        datasetIdentity nvarchar(254) NULL,
        contractVersion nvarchar(128) NULL,
        valueType nvarchar(16) NOT NULL,
        [value] nvarchar(max) NOT NULL,
        source nvarchar(64) NOT NULL,
        verified bit NOT NULL,
        confirmed bit NOT NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectCaseRuntimeValue_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectCaseRuntimeValue_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectCaseRuntimeValue PRIMARY KEY (projectId, caseId, [key]),
        CONSTRAINT FK_ProjectCaseRuntimeValue_Projects
            FOREIGN KEY (projectId) REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );
END;
