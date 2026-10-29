-- Which catalog service fills which scenario field (module "Catálogo de servicios").
-- scenarioId N'' = the owner's general form; a scenario row overrides it.
-- serviceKey NULL on a scenario row = that scenario types the value by hand. Idempotent.
IF OBJECT_ID(N'dbo.ServiceBinding', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ServiceBinding
    (
        id uniqueidentifier NOT NULL CONSTRAINT DF_ServiceBinding_id DEFAULT NEWID(),
        projectId uniqueidentifier NOT NULL,
        ownerType nvarchar(32) NOT NULL,
        ownerId nvarchar(200) NOT NULL,
        scenarioId nvarchar(200) NOT NULL CONSTRAINT DF_ServiceBinding_scenarioId DEFAULT N'',
        targetValueKey nvarchar(256) NOT NULL,
        serviceKey nvarchar(128) NULL,
        paramsJson nvarchar(max) NOT NULL CONSTRAINT DF_ServiceBinding_paramsJson DEFAULT N'{}',
        updatedBy nvarchar(254) NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ServiceBinding_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ServiceBinding_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ServiceBinding PRIMARY KEY (id),
        CONSTRAINT UQ_ServiceBinding_target UNIQUE (projectId, ownerType, ownerId, scenarioId, targetValueKey),
        CONSTRAINT FK_ServiceBinding_Projects FOREIGN KEY (projectId) REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );

    CREATE INDEX IX_ServiceBinding_owner ON dbo.ServiceBinding (projectId, ownerType, ownerId);
END;
