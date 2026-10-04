import pg from 'pg';

export function createPool(connectionString = process.env.DATABASE_URL || process.env.DWELLO_DATABASE_URL, options = {}) {
  if (!connectionString) throw new Error('Set DATABASE_URL, or run ./scripts/start.sh to use the local learning database.');
  return new pg.Pool({ connectionString, max: 8, ...options });
}
