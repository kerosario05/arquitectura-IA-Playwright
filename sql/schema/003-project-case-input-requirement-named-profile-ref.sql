IF COL_LENGTH(N'dbo.ProjectCaseInputRequirement', N'namedProfileRef') IS NULL
BEGIN
    ALTER TABLE dbo.ProjectCaseInputRequirement
        ADD namedProfileRef NVARCHAR(254) NULL
            CONSTRAINT DF_ProjectCaseInputRequirement_namedProfileRef DEFAULT NULL;
END;
