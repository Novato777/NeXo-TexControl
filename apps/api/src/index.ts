import { appState, createApp } from './app';
import { config } from './config';
import { closeDb, initDb } from './db/client';
import { seedIfEmpty } from './db/seed';

// Primero abrimos el puerto (Render exige que el servicio responda pronto) y luego preparamos la base.
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[api] escuchando en http://localhost:${config.port}`);
});

try {
  appState.message = 'conectando la base de datos.';
  const { driver } = await initDb();
  console.log(`[api] base de datos lista (${driver === 'pglite' ? 'PGlite local en ' + config.pgliteDir : 'PostgreSQL'})`);
  if (config.autoSeed) {
    appState.message = 'cargando los datos de demostración (solo la primera vez, puede tardar uno o dos minutos).';
    const seeded = await seedIfEmpty();
    if (seeded) console.log('[api] datos demo cargados por primera vez');
  }
  appState.ready = true;
} catch (err) {
  console.error('[api] no se pudo preparar la base de datos:', err);
  appState.message = 'hubo un problema con la base de datos. Revisa los registros del servidor.';
}

const shutdown = async () => {
  server.close();
  await closeDb();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
