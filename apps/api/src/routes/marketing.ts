// Marketing: segmentos, campañas, plantillas y biblioteca. NO envía mensajes: solo prepara, copia y abre el canal.
import { Router } from 'express';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { addDays, campaignSchema, contentAssetSchema, todayISO, type Segment } from '@nexo/shared';
import { db } from '../db/client';
import { campaigns, contentAssets, customers, messageTemplates, orders } from '../db/schema';
import { audit } from '../lib/audit';
import { currentUser, requireModule } from '../lib/auth';
import { badRequest, idParam, notFound, parse } from '../lib/errors';

export const marketingRouter = Router();
marketingRouter.use(requireModule('marketing'));

async function segmentCustomers(segment: Segment) {
  const today = todayISO();
  const rows = await db
    .select({
      c: customers,
      purchases: sql<number>`(select count(*)::int from orders o where o.customer_id = ${customers.id} and o.status not in ('borrador','cancelado'))`,
      last: sql<string | null>`(select max(order_date) from orders o where o.customer_id = ${customers.id} and o.status not in ('borrador','cancelado'))`,
    })
    .from(customers)
    .where(and(eq(customers.archived, false), eq(customers.marketingConsent, true)))
    .orderBy(asc(customers.name));
  return rows
    .filter((r) => {
      switch (segment) {
        case 'frecuentes':
          return r.purchases >= 4 || r.c.tags.includes('Frecuente');
        case 'institucionales':
          return ['colegio', 'institucion'].includes(r.c.type) || r.c.tags.includes('Institucional');
        case 'temporada':
          return r.c.tags.includes('Temporada escolar') || r.c.type === 'persona';
        case 'inactivos':
          return !r.last || r.last < addDays(today, -90);
        default:
          return true;
      }
    })
    .map((r) => ({ id: r.c.id, name: r.c.name, phone: r.c.whatsapp ?? r.c.phone, type: r.c.type, purchases: r.purchases, lastPurchase: r.last }));
}

marketingRouter.get('/segments', async (_req, res) => {
  const keys: Segment[] = ['frecuentes', 'institucionales', 'temporada', 'inactivos', 'todos'];
  const out = [];
  for (const k of keys) out.push({ key: k, count: (await segmentCustomers(k)).length });
  const [noConsent] = await db.select({ n: sql<number>`count(*)::int` }).from(customers).where(and(eq(customers.archived, false), eq(customers.marketingConsent, false)));
  res.json({ segments: out, withoutConsent: noConsent.n });
});

marketingRouter.get('/segments/:key', async (req, res) => {
  const key = req.params.key as Segment;
  if (!['frecuentes', 'institucionales', 'temporada', 'inactivos', 'todos'].includes(key)) throw badRequest('Ese grupo no existe.');
  res.json(await segmentCustomers(key));
});

marketingRouter.get('/campaigns', async (_req, res) => {
  res.json(await db.select().from(campaigns).orderBy(desc(campaigns.date)));
});

marketingRouter.post('/campaigns', async (req, res) => {
  const user = currentUser(req);
  const input = parse(campaignSchema, req.body);
  const [c] = await db.insert(campaigns).values(input).returning();
  await audit(db, user, { action: 'campana_creada', entity: 'campana', entityId: c.id, summary: `Campaña "${c.name}" creada` });
  res.status(201).json(c);
});

marketingRouter.put('/campaigns/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const input = parse(campaignSchema, req.body);
  const [c] = await db.update(campaigns).set(input).where(eq(campaigns.id, id)).returning();
  if (!c) throw notFound('La campaña');
  res.json(c);
});

marketingRouter.get('/templates', async (_req, res) => {
  res.json(await db.select().from(messageTemplates).orderBy(asc(messageTemplates.id)));
});

marketingRouter.put('/templates/:id', async (req, res) => {
  const id = idParam(req.params.id);
  const body = String(req.body?.body ?? '').trim();
  if (!body) throw badRequest('Escribe el texto de la plantilla.');
  if (body.length > 2000) throw badRequest('La plantilla es muy larga: máximo 2000 caracteres.');
  const [t] = await db.update(messageTemplates).set({ body }).where(eq(messageTemplates.id, id)).returning();
  if (!t) throw notFound('La plantilla');
  res.json(t);
});

marketingRouter.get('/assets', async (_req, res) => {
  res.json(await db.select().from(contentAssets).orderBy(desc(contentAssets.id)));
});

marketingRouter.post('/assets', async (req, res) => {
  const input = parse(contentAssetSchema, req.body);
  const [a] = await db.insert(contentAssets).values(input).returning();
  res.status(201).json(a);
});

