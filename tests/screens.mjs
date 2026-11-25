// Toma capturas de las pantallas principales y reporta errores de consola.
// Uso (con API y web corriendo):  node tests/screens.mjs [rutas...] [--out=docs/capturas] [--role=admin] [--mobile]
// Usa el navegador Edge o Chrome instalado (no descarga navegadores).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const out = opt('out', 'docs/capturas');
const role = opt('role', 'admin');
const base = opt('base', 'http://localhost:5173');
const mobile = args.includes('--mobile');
const routes = args.filter((a) => !a.startsWith('--'));
const DEFAULT = [
  ['inicio', '/'],
  ['pedidos', '/pedidos'],
  ['pedidos-tablero', '/pedidos?modo=tablero'],
  ['venta-rapida', '/venta-rapida'],
  ['crear-pedido', '/pedidos/nuevo'],
];
const list = routes.length ? routes.map((r) => [r.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'inicio', r]) : DEFAULT;

fs.mkdirSync(out, { recursive: true });
const channel = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge';
const browser = await chromium.launch({ channel });
const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true } : { viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(`[console] ${m.text()}`));
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(base + '/ingresar');
await page.evaluate(async (r) => {
  await fetch('/api/auth/demo-login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: r }), credentials: 'include' });
}, role);

for (const [name, route] of list) {
  const before = errors.length;
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  const file = path.join(out, `${name}${mobile ? '-movil' : ''}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const errs = errors.slice(before);
  console.log(`${errs.length ? '✘' : '✔'} ${route} → ${file}${errs.length ? '\n   ' + errs.join('\n   ') : ''}`);
}
await browser.close();
