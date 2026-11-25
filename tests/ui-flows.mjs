// Prueba de interfaz: recorre flujos críticos haciendo clic como un usuario.
// Uso (con API y web corriendo):  node tests/ui-flows.mjs [http://localhost:5173]
import fs from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:5173';
const channel = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge';
const browser = await chromium.launch({ channel });
const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let ok = 0;
const step = async (name, fn) => {
  try {
    await fn();
    ok++;
    console.log('  ✔', name);
  } catch (e) {
    console.log('  ✘', name, '-', e.message.split('\n')[0]);
    await page.screenshot({ path: `test-results-${ok}.png`, fullPage: true });
    await browser.close();
    process.exit(1);
  }
};

console.log('\nIngreso');
await step('entrar como Ventas desde la pantalla de ingreso', async () => {
  await page.goto(base + '/ingresar');
  await page.getByRole('button', { name: /Ventas · / }).click();
  await page.getByRole('heading', { name: /Buenos días|Buenas tardes|Buenas noches/ }).waitFor();
});

console.log('\nFlujo A en pantalla — asistente de pedido');
await step('desde Inicio, pulsar "Crear pedido"', async () => {
  await page.getByRole('link', { name: 'Crear pedido' }).first().click();
  await page.getByRole('heading', { name: '¿Para quién es el pedido?' }).waitFor();
});
await step('no avanza sin cliente y explica por qué', async () => {
  await page.getByRole('button', { name: /Siguiente: Productos/ }).click();
  await page.getByText('Selecciona un cliente o crea uno nuevo para continuar.').waitFor();
});
await step('buscar y seleccionar cliente', async () => {
  await page.getByPlaceholder('Buscar por nombre, documento o teléfono').fill('Andes');
  await page.getByRole('option', { name: /Gimnasio Los Andes/ }).click();
  await page.getByText('Cambiar cliente').waitFor();
  await page.getByRole('button', { name: /Siguiente: Productos/ }).click();
});
await step('agregar camisas talla 10 y 12', async () => {
  await page.getByPlaceholder('Buscar producto por nombre o código').fill('Camisa escolar');
  await page.getByRole('button', { name: /Camisa escolar manga corta/ }).click();
  await page.getByRole('button', { name: /^Talla 10/ }).click();
  await page.getByRole('button', { name: /^Talla 12/ }).click();
  await page.getByText('Productos agregados').waitFor();
  const qty = page.getByLabel(/Cantidad de Camisa escolar manga corta \(Talla 10/);
  await qty.click();
  await qty.fill('15');
});
await step('indicar que lleva logo bordado', async () => {
  await page.getByRole('button', { name: 'Sí', exact: true }).click();
  await page.getByText('Lleva logo o escudo').click();
  await page.getByRole('button', { name: /Siguiente: Entrega y pago/ }).click();
});
await step('entrega en 15 días, prioridad alta y anticipo del 50%', async () => {
  await page.getByRole('button', { name: '15 días' }).click();
  await page.getByRole('button', { name: 'Alta', exact: true }).click();
  await page.getByText('Total del pedido').waitFor();
  await page.getByRole('button', { name: '50%' }).last().click();
  await page.getByRole('button', { name: /Siguiente: Confirmar/ }).click();
});
await step('confirmar pedido', async () => {
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.getByRole('heading', { name: /Pedido PED-\d+ confirmado/ }).waitFor();
});
await step('enviar a producción desde la pantalla de éxito', async () => {
  await page.getByRole('button', { name: 'Enviar a producción' }).click();
  // Ventas no tiene acceso a Producción: vuelve al pedido, que ya muestra la orden creada.
  await page.waitForURL(/\/pedidos\/\d+/);
  await page.getByText(/^OP-\d+$/).first().waitFor();
  await page.getByText(/\d+ en producción/).first().waitFor();
});

console.log('\nFlujo C en pantalla — venta rápida');
await step('vender 1 unidad en efectivo y ver el cambio', async () => {
  await page.goto(base + '/venta-rapida');
  await page.getByPlaceholder('Buscar producto por nombre o código').fill('Medias');
  await page.getByRole('button', { name: /Medias escolares/ }).click();
  await page.getByRole('button', { name: /Única/ }).first().click();
  await page.getByLabel('Efectivo recibido').fill('20000');
  await page.getByRole('button', { name: /Confirmar venta de/ }).click();
  await page.getByText('Cambio para el cliente').waitFor();
});

await browser.close();
console.log(`\n${ok} pasos correctos${errors.length ? `; errores de página: ${errors.join(' | ')}` : ', sin errores de página'}.`);
process.exit(errors.length ? 1 : 0);
