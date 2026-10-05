import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool } from './db.js';
import { projectRoot } from './source.js';

// Real city centroids, not property coordinates. Source: U.S. Census ACS23 places.
// https://tigerweb.geo.census.gov/tigerwebmain/Files/acs24/tigerweb_acs24_incplace_2023_acs23_va.html
// Everything about the properties and their residents is fictional.
const CITY_SEEDS = [
  { name: 'Charlottesville', latitude: 38.0374896, longitude: -78.4855026, key: 'juniper-house', property: 'Juniper House', address: '18 Juniper Lane', description: 'The original Juniper House ledger, with familiar neighbors and a few open windows.', rentAdjustment: 0, names: ['Maya Park', 'Theo Brooks', 'Ari Wells', 'Sam Rivera'] },
  { name: 'Leesburg', latitude: 39.1052356, longitude: -77.5545183, key: 'willow-court', property: 'Willow Court', address: '24 Lantern Walk', description: 'A fictional courtyard home with a little garden and room for new neighbors.', rentAdjustment: 20000, names: ['Nora Finch', 'Eli Moss', 'Rae Bell', 'Jules Hart'] },
  { name: 'Alexandria', latitude: 38.8184547, longitude: -77.0862029, key: 'harbor-house', property: 'Harbor House', address: '6 Paperboat Lane', description: 'A fictional brick house with bright windows and a shared reading nook.', rentAdjustment: 35000, names: ['Lena Vale', 'Kit Rowan', 'Ira Cole', 'Noel Reed'] },
  { name: 'Richmond', latitude: 37.5294349, longitude: -77.4755831, key: 'sycamore-place', property: 'Sycamore Place', address: '41 Copper Street', description: 'A fictional six-home building with cheerful curtains and an open front step.', rentAdjustment: -10000, names: ['Milo Fern', 'Ada Lane', 'Remy Stone', 'Skye Nash'] },
  { name: 'Roanoke', latitude: 37.2784809, longitude: -79.9580847, key: 'blue-ridge-lodge', property: 'Blue Ridge Lodge', address: '12 Fern Rise', description: 'A fictional neighborhood lodge with green shutters and a cozy shared porch.', rentAdjustment: -25000, names: ['Juno Pike', 'Finn Cedar', 'Tess River', 'Alex Linden'] },
  { name: 'Winchester', latitude: 39.1735021, longitude: -78.1746453, key: 'orchard-house', property: 'Orchard House', address: '9 Cider Lane', description: 'A fictional small apartment house with a courtyard and a pair of vacant homes.', rentAdjustment: -5000, names: ['Owen Maple', 'Ivy Gray', 'Sage Quinn', 'Drew Ash'] },
];
const UNIT_SEEDS = [
  ['101', 1, 1, 145000], ['102', 1, 2, 170000],
  ['201', 2, 1, 150000], ['202', 2, 2, 175000],
  ['301', 3, 1, 155000], ['302', 3, 2, 180000],
];

