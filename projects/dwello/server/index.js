import { createApp } from './app.js';
import { createPool } from './db.js';
import { setupDatabase } from './setup.js';

const pool = createPool();
await setupDatabase(pool);
const port = Number(process.env.PORT ?? 4201);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be 1024–65535.');
const server = createApp(pool).listen(port, '127.0.0.1', () => {
  console.log(`Dwello API and production UI: http://127.0.0.1:${port}`);
});
server.on('error', async error => { console.error(error.message); await pool.end(); process.exit(1); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  server.close(async () => { await pool.end(); process.exit(0); });
});
