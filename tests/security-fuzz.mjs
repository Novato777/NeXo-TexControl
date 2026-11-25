// Auditoría automática de robustez y seguridad contra la API en ejecución.
// Uso:  node tests/security-fuzz.mjs [http://localhost:4000]
// Comprueba: autenticación, permisos por rol, CSRF, entradas maliciosas/extremas (nunca debe haber 500),
// inyección SQL, XSS almacenado en URLs, desbordes numéricos, parámetros de consulta inválidos y cabeceras.
const BASE = (process.argv[2] ?? 'http://localhost:4000') + '/api';
let passed = 0;
const failures = [];
const ok = (cond, msg) => {
  if (cond) passed++;
  else failures.push(msg);
};

async function session(role) {
  const r = await fetch(`${BASE}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* no json */
    }
    return { status: res.status, data, headers: res.headers };
  };
  return { cookie, get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b ?? {}, h), put: (p, b) => call('PUT', p, b), raw: call };
}

const admin = await session('admin');
const ventas = await session('ventas');
const prod = await session('produccion');

// ------------------------------------------------------------------ 1. Autenticación
console.log('1. Autenticación');
for (const p of ['/dashboard', '/orders', '/customers', '/cash/current', '/users', '/audit', '/settings']) {
  const r = await fetch(`${BASE}${p}`);
  ok(r.status === 401, `sin sesión ${p} debería dar 401 (dio ${r.status})`);
}
{
  const r = await fetch(`${BASE}/orders`, { headers: { cookie: 'nexo_session=eyJhbGciOiJub25lIn0.eyJpZCI6MSwicm9sZSI6ImFkbWluIn0.' } });
  ok(r.status === 401, `token falsificado (alg none) debería dar 401 (dio ${r.status})`);
}
{
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@demo.co', password: "' OR '1'='1" }) });
  ok(r.status === 401, `login con inyección SQL debe fallar (dio ${r.status})`);
}
{
  // Fuerza bruta: muchos intentos fallidos deben terminar bloqueados (429)
  let last = 0;
  for (let i = 0; i < 15; i++) {
    const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.9.9' }, body: JSON.stringify({ email: 'nadie@demo.co', password: 'malamala' + i }) });
    last = r.status;
  }
  ok(last === 429, `tras 15 intentos fallidos debería bloquear con 429 (dio ${last})`);
}

// ------------------------------------------------------------------ 2. Cabeceras y CSRF
console.log('2. Cabeceras y CSRF');
{
  const r = await admin.get('/settings');
  ok(r.headers.get('x-content-type-options') === 'nosniff', 'falta cabecera X-Content-Type-Options: nosniff');
  ok(!!r.headers.get('x-frame-options'), 'falta cabecera X-Frame-Options');
  ok(!r.headers.get('x-powered-by'), 'no debe exponer X-Powered-By');
  const login = await fetch(`${BASE}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'ventas' }) });
  const sc = login.headers.get('set-cookie') ?? '';
  ok(/HttpOnly/i.test(sc), 'la cookie de sesión debe ser HttpOnly');
  ok(/SameSite=Lax|SameSite=Strict/i.test(sc), 'la cookie de sesión debe tener SameSite');
}
{
  // Formulario de otro sitio (text/plain) no debe poder ejecutar acciones
  const r = await admin.raw('POST', '/cash/movements', '{"type":"egreso","category":"Otros gastos","concept":"csrf","amount":1000,"method":"transferencia"}', { 'content-type': 'text/plain' });
  ok(r.status === 415 || r.status === 400, `POST con text/plain (CSRF) debe rechazarse con 415/400 (dio ${r.status})`);
}

// ------------------------------------------------------------------ 3. Permisos por rol
console.log('3. Permisos por rol');
const forbidden = [
  [prod, 'GET', '/cash/current'],
  [prod, 'GET', '/receivables'],
  [prod, 'GET', '/reports/indicators'],
  [prod, 'POST', '/orders/quick-sale', { items: [] }],
  [ventas, 'GET', '/users'],
  [ventas, 'GET', '/audit'],
  [ventas, 'PUT', '/settings', {}],
  [ventas, 'POST', '/demo/reset', {}],
  [ventas, 'POST', '/cash/close', { countedCash: 0 }],
  [ventas, 'POST', '/inventory/adjust', { variantId: 1, direction: 'entrada', quantity: 1, reason: 'x' }],
  [ventas, 'POST', '/orders/payments/1/reverse', { reason: 'x' }],
  [ventas, 'POST', '/users', { name: 'x', email: 'x@x.co', role: 'admin', password: '12345678' }],
  [prod, 'POST', '/purchases', {}],
  [prod, 'PUT', '/products/1', {}],
];
for (const [s, m, p, b] of forbidden) {
  const r = m === 'GET' ? await s.get(p) : m === 'PUT' ? await s.put(p, b) : await s.post(p, b);
  ok(r.status === 403, `${m} ${p} con rol sin permiso debe dar 403 (dio ${r.status})`);
}
{
  const o = await prod.get('/orders?limit=5');
  ok(o.status === 200 && o.data.rows.every((r) => r.total === null && r.balance === null), 'Producción no debe ver valores de dinero en pedidos');
  const d = await prod.get(`/orders/${o.data.rows[0]?.id}`);
  ok(d.status === 200 && d.data.payments.length === 0 && d.data.items.every((i) => i.unitPrice === null), 'Producción no debe ver precios ni pagos en el detalle');
}

