// npm run db:seed   -> carga datos demo solo si la base está vacía (no duplica).
// npm run db:reset  -> borra TODO y vuelve a cargar los datos demo.
import { closeDb, initDb } from './client';
import { resetAndSeed, seedIfEmpty } from './seed';

const reset = process.argv.includes('--reset');
const { driver } = await initDb();
console.log(`[db] conectado (${driver})`);
if (reset) {
  await resetAndSeed();
  console.log('[db] base reiniciada con datos demo.');
} else {
  const done = await seedIfEmpty();
  console.log(done ? '[db] datos demo cargados.' : '[db] la base ya tenía datos; no se cargó nada (usa db:reset para reiniciar).');
}
await closeDb();
