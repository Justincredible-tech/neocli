/* NEO_SKILL_META
{
  "name": "sqlite_manager",
  "description": "Executes SQL queries against a local 'neodb.sqlite' database. Supports SELECT, INSERT, UPDATE, DELETE, and CREATE operations with parameterized queries.",
  "argsSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "SQL statement (SELECT, INSERT, UPDATE, DELETE, CREATE)" },
      "params": { "type": "array", "items": {}, "description": "Parameters for prepared statements (use ? placeholders in query)" },
      "action": { "type": "string", "enum": ["query", "tables", "schema"], "description": "Optional action: 'tables' lists all tables, 'schema' shows table structure" },
      "table": { "type": "string", "description": "Table name for 'schema' action" }
    }
  }
}
NEO_SKILL_META */

import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

/** Maximum query length allowed */
const MAX_QUERY_LENGTH = 10000;

/** Maximum number of results to return */
const MAX_RESULTS = 1000;

/** Allowed SQL operations */
const ALLOWED_OPERATIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'PRAGMA'];

/** Dangerous SQL patterns to block */
const DANGEROUS_PATTERNS = [
  /ATTACH\s+DATABASE/i,
  /DETACH\s+DATABASE/i,
  /LOAD_EXTENSION/i,
  /INTO\s+OUTFILE/i,
  /INTO\s+DUMPFILE/i,
];

/**
 * Validates a SQL query for safety.
 * @param query - The SQL query to validate
 * @throws Error if query is dangerous
 */
function validateQuery(query: string): void {
  if (!query || typeof query !== 'string') {
    throw new Error("Query must be a non-empty string.");
  }

  const trimmed = query.trim();

  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query too long (max ${MAX_QUERY_LENGTH} characters).`);
  }

  // Check if query starts with an allowed operation
  const upperQuery = trimmed.toUpperCase();
  const startsWithAllowed = ALLOWED_OPERATIONS.some(op =>
    upperQuery.startsWith(op + ' ') || upperQuery.startsWith(op + '\n') || upperQuery.startsWith(op + '\t')
  );

  if (!startsWithAllowed) {
    throw new Error(`SQL operation not allowed. Permitted: ${ALLOWED_OPERATIONS.join(', ')}`);
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(query)) {
      throw new Error("Query contains a blocked pattern for security reasons.");
    }
  }

  // Check for multiple statements (potential injection)
  const statementCount = (query.match(/;/g) || []).length;
  // Allow one semicolon at the end
  if (statementCount > 1 || (statementCount === 1 && !trimmed.endsWith(';'))) {
    throw new Error("Multiple SQL statements are not allowed. Execute one query at a time.");
  }
}

/**
 * Validates table name to prevent injection.
 * @param tableName - The table name to validate
 */
function validateTableName(tableName: string): string {
  if (!tableName || typeof tableName !== 'string') {
    throw new Error("Table name is required.");
  }

  // Only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name. Use only letters, numbers, and underscores.");
  }

  if (tableName.length > 64) {
    throw new Error("Table name too long (max 64 characters).");
  }

  return tableName;
}

interface QueryArgs {
  query?: string;
  params?: unknown[];
  action?: 'query' | 'tables' | 'schema';
  table?: string;
}

export async function run(args: QueryArgs): Promise<string> {
  const dbDir = path.join(process.cwd(), '.neo');
  const dbPath = path.join(dbDir, 'neodb.sqlite');

  // Ensure directory exists
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  let db: DatabaseType | null = null;

  try {
    db = new Database(dbPath);

    // Enable foreign keys and set safe pragmas
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');

    // Handle special actions
    if (args.action === 'tables') {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      if (tables.length === 0) {
        return "No tables found in database.";
      }
      return `Tables in database:\n${tables.map(t => `  - ${t.name}`).join('\n')}`;
    }

    if (args.action === 'schema') {
      if (!args.table) {
        return "Error: 'table' parameter required for 'schema' action.";
      }
      const safeName = validateTableName(args.table);
      const schema = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`).get(safeName) as { sql: string } | undefined;
      if (!schema) {
        return `Table '${safeName}' not found.`;
      }
      return `Schema for '${safeName}':\n${schema.sql}`;
    }

    // Regular query execution
    if (!args.query) {
      return "Error: 'query' parameter is required. Use 'action: tables' to list tables.";
    }

    validateQuery(args.query);

    const trimmedQuery = args.query.trim().toUpperCase();
    const isSelect = trimmedQuery.startsWith('SELECT') || trimmedQuery.startsWith('PRAGMA');
    const stmt = db.prepare(args.query);

    // Safely handle params - ensure they're primitive values
    const safeParams = (args.params || []).map(p => {
      if (p === null || p === undefined) return null;
      if (typeof p === 'string' || typeof p === 'number' || typeof p === 'boolean') return p;
      if (typeof p === 'bigint') return p.toString();
      return String(p);
    });

    if (isSelect) {
      const results = stmt.all(...safeParams) as Record<string, unknown>[];

      if (results.length === 0) {
        return "Query returned no results.";
      }

      if (results.length > MAX_RESULTS) {
        const truncated = results.slice(0, MAX_RESULTS);
        return JSON.stringify(truncated, null, 2) + `\n\n[Truncated: showing ${MAX_RESULTS} of ${results.length} results]`;
      }

      return JSON.stringify(results, null, 2);
    } else {
      const info = stmt.run(...safeParams);
      return `Success: ${info.changes} row(s) affected. Last inserted ID: ${info.lastInsertRowid}`;
    }
  } catch (e: unknown) {
    const error = e as Error;
    return `SQL Error: ${error.message}`;
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close errors
      }
    }
  }
}