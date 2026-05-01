import { createDatabaseClient } from '../db/client.js';
import { migrateDatabase } from '../db/migrate.js';

const client = createDatabaseClient();

await migrateDatabase(client);
await client.close();

console.log('Database migrations completed.');
