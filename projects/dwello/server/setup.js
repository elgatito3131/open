import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool } from './db.js';
import { projectRoot } from './source.js';

export async function setupDatabase(pool) {
  const schema = await readFile(resolve(projectRoot, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(42004201)');
    await client.query(schema);
    const existing = await client.query('SELECT id FROM properties LIMIT 1');
    if (!existing.rowCount) {
      const property = (await client.query(`INSERT INTO properties(name, address, city)
        VALUES ('Juniper House', '18 Juniper Lane', 'Sampletown · fictional') RETURNING id`)).rows[0];
      const unitIds = {};
      for (const [number, floor, bedrooms, rent] of [
        ['101', 1, 1, 145000], ['102', 1, 2, 170000],
        ['201', 2, 1, 150000], ['202', 2, 2, 175000],
        ['301', 3, 1, 155000], ['302', 3, 2, 180000],
      ]) {
        unitIds[number] = (await client.query(`INSERT INTO units(property_id, number, floor, bedrooms, monthly_rent_cents)
          VALUES ($1, $2, $3, $4, $5) RETURNING id`, [property.id, number, floor, bedrooms, rent])).rows[0].id;
      }
      for (const [number, name, email, rent, paid] of [
        ['101', 'Maya Park', 'maya.park@example.com', 145000, 145000],
        ['201', 'Theo Brooks', 'theo.brooks@example.com', 150000, 75000],
        ['301', 'Ari Wells', 'ari.wells@example.com', 155000, 0],
        ['302', 'Sam Rivera', 'sam.rivera@example.com', 180000, 180000],
      ]) {
        const tenant = (await client.query('INSERT INTO tenants(name, email) VALUES ($1, $2) RETURNING id', [name, email])).rows[0];
        const lease = (await client.query(`INSERT INTO leases(unit_id, tenant_id, start_date, end_date, monthly_rent_cents)
          VALUES ($1, $2, '2026-01-01', '2027-12-31', $3) RETURNING id`, [unitIds[number], tenant.id, rent])).rows[0];
        if (paid) await client.query(`INSERT INTO payments(lease_id, month, amount_cents, paid_on, method, note)
          VALUES ($1, '2026-10-01', $2, '2026-10-02', 'bank', 'Fictional opening receipt')`, [lease.id, paid]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const pool = createPool();
  try {
    await setupDatabase(pool);
    console.log('Dwello schema ready. Fictional seed records were added only if the ledger was empty.');
  } finally {
    await pool.end();
  }
}
