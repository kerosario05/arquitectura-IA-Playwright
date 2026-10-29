import { withConnection, withTransaction } from "./sql-connection";
import type { DbConnection } from "./db-connection";
import type { BindingOwnerType, BindingParamValue, BindingSegment, ServiceBinding } from "../service-catalog/service-bindings";

type ConnectionLike = Pick<DbConnection, "query">;

export type ServiceBindingDb = {
  withConnection: <T>(fn: (conn: ConnectionLike) => Promise<T>) => Promise<T>;
  withTransaction: <T>(fn: (conn: ConnectionLike) => Promise<T>) => Promise<T>;
};

export type BindingOwner = { projectSlug: string; ownerType: BindingOwnerType; ownerId: string };

export type BindingTarget = BindingOwner & { scenarioId: string; targetValueKey: string };

type Row = {
  id: string;
  projectSlug: string;
  ownerType: BindingOwnerType;
  ownerId: string;
  scenarioId: string | null;
  targetValueKey: string;
  serviceKey: string | null;
  paramsJson: string | null;
  updatedBy: string | null;
  updatedAt: string | Date | null;
};

const SELECT = `SELECT b.id, p.slug AS projectSlug, b.ownerType, b.ownerId, b.scenarioId, b.targetValueKey,
       b.serviceKey, b.paramsJson, b.updatedBy, b.updatedAt
  FROM dbo.ServiceBinding b
  JOIN dbo.Projects p ON p.id = b.projectId`;

/** paramsJson also carries the binding's segment, under a key no service parameter can use. */
const SEGMENT_KEY = "__segment";

function parseParams(json: string | null): { params: Record<string, BindingParamValue>; segment: BindingSegment | null } {
  try {
    const parsed = JSON.parse(json ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { params: {}, segment: null };
    const { [SEGMENT_KEY]: rawSegment, ...params } = parsed as Record<string, unknown>;
    const segment = rawSegment && typeof rawSegment === "object"
      && typeof (rawSegment as BindingSegment).group === "string" && Number.isInteger((rawSegment as BindingSegment).position)
      ? { group: (rawSegment as BindingSegment).group, position: (rawSegment as BindingSegment).position }
      : null;
    return { params: params as Record<string, BindingParamValue>, segment };
  } catch {
    return { params: {}, segment: null };
  }
}

function toBinding(row: Row): ServiceBinding {
  const { params, segment } = parseParams(row.paramsJson);
  return {
    id: String(row.id).toLowerCase(),
    projectSlug: row.projectSlug,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    scenarioId: row.scenarioId ?? "",
    targetValueKey: row.targetValueKey,
    serviceKey: row.serviceKey || null,
    params,
    segment,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

export function createServiceBindingRepository(db: ServiceBindingDb) {
  async function projectIdFor(conn: ConnectionLike, slug: string): Promise<string> {
    const projects = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [slug]);
    if (!projects.length) throw new Error(`project not found: ${slug}`);
    return projects[0].id;
  }

  /** Every binding of an owner: its general rows and all its scenario rows. */
  async function listForOwner(owner: BindingOwner, conn?: ConnectionLike): Promise<ServiceBinding[]> {
    const run = async (c: ConnectionLike) => (await c.query<Row>(
      `${SELECT} WHERE p.slug = ? AND b.ownerType = ? AND b.ownerId = ? ORDER BY b.scenarioId, b.targetValueKey`,
      [owner.projectSlug, owner.ownerType, owner.ownerId],
    )).map(toBinding);
    return conn ? run(conn) : db.withConnection(run);
  }

  async function upsert(
    target: BindingTarget,
    input: {
      serviceKey: string | null;
      params: Record<string, BindingParamValue>;
      segment?: BindingSegment | null;
      updatedBy: string | null;
    },
  ): Promise<{ action: "inserted" | "updated"; binding: ServiceBinding }> {
    return db.withTransaction(async (conn) => {
      const projectId = await projectIdFor(conn, target.projectSlug);
      const key = [projectId, target.ownerType, target.ownerId, target.scenarioId, target.targetValueKey];
      const existing = await conn.query<{ id: string }>(
        `SELECT id FROM dbo.ServiceBinding
          WHERE projectId = ? AND ownerType = ? AND ownerId = ? AND scenarioId = ? AND targetValueKey = ?`,
        key,
      );
      const paramsJson = JSON.stringify(input.segment ? { ...input.params, [SEGMENT_KEY]: input.segment } : input.params);
      if (existing.length) {
        await conn.query(
          `UPDATE dbo.ServiceBinding
              SET serviceKey = ?, paramsJson = ?, updatedBy = ?, updatedAt = SYSUTCDATETIME()
            WHERE id = ?`,
          [input.serviceKey, paramsJson, input.updatedBy, existing[0].id],
        );
      } else {
        await conn.query(
          `INSERT INTO dbo.ServiceBinding
             (projectId, ownerType, ownerId, scenarioId, targetValueKey, serviceKey, paramsJson, updatedBy)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [...key, input.serviceKey, paramsJson, input.updatedBy],
        );
      }
      const saved = (await listForOwner(target, conn)).find((binding) =>
        binding.scenarioId === target.scenarioId && binding.targetValueKey === target.targetValueKey);
      return { action: existing.length ? "updated" : "inserted", binding: saved! };
    });
  }

  /** Removing a scenario row makes that scenario inherit the general form again. */
  async function remove(target: BindingTarget): Promise<boolean> {
    return db.withTransaction(async (conn) => {
      const projectId = await projectIdFor(conn, target.projectSlug);
      const key = [projectId, target.ownerType, target.ownerId, target.scenarioId, target.targetValueKey];
      const existing = await conn.query<{ id: string }>(
        `SELECT id FROM dbo.ServiceBinding
          WHERE projectId = ? AND ownerType = ? AND ownerId = ? AND scenarioId = ? AND targetValueKey = ?`,
        key,
      );
      if (!existing.length) return false;
      await conn.query("DELETE FROM dbo.ServiceBinding WHERE id = ?", [existing[0].id]);
      return true;
    });
  }

  return { listForOwner, upsert, remove };
}

const defaultRepository = createServiceBindingRepository({ withConnection, withTransaction });

export const listServiceBindings = defaultRepository.listForOwner;
export const upsertServiceBinding = defaultRepository.upsert;
export const removeServiceBinding = defaultRepository.remove;
