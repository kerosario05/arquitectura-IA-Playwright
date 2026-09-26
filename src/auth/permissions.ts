/**
 * Permission catalogue and system role definitions.
 *
 * Permission keys are `<module>.<action>` and are the single source of truth for
 * both the API middleware and the UI (which renders the checkbox tree from
 * `PERMISSION_MODULES`). Keys are stored verbatim in `RolePermissions`, so a key
 * must never be renamed without a migration.
 */

export type PermissionKey =
  | "dashboard.view"
  | "projects.view"
  | "projects.create"
  | "projects.edit"
  | "projects.delete"
  | "projects.materialize"
  | "tests.launch"
  | "tests.rerun"
  | "recordings.view"
  | "recordings.create"
  | "recordings.derive"
  | "recordings.promote"
  | "executions.view"
  | "executions.export"
  | "admin.users"
  | "admin.roles";

export type PermissionDefinition = {
  key: PermissionKey;
  label: string;
  description: string;
};

export type PermissionModule = {
  key: string;
  label: string;
  permissions: PermissionDefinition[];
};

export const PERMISSION_MODULES: PermissionModule[] = [
  {
    key: "dashboard",
    label: "Inicio / Dashboard",
    permissions: [
      {
        key: "dashboard.view",
        label: "Ver dashboard",
        description: "Acceder a la pantalla de inicio y sus métricas agregadas",
      },
    ],
  },
  {
    key: "projects",
    label: "Proyectos",
    permissions: [
      {
        key: "projects.view",
        label: "Ver proyectos",
        description: "Listar y consultar la configuración de los proyectos asignados",
      },
      {
        key: "projects.create",
        label: "Crear proyectos",
        description: "Dar de alta proyectos web o móviles",
      },
      {
        key: "projects.edit",
        label: "Editar proyectos",
        description: "Modificar configuración web, móvil, OTP, Jira, TestRail y conocimiento",
      },
      {
        key: "projects.delete",
        label: "Eliminar proyectos",
        description: "Borrar un proyecto y toda su configuración",
      },
      {
        key: "projects.materialize",
        label: "Materializar proyectos",
        description: "Escribir los archivos de perfil en automations/apps/<slug>/",
      },
    ],
  },
  {
    key: "tests",
    label: "Lanzar pruebas",
    permissions: [
      {
        key: "tests.launch",
        label: "Lanzar ejecuciones",
        description: "Disparar discovery, sprint y launch-execution",
      },
      {
        key: "tests.rerun",
        label: "Relanzar ejecuciones",
        description: "Re-ejecutar un job completo o solo sus casos fallidos",
      },
    ],
  },
  {
    key: "recordings",
    label: "Grabación",
    permissions: [
      {
        key: "recordings.view",
        label: "Ver grabaciones",
        description: "Listar y consultar sesiones de grabación",
      },
      {
        key: "recordings.create",
        label: "Grabar",
        description: "Iniciar y detener sesiones de grabación",
      },
      {
        key: "recordings.derive",
        label: "Derivar escenarios",
        description: "Convertir una grabación en escenarios y planes",
      },
      {
        key: "recordings.promote",
        label: "Promover a TestRail",
        description: "Publicar los escenarios derivados como casos de TestRail",
      },
    ],
  },
  {
    key: "executions",
    label: "Ejecución",
    permissions: [
      {
        key: "executions.view",
        label: "Ver ejecuciones",
        description: "Consultar resultados, logs y evidencias",
      },
      {
        key: "executions.export",
        label: "Exportar evidencia",
        description: "Descargar reportes y evidencia de las ejecuciones",
      },
    ],
  },
  {
    key: "admin",
    label: "Administración",
    permissions: [
      {
        key: "admin.users",
        label: "Administrar usuarios",
        description: "Crear, editar, desactivar y resetear contraseñas de usuarios",
      },
      {
        key: "admin.roles",
        label: "Administrar roles",
        description: "Crear y modificar roles y sus permisos",
      },
    ],
  },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_MODULES.flatMap((m) =>
  m.permissions.map((p) => p.key),
);

const PERMISSION_KEY_SET = new Set<string>(ALL_PERMISSION_KEYS);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_KEY_SET.has(value);
}

/**
 * Validates a caller-supplied permission list, de-duplicating and preserving the
 * catalogue order so stored rows stay stable regardless of UI input order.
 */
export function normalizePermissionKeys(values: unknown): PermissionKey[] {
  if (!Array.isArray(values)) throw new Error("permissions must be an array");
  const seen = new Set<PermissionKey>();
  for (const value of values) {
    if (!isPermissionKey(value)) throw new Error(`unknown permission key: ${String(value)}`);
    seen.add(value);
  }
  return ALL_PERMISSION_KEYS.filter((key) => seen.has(key));
}

export type SystemRoleDefinition = {
  slug: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
};

const NON_ADMIN_KEYS = ALL_PERMISSION_KEYS.filter((key) => !key.startsWith("admin."));
const VIEW_ONLY_KEYS = ALL_PERMISSION_KEYS.filter((key) => key.endsWith(".view"));

/**
 * Seeded by `npm run auth:init`. These roles carry `isSystem = 1`: their
 * permissions may be reviewed but the rows cannot be deleted, so an install can
 * never end up without an administrator role.
 */
export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    slug: "admin",
    name: "Administrador",
    description: "Acceso total, incluida la administración de usuarios y roles",
    permissions: [...ALL_PERMISSION_KEYS],
  },
  {
    slug: "qa-lead",
    name: "QA Lead",
    description: "Todo el ciclo de automatización sin administración de usuarios",
    permissions: NON_ADMIN_KEYS,
  },
  {
    slug: "qa-engineer",
    name: "QA Engineer",
    description: "Graba, deriva y ejecuta pruebas sobre los proyectos asignados",
    permissions: [
      "dashboard.view",
      "projects.view",
      "tests.launch",
      "tests.rerun",
      "recordings.view",
      "recordings.create",
      "recordings.derive",
      "executions.view",
      "executions.export",
    ],
  },
  {
    slug: "viewer",
    name: "Consulta",
    description: "Solo lectura sobre los proyectos asignados",
    permissions: VIEW_ONLY_KEYS,
  },
];
