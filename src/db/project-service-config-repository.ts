import { withConnection, withTransaction } from "./sql-connection";
import type { DbConnection } from "./db-connection";
import { OTP_ORACLE_LOCAL_TOKEN_KEY } from "../service-catalog/providers/otp-oracle-local-token";

type ConnectionLike = Pick<DbConnection, "query">;

export type ProjectServiceConfig = {
  projectSlug: string;
  serviceKey: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  updatedAt: string | null;
  /** Read from the old ProjectOtpConfiguration table; saving it creates a catalog row. */
  legacy: boolean;
};

type Row = {
  projectSlug: string;
  serviceKey: string;
  enabled: boolean | number | string;
  settingsJson: string | null;
  updatedAt: string | Date | null;
};

type LegacyOtpRow = {
  projectSlug: string;
  enabled: boolean | number | string;
  strategy: string | null;
  defaultChannel: string | null;
  allowedChannelsJson: string | null;
  enabledEnvironmentsJson: string | null;
  updatedAt: string | Date | null;
};

export type ProjectServiceConfigDb = {
  withConnection: <T>(fn: (conn: ConnectionLike) => Promise<T>) => Promise<T>;
  withTransaction: <T>(fn: (conn: ConnectionLike) => Promise<T>) => Promise<T>;
};

const SELECT = `SELECT p.slug AS projectSlug, s.serviceKey, s.enabled, s.settingsJson, s.updatedAt
  FROM dbo.ProjectServiceConfiguration s
  JOIN dbo.Projects p ON p.id = s.projectId`;

const SELECT_LEGACY_OTP = `SELECT p.slug AS projectSlug, o.enabled, o.strategy, o.defaultChannel,
       o.allowedChannelsJson, o.enabledEnvironmentsJson, o.updatedAt
  FROM dbo.ProjectOtpConfiguration o
  JOIN dbo.Projects p ON p.id = o.projectId`;

function toBool(value: boolean | number | string): boolean {
  return value === true || value === 1 || value === "1";
}

function isoOrNull(value: string | Date | null): string | null {
  return value instanceof Date ? value.toISOString() : value;
}

function parseObject(json: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseList(json: string | null): string[] {
  try {
    const parsed = JSON.parse(json ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function toConfig(row: Row): ProjectServiceConfig {
  return {
    projectSlug: row.projectSlug,
    serviceKey: row.serviceKey,
    enabled: toBool(row.enabled),
    settings: parseObject(row.settingsJson),
    updatedAt: isoOrNull(row.updatedAt),
    legacy: false,
  };
}

/** Only an Oracle-token OTP row maps onto the catalog; `none` and other strategies are ignored. */
function legacyOtpToConfig(row: LegacyOtpRow): ProjectServiceConfig | null {
  if ((row.strategy ?? "").trim().toLowerCase() !== "oracle_local_token") return null;
  return {
    projectSlug: row.projectSlug,
    serviceKey: OTP_ORACLE_LOCAL_TOKEN_KEY,
    enabled: toBool(row.enabled),
    settings: {
      defaultChannel: row.defaultChannel || null,
      allowedChannels: parseList(row.allowedChannelsJson),
      enabledEnvironments: parseList(row.enabledEnvironmentsJson),
    },
    updatedAt: isoOrNull(row.updatedAt),
    legacy: true,
  };
}

/** Catalog rows win; a legacy OTP row fills in only for projects without one. */
function mergeLegacy(rows: ProjectServiceConfig[], legacyRows: LegacyOtpRow[]): ProjectServiceConfig[] {
  const merged = [...rows];
  for (const legacyRow of legacyRows) {
    const config = legacyOtpToConfig(legacyRow);
    if (!config) continue;
    const exists = rows.some((row) =>
      row.serviceKey === config.serviceKey && row.projectSlug.toLowerCase() === config.projectSlug.toLowerCase());
    if (!exists) merged.push(config);
  }
  return merged;
}

export function createProjectServiceConfigRepository(db: ProjectServiceConfigDb) {
  async function listForProject(slug: string, conn?: ConnectionLike): Promise<ProjectServiceConfig[]> {
    const run = async (c: ConnectionLike) => {
      const rows = (await c.query<Row>(`${SELECT} WHERE p.slug = ? ORDER BY s.serviceKey`, [slug])).map(toConfig);
      const legacy = await c.query<LegacyOtpRow>(`${SELECT_LEGACY_OTP} WHERE p.slug = ?`, [slug]);
      return mergeLegacy(rows, legacy);
    };
    return conn ? run(conn) : db.withConnection(run);
  }

  /** Every project's configuration, for the catalog's "used in" list. */
  async function listAll(): Promise<ProjectServiceConfig[]> {
    return db.withConnection(async (c) => {
      const rows = (await c.query<Row>(`${SELECT} ORDER BY p.slug`)).map(toConfig);
      const legacy = await c.query<LegacyOtpRow>(SELECT_LEGACY_OTP);
      return mergeLegacy(rows, legacy);
    });
  }

  async function get(slug: string, serviceKey: string, conn?: ConnectionLike): Promise<ProjectServiceConfig | null> {
    const configs = await listForProject(slug, conn);
    return configs.find((config) => config.serviceKey.toLowerCase() === serviceKey.toLowerCase()) ?? null;
  }

  async function upsert(
    slug: string,
    serviceKey: string,
    input: { enabled: boolean; settings: Record<string, unknown> },
  ): Promise<{ action: "inserted" | "updated"; config: ProjectServiceConfig }> {
    return db.withTransaction(async (conn) => {
      const projects = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
      if (!projects.length) throw new Error(`project not found: ${slug}`);
      const projectId = projects[0].id;
      const existing = await conn.query<{ projectId: string }>(
        "SELECT projectId FROM dbo.ProjectServiceConfiguration WHERE projectId = ? AND serviceKey = ?",
        [projectId, serviceKey],
      );
      const settingsJson = JSON.stringify(input.settings);
      if (existing.length) {
        await conn.query(
          `UPDATE dbo.ProjectServiceConfiguration
              SET enabled = ?, settingsJson = ?, updatedAt = SYSUTCDATETIME()
            WHERE projectId = ? AND serviceKey = ?`,
          [input.enabled ? 1 : 0, settingsJson, projectId, serviceKey],
        );
      } else {
        await conn.query(
          `INSERT INTO dbo.ProjectServiceConfiguration (projectId, serviceKey, enabled, settingsJson)
           VALUES (?, ?, ?, ?)`,
          [projectId, serviceKey, input.enabled ? 1 : 0, settingsJson],
        );
      }
      await conn.query(
        "INSERT INTO dbo.ProjectConfigurationHistory (projectId, changeType, section) VALUES (?, 2, ?)",
        [projectId, `service:${serviceKey}`],
      );
      const saved = await get(slug, serviceKey, conn);
      return { action: existing.length ? "updated" : "inserted", config: saved! };
    });
  }

  return { listForProject, listAll, get, upsert };
}

const defaultRepository = createProjectServiceConfigRepository({ withConnection, withTransaction });

export const listProjectServiceConfigs = defaultRepository.listForProject;
export const listAllProjectServiceConfigs = defaultRepository.listAll;
export const getProjectServiceConfig = defaultRepository.get;
export const upsertProjectServiceConfig = defaultRepository.upsert;
