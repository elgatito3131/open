import express from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLease, createPayment, getCities, getLedger } from './service.js';
import { AppError } from './validation.js';
import { makeTrace, projectRoot, readSource } from './source.js';

function publicError(error) {
  if (error instanceof AppError) return error;
  if (error.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON', 'Send valid JSON.');
  if (error.type === 'entity.too.large') return new AppError(413, 'TOO_LARGE', 'Request is too large.');
  if (error.code === '23505') return new AppError(409, 'DUPLICATE_EMAIL', 'That email already belongs to a tenant. Use a new fictional email for a new tenant.');
  if (error.code === '23P01') return new AppError(409, 'LEASE_OVERLAP', 'That unit already has a lease during these dates.');
  if (error.code === '23503') return new AppError(404, 'NOT_FOUND', 'The referenced lease or unit does not exist.');
  if (error.code === '23514') return new AppError(409, 'PAYMENT_CONFLICT', 'The payment exceeds the remaining rent, or its month is outside the lease.');
  return new AppError(500, 'SERVER_ERROR', 'The request could not be saved. Check the local server log.');
}

export function createApp(pool) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    req.trace = makeTrace();
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname)) {
      return next(new AppError(403, 'LOCAL_ONLY', 'Dwello accepts local connections only.'));
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('Origin');
      const allowed = new Set(['http://127.0.0.1:4200', 'http://localhost:4200', 'http://127.0.0.1:4201', 'http://localhost:4201']);
      allowed.add(`${req.protocol}://${req.get('Host')}`);
      if (origin && !allowed.has(origin)) return next(new AppError(403, 'ORIGIN_REJECTED', 'Use the local Dwello app to make changes.'));
      if (!req.is('application/json')) return next(new AppError(415, 'JSON_REQUIRED', 'Use application/json.'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'PostgreSQL', demo: true });
  });
  // trace: get-ledger
  app.get('/api/ledger', async (req, res) => {
    const data = await getLedger(pool, req.query.month, req.trace, req.query.propertyId);
    res.json({ data, trace: req.trace.steps });
  });
  app.get('/api/cities', async (req, res) => {
    const data = await getCities(pool, req.trace);
    res.json({ data, trace: req.trace.steps });
  });
  // trace: post-lease
  app.post('/api/leases', async (req, res) => {
    const data = await createLease(pool, req.body, req.trace);
    await req.trace.add('Return 201 Created', 'API', 'Express returns the new IDs. React can now reload the saved ledger.', 'server/app.js', 'post-lease', { result: { status: 201, ...data } });
    res.status(201).json({ data, trace: req.trace.steps });
  });
  // trace: post-payment
  app.post('/api/payments', async (req, res) => {
    const data = await createPayment(pool, req.body, req.trace);
    await req.trace.add('Return 201 Created', 'API', 'React receives the stored receipt ID and remaining balance.', 'server/app.js', 'post-payment', { result: { status: 201, ...data } });
    res.status(201).json({ data, trace: req.trace.steps });
  });
  app.get('/api/source', async (req, res) => {
    const source = await readSource(req.query.file);
    if (!source) throw new AppError(404, 'SOURCE_NOT_FOUND', 'That file is not in the source reading list.');
    res.json(source);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route.' }, trace: [] }));
  const clientBuild = resolve(projectRoot, 'client/dist');
  if (existsSync(clientBuild)) app.use(express.static(clientBuild));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const result = publicError(error);
    if (result.status === 500) console.error(error);
    res.status(result.status).json({ error: { code: result.code, message: result.message }, trace: req.trace?.steps ?? [] });
  });
  return app;
}
