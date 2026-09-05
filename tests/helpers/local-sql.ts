import { DatabaseSync } from "node:sqlite";
import { getTableColumns, type Table } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";

/** Real Drizzle SQL against an isolated store; never connects to MySQL. */
export function localSql(tables: Record<string, Table>) {
  const store = new DatabaseSync(":memory:");
  const queries: { sql: string; params: unknown[] }[] = [];
  for (const [name, table] of Object.entries(tables)) {
    const columns = Object.values(getTableColumns(table));
    store.exec(`CREATE TABLE ${name} (${columns.map(c => c.name === "id"
      ? "id INTEGER PRIMARY KEY AUTOINCREMENT"
      : `\`${c.name}\` ${/int|boolean/i.test(c.getSQLType()) ? "INTEGER" : "TEXT"}`).join(",")})`);
  }
  const db = drizzle(async (sql, params, method) => {
    queries.push({ sql, params });
    const bindings = params.map(value => typeof value === "boolean" ? Number(value) : value);
    const statement = store.prepare(sql.replace(/\s+for update$/i, "").replace(/\bdefault\b/gi, "NULL"));
    if (method === "all") {
      statement.setReturnArrays(true);
      return { rows: (statement.all(...bindings) as unknown as unknown[][]).map(row => row.map(value => {
        if (typeof value !== "string" || !/^[\[{]/.test(value)) return value;
        try { return JSON.parse(value); } catch { return value; }
      })) };
    }
    const result = statement.run(...bindings);
    return { rows: [{ affectedRows: Number(result.changes), insertId: Number(result.lastInsertRowid) }] };
  });
  // Serialize transaction callbacks as MySQL's event row locks would do.
  let tail = Promise.resolve<unknown>(undefined);
  Object.assign(db, { transaction: (fn: (tx: typeof db) => unknown) => {
    const result = tail.then(() => fn(db));
    tail = result.catch(() => undefined);
    return result;
  } });
  return { db, store, queries };
}
