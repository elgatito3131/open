import { AppError, month, validateLease, validatePayment } from './validation.js';

export const DEMO_MONTH = '2026-10';
const missing = (message) => { throw new AppError(404, 'NOT_FOUND', message); };

export async function getLedger(pool, requestedMonth, trace) {
  const selectedMonth = month(requestedMonth ?? DEMO_MONTH);
  await trace.add('Read the request', 'API', `Read the property ledger for ${selectedMonth}.`, 'server/service.js', 'read-ledger');
  // trace: read-ledger
  const sql = `SELECT u.id, u.number, u.floor, u.bedrooms, u.monthly_rent_cents,
    l.id AS lease_id, l.start_date::text, l.end_date::text, l.monthly_rent_cents AS lease_rent,
    t.id AS tenant_id, t.name, t.email,
    coalesce(p.paid_cents, 0)::integer AS paid_cents, coalesce(p.receipts, '[]'::json) AS payments
    FROM units u
    LEFT JOIN leases l ON l.unit_id = u.id AND $1::date BETWEEN l.start_date AND l.end_date
    LEFT JOIN tenants t ON t.id = l.tenant_id
    LEFT JOIN LATERAL (
      SELECT sum(amount_cents) AS paid_cents,
        json_agg(json_build_object('id', id, 'amountCents', amount_cents,
          'paidOn', paid_on::text, 'method', method, 'note', note) ORDER BY paid_on DESC, id DESC) AS receipts
      FROM payments WHERE lease_id = l.id AND month = $1::date
    ) p ON true WHERE u.property_id = $2 ORDER BY u.floor DESC, u.number`;
  const property = (await pool.query('SELECT id, name, address, city FROM properties ORDER BY id LIMIT 1')).rows[0];
  if (!property) missing('No property exists. Run npm run db:setup.');
  const parameters = [`${selectedMonth}-01`, property.id];
  const { rows } = await pool.query(sql, parameters);
  await trace.add('Join related records', 'PostgreSQL', 'The query joins units, leases, tenants, and receipts for the selected month.', 'server/service.js', 'read-ledger', { sql, parameters, result: { unitsReturned: rows.length } });
  const units = rows.map(row => ({
    id: row.id, number: row.number, floor: row.floor, bedrooms: row.bedrooms,
    monthlyRentCents: row.monthly_rent_cents,
    lease: row.lease_id ? {
      id: row.lease_id, tenant: { id: row.tenant_id, name: row.name, email: row.email },
      startDate: row.start_date, endDate: row.end_date, monthlyRentCents: row.lease_rent,
      paidCents: row.paid_cents, balanceCents: row.lease_rent - row.paid_cents,
      payments: row.payments,
    } : null,
  }));
  await trace.add('Return the ledger', 'API', 'Express sends these persisted records as JSON to React.', 'server/app.js', 'get-ledger', { result: { status: 200, units: units.length } });
  return { month: selectedMonth, owner: 'Juniper House Co.', property, units };
}

export async function createLease(pool, body, trace) {
  const input = validateLease(body);
  await trace.add('Validate the lease', 'API', 'Validate IDs, email, integer cents, and calendar-month dates on the server.', 'server/validation.js', 'validate-lease');
  const client = await pool.connect();
  try {
    // trace: begin-lease
    await client.query('BEGIN');
    const unit = await client.query('SELECT id FROM units WHERE id = $1 FOR UPDATE', [input.unitId]);
    if (!unit.rowCount) missing('That unit does not exist.');
    await trace.add('Begin and lock the unit', 'PostgreSQL', 'One transaction owns this unit row while the lease is created.', 'server/service.js', 'begin-lease', { sql: 'SELECT id FROM units WHERE id = $1 FOR UPDATE', parameters: [input.unitId] });
    // trace: insert-tenant
    const tenantSql = 'INSERT INTO tenants(name, email) VALUES ($1, $2) RETURNING id';
    const tenantParameters = [input.name, input.email];
    const tenant = (await client.query(tenantSql, tenantParameters)).rows[0];
    await trace.add('Create the tenant', 'PostgreSQL', 'Bound values are separate from SQL. The unique email constraint protects this record.', 'server/service.js', 'insert-tenant', { sql: tenantSql, parameters: tenantParameters, result: { tenantId: tenant.id } });
    // trace: insert-lease
    const leaseSql = `INSERT INTO leases(unit_id, tenant_id, start_date, end_date, monthly_rent_cents)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`;
    const leaseParameters = [input.unitId, tenant.id, input.startDate, input.endDate, input.monthlyRentCents];
    const lease = (await client.query(leaseSql, leaseParameters)).rows[0];
    await trace.add('Connect the lease', 'PostgreSQL', 'Foreign keys connect tenant and unit. A date-range exclusion constraint rejects overlapping leases.', 'schema.sql', 'lease-constraint', { sql: leaseSql, parameters: leaseParameters, result: { leaseId: lease.id } });
    // trace: commit-lease
    await client.query('COMMIT');
    const result = { tenantId: tenant.id, leaseId: lease.id, unitId: input.unitId };
    await trace.add('Commit both records', 'PostgreSQL', 'Tenant and lease are now durable together. A failure before commit rolls both back.', 'server/service.js', 'commit-lease', { sql: 'COMMIT', result });
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    await trace.add('Roll back the request', 'PostgreSQL', 'No part of this lease request was saved.', 'server/service.js', 'commit-lease', { sql: 'ROLLBACK' });
    throw error;
  } finally {
    client.release();
  }
}

export async function createPayment(pool, body, trace) {
  const input = validatePayment(body);
  await trace.add('Validate the receipt', 'API', 'The amount is a positive integer number of cents. Date, method, and month are checked.', 'server/validation.js', 'validate-payment');
  const client = await pool.connect();
  try {
    // trace: lock-payment
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM leases WHERE id = $1 FOR UPDATE', [input.leaseId]);
    if (!rows.length) missing('That lease does not exist.');
    await trace.add('Lock the lease', 'PostgreSQL', 'Concurrent payments wait for this lease lock, so two requests cannot spend the same balance.', 'server/service.js', 'lock-payment', { sql: 'SELECT * FROM leases WHERE id = $1 FOR UPDATE', parameters: [input.leaseId] });
    // trace: insert-payment
    const sql = `INSERT INTO payments(lease_id, month, amount_cents, paid_on, method, note)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;
    const parameters = [input.leaseId, `${input.month}-01`, input.amountCents, input.paidOn, input.method, input.note];
    const payment = (await client.query(sql, parameters)).rows[0];
    await trace.add('Check and store the payment', 'PostgreSQL', 'The database trigger checks that the billing month belongs to the lease and the payment fits the remaining rent.', 'schema.sql', 'payment-constraint', { sql, parameters, result: { paymentId: payment.id } });
    // trace: commit-payment
    const paid = (await client.query('SELECT sum(amount_cents)::integer AS total FROM payments WHERE lease_id = $1 AND month = $2', [input.leaseId, `${input.month}-01`])).rows[0].total;
    await client.query('COMMIT');
    const result = { paymentId: payment.id, leaseId: input.leaseId, balanceCents: rows[0].monthly_rent_cents - paid };
    await trace.add('Commit the receipt', 'PostgreSQL', 'The receipt survives a reload or server restart. The remaining balance is computed from saved payments.', 'server/service.js', 'commit-payment', { sql: 'COMMIT', result });
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    await trace.add('Roll back the request', 'PostgreSQL', 'The rejected payment was not saved.', 'server/service.js', 'commit-payment', { sql: 'ROLLBACK' });
    throw error;
  } finally {
    client.release();
  }
}
