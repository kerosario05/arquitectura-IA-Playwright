IF OBJECT_ID('dbo.ProjectDataCatalog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProjectDataCatalog (
    id NVARCHAR(36) NOT NULL PRIMARY KEY,
    projectId NVARCHAR(36) NOT NULL,
    name NVARCHAR(200) NOT NULL,
    fieldName NVARCHAR(200) NOT NULL,
    aliasesJson NVARCHAR(MAX) NOT NULL CONSTRAINT DF_ProjectDataCatalog_aliases DEFAULT '[]',
    active BIT NOT NULL CONSTRAINT DF_ProjectDataCatalog_active DEFAULT 1,
    revision INT NOT NULL CONSTRAINT DF_ProjectDataCatalog_revision DEFAULT 1,
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectDataCatalog_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectDataCatalog_updatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ProjectDataCatalog_Projects FOREIGN KEY (projectId) REFERENCES dbo.Projects(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_ProjectDataCatalog_project_active ON dbo.ProjectDataCatalog(projectId, active, name);
END;
IF OBJECT_ID('dbo.ProjectDataCatalogOption', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ProjectDataCatalogOption (
    id NVARCHAR(36) NOT NULL PRIMARY KEY,
    catalogId NVARCHAR(36) NOT NULL,
    label NVARCHAR(200) NOT NULL,
    [value] NVARCHAR(1000) NOT NULL,
    active BIT NOT NULL CONSTRAINT DF_ProjectDataCatalogOption_active DEFAULT 1,
    position INT NOT NULL CONSTRAINT DF_ProjectDataCatalogOption_position DEFAULT 0,
    createdAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectDataCatalogOption_createdAt DEFAULT SYSUTCDATETIME(),
    updatedAt DATETIME2 NOT NULL CONSTRAINT DF_ProjectDataCatalogOption_updatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_ProjectDataCatalogOption_Catalog FOREIGN KEY (catalogId) REFERENCES dbo.ProjectDataCatalog(id) ON DELETE CASCADE
  );
  CREATE INDEX IX_ProjectDataCatalogOption_catalog_position ON dbo.ProjectDataCatalogOption(catalogId, active, position, id);
END;
