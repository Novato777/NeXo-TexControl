// Conexión única. Sin DATABASE_URL usa PGlite (PostgreSQL embebido, sin instalar nada).
// Con DATABASE_URL usa node-postgres (Neon, Render Postgres, local, etc.). Mismo esquema y migraciones.
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import fs from 'node:fs';
import { config } from '../config';
import * as schema from './schema';

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type Executor = DB | Tx;

export let db: DB;
let closeFn: (() => Promise<void>) | null = null;

export async function initDb(): Promise<{ driver: 'postgres' | 'pglite' }> {
  if (config.databaseUrl) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: config.databaseUrl, max: 5 });
    db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: config.migrationsDir });
    closeFn = () => pool.end();
    return { driver: 'postgres' };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  fs.mkdirSync(config.pgliteDir, { recursive: true });
  const client = new PGlite(config.pgliteDir);
  const pdb = drizzle(client, { schema });
  await migrate(pdb, { migrationsFolder: config.migrationsDir });
  db = pdb as unknown as DB;
  closeFn = () => client.close();
  return { driver: 'pglite' };
}

export async function closeDb() {
  await closeFn?.();
}
