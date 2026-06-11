import 'dotenv/config';
import { Database } from 'bun:sqlite';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { env } from '@repo/config';
import * as schema from './schema.ts';

export const sql = new Database(env.DB_FILE_NAME);

// const ret = sql.prepare('').all();

// toDb0(sql, {});
export const db = drizzle({ client: sql, schema });

// import { toDb0 } from 'agnostic-query/db0/sqlite.ts';
import { createDatabase } from 'db0';
import bunSqlite from 'db0/connectors/bun-sqlite';
// import { drizzle } from 'db0/integrations/drizzle';
// export const sql = createDatabase(
// 	bunSqlite({
// 		path: env.DB_FILE_NAME,
// 	}),
// );
// const ret = sql.prepare('').all();
// export const db = drizzle<typeof schema>(sql);
