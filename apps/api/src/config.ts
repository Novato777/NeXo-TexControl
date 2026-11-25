import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';

let jwtSecret = process.env.JWT_SECRET || '';
if (!jwtSecret) {
  if (isProd) {
    throw new Error('Falta JWT_SECRET. Defínelo en las variables de entorno antes de iniciar en producción.');
  }
  jwtSecret = 'solo-para-desarrollo-local-no-usar-en-produccion';
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 4000),
  databaseUrl: process.env.DATABASE_URL || '',
  pgliteDir: process.env.PGLITE_DIR || path.resolve(__dirname, '../.data/pglite'),
  migrationsDir: path.resolve(__dirname, '../drizzle'),
  jwtSecret,
  corsOrigin: process.env.CORS_ORIGIN || '',
  demoPassword: process.env.DEMO_PASSWORD || 'Demo2026*',
  autoSeed: (process.env.AUTO_SEED ?? 'true') !== 'false',
  sessionCookie: 'nexo_session',
};
