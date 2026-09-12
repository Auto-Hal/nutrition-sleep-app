import { Pool, type QueryResultRow } from "pg";
import { requiredServerEnv } from "@/lib/env";

declare global {
  var __astraPool: Pool | undefined;
}

function pool() {
  if (globalThis.__astraPool) return globalThis.__astraPool;
  const { databaseUrl } = requiredServerEnv();
  globalThis.__astraPool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  return globalThis.__astraPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return pool().query<T>(text, values);
}
