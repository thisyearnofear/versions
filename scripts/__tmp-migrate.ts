import { migrate } from 'drizzle-orm/neon-http/migrator';
import { neonConfig, neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from '../src/lib/schema';
import ws from 'ws';
neonConfig.webSocketConstructor = ws;
const u = new URL(process.env.DATABASE_URL!);
u.search = '';
const sql = neon(u.href);
const db = drizzle(sql, { schema });
(async () => {
  try {
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('MIGRATION OK');
  } catch (e) {
    console.error('MIGRATION FAILED:', (e as Error).message);
    process.exit(1);
  }
})();
