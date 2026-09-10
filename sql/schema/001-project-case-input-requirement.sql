IF OBJECT_ID(N'dbo.ProjectCaseInputRequirement', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectCaseInputRequirement
    (
        projectId uniqueidentifier NOT NULL,
        caseId int NOT NULL,
        [key] nvarchar(254) NOT NULL,
        label nvarchar(254) NULL,
        controlType nvarchar(254) NULL,
        required bit NOT NULL,
        sensitive bit NOT NULL,
        allowedValues nvarchar(max) NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectCaseInputRequirement_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectCaseInputRequirement_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectCaseInputRequirement PRIMARY KEY (projectId, caseId, [key]),
        CONSTRAINT FK_ProjectCaseInputRequirement_Projects
            FOREIGN KEY (projectId) REFERENCES dbo.Projects (id)
    );
END;
