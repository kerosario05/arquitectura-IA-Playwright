IF OBJECT_ID(N'dbo.ProjectGenerationConfig', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectGenerationConfig
    (
        projectId uniqueidentifier NOT NULL,
        version nvarchar(64) NOT NULL,
        configJson nvarchar(max) NOT NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectGenerationConfig_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectGenerationConfig_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectGenerationConfig PRIMARY KEY (projectId),
        CONSTRAINT FK_ProjectGenerationConfig_Projects FOREIGN KEY (projectId) REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );
END;
