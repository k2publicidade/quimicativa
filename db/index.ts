import type { D1Database } from "@cloudflare/workers-types";
import { supabaseAdmin } from "../lib/supabase/admin";
import { getFiles as storageGetFiles } from "../lib/supabase/storage";

export const getFiles = storageGetFiles;

/**
 * Camada de compatibilidade D1 -> Supabase.
 *
 * O app foi escrito sobre o D1 (SQLite) com SQL parametrizado por `?` e usa
 * `getD1().prepare(sql).bind(...).first()/.all()/.run()`. O Supabase e acessado
 * por HTTPS (Cloudflare Workers nao abre TCP para o Postgres), entao este
 * modulo expoe a MESMA interface do D1 sobre o RPC `exec_sql`.
 *
 * Resultado: as rotas de API nao precisam de nenhuma alteracao.
 * Os tipos no banco espelham o SQLite (bigserial, bigint epoch, 0/1, JSON text),
 * entao os valores chegam ao app exatamente como antes.
 */

type Row = Record<string, unknown>;

/** Escapa um valor JS como literal SQL (o RPC recebe a consulta montada). */
function literal(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return String(Math.floor(value.getTime() / 1000));
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Troca cada `?` (fora de strings) pelo literal correspondente. */
function inline(sql: string, params: unknown[]): string {
  let index = 0;
  let out = "";
  let inString = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inString = !inString;
    if (ch === "?" && !inString) {
      out += literal(params[index++]);
      continue;
    }
    out += ch;
  }
  return out;
}

async function execute(
  sql: string,
  params: unknown[],
  expectRows: boolean,
): Promise<Row[]> {
  const query = inline(sql.trim().replace(/;\s*$/, ""), params);
  const { data, error } = await supabaseAdmin().rpc("exec_sql", {
    query,
    expect_rows: expectRows,
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Row[]) : [];
}

export type D1Result<T> = {
  results: T[];
  success: boolean;
  meta: Record<string, unknown>;
};

class PreparedStatement {
  constructor(
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...values: unknown[]): PreparedStatement {
    return new PreparedStatement(this.sql, values);
  }

  /** Compatibilidade estrutural com D1PreparedStatement. */
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const rows = await execute(this.sql, this.params, true);
    const values = rows.map((row) => Object.values(row));
    if (options?.columnNames && rows.length) {
      return [Object.keys(rows[0]), ...values] as unknown as T[];
    }
    return values as unknown as T[];
  }

  /** Consulta final com os literais ja embutidos (usado no batch). */
  toQuery(): string {
    return inline(this.sql.trim().replace(/;\s*$/, ""), this.params);
  }

  async first<T = Row>(): Promise<T | null> {
    const rows = await execute(this.sql, this.params, true);
    return (rows[0] as T) ?? null;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    const rows = await execute(this.sql, this.params, true);
    return { results: rows as T[], success: true, meta: {} };
  }

  async run(): Promise<D1Result<Row>> {
    // Instrucoes sem RETURNING nao devolvem linhas; com RETURNING, devolvem.
    const rows = await execute(
      this.sql,
      this.params,
      /\breturning\b/i.test(this.sql),
    );
    return { results: rows, success: true, meta: {} };
  }
}

/** Substituto do binding D1: mesma API (prepare/bind/first/all/run). */
export function getD1(): D1Database {
  return {
    prepare: (sql: string) => new PreparedStatement(sql),
    async batch(statements: PreparedStatement[]) {
      // Uma unica transacao no banco (equivalente ao batch do D1).
      const queries = statements.map((statement) =>
        statement.toQuery(),
      );
      const { data, error } = await supabaseAdmin().rpc("exec_sql_batch", {
        queries,
      });
      if (error) throw new Error(error.message);
      const results = Array.isArray(data) ? (data as Row[][]) : [];
      return results.map((rows) => ({
        results: Array.isArray(rows) ? rows : [],
        success: true,
        meta: {},
      }));
    },
    async exec(sql: string) {
      await execute(sql, [], false);
      return { count: 0, duration: 0 };
    },
    /** Compatibilidade estrutural com D1Database. */
    withSession() {
      return getD1();
    },
    async dump() {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

/** Mantido por compatibilidade com codigo que importava getDb(). */
export function getDb() {
  return getD1();
}
