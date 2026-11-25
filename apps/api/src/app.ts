import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { requireAuth } from './lib/auth';
import { errorHandler } from './lib/errors';
import { appState } from './lib/state';
import { requireJson, sanitizeInput, securityHeaders } from './lib/security';
export { appState };
import { auditRouter, demoRouter, settingsRouter, usersRouter } from './routes/admin';
import { analysisRouter } from './routes/analysis';
import { authRouter } from './routes/auth';
import { cashRouter, payablesRouter, receivablesRouter } from './routes/finance';
import { customersRouter } from './routes/customers';
import { dashboardRouter } from './routes/dashboard';
import { deliveriesRouter } from './routes/deliveries';
import { inventoryRouter } from './routes/inventory';
import { marketingRouter } from './routes/marketing';
import { ordersRouter } from './routes/orders';
import { productionRouter } from './routes/production';
import { productsRouter } from './routes/products';
import { purchasesRouter, suppliersRouter } from './routes/suppliers';
import { reportsRouter } from './routes/reports';


export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Saltos de proxy de confianza (1 = Render; 2 = Vercel + Render). Necesario para conocer la IP real del cliente.
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1));
  if (config.corsOrigin) {
    app.use(cors({ origin: config.corsOrigin.split(',').map((s) => s.trim()), credentials: true }));
  }
  app.use(securityHeaders);
  app.use(requireJson);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(sanitizeInput);
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, ready: appState.ready, service: 'nexo-texcontrol-api' }));
  app.use('/api', (_req, res, next) => {
    if (appState.ready) return next();
    res.status(503).json({ error: `Estamos preparando el sistema: ${appState.message} Intenta de nuevo en un momento.`, preparing: true });
  });
  app.use('/api/auth', authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/settings', settingsRouter);
  api.use('/users', usersRouter);
  api.use('/audit', auditRouter);
  api.use('/demo', demoRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/customers', customersRouter);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/orders', ordersRouter);
  api.use('/production', productionRouter);
  api.use('/deliveries', deliveriesRouter);
  api.use('/cash', cashRouter);
  api.use('/payables', payablesRouter);
  api.use('/receivables', receivablesRouter);
  api.use('/suppliers', suppliersRouter);
  api.use('/purchases', purchasesRouter);
  api.use('/reports', reportsRouter);
  api.use('/analysis', analysisRouter);
  api.use('/marketing', marketingRouter);
  app.use('/api', api);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Recurso no encontrado.' }));
  app.use(errorHandler);
  return app;
}