// ------------------------------------------------------------------ 4. Entradas maliciosas y extremas (nunca 500)
console.log('4. Entradas maliciosas y extremas');
const evil = ["' OR 1=1 --", '"; DROP TABLE orders; --', '<script>alert(1)</script>', '%', '_', '\\', '\u0000', 'a'.repeat(20000), '😀👍🏽', '../../etc/passwd', '{{7*7}}', '${7*7}'];
const searchPaths = ['/customers?q=', '/orders?q=', '/products?q=', '/products/variants/search?q=', '/inventory/stock?q=', '/inventory/movements?q=', '/suppliers?q=', '/production?q=', '/audit?q='];
for (const p of searchPaths) for (const e of evil) {
  const r = await admin.get(p + encodeURIComponent(e));
  ok(r.status !== 500 && r.status < 500, `GET ${p}<malicioso:${e.slice(0, 12)}> dio ${r.status}`);
}
const badQuery = ['/orders?limit=abc', '/orders?limit=-5', '/orders?offset=xyz', '/orders?from=hola&to=chao', '/inventory/movements?limit=999999&offset=-1', '/reports/ventas-periodo?from=2026-13-45&to=nope', '/reports/indicators?from=%27&to=1', '/dashboard?from=x&to=y', '/payables?supplierId=abc', '/purchases?supplierId=1%20OR%201=1', '/inventory/movements?variantId=abc', '/orders/abc', '/orders/-1', '/orders/99999999999', '/customers/1.5', '/products/0'];
for (const p of badQuery) {
  const r = await admin.get(p);
  ok(r.status < 500, `GET ${p} no debe dar 500 (dio ${r.status})`);
}
const big = 99999999999999;
const posts = [
  ['/customers', { name: 'x'.repeat(5000), type: 'persona' }],
  ['/customers', { name: '<img src=x onerror=alert(1)>', type: 'persona', email: 'no-es-correo' }],
  ['/customers', { name: 'Ok', type: 'hacker' }],
  ['/customers', { name: 'Ok', type: 'persona', creditDays: -10 }],
  ['/products', { name: 'P', type: 'terminado', category: 'X', unit: 'unidad', price: big, cost: 1, variants: [{}] }],
  ['/products', { name: 'P', type: 'terminado', category: 'X', unit: 'unidad', price: -1, cost: 1, variants: [{}] }],
  ['/products', { name: 'P', type: 'terminado', category: 'X', unit: 'unidad', price: 1000, cost: 1, variants: [] }],
  ['/products', { name: 'P', type: 'terminado', category: 'X', unit: 'unidad', price: 1000, cost: 1, variants: [{ initialStock: big }] }],
  ['/orders', { customerId: 1, items: [{ variantId: 1, quantity: 2147483647, unitPrice: 2147483647 }], promisedDate: '2099-01-01' }],
  ['/orders', { customerId: 1, items: [{ variantId: 999999, quantity: 1, unitPrice: 1000 }], promisedDate: '2099-01-01' }],
  ['/orders', { customerId: 999999, items: [{ variantId: 1, quantity: 1, unitPrice: 1000 }], promisedDate: '2099-01-01' }],
  ['/orders', { customerId: 1, items: [{ variantId: 1, quantity: 1.5, unitPrice: 1000 }], promisedDate: '2099-01-01' }],
  ['/orders', { customerId: 1, items: [{ variantId: 1, quantity: 1, unitPrice: 1000 }], promisedDate: '01/01/2099' }],
  ['/orders', { customerId: 1, items: Array.from({ length: 5000 }, () => ({ variantId: 1, quantity: 1, unitPrice: 1 })), promisedDate: '2099-01-01' }],
  ['/orders/quick-sale', { items: [{ variantId: 1, quantity: -3, unitPrice: 1000 }] }],
  ['/orders/quick-sale', { items: [{ variantId: 1, quantity: 1, unitPrice: 1000 }], payments: [{ amount: big, method: 'efectivo' }] }],
  ['/orders/quick-sale', { items: [{ variantId: 1, quantity: 1, unitPrice: 1000 }], discount: -5000, payments: [] }],
  ['/orders/1/payments', { amount: 0, method: 'efectivo' }],
  ['/orders/1/payments', { amount: big, method: 'efectivo' }],
  ['/orders/1/payments', { amount: 1000, method: 'bitcoin' }],
  ['/orders/1/status', { status: 'entregado' }],
  ['/orders/1/status', { status: 'inventado' }],
  ['/inventory/adjust', { variantId: 1, direction: 'salida', quantity: big, reason: 'x' }],
  ['/inventory/adjust', { variantId: 'abc', direction: 'salida', quantity: 1, reason: 'x' }],
  ['/inventory/count', { lines: [{ variantId: 1, counted: -1 }] }],
  ['/cash/movements', { type: 'egreso', category: 'x', concept: 'x', amount: big, method: 'transferencia' }],
  ['/cash/movements', { type: 'robo', category: 'x', concept: 'x', amount: 10, method: 'efectivo' }],
  ['/payables', { category: 'x', concept: 'x', amount: big, dueDate: '2026-01-01' }],
  ['/purchases', { supplierId: 1, date: '2026-01-01', items: [{ variantId: 1, quantity: big, unitCost: big }] }],
  ['/production', { targetDate: '2099-01-01', items: [{ variantId: 1, quantity: 0 }] }],
  ['/marketing/assets', { name: 'malo', kind: 'imagen', url: 'javascript:alert(document.cookie)' }],
  ['/marketing/campaigns', { name: 'x', segment: 'todos', channel: 'whatsapp', date: 'ayer', message: 'x' }],
  ['/users', { name: 'x', email: 'admin@demo.co', role: 'admin', password: '123' }],
  ['/settings', { companyName: '' }],
];
for (const [p, b] of posts) {
  const r = p === '/settings' ? await admin.put(p, b) : await admin.post(p, b);
  ok(r.status >= 400 && r.status < 500, `POST ${p} con datos inválidos debe dar 4xx (dio ${r.status}${r.data?.error ? ': ' + r.data.error.slice(0, 80) : ''})`);
  ok(typeof r.data?.error === 'string' && !/stack|at \w+ \(|node_modules|syntax error|relation|column/i.test(r.data.error), `POST ${p}: el error no debe filtrar detalles internos (${r.data?.error?.slice(0, 60)})`);
}
{
  const r = await admin.raw('POST', '/customers', '{"name": "roto",', {});
  ok(r.status === 400, `JSON mal formado debe dar 400 (dio ${r.status})`);
  const huge = await admin.raw('POST', '/customers', JSON.stringify({ name: 'x', type: 'persona', notes: 'x'.repeat(3_000_000) }), {});
  ok(huge.status === 413 || huge.status === 400, `cuerpo de 3 MB debe rechazarse (dio ${huge.status})`);
  const proto = await admin.post('/customers', JSON.parse('{"name":"Proto","type":"persona","__proto__":{"admin":true},"constructor":{"prototype":{"x":1}}}'));
  ok(proto.status < 500, `__proto__ en el cuerpo no debe romper (dio ${proto.status})`);
}

// ------------------------------------------------------------------ 5. Lógica de negocio que no se debe poder burlar
console.log('5. Reglas de negocio');
{
  const o = (await admin.get('/orders?view=con_saldo&limit=1')).data.rows[0];
  if (o) {
    const over = await admin.post(`/orders/${o.id}/payments`, { amount: o.balance + 1, method: 'transferencia' });
    ok(over.status === 400, 'no se puede pagar más del saldo');
  }
  const v = (await admin.get('/products/variants/search?types=terminado')).data[0];
  const neg = await admin.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: v.available + 1000, unitPrice: v.price }], payments: [{ amount: (v.available + 1000) * v.price, method: 'tarjeta' }] });
  ok(neg.status === 400, 'no se puede vender más de lo disponible');
  const mat = (await admin.get('/products/variants/search?types=materia_prima')).data[0];
  const sale = await admin.post('/orders/quick-sale', { items: [{ variantId: mat.id, quantity: 1, unitPrice: 1 }], payments: [{ amount: 1, method: 'tarjeta' }] });
  ok(sale.status === 400, 'no se pueden vender materias primas en mostrador');
  const cheap = await ventas.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 1, unitPrice: v.price }], discount: v.price, payments: [] });
  ok(cheap.status === 403 || cheap.status === 400, 'Ventas no puede regalar productos con 100% de descuento');
}

// ------------------------------------------------------------------ resultado
console.log(`\n${passed} comprobaciones correctas, ${failures.length} fallas.`);
for (const f of failures) console.log('  ✘', f);
process.exit(failures.length ? 1 : 0);
