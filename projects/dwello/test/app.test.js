import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPool } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setupDatabase } from '../server/setup.js';
import { makeTrace } from '../server/source.js';

const schema = `dwello_test_${randomUUID().replaceAll('-', '')}`;
let admin, pool, server, base, ledger;
async function request(path, body, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    ...options,
  });
  return { status: response.status, body: await response.json() };
}
const leaseInput = (unitId, email, overrides = {}) => ({
  unitId, name: 'Robin Sample', email, startDate: '2026-10-01', endDate: '2027-09-30', monthlyRentCents: 170000, ...overrides,
});
before(async () => {
  admin = createPool();
  await admin.query(`CREATE SCHEMA ${schema}`);
  pool = createPool(undefined, { options: `-c search_path=${schema},public` });
  await setupDatabase(pool);
  server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  ledger = (await request('/api/ledger')).body.data;
});
after(async () => {
  if (server) { server.close(); await once(server, 'close'); }
  if (pool) await pool.end();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
});

test('ledger joins six units and stored receipts; setup preserves existing records', async () => {
  assert.equal(ledger.units.length, 6);
  const unit = ledger.units.find(u => u.number === '201');
  assert.equal(unit.lease.balanceCents, 75000);
  assert.equal(unit.lease.payments.length, 1);
  await setupDatabase(pool);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM properties')).rows[0].n, 1);
});

test('lease and tenant commit together and remain visible on a fresh connection', async () => {
  const unit = ledger.units.find(u => u.number === '102');
  const result = await request('/api/leases', leaseInput(unit.id, 'robin@example.com'));
  assert.equal(result.status, 201);
  assert.ok(result.body.trace.find(t => t.label === 'Commit both records'));
  const independent = createPool(undefined, { options: `-c search_path=${schema},public` });
  try {
    const row = (await independent.query('SELECT t.email FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.id=$1', [result.body.data.leaseId])).rows[0];
    assert.equal(row.email, 'robin@example.com');
  } finally { await independent.end(); }
  const fresh = (await request('/api/ledger')).body.data.units.find(u => u.id === unit.id);
  assert.equal(fresh.lease.tenant.name, 'Robin Sample');
});

test('overlapping lease rejects atomically without leaving an orphan tenant', async () => {
  const occupied = ledger.units.find(u => u.number === '301');
  const result = await request('/api/leases', leaseInput(occupied.id, 'rollback@example.com'));
  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, 'LEASE_OVERLAP');
  assert.ok(result.body.trace.some(t => t.sql === 'ROLLBACK'));
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM tenants WHERE email='rollback@example.com'")).rows[0].n, 0);
});

test('duplicate emails, missing units, malformed dates and fractional cents are rejected', async () => {
  const unit = ledger.units.find(u => u.number === '202');
  assert.equal((await request('/api/leases', leaseInput(unit.id, 'ari.wells@example.com'))).status, 409);
  assert.equal((await request('/api/leases', leaseInput(99999, 'missing@example.com'))).status, 404);
  for (const overrides of [{ monthlyRentCents: 1.2 }, { startDate: '2026-02-30' }, { endDate: '2026-10-15' }, { name: 'x'.repeat(101) }]) {
    assert.equal((await request('/api/leases', leaseInput(unit.id, 'invalid@example.com', overrides))).status, 400);
  }
});

test('concurrent payments cannot exceed the outstanding rent', async () => {
  const leaseId = ledger.units.find(u => u.number === '201').lease.id;
  const receipt = { leaseId, month: '2026-10', amountCents: 50000, paidOn: '2026-10-04', method: 'bank', note: 'Concurrency test' };
  const results = await Promise.all([request('/api/payments', receipt), request('/api/payments', receipt)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
  const row = (await pool.query('SELECT sum(amount_cents)::integer AS total FROM payments WHERE lease_id=$1 AND month=$2', [leaseId, '2026-10-01'])).rows[0];
  assert.equal(row.total, 125000);
  const exact = await request('/api/payments', { ...receipt, amountCents: 25000 });
  assert.equal(exact.status, 201);
  assert.equal(exact.body.data.balanceCents, 0);
  assert.equal((await request('/api/payments', { ...receipt, amountCents: 1 })).status, 409);
});

test('database constraints reject a direct overpayment and an invalid month', async () => {
  const leaseId = ledger.units.find(u => u.number === '101').lease.id;
  await assert.rejects(pool.query("INSERT INTO payments(lease_id,month,amount_cents,paid_on,method) VALUES($1,'2026-10-01',1,'2026-10-04','cash')", [leaseId]), error => error.code === '23514');
  const result = await request('/api/payments', { leaseId, month: '2030-01', amountCents: 100, paidOn: '2030-01-01', method: 'cash' });
  assert.equal(result.status, 409);
});

test('source is allowlisted and maps recorded steps to real line numbers', async () => {
  const response = await request('/api/ledger');
  for (const step of response.body.trace) {
    const source = await request(`/api/source?file=${encodeURIComponent(step.source.file)}`);
    assert.equal(source.status, 200);
    const lines = source.body.content.split('\n');
    assert.ok(lines[step.source.startLine - 1].includes('trace:'));
  }
  assert.equal((await request('/api/source?file=../../.runtime/database.env')).status, 404);
});

test('unavailable explanation source cannot turn a saved operation into a failed request', async () => {
  const trace = makeTrace();
  await trace.add('Committed', 'PostgreSQL', 'Saved operation', 'unavailable.js', 'none');
  assert.equal(trace.steps.length, 1);
  assert.equal(trace.steps[0].source.available, false);
});

test('cross-origin writes, non-JSON and broken JSON are rejected', async () => {
  const body = leaseInput(1, 'other@example.com');
  assert.equal((await request('/api/leases', body, { headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' } })).status, 403);
  assert.equal((await request('/api/leases', body, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/leases', body, { body: '{broken' })).status, 400);
});
