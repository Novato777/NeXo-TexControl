// Prueba de carga y concurrencia ("romper el sistema").
// Uso (con la API corriendo):  node tests/load-test.mjs [http://localhost:4000] [--scale=1]
// 1) Carga masiva de datos por la API (clientes, productos, ventas, pedidos, producción, compras, pagos).
// 2) Ataques de concurrencia: sobreventa, doble pago, doble apertura de caja, ajustes simultáneos.
// 3) Tiempos de respuesta con la base llena.
// 4) Verificación de integridad (stock, pagos, reservas, cajas).
// Modifica muchos datos. Para volver al estado inicial: Configuración → Restablecer, o npm run db:reset.
const args = process.argv.slice(2);
const BASE = (args.find((a) => a.startsWith('http')) ?? 'http://localhost:4000') + '/api';
const SCALE = Number(args.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 1);
const N = { customers: 1500 * SCALE, products: 40 * SCALE, sales: 2500 * SCALE, orders: 300 * SCALE, production: 120 * SCALE, purchases: 60 * SCALE, payments: 200 * SCALE };
const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
  console.log(`  ${cond ? '✔' : '✘'} ${msg}`);
};

async function session(role) {
  const r = await fetch(`${BASE}/auth/demo-login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role }) });
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  const call = async (method, path, body) => {
    const t0 = performance.now();
    const res = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => null);
    return { status: res.status, data, ms: performance.now() - t0 };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b) };
}

/** Ejecuta tareas con N en paralelo y cuenta resultados por código HTTP. */
async function pool(count, conc, task) {
  const stats = {};
  let i = 0;
  const lat = [];
  const worker = async () => {
    while (i < count) {
      const n = i++;
      try {
        const r = await task(n);
        stats[r.status] = (stats[r.status] ?? 0) + 1;
        lat.push(r.ms);
        if (r.status >= 500) stats.err500 = r.data?.error;
      } catch (e) {
        stats.exception = (stats.exception ?? 0) + 1;
        stats.lastException = e.message;
      }
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: conc }, worker));
  const secs = (performance.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  return { stats, secs, rps: Math.round(count / secs), p95: Math.round(lat[Math.floor(lat.length * 0.95)] ?? 0) };
}
const report = (label, r) => console.log(`  ${label}: ${JSON.stringify(r.stats)} · ${r.secs.toFixed(1)} s · ${r.rps} req/s · p95 ${r.p95} ms`);
const no500 = (label, r) => check(!r.stats[500] && !r.stats.exception, `${label}: sin errores 500 ni caídas`);

const admin = await session('admin');
const ventas = await session('ventas');
const caja = await session('finanzas');
const prod = await session('produccion');
const t = (Date.now() % 100000).toString(36);

// ------------------------------------------------------------------ 1. Carga masiva
console.log(`\n1. Carga masiva (escala ${SCALE})`);
const cur = await caja.get('/cash/current');
if (!cur.data?.open) await caja.post('/cash/open', { openingAmount: 500000 });

let r = await pool(N.customers, 20, (n) =>
  ventas.post('/customers', { name: `Cliente carga ${t}-${n} ${'Ñandú José María'.slice(0, n % 16)}`, type: ['persona', 'empresa', 'colegio', 'equipo'][n % 4], phone: `3${String(100000000 + n).slice(0, 9)}`, document: `LT${t}${n}`, tags: n % 3 ? ['Frecuente'] : [], marketingConsent: n % 2 === 0 }),
);
report(`${N.customers} clientes`, r);
no500('Clientes', r);

const sizes = ['6', '8', '10', '12', '14', '16'];
r = await pool(N.products, 10, (n) =>
  admin.post('/products', { name: `Prenda carga ${t} ${n}`, type: 'terminado', category: 'Uniforme escolar', unit: 'unidad', price: 30000 + n * 100, cost: 15000, minStock: 5, customizable: true, variants: sizes.map((s) => ({ size: s, color: 'Blanco', initialStock: 400 })) }),
);
report(`${N.products} productos × 6 tallas`, r);
no500('Productos', r);

const variants = (await admin.get(`/products/variants/search?q=${encodeURIComponent('Prenda carga ' + t)}&types=terminado`)).data;
const customers = (await admin.get(`/customers?q=${encodeURIComponent('Cliente carga ' + t)}`)).data;
const createdProducts = (await admin.get(`/products?q=${encodeURIComponent('Prenda carga ' + t)}`)).data;
check(createdProducts.reduce((a, p) => a + p.variantsCount, 0) === N.products * 6, `variantes creadas: ${createdProducts.reduce((a, p) => a + p.variantsCount, 0)} de ${N.products * 6}`);
check(customers.length >= N.customers * 0.9, `clientes creados: ${customers.length}`);
const pickV = (n) => variants[n % variants.length];
const pickC = (n) => customers[n % customers.length];

r = await pool(N.sales, 20, (n) => {
  const v = pickV(n);
  const v2 = pickV(n + 7);
  const items = [{ variantId: v.id, quantity: 1, unitPrice: v.price }];
  if (n % 3 === 0 && v2.id !== v.id) items.push({ variantId: v2.id, quantity: 2, unitPrice: v2.price });
  const total = items.reduce((a, i) => a + i.quantity * i.unitPrice, 0);
  const credit = n % 10 === 0;
  return (n % 2 ? ventas : caja).post('/orders/quick-sale', {
    customerId: credit || n % 4 === 0 ? pickC(n).id : null,
    items,
    payments: credit ? [{ amount: Math.round(total / 2), method: 'nequi' }] : [{ amount: total, method: ['efectivo', 'tarjeta', 'nequi', 'transferencia'][n % 4] }],
  });
});
report(`${N.sales} ventas de mostrador`, r);
no500('Ventas', r);

const createdOrders = [];
r = await pool(N.orders, 15, async (n) => {
  const items = [0, 1, 2].map((k) => {
    const v = pickV(n * 3 + k);
    return { variantId: v.id, quantity: 5 + ((n + k) % 20), unitPrice: v.price, customization: n % 2 ? { logo: true, technique: 'bordado', position: 'Pecho izquierdo' } : null };
  }).filter((x, i, a) => a.findIndex((y) => y.variantId === x.variantId) === i);
  const res = await ventas.post('/orders', { customerId: pickC(n).id, items, promisedDate: '2099-06-01', priority: ['normal', 'alta', 'urgente'][n % 3], deliveryMethod: 'recoge', discount: 0, status: n % 10 === 0 ? 'pendiente' : 'confirmado', advance: { amount: 50000, method: 'transferencia' } });
  if (res.status === 201) createdOrders.push(res.data);
  return res;
});
report(`${N.orders} pedidos con anticipo`, r);
no500('Pedidos', r);

const confirmed = createdOrders.filter((o) => o.status === 'confirmado');
const createdPOs = [];
r = await pool(Math.min(N.production, confirmed.length), 10, async (n) => {
  const res = await admin.post('/production', { orderId: confirmed[n].id, targetDate: '2099-05-01', priority: 'normal' });
  if (res.status === 201) createdPOs.push(res.data);
  return res;
});
report(`${createdPOs.length} órdenes de producción`, r);
check(!r.stats[500], 'Producción: sin errores 500');

r = await pool(Math.min(60, createdPOs.length), 8, async (n) => {
  const po = createdPOs[n];
  const d = await prod.get(`/production/${po.id}`);
  await prod.post(`/production/${po.id}/progress`, { lines: d.data.items.map((i) => ({ itemId: i.id, done: i.quantity })) });
  return prod.post(`/production/${po.id}/finish`, { qcApproved: true, consumeRemaining: false });
});
report('60 órdenes terminadas con control de calidad', r);
no500('Terminar producción', r);

r = await pool(N.payments, 15, async (n) => {
  const o = createdOrders[n % createdOrders.length];
  return caja.post(`/orders/${o.id}/payments`, { amount: 1000 + (n % 50) * 100, method: ['transferencia', 'nequi', 'tarjeta'][n % 3] });
});
report(`${N.payments} abonos`, r);
no500('Abonos', r);

const suppliers = (await admin.get('/suppliers')).data;
const mats = (await admin.get('/products/variants/search?types=materia_prima,insumo')).data;
const createdPurchases = [];
r = await pool(N.purchases, 8, async (n) => {
  const res = await admin.post('/purchases', { supplierId: suppliers[n % suppliers.length].id, date: new Date().toISOString().slice(0, 10), items: [0, 1].map((k) => ({ variantId: mats[(n + k * 5) % mats.length].id, quantity: 20 + n, unitCost: 1000 + n })), discount: 0 });
  if (res.status === 201) createdPurchases.push(res.data);
  return res;
});
report(`${N.purchases} compras`, r);
no500('Compras', r);
r = await pool(createdPurchases.length, 8, async (n) => {
  const d = await admin.get(`/purchases/${createdPurchases[n].id}`);
  return admin.post(`/purchases/${createdPurchases[n].id}/receive`, { lines: d.data.items.map((i) => ({ itemId: i.id, quantity: i.pending })) });
});
report('recepción de todas las compras', r);
no500('Recepción', r);

// ------------------------------------------------------------------ 2. Ataques de concurrencia
console.log('\n2. Concurrencia (operaciones simultáneas sobre lo mismo)');
{
  // A. Sobreventa: 40 ventas simultáneas de una talla con solo 10 unidades
  await admin.post('/products', { name: `Escasa ${t}`, type: 'terminado', category: 'Accesorios', unit: 'unidad', price: 10000, cost: 5000, variants: [{ initialStock: 10 }] });
  const v = (await admin.get(`/products/variants/search?q=${encodeURIComponent('Escasa ' + t)}`)).data[0];
  const res = await pool(40, 40, () => caja.post('/orders/quick-sale', { items: [{ variantId: v.id, quantity: 1, unitPrice: 10000 }], payments: [{ amount: 10000, method: 'tarjeta' }] }));
  const after = (await admin.get(`/products/variants/search?q=${encodeURIComponent(v.sku)}`)).data[0];
  check((res.stats[201] ?? 0) === 10 && after.stock === 0, `40 ventas simultáneas con 10 unidades → vendidas ${res.stats[201] ?? 0}, quedan ${after.stock} (esperado 10 y 0)`);
}
{
  // B. Doble pago: 25 pagos simultáneos del saldo completo del mismo pedido
  const o = (await admin.get(`/orders/${createdOrders[0].id}`)).data.order;
  const methods = ['transferencia', 'nequi', 'tarjeta', 'otro', 'efectivo'];
  const res = await pool(25, 25, (n) => caja.post(`/orders/${o.id}/payments`, { amount: o.balance, method: methods[n % 5], reference: `r${n}` }));
  const after = (await admin.get(`/orders/${o.id}`)).data.order;
  check((res.stats[201] ?? 0) === 1 && after.paid === o.total, `25 pagos simultáneos del saldo → aceptados ${res.stats[201] ?? 0}, pagado ${after.paid} de ${o.total}`);
}
{
  // C. Doble apertura de caja
  const c = await caja.get('/cash/current');
  if (c.data.open) await caja.post('/cash/close', { countedCash: c.data.summary.expectedCash });
  const res = await pool(12, 12, () => caja.post('/cash/open', { openingAmount: 100000 }));
  const sessions = (await caja.get('/cash/sessions')).data.filter((s) => s.status === 'abierta');
  check((res.stats[201] ?? 0) === 1 && sessions.length === 1, `12 aperturas simultáneas → abiertas ${sessions.length} (esperado 1)`);
}
{
  // D. Ajustes simultáneos: 20 salidas de 1 unidad sobre un material con 5
  await admin.post('/products', { name: `Insumo escaso ${t}`, type: 'insumo', category: 'Insumos de confección', unit: 'unidad', price: 0, cost: 100, variants: [{ initialStock: 5 }] });
  const v = (await admin.get(`/products/variants/search?q=${encodeURIComponent('Insumo escaso ' + t)}`)).data[0];
  const res = await pool(20, 20, () => admin.post('/inventory/adjust', { variantId: v.id, direction: 'salida', kind: 'merma', quantity: 1, reason: 'prueba de concurrencia' }));
  const after = (await admin.get(`/products/variants/search?q=${encodeURIComponent(v.sku)}`)).data[0];
  check((res.stats[201] ?? 0) === 5 && after.stock === 0, `20 ajustes simultáneos con 5 unidades → aplicados ${res.stats[201] ?? 0}, quedan ${after.stock}`);
}
{
  // E. Confirmar el mismo pedido 10 veces a la vez (no debe reservar doble)
  const p = createdOrders.find((o) => o.status === 'pendiente');
  if (p) {
    await pool(10, 10, () => ventas.post(`/orders/${p.id}/status`, { status: 'confirmado' }));
    const d = (await admin.get(`/orders/${p.id}`)).data;
    check(d.items.every((i) => i.reserved <= i.quantity), `10 confirmaciones simultáneas → sin reservas dobles`);
  }
}

// ------------------------------------------------------------------ 3. Tiempos con la base llena
console.log('\n3. Tiempos de respuesta con la base llena (10 consultas cada una)');
const endpoints = ['/dashboard', '/orders?view=activos', '/orders?kind=venta&limit=200', '/customers', '/products', '/inventory/stock?kind=terminado', '/inventory/reorder', '/production', '/receivables', '/reports/indicators', '/reports/ventas-producto', '/analysis', '/cash/current', `/orders?q=${encodeURIComponent('Cliente carga')}`];
for (const e of endpoints) {
  const times = [];
  let status = 0;
  for (let k = 0; k < 10; k++) {
    const x = await admin.get(e);
    times.push(x.ms);
    status = x.status;
  }
  times.sort((a, b) => a - b);
  const p50 = Math.round(times[5]);
  const p95 = Math.round(times[9]);
  check(status === 200 && p95 < 3000, `${e} → ${status} · p50 ${p50} ms · máx ${p95} ms`);
}

// ------------------------------------------------------------------ 4. Integridad
console.log('\n4. Integridad de los datos después de la carga');
const integ = (await admin.get('/audit/integrity')).data;
for (const c of integ.results) check(c.problems === 0, `${c.label}: ${c.problems} problema(s)${c.problems ? ' ' + JSON.stringify(c.sample[0]) : ''}`);

console.log(`\n${failures.length ? `✘ ${failures.length} falla(s)` : '✔ El sistema resistió toda la carga sin fallas'}`);
process.exit(failures.length ? 1 : 0);
