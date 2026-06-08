import os from 'node:os';
import { Pool } from 'pg';
import { loadConfig } from '../config';

/**
 * Cross-platform database bootstrap — the Docker-free replacement for
 * `docker compose up -d postgres`.
 *
 * It connects to an *already running* PostgreSQL server as an administrative
 * user and creates the application role + database described by DATABASE_URL.
 * It is idempotent: running it twice is a no-op. Pass `--reset` to drop and
 * recreate the database (handy for a clean slate before tests).
 *
 * Connection model
 * ----------------
 *   - Target (what we create) comes from DATABASE_URL
 *       default: postgres://workflow:workflow@localhost:5432/workflow
 *   - Admin (who creates it) comes from ADMIN_DATABASE_URL, or is derived as
 *       postgres://<PGUSER|os-user>@<host>:<port>/postgres
 *     which matches a stock Homebrew (macOS) or local install where your OS
 *     user is a superuser over local (trust/peer) connections.
 *
 * Examples
 * --------
 *   npm run db:setup
 *   npm run db:reset
 *   ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:setup
 */

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string): string {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `Unsafe SQL identifier ${JSON.stringify(
        name,
      )}: use only letters, digits and underscores.`,
    );
  }
  return `"${name}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return url;
  }
}

interface Target {
  role: string;
  password: string | null;
  database: string;
  host: string;
  port: string;
}

function parseTarget(databaseUrl: string): Target {
  const u = new URL(databaseUrl);
  return {
    role: decodeURIComponent(u.username) || 'workflow',
    password: u.password ? decodeURIComponent(u.password) : null,
    database: decodeURIComponent(u.pathname.replace(/^\//, '')) || 'workflow',
    host: u.hostname || 'localhost',
    port: u.port || '5432',
  };
}

function adminUrl(target: Target): string {
  if (process.env.ADMIN_DATABASE_URL) return process.env.ADMIN_DATABASE_URL;
  const adminUser = process.env.PGUSER ?? os.userInfo().username;
  const adminDb = process.env.ADMIN_DATABASE ?? 'postgres';
  return `postgres://${encodeURIComponent(adminUser)}@${target.host}:${
    target.port
  }/${adminDb}`;
}

async function exists(
  pool: Pool,
  sql: string,
  param: string,
): Promise<boolean> {
  const { rowCount } = await pool.query(sql, [param]);
  return (rowCount ?? 0) > 0;
}

async function main(): Promise<void> {
  const reset = process.argv.includes('--reset');
  const { databaseUrl } = loadConfig();
  const target = parseTarget(databaseUrl);
  const admin = adminUrl(target);

  console.log(`• Target database : ${target.database} (owner: ${target.role})`);
  console.log(`• Admin connection: ${redact(admin)}`);
  if (reset)
    console.log(
      '• Mode            : --reset (database will be dropped & recreated)',
    );

  // pg's SASL/SCRAM path requires a password *string* even when the server
  // uses trust/peer auth. Inject a dummy when none is supplied so trust-based
  // local installs work out of the box (trust ignores it); a server that
  // genuinely requires a password will surface a clear auth error instead.
  const adminConn = new URL(admin);
  if (!adminConn.password) adminConn.password = 'trust';
  const pool = new Pool({ connectionString: adminConn.toString() });
  try {
    // 1. Application role (idempotent)
    if (
      await exists(
        pool,
        'SELECT 1 FROM pg_roles WHERE rolname = $1',
        target.role,
      )
    ) {
      console.log(`  role "${target.role}" already exists`);
    } else {
      const withPw = target.password
        ? ` LOGIN PASSWORD ${quoteLiteral(target.password)}`
        : ' LOGIN';
      await pool.query(`CREATE ROLE ${quoteIdent(target.role)} WITH${withPw}`);
      console.log(`  created role "${target.role}"`);
    }

    // 2. Optional reset — terminate other sessions, then drop.
    if (
      reset &&
      (await exists(
        pool,
        'SELECT 1 FROM pg_database WHERE datname = $1',
        target.database,
      ))
    ) {
      await pool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [target.database],
      );
      await pool.query(`DROP DATABASE ${quoteIdent(target.database)}`);
      console.log(`  dropped database "${target.database}"`);
    }

    // 3. Application database (idempotent)
    if (
      await exists(
        pool,
        'SELECT 1 FROM pg_database WHERE datname = $1',
        target.database,
      )
    ) {
      console.log(`  database "${target.database}" already exists`);
    } else {
      await pool.query(
        `CREATE DATABASE ${quoteIdent(target.database)} OWNER ${quoteIdent(
          target.role,
        )}`,
      );
      console.log(`  created database "${target.database}"`);
    }

    console.log('\n\u2713 Database ready. Next: npm run migrate');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(
    '\n\u2717 Database bootstrap failed:\n  ',
    err instanceof Error ? err.message : err,
  );
  console.error(
    '\nChecklist:\n' +
      '  1. Is PostgreSQL running?\n' +
      '       macOS (Homebrew): brew services start postgresql@16\n' +
      '       Linux (systemd):  sudo systemctl start postgresql\n' +
      '  2. Can your OS user connect as an admin?\n' +
      "       psql -d postgres -c 'select 1'\n" +
      '  3. If not, point the script at a superuser explicitly:\n' +
      '       ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run db:setup\n',
  );
  process.exit(1);
});
