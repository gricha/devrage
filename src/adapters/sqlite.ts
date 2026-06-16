/**
 * Owns read-only SQLite driver selection for local agent stores. Native runtime
 * drivers are preferred, with better-sqlite3 kept as the compatibility fallback.
 */
export interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown | undefined;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface BunSqliteDatabase {
  prepare(sql: string): SqliteStatement;
  query(sql: string): SqliteStatement;
  close(): void;
}

interface NodeSqliteModule {
  DatabaseSync: new (
    filename: string,
    options?: { open?: boolean; readOnly?: boolean; timeout?: number },
  ) => SqliteDatabase;
}

interface BunSqliteModule {
  Database: new (
    filename: string,
    options?: { create?: boolean; readonly?: boolean },
  ) => BunSqliteDatabase;
}

/** Opens a read-only SQLite database, returning null when no local driver works. */
export async function openReadonlySqliteDatabase(dbPath: string): Promise<SqliteDatabase | null> {
  const requestedDriver = process.env["DEVRAGE_SQLITE_DRIVER"];
  if (requestedDriver) {
    const loader = driverLoader(requestedDriver);
    if (!loader) {
      return null;
    }

    try {
      return await loader(dbPath);
    } catch {
      return null;
    }
  }

  const loaders = isBunRuntime()
    ? [openWithBunSqlite, openWithNodeSqlite, openWithBetterSqlite3]
    : [openWithNodeSqlite, openWithBetterSqlite3];

  for (const loader of loaders) {
    try {
      return await loader(dbPath);
    } catch {
      continue;
    }
  }

  return null;
}

function driverLoader(driver: string): ((dbPath: string) => Promise<SqliteDatabase>) | null {
  switch (driver) {
    case "bun":
    case "bun:sqlite":
      return openWithBunSqlite;
    case "node":
    case "node:sqlite":
      return openWithNodeSqlite;
    case "better-sqlite3":
      return openWithBetterSqlite3;
    default:
      return null;
  }
}

function isBunRuntime(): boolean {
  return Boolean((process.versions as Record<string, string | undefined>)["bun"]);
}

async function openWithBunSqlite(dbPath: string): Promise<SqliteDatabase> {
  const specifier = "bun:sqlite";
  const sqlite = (await import(specifier)) as BunSqliteModule;
  const db = new sqlite.Database(dbPath, { readonly: true, create: false });

  return {
    prepare(sql: string) {
      const prepare = db.prepare ?? db.query;
      return prepare.call(db, sql);
    },
    close() {
      db.close();
    },
  };
}

async function openWithNodeSqlite(dbPath: string): Promise<SqliteDatabase> {
  const sqlite = await importNodeSqlite();
  return new sqlite.DatabaseSync(dbPath, { open: true, readOnly: true, timeout: 5000 });
}

async function openWithBetterSqlite3(dbPath: string): Promise<SqliteDatabase> {
  const BetterSqlite3 = await import("better-sqlite3");
  const Ctor = BetterSqlite3.default ?? BetterSqlite3;
  return new (Ctor as unknown as new (...args: unknown[]) => SqliteDatabase)(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
}

async function importNodeSqlite(): Promise<NodeSqliteModule> {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const message = typeof warning === "string" ? warning : warning.message;
    const type = typeof args[0] === "string" ? args[0] : undefined;
    if (
      message === "SQLite is an experimental feature and might change at any time" &&
      type === "ExperimentalWarning"
    ) {
      return;
    }

    (originalEmitWarning as (...emitArgs: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    const specifier = "node:sqlite";
    const sqlite = (await import(specifier)) as NodeSqliteModule;
    if (typeof sqlite.DatabaseSync !== "function") {
      throw new Error("node:sqlite DatabaseSync is unavailable");
    }
    return sqlite;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}
