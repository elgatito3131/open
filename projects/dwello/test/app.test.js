import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
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
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM properties')).rows[0].n, 6);
});

test('six Virginia cities expose their own fictional six-unit properties', async () => {
  const response = await request('/api/cities');
  assert.equal(response.status, 200);
  const { cities } = response.body.data;
  assert.deepEqual(cities.map(city => city.name), ['Charlottesville', 'Leesburg', 'Alexandria', 'Richmond', 'Roanoke', 'Winchester']);
  assert.equal(cities.length, 6);
  for (const city of cities) {
    assert.equal(city.state, 'VA');
    assert.equal(typeof city.latitude, 'number');
    assert.equal(typeof city.longitude, 'number');
    assert.equal(city.properties.length, 1);
    assert.equal(city.properties[0].unitCount, 6);
    assert.equal(city.properties[0].city, `${city.name}, VA`);
  }
  assert.equal(cities[0].properties[0].id, ledger.property.id);
  assert.ok(response.body.trace.length > 0);
});

test('explicit property ledger never includes units, leases or receipts from another property', async () => {
  const cities = (await request('/api/cities')).body.data.cities;
  const allUnitIds = new Set();
  const allLeaseIds = new Set();
  const allReceiptIds = new Set();
  for (const city of cities) {
    const property = city.properties[0];
    const response = await request(`/api/ledger?propertyId=${property.id}&month=2026-10`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.property.id, property.id);
    assert.equal(response.body.data.property.cityId, city.id);
    assert.equal(response.body.data.owner, `${property.name} Co.`);
    assert.equal(response.body.data.units.length, 6);
    for (const unit of response.body.data.units) {
      assert.ok(!allUnitIds.has(unit.id)); allUnitIds.add(unit.id);
      if (unit.lease) {
        assert.ok(!allLeaseIds.has(unit.lease.id)); allLeaseIds.add(unit.lease.id);
        for (const receipt of unit.lease.payments) {
          assert.ok(!allReceiptIds.has(receipt.id)); allReceiptIds.add(receipt.id);
        }
      }
    }
  }
  assert.equal(allUnitIds.size, 36);
  assert.equal(allLeaseIds.size, 24);
  const implicit = await request('/api/ledger');
  const explicit = await request(`/api/ledger?propertyId=${ledger.property.id}`);
  assert.deepEqual(implicit.body.data, explicit.body.data);
});

test('malformed property IDs reject without silently opening the default property', async () => {
  for (const value of ['', '0', '-1', '1.5', '1e0', '01', 'NaN', '1 OR 1=1', '2147483648']) {
    assert.equal((await request(`/api/ledger?propertyId=${encodeURIComponent(value)}`)).status, 400, value);
  }
  assert.equal((await request('/api/ledger?propertyId=1&propertyId=2')).status, 400);
  assert.equal((await request('/api/ledger?propertyId=2147483647')).status, 404);
  assert.equal((await request('/api/ledger?month=2026-13')).status, 400);
});

test('legacy migration twice preserves custom tenants, receipts and original IDs without reseeding units', async () => {
  const legacySchema = `${schema}_legacy`;
  await admin.query(`CREATE SCHEMA ${legacySchema}`);
  const legacy = createPool(undefined, { options: `-c search_path=${legacySchema},public` });
  try {
    // Reconstruct the prior schema so this exercises ADD COLUMN, not just a
    // second startup against a database already using the new city columns.
    const currentSchema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
    const oldSchema = currentSchema
      .replace(/CREATE TABLE IF NOT EXISTS cities \([\s\S]*?\n\);\n/, '')
      .replace(/^ALTER TABLE properties .*\n/gm, '')
      .replace(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS properties_(?:seed_key|city)_idx.*\n/gm, '');
    await legacy.query(oldSchema);
    const property = (await legacy.query("INSERT INTO properties(name,address,city) VALUES('Juniper House','18 Juniper Lane','Sampletown · fictional') RETURNING id")).rows[0];
    const custom = (await legacy.query("INSERT INTO properties(name,address,city) VALUES('Saved Custom Place','Original custom address','An unmapped custom city') RETURNING id")).rows[0];
    const unit = (await legacy.query("INSERT INTO units(property_id,number,floor,bedrooms,monthly_rent_cents) VALUES($1,'102',1,2,170000) RETURNING id", [property.id])).rows[0];
    // This intentionally collides with a new city's seed email. It must survive
    // unchanged, rather than being renamed, reused or causing setup to fail.
    const tenant = (await legacy.query("INSERT INTO tenants(name,email) VALUES('Rowan Saved','dwello.willow-court.101@example.com') RETURNING id")).rows[0];
    const lease = (await legacy.query("INSERT INTO leases(unit_id,tenant_id,start_date,end_date,monthly_rent_cents) VALUES($1,$2,'2026-10-01','2027-09-30',170000) RETURNING id", [unit.id, tenant.id])).rows[0];
    await legacy.query("INSERT INTO payments(lease_id,month,amount_cents,paid_on,method,note) VALUES($1,'2026-10-01',42500,'2026-10-04','bank','Keep this receipt')", [lease.id]);
    const before = {};
    for (const table of ['units', 'tenants', 'leases', 'payments']) before[table] = (await legacy.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    await setupDatabase(legacy);
    await setupDatabase(legacy);
    for (const table of ['units', 'tenants', 'leases', 'payments']) {
      const current = (await legacy.query(`SELECT * FROM ${table} WHERE id = ANY($1::integer[]) ORDER BY id`, [before[table].map(row => row.id)])).rows;
      assert.deepEqual(current, before[table], `${table} preserved`);
    }
    const original = (await legacy.query('SELECT * FROM properties WHERE id=$1', [property.id])).rows[0];
    assert.equal(original.name, 'Juniper House');
    assert.equal(original.address, '18 Juniper Lane');
    assert.equal(original.city, 'Charlottesville, VA');
    assert.equal(original.seed_key, 'juniper-house');
    assert.equal((await legacy.query('SELECT count(*)::integer AS n FROM units WHERE property_id=$1', [property.id])).rows[0].n, 1, 'does not fill or reseed existing property');
    const customAfter = (await legacy.query('SELECT * FROM properties WHERE id=$1', [custom.id])).rows[0];
    assert.equal(customAfter.name, 'Saved Custom Place');
    assert.equal(customAfter.address, 'Original custom address');
    assert.equal(customAfter.city, 'An unmapped custom city');
    assert.equal(customAfter.city_id, original.city_id, 'unmapped property remains accessible under default city');
    assert.equal((await legacy.query('SELECT count(*)::integer AS n FROM properties')).rows[0].n, 7);
    assert.equal((await legacy.query('SELECT count(*)::integer AS n FROM units')).rows[0].n, 31);
    assert.equal((await legacy.query('SELECT count(*)::integer AS n FROM tenants')).rows[0].n, 21);
    assert.equal((await legacy.query('SELECT count(*)::integer AS n FROM payments')).rows[0].n, 16);
  } finally {
    await legacy.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${legacySchema} CASCADE`);
  }
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
