-- Git repository holding each project's test-plan-<HU>.md files
-- (module "Planificación de pruebas"). Idempotent.
IF OBJECT_ID(N'dbo.ProjectRepositoryConfiguration', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectRepositoryConfiguration
    (
        projectId uniqueidentifier NOT NULL,
        repoUrl nvarchar(1000) NOT NULL,
        defaultBranch nvarchar(250) NOT NULL,
        specsPath nvarchar(500) NOT NULL,
        filePattern nvarchar(250) NOT NULL,
        protectedBranchesJson nvarchar(max) NOT NULL CONSTRAINT DF_ProjectRepositoryConfiguration_protected DEFAULT N'[]',
        -- env:VAR holding a PAT; NULL = the server's own git credentials.
        credentialSecretRef nvarchar(256) NULL,
        enabled bit NOT NULL CONSTRAINT DF_ProjectRepositoryConfiguration_enabled DEFAULT 1,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectRepositoryConfiguration_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectRepositoryConfiguration_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectRepositoryConfiguration PRIMARY KEY (projectId),
        CONSTRAINT FK_ProjectRepositoryConfiguration_Projects FOREIGN KEY (projectId) REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );
END;
