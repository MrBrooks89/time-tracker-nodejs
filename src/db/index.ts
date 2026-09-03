import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema.ts";

const dbUrl = path.join(process.cwd(), "data", "app.db");

fs.mkdirSync(path.dirname(dbUrl), { recursive: true });

export const sqlite = new Database(dbUrl);

sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export { schema };
