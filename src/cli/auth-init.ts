import "../config/env"; // Load .env before touching the datasource
import { closeConnection, describeDatasource, resolveDriverName } from "../db/sql-connection";
import { bootstrapIdentity, DEFAULT_ADMIN_USERNAME } from "../auth/bootstrap";
import { PasswordPolicyError } from "../auth/password";
import { ALL_PERMISSION_KEYS, SYSTEM_ROLES } from "../auth/permissions";

/**
 * Seeds the identity tables: system roles, their permissions and the first
 * administrator. Safe to re-run — it is the supported way to pick up new
 * permission keys after an upgrade.
 */

interface CliArgs {
  username?: string;
  password?: string;
  fullName?: string;
  email?: string;
  syncSystemRoles: boolean;
  keepPassword: boolean;
  help: boolean;
}

const FLAGS = new Set(["--sync-roles", "--keep-password", "--help", "-h"]);

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { syncSystemRoles: false, keepPassword: false, help: false };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--sync-roles") {
      args.syncSystemRoles = true;
      continue;
    }
    if (token === "--keep-password") {
      args.keepPassword = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next || (next.startsWith("--") && FLAGS.has(next))) {
      throw new Error(`Missing value for argument: ${token}`);
    }

    switch (token) {
      case "--username":
        args.username = next;
        break;
      case "--password":
        args.password = next;
        break;
      case "--full-name":
        args.fullName = next;
        break;
      case "--email":
        args.email = next;
        break;
      default:
        throw new Error(`Unknown argument: ${token}`);
    }
    i += 1;
  }

  return args;
}

function printHelp(): void {
  console.log(`
  npm run auth:init -- [opciones]

  Siembra los roles de sistema y crea el primer administrador. Es idempotente.

  Opciones:
    --username <user>    Usuario administrador (default: ${DEFAULT_ADMIN_USERNAME})
    --password <pass>    Contraseña inicial. Si se omite se genera una temporal
    --full-name <name>   Nombre completo
    --email <email>      Correo
    --sync-roles         Reescribe los permisos de TODOS los roles de sistema
                         según el catálogo (descarta ajustes manuales)
    --keep-password      No forzar el cambio de contraseña en el primer login
                         (solo tiene sentido junto a --password)

  Variables de entorno equivalentes:
    AUTH_BOOTSTRAP_USERNAME, AUTH_BOOTSTRAP_PASSWORD,
    AUTH_BOOTSTRAP_FULLNAME, AUTH_BOOTSTRAP_EMAIL
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  console.log(`\n[auth] driver     : ${resolveDriverName()}`);
  console.log(`[auth] datasource : ${describeDatasource()}`);
  console.log(`[auth] catálogo   : ${ALL_PERMISSION_KEYS.length} permisos, ${SYSTEM_ROLES.length} roles de sistema\n`);

  const report = await bootstrapIdentity({
    username: args.username,
    password: args.password,
    fullName: args.fullName,
    email: args.email,
    syncSystemRoles: args.syncSystemRoles,
    forcePasswordChange: !args.keepPassword,
  });

  const { roles, admin } = report;

  if (roles.created.length > 0) {
    console.log(`[auth] roles creados    : ${roles.created.join(", ")}`);
  }
  if (roles.synced.length > 0) {
    console.log(`[auth] roles sincronizados: ${roles.synced.join(", ")}`);
  }
  for (const entry of roles.toppedUp) {
    console.log(`[auth] permisos añadidos a "${entry.slug}": ${entry.added.join(", ")}`);
  }
  for (const entry of roles.unknownKeys) {
    console.warn(
      `[auth] AVISO: el rol "${entry.slug}" tiene permisos fuera del catálogo: ${entry.keys.join(", ")}` +
        ` — usa --sync-roles para limpiarlos`,
    );
  }
  if (
    roles.created.length === 0 &&
    roles.synced.length === 0 &&
    roles.toppedUp.length === 0
  ) {
    console.log(`[auth] roles            : sin cambios (ya estaban al día)`);
  }

  console.log("");
  switch (admin.status) {
    case "created":
      console.log(`[auth] administrador creado: ${admin.username}`);
      if (admin.generatedPassword) {
        console.log(`\n  ┌─────────────────────────────────────────────────────┐`);
        console.log(`  │  Contraseña temporal (se muestra una sola vez)      │`);
        console.log(`  └─────────────────────────────────────────────────────┘`);
        console.log(`\n      usuario    : ${admin.username}`);
        console.log(`      contraseña : ${admin.generatedPassword}\n`);
      }
      if (admin.mustChangePassword) {
        console.log(`  Deberá cambiarla en el primer login.\n`);
      }
      break;
    case "role_assigned":
      console.log(
        `[auth] el usuario "${admin.username}" ya existía sin permisos de administración;` +
          ` se le asignó el rol admin.`,
      );
      break;
    case "already_exists":
      console.log(
        `[auth] ya existe al menos un administrador activo — no se creó ninguno nuevo.`,
      );
      break;
  }

  console.log(`[auth] listo.\n`);
}

main()
  .catch((err) => {
    if (err instanceof PasswordPolicyError) {
      console.error(`\n[auth] la contraseña indicada no cumple la política:`);
      for (const violation of err.violations) console.error(`  - ${violation}`);
      console.error("");
    } else {
      console.error(`\n[auth] falló:`, err instanceof Error ? err.message : err, "\n");
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeConnection().catch(() => {});
  });
