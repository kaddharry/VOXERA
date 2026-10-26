/**
 * A tiny in-memory stand-in for the parts of the Supabase query builder the
 * schedule endpoints use (select/insert/update with eq/in/is filters). It
 * applies filters to real rows, so a test proves which rows a query would
 * actually read or change, not just which methods were called.
 */
type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

/** Reads a column, including a JSON path like "payload->>role". */
function read(row: Row, col: string): any {
  const clean = col.replace(/"/g, "");
  const [head, ...path] = clean.split(/->>?/);
  return path.reduce((v, key) => (v == null ? undefined : v[key]), row[head]);
}

function coerce(raw: string): any {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
}

/** Splits "a,b(c,d),e" on top-level commas. */
function splitTop(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** Parses a PostgREST logic expression: and(...), or(...), col.op.value. */
function parseLogic(expr: string): Filter {
  const group = expr.match(/^(and|or)\((.*)\)$/);
  if (group) {
    const subs = splitTop(group[2]).map(parseLogic);
    return group[1] === "and" ? (r) => subs.every((f) => f(r)) : (r) => subs.some((f) => f(r));
  }
  const [col, op, ...rest] = expr.split(".");
  const val = coerce(rest.join("."));
  switch (op) {
    case "eq":
      return (r) => read(r, col) === val;
    case "is":
      return (r) => (read(r, col) ?? null) === val;
    case "lt":
      return (r) => read(r, col) != null && read(r, col) < val;
    case "lte":
      return (r) => read(r, col) != null && read(r, col) <= val;
    case "gt":
      return (r) => read(r, col) != null && read(r, col) > val;
    case "gte":
      return (r) => read(r, col) != null && read(r, col) >= val;
    default:
      throw new Error(`fake-supabase: unsupported operator ${op}`);
  }
}

export function createFakeDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" = "select";
    let payload: Row | Row[] | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitTo: number | null = null;

    const run = () => {
      const rows = tables[table];
      if (op === "insert") {
        const toInsert = (Array.isArray(payload) ? payload : [payload]).map((r) => ({ ...r }));
        rows.push(...toInsert);
        return { data: toInsert.map((r) => ({ ...r })), error: null };
      }
      let matched = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") {
        for (const r of matched) Object.assign(r, payload);
      }
      if (orderBy) {
        const { col, asc } = orderBy;
        matched = [...matched].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (limitTo != null && op === "select") matched = matched.slice(0, limitTo);
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const builder: any = {
      select: () => builder,
      insert: (rows: Row | Row[]) => ((op = "insert"), (payload = rows), builder),
      update: (values: Row) => ((op = "update"), (payload = values), builder),
      eq: (col: string, val: unknown) => (filters.push((r) => read(r, col) === val), builder),
      neq: (col: string, val: unknown) => (filters.push((r) => read(r, col) !== val), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(read(r, col))), builder),
      is: (col: string, val: null) => (filters.push((r) => (read(r, col) ?? null) === val), builder),
      lt: (col: string, val: number) => (filters.push((r) => read(r, col) != null && read(r, col) < val), builder),
      lte: (col: string, val: number) => (filters.push((r) => read(r, col) != null && read(r, col) <= val), builder),
      gt: (col: string, val: number) => (filters.push((r) => read(r, col) != null && read(r, col) > val), builder),
      gte: (col: string, val: number) => (filters.push((r) => read(r, col) != null && read(r, col) >= val), builder),
      or: (expr: string) => (filters.push(parseLogic(`or(${expr})`)), builder),
      order: (col: string, opts?: { ascending?: boolean }) => ((orderBy = { col, asc: opts?.ascending !== false }), builder),
      // Like PostgREST, limit caps what a select returns (an update with
      // limit still matches every row it filters, which is all the
      // dispatcher's tests need).
      limit: (n: number) => ((limitTo = n), builder),
      single: async () => {
        const { data } = run();
        return data.length === 1 ? { data: data[0], error: null } : { data: null, error: { message: "not exactly one row" } };
      },
      maybeSingle: async () => {
        const { data } = run();
        return { data: data[0] ?? null, error: null };
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  }

  return { from, tables };
}
