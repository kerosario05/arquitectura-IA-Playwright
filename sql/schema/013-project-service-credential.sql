-- Credentials a catalog service asks for from its own panel (module "Catálogo de servicios"), e.g. the
-- Portal login used by cédula generation, LexisNexis screening and request cancellation.
-- The password is stored encrypted (AES-256-GCM, key kept outside the database). Idempotent.
IF OBJECT_ID(N'dbo.ProjectServiceCredential', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ProjectServiceCredential
    (
        projectId uniqueidentifier NOT NULL,
        credentialKey nvarchar(64) NOT NULL,
        username nvarchar(254) NOT NULL,
        passwordCipher nvarchar(max) NOT NULL,
        updatedBy nvarchar(254) NULL,
        createdAt datetime2 NOT NULL CONSTRAINT DF_ProjectServiceCredential_createdAt DEFAULT SYSUTCDATETIME(),
        updatedAt datetime2 NOT NULL CONSTRAINT DF_ProjectServiceCredential_updatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ProjectServiceCredential PRIMARY KEY (projectId, credentialKey),
        CONSTRAINT FK_ProjectServiceCredential_Projects FOREIGN KEY (projectId) REFERENCES dbo.Projects (id) ON DELETE CASCADE
    );
END;
