/**
 * A tiny in-memory stand-in for the parts of the Supabase query builder the
 * schedule endpoints use (select/insert/update with eq/in/is filters). It
 * applies filters to real rows, so a test proves which rows a query would
 * actually read or change, not just which methods were called.
 */
type Row = Record<string, any>;
type Filter = (row: Row) => boolean;

export function createFakeDb(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "update" | "insert" = "select";
    let payload: Row | Row[] | null = null;
    let orderBy: { col: string; asc: boolean } | null = null;

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
      return { data: matched.map((r) => ({ ...r })), error: null };
    };

    const builder: any = {
      select: () => builder,
      insert: (rows: Row | Row[]) => ((op = "insert"), (payload = rows), builder),
      update: (values: Row) => ((op = "update"), (payload = values), builder),
      eq: (col: string, val: unknown) => (filters.push((r) => r[col] === val), builder),
      neq: (col: string, val: unknown) => (filters.push((r) => r[col] !== val), builder),
      in: (col: string, vals: unknown[]) => (filters.push((r) => vals.includes(r[col])), builder),
      is: (col: string, val: null) => (filters.push((r) => (r[col] ?? null) === val), builder),
      order: (col: string, opts?: { ascending?: boolean }) => ((orderBy = { col, asc: opts?.ascending !== false }), builder),
      limit: () => builder,
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