async function createFictionalProperty(client, cityId, seed) {
  const property = (await client.query(`INSERT INTO properties(name, address, city, city_id, seed_key)
    VALUES ($1, $2, $3, $4, $5) RETURNING id`, [seed.property, seed.address, `${seed.name}, VA`, cityId, seed.key])).rows[0];
  const unitIds = {};
  for (const [number, floor, bedrooms, baseRent] of UNIT_SEEDS) {
    unitIds[number] = (await client.query(`INSERT INTO units(property_id, number, floor, bedrooms, monthly_rent_cents)
      VALUES ($1, $2, $3, $4, $5) RETURNING id`, [property.id, number, floor, bedrooms, baseRent + seed.rentAdjustment])).rows[0].id;
  }
  for (const [index, number] of ['101', '201', '301', '302'].entries()) {
    const name = seed.names[index];
    const baseEmail = seed.key === 'juniper-house'
      ? `${name.toLowerCase().replaceAll(' ', '.')}@example.com`
      : `dwello.${seed.key}.${number}@example.com`;
    // A pre-existing tenant is never renamed/reused. Rare seed-email collisions
    // get a deterministic suffix rather than modifying somebody else's record.
    let tenant;
    for (let suffix = 0; !tenant && suffix < 1000; suffix++) {
      const email = suffix ? baseEmail.replace('@', `.seed${property.id}-${suffix}@`) : baseEmail;
      tenant = (await client.query(`INSERT INTO tenants(name, email) VALUES ($1, $2)
        ON CONFLICT (email) DO NOTHING RETURNING id`, [name, email])).rows[0];
    }
    if (!tenant) throw new Error('Could not allocate a fictional seed email.');
    const rent = UNIT_SEEDS.find(unit => unit[0] === number)[3] + seed.rentAdjustment;
    const lease = (await client.query(`INSERT INTO leases(unit_id, tenant_id, start_date, end_date, monthly_rent_cents)
      VALUES ($1, $2, '2026-01-01', '2027-12-31', $3) RETURNING id`, [unitIds[number], tenant.id, rent])).rows[0];
    const paid = index === 2 ? 0 : index === 1 ? Math.floor(rent / 2) : rent;
    if (paid) await client.query(`INSERT INTO payments(lease_id, month, amount_cents, paid_on, method, note)
      VALUES ($1, '2026-10-01', $2, '2026-10-02', 'bank', 'Fictional opening receipt')`, [lease.id, paid]);
  }
}

export async function setupDatabase(pool) {
  const schema = await readFile(resolve(projectRoot, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(42004201)');
    await client.query(schema);
    const cityIds = new Map();
    for (const seed of CITY_SEEDS) {
      await client.query(`INSERT INTO cities(name, state, latitude, longitude, description)
        VALUES ($1, 'VA', $2, $3, $4) ON CONFLICT (name, state) DO NOTHING`, [seed.name, seed.latitude, seed.longitude, seed.description]);
      const city = (await client.query("SELECT id FROM cities WHERE name=$1 AND state='VA'", [seed.name])).rows[0];
      cityIds.set(seed.name, city.id);
    }
    const defaultCityId = cityIds.get('Charlottesville');
    // Only the exact legacy sample-place label is renamed. IDs, names, units,
    // leases, tenants and receipts are never replaced during this migration.
    await client.query(`UPDATE properties SET city='Charlottesville, VA', city_id=coalesce(city_id, $1)
      WHERE city='Sampletown · fictional'`, [defaultCityId]);
    for (const seed of CITY_SEEDS) {
      const cityId = cityIds.get(seed.name);
      await client.query(`UPDATE properties SET city_id=$1 WHERE city_id IS NULL
        AND (lower(trim(city))=lower($2) OR lower(trim(city))=lower($3))`, [cityId, seed.name, `${seed.name}, VA`]);
      const existing = await client.query('SELECT id FROM properties WHERE seed_key=$1', [seed.key]);
      if (existing.rowCount) continue;
      // Adopt the old Juniper seed without filling vacant units or inserting any
      // residents. Other exact existing seed buildings can likewise be preserved.
      const matching = await client.query(`SELECT id FROM properties
        WHERE seed_key IS NULL AND name=$1 AND address=$2 AND city_id=$3 ORDER BY id LIMIT 1`, [seed.property, seed.address, cityId]);
      if (matching.rowCount) {
        await client.query('UPDATE properties SET seed_key=$1 WHERE id=$2', [seed.key, matching.rows[0].id]);
      } else {
        await createFictionalProperty(client, cityId, seed);
      }
    }
    // Preserve unrecognized custom city text. Until manually assigned, a property
    // needs a map entry, so it is grouped under Charlottesville (not geocoded).
    await client.query('UPDATE properties SET city_id=$1 WHERE city_id IS NULL', [defaultCityId]);
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
    console.log('Dwello city map and fictional seed properties ready. Existing ledger records were preserved.');
  } finally {
    await pool.end();
  }
}
