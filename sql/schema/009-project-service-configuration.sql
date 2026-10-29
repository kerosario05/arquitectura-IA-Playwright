-- Catalog services enabled per project (module "Catálogo de servicios") and their settings.
-- The services are code (src/service-catalog); this table only stores per-project settings. Idempotent.
IF OBJECT_ID(N'dbo.ProjectServiceConfiguration', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectServiceConfiguration
    (
        projectId uniqueidentifier NOT NULL,
        serviceKey nvarchar(128) NOT NULL,
        enabled bit NOT NULL CONSTRAINT DF_ProjectServiceConfiguration_enabled DEFAULT 1,
        settingsJson nvarchar(max) NOT NULL CONSTRAINT DF_ProjectServiceConfiguration_settingsJson DEFAULT N'{}',
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectServiceConfiguration_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectServiceConfiguration_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectServiceConfiguration PRIMARY KEY (projectId, serviceKey),
        CONSTRAINT FK_ProjectServiceConfiguration_Projects FOREIGN KEY (projectId)
            REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );
END;
